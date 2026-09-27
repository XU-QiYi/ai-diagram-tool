import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runCli } from '../src/cli.js';

test('validate command returns zero for a valid model and writes JSON report', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-diagram-cli-'));
  const input = path.join(dir, 'valid.model.json');
  const report = path.join(dir, 'report.json');
  await fs.writeFile(input, JSON.stringify({ id: 'cli-flow', title: 'CLI Flow', type: 'flowchart', nodes: [{ id: 'node.a', label: 'A' }, { id: 'node.b', label: 'B' }], edges: [{ id: 'edge.a-b', source: 'node.a', target: 'node.b', type: 'flow' }] }));
  const code = await runCli(['validate', input, '--report', report]);
  assert.equal(code, 0);
  const result = JSON.parse(await fs.readFile(report, 'utf8'));
  assert.equal(result.valid, true);
  assert.equal(result.status, 'passed');
  assert.equal(result.iterationHistory.length, 1);
});

test('help command is explicit and does not interpret help as diagram input', async () => {
  assert.equal(await runCli(['help']), 0);
});

test('validate command returns nonzero and reports missing metadata references', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-diagram-cli-'));
  const input = path.join(dir, 'invalid.model.json');
  const report = path.join(dir, 'report.json');
  await fs.writeFile(input, JSON.stringify({
    id: 'invalid-activity',
    title: 'Invalid Activity',
    type: 'activity',
    nodes: [
      { id: 'node.start', label: 'Start', kind: 'start' },
      { id: 'node.end', label: 'End', kind: 'end' },
    ],
    edges: [{ id: 'edge.start-end', source: 'node.start', target: 'node.end', type: 'flow' }],
    activity: { objectFlows: ['edge.missing'] },
  }));
  const code = await runCli(['validate', input, '--report', report]);
  const result = JSON.parse(await fs.readFile(report, 'utf8'));
  assert.equal(code, 1);
  assert.equal(result.valid, false);
  assert.ok(result.issues.some((issue: { severity: string; message: string }) =>
    issue.severity === 'ERROR' && issue.message === 'Activity object flow references missing edge: edge.missing',
  ));
});

test('render command writes editable Draw.io and SVG artifacts', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-diagram-cli-'));
  const input = path.join(dir, 'valid.model.json');
  const out = path.join(dir, 'rendered');
  await fs.writeFile(input, JSON.stringify({ id: 'cli-flow', title: 'CLI Flow', type: 'flowchart', nodes: [{ id: 'node.a', label: 'A' }, { id: 'node.b', label: 'B' }], edges: [{ id: 'edge.a-b', source: 'node.a', target: 'node.b', type: 'flow' }] }));
  const code = await runCli(['render', input, '--out', out]);
  assert.equal(code, 0);
  assert.ok((await fs.stat(path.join(out, 'cli-flow.drawio'))).isFile());
  assert.ok((await fs.stat(path.join(out, 'cli-flow.svg'))).isFile());
});

test('generate command returns nonzero when the input model fails semantic validation', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-diagram-cli-'));
  const input = path.join(dir, 'invalid.model.json');
  const out = path.join(dir, 'generated');
  await fs.writeFile(input, JSON.stringify({
    id: 'invalid-activity',
    title: 'Invalid Activity',
    type: 'activity',
    nodes: [
      { id: 'node.start', label: 'Start', kind: 'start' },
      { id: 'node.end', label: 'End', kind: 'end' },
    ],
    edges: [{ id: 'edge.start-end', source: 'node.start', target: 'node.end', type: 'flow' }],
    activity: { objectFlows: ['edge.missing'] },
  }));
  const code = await runCli(['generate', '--input', input, '--out', out]);
  assert.equal(code, 1);
  assert.ok((await fs.stat(path.join(out, 'invalid-activity.drawio'))).isFile());
});

test('generate command rejects an underspecified natural-language request without writing a template', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-diagram-cli-'));
  const out = path.join(dir, 'generated');
  const code = await runCli(['generate', '画一个时序图', '--out', out]);
  assert.equal(code, 1);
  await assert.rejects(() => fs.stat(out));
});

test('generate command rejects low-confidence ordinary language without writing a diagram', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-diagram-cli-'));
  const out = path.join(dir, 'generated');
  const code = await runCli(['generate', '请生成到期提醒', '--out', out]);
  assert.equal(code, 1);
  await assert.rejects(() => fs.stat(out));
});
