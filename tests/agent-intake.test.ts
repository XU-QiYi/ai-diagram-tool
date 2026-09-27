import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { callTool } from '../src/mcp/tools.js';
import { ToolError } from '../src/mcp/guards.js';

/**
 * An external reasoner supplies the semantics and the visual findings. These tests hold
 * submitted answers to the same gates the in-project planner faced, and assert that no
 * coordinate can travel back in through either channel.
 */

const REQUEST = '用户调用订单服务，订单服务写入数据库';
const evidence = (quote: string) => ({ source: 'request', quote, confidence: 0.95 });

interface AnswerLike {
  diagram: { nodes: Array<Record<string, unknown>>; [key: string]: unknown };
  confidence: number;
  uncertainties: unknown[];
}

function answer(): AnswerLike {
  const node = (id: string, label: string, quote: string): Record<string, unknown> => ({ id, label, kind: 'service', provenance: evidence(quote) });
  return {
    diagram: {
      id: 'agent-order-flow',
      title: 'Order Flow',
      type: 'flowchart',
      direction: 'TOP_TO_BOTTOM',
      nodes: [node('node.user', '用户', '用户'), node('node.order', '订单服务', '订单服务'), node('node.db', '数据库', '数据库')],
      edges: [
        { id: 'edge.user-order', source: 'node.user', target: 'node.order', type: 'flow', provenance: evidence('用户调用订单服务') },
        { id: 'edge.order-db', source: 'node.order', target: 'node.db', type: 'flow', provenance: evidence('订单服务写入数据库') },
      ],
    },
    confidence: 0.93,
    uncertainties: [],
  };
}

function smuggledAnswer(): AnswerLike {
  const payload = answer();
  payload.diagram.nodes[1].x = 640;
  return payload;
}

function unsupportedAnswer(): AnswerLike {
  const payload = answer();
  (payload.diagram.nodes[2].provenance as { quote: string }).quote = '不存在的缓存服务';
  return payload;
}

let workspace = '';
before(async () => {
  workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-agent-intake-'));
});
after(async () => {
  await fs.rm(workspace, { recursive: true, force: true });
});

async function payload(result: Awaited<ReturnType<typeof callTool>>): Promise<Record<string, any>> {
  const text = result.content[0]?.text ?? '';
  assert.ok(text.startsWith('{'), `expected a JSON payload, got: ${text.slice(0, 160)}`);
  return JSON.parse(text) as Record<string, any>;
}

const sources = { text: REQUEST };
const env = {};

test('plan_request hands the caller a task that states who owns geometry', async () => {
  const json = await payload(await callTool('diagram_plan_request', sources, { root: workspace, env }));
  assert.match(json.task.system, /Do not output x, y, width, height/);
  assert.ok(json.task.rules.every((rule: string) => rule.trim().length > 0));
  assert.equal(json.task.messages[0].role, 'system', 'the task is ready to send to any chat model');
});

test('plan_submit lays out an accepted answer and writes editable artifacts', async () => {
  const json = await payload(await callTool('diagram_plan_submit', {
    ...sources,
    answer: answer(),
    audit: { confidence: 0.9, missing: [], unsupportedElementIds: [] },
    out: 'submitted',
  }, { root: workspace, env }));
  assert.equal(json.written.valid, true, JSON.stringify(json.written.issues));
  assert.equal(json.written.counts.nodes, 3);
  assert.equal(json.written.evidence.verified, 5, 'every quote is re-verified verbatim against the request');
  assert.ok(json.written.auditConfidence >= 0.7);
  assert.ok(json.written.layoutIterations >= 1);
  const model = JSON.parse(await fs.readFile(path.join(workspace, 'submitted', 'agent-order-flow.model.json'), 'utf8'));
  assert.ok(model.nodes.every((node: Record<string, unknown>) => !('x' in node) && !('y' in node)));
  assert.match(await fs.readFile(path.join(workspace, 'submitted', 'agent-order-flow.drawio'), 'utf8'), /<mxfile/);
});

test('an answer smuggling coordinates is refused and writes nothing', async () => {
  await assert.rejects(
    callTool('diagram_plan_submit', { ...sources, answer: smuggledAnswer(), out: 'rejected-geometry' }, { root: workspace, env }),
    /MODEL_GEOMETRY_FORBIDDEN/,
  );
  assert.ok(!existsSync(path.join(workspace, 'rejected-geometry', 'agent-order-flow.drawio')), 'a refused answer must not leave a diagram behind');
});

test('an answer whose evidence is not in the sources is refused', async () => {
  await assert.rejects(
    callTool('diagram_plan_submit', { ...sources, answer: unsupportedAnswer() }, { root: workspace, env }),
    /UNSUPPORTED_EVIDENCE/,
  );
});

test('a missing audit is reported as unreviewed, never as a pass', async () => {
  const json = await payload(await callTool('diagram_plan_submit', { ...sources, answer: answer(), out: 'no-audit' }, { root: workspace, env }));
  const warning = json.written.issues.find((issue: { code: string }) => issue.code === 'SEMANTIC_AUDIT_SKIPPED');
  assert.equal(warning.severity, 'WARNING');
  assert.equal(json.written.auditConfidence, 0, 'the report must not imply an audit happened');
});

test('review request packages the bitmap with only referenceable ids', async () => {
  const json = await payload(await callTool('diagram_review_request', { modelPath: 'submitted/agent-order-flow.model.json', out: 'review' }, { root: workspace, env }));
  assert.ok(existsSync(json.task.pngPath), `bitmap missing: ${json.task.pngPath}`);
  assert.ok(json.task.width > 0 && json.task.height > 0);
  assert.ok(json.task.elementIds.includes('node.order'));
  assert.match(json.task.geometryFacts, /CANVAS/);
  assert.ok(json.task.allowedFields.includes('nodeSpacing'));
  assert.ok(!json.task.allowedFields.some((field: string) => ['x', 'y', 'dx', 'dy', 'portCoord'].includes(field)));
});

test('review findings only move layout preferences; coordinates are discarded and ELK re-runs', async () => {
  const findings = {
    findings: [
      { code: 'VISUAL_CROWDED', elementId: 'node.order', severity: 'ERROR', observation: 'boxes sit too close', hint: 'increase nodeSpacing', x: 12, y: 34 },
      { code: 'VISUAL_CROWDED', elementId: 'node.ghost', severity: 'ERROR', observation: 'invented element', hint: 'increase layerSpacing' },
    ],
  };
  const json = await payload(await callTool('diagram_review_submit', { modelPath: 'submitted/agent-order-flow.model.json', findings, out: 'reviewed' }, { root: workspace, env }));
  assert.match(json.applied.map((issue: { message: string }) => issue.message).join('; '), /nodeSpacing/, 'an accepted finding must become a layout preference');
  assert.ok(json.discarded.some((issue: { code: string }) => /COORDINATE/i.test(issue.code)), 'the smuggled x/y must be reported as discarded');
  assert.ok(json.discarded.some((issue: { code: string }) => /UNKNOWN_ELEMENT_ID/i.test(issue.code)), 'the invented element id must control nothing');
  const model = JSON.parse(await fs.readFile(path.join(workspace, 'reviewed', 'agent-order-flow.model.json'), 'utf8'));
  assert.ok(typeof model.layout?.nodeSpacing === 'number' && model.layout.nodeSpacing > 0);
  assert.ok(!JSON.stringify(model).includes('"x"'), 'no coordinates may enter the model');
  assert.ok(json.written.diagrams[0].valid, 'the re-laid-out diagram must still pass the numeric validators');
});

test('findings that no preference can fix are reported instead of faked', async () => {
  const json = await payload(await callTool('diagram_review_submit', {
    modelPath: 'submitted/agent-order-flow.model.json',
    findings: { findings: [{ code: 'VISUAL_LABEL_TRUNCATED', elementId: 'node.db', severity: 'ERROR', observation: 'the label is cut off', hint: 'shorten the wording' }] },
    out: 'unsolvable',
  }, { root: workspace, env }));
  assert.equal(json.needsSemanticChange, true);
  assert.equal(json.applied.length, 0, 'nothing may be reported as fixed');
});

test('an inline answer that dictates geometry is refused as a request error', async () => {
  await assert.rejects(
    callTool('diagram_plan_submit', { ...sources, answer: smuggledAnswer(), out: 'inline' }, { root: workspace, env }),
    (error: unknown) => {
      assert.ok(error instanceof Error, 'the refusal must be an Error');
      assert.match(error.message, /MODEL_GEOMETRY_FORBIDDEN|geometry/i);
      return true;
    },
  );
});
