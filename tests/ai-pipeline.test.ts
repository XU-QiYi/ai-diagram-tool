import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { prepareInput } from '../src/ai/input.js';
import { planDiagram, SemanticPlanningError } from '../src/ai/pipeline.js';
import type { SemanticPlanner } from '../src/ai/types.js';
import { runCli } from '../src/cli.js';

const request = '用户调用服务';
const goodAudit = () => ({ confidence: 0.92, missing: [], unsupportedElementIds: [] });
const goodPlan = () => ({
  confidence: 0.94,
  uncertainties: [],
  diagram: {
    id: 'user-service',
    title: '调用关系',
    type: 'system-architecture',
    // These tests pin the strict contract (quotes re-verified, confidence enforced);
    // the ai-led default is covered in tests/validation-profile.test.ts.
    layout: { profile: 'strict' },
    nodes: [
      { id: 'node.user', label: '用户', provenance: { source: 'request', quote: '用户', confidence: 0.95 } },
      { id: 'node.service', label: '服务', provenance: { source: 'request', quote: '服务', confidence: 0.95 } },
    ],
    edges: [
      {
        id: 'edge.user-service',
        source: 'node.user',
        target: 'node.service',
        type: 'uses',
        provenance: { source: 'request', quote: '调用', confidence: 0.9 },
      },
    ],
  },
});

test('AI plan uses source evidence and passes through ELK', async () => {
  const input = await prepareInput({ text: request });
  const planner: SemanticPlanner = {
    plan: async () => goodPlan(),
    revise: async () => {
      throw new Error('unexpected revision');
    },
    audit: async () => goodAudit(),
  };
  const result = await planDiagram(input, planner);
  assert.equal(result.plan.diagram.nodes.length, 2);
  assert.equal(result.quality.valid, true);
  assert.equal(result.quality.attempts, 1);
  assert.equal(result.quality.auditConfidence, 0.92);
  assert.equal(result.quality.evidence.modelReported, 0);
  assert.ok(result.layout.nodes.every((node) => Number.isFinite(node.x)));
});

test('unsupported claims and low confidence cannot produce a diagram', async () => {
  const input = await prepareInput({ text: request });
  const bad = goodPlan();
  bad.diagram.nodes[1].label = '库存';
  bad.diagram.nodes[1].provenance.quote = '库存';
  bad.confidence = 0.5;
  let revisions = 0;
  const planner: SemanticPlanner = {
    plan: async () => bad,
    revise: async () => {
      revisions++;
      return bad;
    },
    audit: async () => goodAudit(),
  };
  await assert.rejects(
    () => planDiagram(input, planner),
    (error: unknown) => {
      assert.ok(error instanceof SemanticPlanningError);
      assert.ok(error.issues.some((issue) => issue.code === 'UNSUPPORTED_EVIDENCE'));
      assert.ok(error.issues.some((issue) => issue.code === 'LOW_CONFIDENCE'));
      return true;
    },
  );
  assert.equal(revisions, 2);
});

test('planner may correct an invalid first attempt without changing stable IDs', async () => {
  const input = await prepareInput({ text: request });
  const first = goodPlan();
  first.diagram.edges[0].provenance.quote = '不存在';
  let revised = false;
  const planner: SemanticPlanner = {
    plan: async () => first,
    revise: async (_input, _previous, feedback) => {
      assert.ok(feedback.issues.some((issue) => issue.code === 'UNSUPPORTED_EVIDENCE'));
      revised = true;
      return goodPlan();
    },
    audit: async () => goodAudit(),
  };
  const result = await planDiagram(input, planner);
  assert.equal(revised, true);
  assert.equal(result.quality.attempts, 2);
  assert.equal(result.plan.diagram.edges[0].id, 'edge.user-service');
});

test('AI coordinates are rejected even with otherwise valid evidence', async () => {
  const input = await prepareInput({ text: request });
  const plan = goodPlan() as ReturnType<typeof goodPlan> & { diagram: { nodes: Array<{ x?: number }> } };
  plan.diagram.nodes[0].x = 42;
  const planner: SemanticPlanner = { plan: async () => plan, revise: async () => plan, audit: async () => goodAudit() };
  await assert.rejects(
    () => planDiagram(input, planner),
    (error: unknown) => {
      assert.ok(error instanceof SemanticPlanningError);
      assert.ok(error.issues.some((issue) => issue.code === 'MODEL_GEOMETRY_FORBIDDEN'));
      return true;
    },
  );
});

test('AI cannot introduce an unsupported relationship type', async () => {
  const input = await prepareInput({ text: request });
  const plan = goodPlan();
  plan.diagram.edges[0].type = 'magic';
  const planner: SemanticPlanner = { plan: async () => plan, revise: async () => plan, audit: async () => goodAudit() };
  await assert.rejects(
    () => planDiagram(input, planner),
    (error: unknown) => {
      assert.ok(error instanceof SemanticPlanningError);
      assert.ok(error.issues.some((item) => item.code === 'INVALID_RELATIONSHIP_TYPE'));
      return true;
    },
  );
});

test('independent semantic review triggers revision for omitted requirements', async () => {
  const input = await prepareInput({ text: '用户调用服务，服务写入数据库' });
  const revised = goodPlan();
  revised.diagram.nodes.push({
    id: 'node.database',
    label: '数据库',
    provenance: { source: 'request', quote: '数据库', confidence: 0.93 },
  });
  revised.diagram.edges.push({
    id: 'edge.service-database',
    source: 'node.service',
    target: 'node.database',
    type: 'uses',
    provenance: { source: 'request', quote: '写入', confidence: 0.9 },
  });
  let audits = 0;
  const planner: SemanticPlanner = {
    plan: async () => goodPlan(),
    audit: async () =>
      ++audits === 1
        ? {
            confidence: 0.9,
            missing: [{ source: 'request', quote: '服务写入数据库', reason: 'Database write omitted' }],
            unsupportedElementIds: [],
          }
        : goodAudit(),
    revise: async (_input, _previous, feedback) => {
      assert.ok(feedback.issues.some((item) => item.code === 'MISSING_REQUIREMENT'));
      return revised;
    },
  };
  const result = await planDiagram(input, planner);
  assert.equal(result.quality.attempts, 2);
  assert.equal(result.plan.diagram.nodes.length, 3);
});

test('document and image inputs are real files with validated types', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'diagram-ai-input-'));
  const document = path.join(dir, 'request.md');
  const image = path.join(dir, 'reference.png');
  const template = path.join(dir, 'reference.model.json');
  await fs.writeFile(document, '# 关系\n用户调用服务');
  await fs.writeFile(image, Buffer.from('89504e470d0a1a0a00000000', 'hex'));
  await fs.writeFile(template, JSON.stringify(goodPlan().diagram));
  const textInput = await prepareInput({ document });
  assert.equal(textInput.sources[0].kind, 'document');
  assert.match(textInput.sources[0].text ?? '', /用户调用服务/);
  const imageInput = await prepareInput({ image, text: '按图绘制' });
  assert.equal(imageInput.sources[0].kind, 'image');
  assert.match(imageInput.sources[0].dataUrl ?? '', /^data:image\/png;base64,/);
  const templateInput = await prepareInput({ text: request, template });
  assert.equal(templateInput.sources[1].kind, 'template');
  assert.match(templateInput.sources[1].text ?? '', /node\.user/);
  await assert.rejects(() => prepareInput({ document: path.join(dir, 'bad.exe') }), /Unsupported document format/);
});

test('PDF adapter extracts searchable text', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'diagram-ai-pdf-'));
  const file = path.join(dir, 'request.pdf');
  const stream = 'BT /F1 12 Tf 40 60 Td (User calls Service) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 100] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  await fs.writeFile(file, pdf);
  const input = await prepareInput({ document: file });
  assert.match(input.sources[0].text ?? '', /User calls Service/);
});

test('the CLI emits a planning task and accepts an answered one', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'diagram-agent-cli-'));
  const out = path.join(dir, 'out');
  const taskFile = path.join(dir, 'task.json');
  // Emission needs no credential and performs no request.
  assert.equal(await runCli(['generate', '--text', request, '--emit-plan', taskFile, '--out', out]), 0);
  const task = JSON.parse(await fs.readFile(taskFile, 'utf8')) as {
    system: string;
    messages: Array<{ role: string; content: unknown }>;
    rules: string[];
  };
  assert.match(task.system, /Do not output x, y, width, height/);
  assert.equal(task.messages[0].role, 'system');
  assert.ok(
    task.rules.some((rule) => /coordinates|ELK/.test(rule)),
    'the task states who owns geometry',
  );
  assert.deepEqual(await fs.readdir(out).catch(() => []), [], 'emitting a task writes no diagram');

  const answerFile = path.join(dir, 'answer.json');
  const auditFile = path.join(dir, 'audit.json');
  await fs.writeFile(answerFile, JSON.stringify(goodPlan()), 'utf8');
  await fs.writeFile(auditFile, JSON.stringify(goodAudit()), 'utf8');
  assert.equal(
    await runCli(['generate', '--text', request, '--plan', answerFile, '--audit', auditFile, '--out', out]),
    0,
  );

  const quality = JSON.parse(await fs.readFile(path.join(out, 'user-service.quality.json'), 'utf8'));
  assert.equal(quality.valid, true);
  assert.equal(quality.evidence.verified, 3, 'evidence quotes are re-verified against the request on the way in');
  assert.ok(quality.auditConfidence >= 0.7);
  assert.match(await fs.readFile(path.join(out, 'user-service.drawio'), 'utf8'), /mxGraphModel/);
  assert.match(await fs.readFile(path.join(out, 'user-service.svg'), 'utf8'), /<svg/);
});

test('an unsupported answer is refused and writes nothing', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'diagram-agent-bad-'));
  const out = path.join(dir, 'out');
  const unsupported = goodPlan() as typeof goodPlan extends () => infer R ? R : never;
  (unsupported as { diagram: { nodes: Array<{ provenance: { quote: string } }> } }).diagram.nodes[0].provenance.quote =
    '不存在的依赖';
  const answerFile = path.join(dir, 'answer.json');
  await fs.writeFile(answerFile, JSON.stringify(unsupported), 'utf8');
  assert.equal(await runCli(['generate', '--text', request, '--plan', answerFile, '--out', out]), 1);
  await assert.rejects(() => fs.stat(path.join(out, 'user-service.drawio')));
});

test('an answer smuggling coordinates is refused by the same geometry gate', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'diagram-agent-geom-'));
  const smuggled = JSON.parse(JSON.stringify(goodPlan())) as { diagram: { nodes: Array<Record<string, unknown>> } };
  smuggled.diagram.nodes[0].x = 240;
  const answerFile = path.join(dir, 'answer.json');
  await fs.writeFile(answerFile, JSON.stringify(smuggled), 'utf8');
  assert.equal(await runCli(['generate', '--text', request, '--plan', answerFile, '--out', path.join(dir, 'out')]), 1);
});

test('a model-free path is available without any submission', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'diagram-agent-chain-'));
  assert.equal(await runCli(['generate', '--chain', '--text', '用户 → 服务 → 数据库', '--out', dir]), 0);
  const files = await fs.readdir(dir);
  assert.ok(
    files.includes('user-service-flowchart.drawio') || files.some((file) => file.endsWith('.drawio')),
    `drawio missing in ${files.join(', ')}`,
  );
  // Asking for a diagram with no plan source and no --chain must be refused, not guessed.
  assert.equal(await runCli(['generate', '--text', request, '--out', path.join(dir, 'none')]), 1);
});
