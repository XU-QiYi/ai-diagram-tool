import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { callTool } from '../src/mcp/tools.js';
import { ToolError } from '../src/mcp/guards.js';
import { handleRequest } from '../src/mcp/server.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverEntry = path.join(projectRoot, 'src', 'mcp', 'server.ts');

/** A minimal, valid two-node model used to drive the file producing tools. */
function sampleModel(overrides: Record<string, unknown> = {}): Record<string, any> {
  return {
    id: 'mcp-sample',
    title: 'MCP Sample Flow',
    type: 'flowchart',
    direction: 'TOP_TO_BOTTOM',
    nodes: [
      { id: 'node.start', label: 'Start', kind: 'start' },
      { id: 'node.finish', label: 'Finish', kind: 'end' },
    ],
    edges: [{ id: 'edge.start-finish', source: 'node.start', target: 'node.finish', type: 'flow' }],
    ...overrides,
  };
}

let workspace = '';

before(async () => {
  workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-diagram-mcp-'));
});

after(async () => {
  await fs.rm(workspace, { recursive: true, force: true });
});

async function payload(result: Awaited<ReturnType<typeof callTool>>): Promise<Record<string, any>> {
  const text = result.content[0]?.text ?? '';
  assert.ok(text.startsWith('{'), `expected a JSON tool payload, got: ${text.slice(0, 200)}`);
  return JSON.parse(text) as Record<string, any>;
}

test('diagram_validate reports a clean model without writing files', async () => {
  const result = await callTool('diagram_validate', { model: sampleModel() }, { root: workspace, env: {} });
  const json = await payload(result);
  assert.equal(result.isError, undefined);
  assert.equal(json.valid, true);
  assert.equal(json.counts.nodes, 2);
  assert.equal(json.counts.edges, 1);
  assert.ok(json.iterations >= 1);
  assert.equal(json.canvas.width > 0, true);
  // validate must be side-effect free
  assert.deepEqual(await fs.readdir(workspace), []);
});

test('diagram_validate surfaces semantic errors as a report, not a crash', async () => {
  const broken = sampleModel({
    edges: [{ id: 'edge.bad', source: 'node.start', target: 'node.does-not-exist', type: 'flow' }],
  });
  const result = await callTool('diagram_validate', { model: broken }, { root: workspace, env: {} });
  const json = await payload(result);
  assert.equal(json.status, 'rejected_before_layout');
  assert.equal(json.valid, false);
  assert.equal(json.counts.nodes, 0);
  const error = json.issues.find((issue: { severity: string }) => issue.severity === 'ERROR');
  assert.equal(error.code, 'INVALID_MODEL');
  assert.match(error.message, /node\.does-not-exist/);
});

test('diagram_render writes .model.json, .drawio and .svg', async () => {
  const out = path.join(workspace, 'rendered');
  const result = await callTool('diagram_render', { model: sampleModel(), out: 'rendered' }, { root: workspace, env: {} });
  const json = await payload(result);
  assert.equal(result.isError, undefined);
  assert.equal(json.written.diagrams.length, 1);
  assert.equal(json.written.diagrams[0].valid, true);
  for (const suffix of ['.model.json', '.drawio', '.svg']) {
    const file = path.join(out, `mcp-sample${suffix}`);
    const stat = await fs.stat(file);
    assert.ok(stat.size > 0, `${suffix} should be non-empty`);
  }
  const drawio = await fs.readFile(path.join(out, 'mcp-sample.drawio'), 'utf8');
  assert.match(drawio, /<mxfile/i);
  assert.match(drawio, /<mxGraphModel/i);
});

test('diagram_patch keeps existing stable ids and adds the new node', async () => {
  const modelPath = path.join(workspace, 'patch-base.model.json');
  await fs.writeFile(modelPath, JSON.stringify(sampleModel(), null, 2), 'utf8');
  const result = await callTool(
    'diagram_patch',
    {
      modelPath: 'patch-base.model.json',
      out: 'patched',
      patch: {
        addNodes: [{ id: 'node.review', label: 'Review', kind: 'process' }],
        addEdges: [{ id: 'edge.review-finish', source: 'node.review', target: 'node.finish', type: 'flow' }],
        updateNodes: [{ id: 'node.start', label: 'Submit' }],
      },
    },
    { root: workspace, env: {} },
  );
  const json = await payload(result);
  assert.equal(result.isError, undefined);
  assert.ok(json.stableIds.preserved.includes('node.start'));
  assert.ok(json.stableIds.preserved.includes('node.finish'));
  assert.ok(json.stableIds.added.includes('node.review'));
  const patched = JSON.parse(await fs.readFile(path.join(workspace, 'patched', 'mcp-sample.model.json'), 'utf8'));
  assert.equal(patched.nodes.find((node: { id: string }) => node.id === 'node.start').label, 'Submit');
  assert.equal(
    patched.nodes.some((node: { id: string }) => node.id === 'node.finish'),
    true,
    'untouched nodes must survive the patch',
  );
});

test('a model carrying coordinates is refused before layout runs', async () => {
  const smuggled = sampleModel();
  smuggled.nodes[0].x = 120;
  smuggled.nodes[0].y = -40;
  await assert.rejects(
    callTool('diagram_validate', { model: smuggled }, { root: workspace, env: {} }),
    (error: unknown) => {
      assert.equal((error as { code?: string }).code, 'INPUT_GEOMETRY_FORBIDDEN');
      assert.match((error as Error).message, /ELK computes every position/);
      return true;
    },
  );
});

test('a patched model with absolute positions is refused with an explanation', async () => {
  await assert.rejects(
    callTool(
      'diagram_render',
      { model: sampleModel({ nodes: [{ id: 'node.a', label: 'A' }, { id: 'node.b', label: 'B', mxGeometry: '<mxGeometry x="1"/>' }] }), out: 'nope' },
      { root: workspace, env: {} },
    ),
    /Geometry must not be supplied by the caller/,
  );
});

test('a patch that tries to place nodes is refused', async () => {
  await assert.rejects(
    callTool(
      'diagram_patch',
      { model: sampleModel(), patch: { updateNodes: [{ id: 'node.start', x: 900, y: 900 }] }, out: 'nope' },
      { root: workspace, env: {} },
    ),
    /Geometry must not be supplied/,
  );
});

test('relative paths cannot escape the workspace root', async () => {
  await assert.rejects(
    callTool('diagram_validate', { modelPath: '../../etc/passwd' }, { root: workspace, env: {} }),
    (error: unknown) => {
      if (!(error instanceof ToolError)) throw new Error(`expected a ToolError, got ${String(error)}`);
      assert.equal(error.code, 'PATH_OUTSIDE_WORKSPACE');
      assert.match(error.message, /outside the server root/);
      return true;
    },
  );
});

test('generate without a configured planner refuses with an actionable hint', async () => {
  await assert.rejects(
    callTool(
      'diagram_generate',
      { text: 'User calls the order service, which writes to the database' },
      { root: workspace, env: {} },
    ),
    (error: unknown) => {
      assert.equal((error as { code?: string }).code, 'AGENT_PLAN_REQUIRED');
      assert.match((error as ToolError).hint ?? '', /diagram_plan_request/);
      assert.match((error as ToolError).hint ?? '', /offline/);
      return true;
    },
  );
});

test('offline generate produces renderable artifacts', async () => {
  const result = await callTool(
    'diagram_generate',
    { offline: true, text: '用户 → 服务 → 数据库', out: 'offline' },
    { root: workspace, env: {} },
  );
  const json = await payload(result);
  assert.equal(result.isError, undefined);
  assert.equal(json.written.diagrams.length >= 1, true);
  assert.ok(json.written.diagrams[0].counts.nodes >= 2);
});

// ---------------------------------------------------------------------------
// Real stdio MCP session
// ---------------------------------------------------------------------------

interface RpcMessage {
  jsonrpc: '2.0';
  id?: number;
  method?: string;
  params?: unknown;
  result?: any;
  error?: { code: number; message: string };
}

function startServer(cwd: string) {
  const child = spawn(process.execPath, ['--import', 'tsx', serverEntry], {
    cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, DIAGRAM_MCP_ROOT: cwd },
  });
  const lines: string[] = [];
  const waiters: Array<() => void> = [];
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    for (const line of chunk.split('\n')) {
      const trimmed = line.trim();
      if (trimmed) { lines.push(trimmed); waiters.shift()?.(); }
    }
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => { stderr += chunk; });

  const nextMessage = async (timeoutMs = 60_000): Promise<RpcMessage> => {
    const deadline = Date.now() + timeoutMs;
    while (!lines.length) {
      if (Date.now() > deadline) throw new Error(`no MCP frame within ${timeoutMs}ms; stderr=${stderr}`);
      await new Promise<void>(resolve => waiters.push(resolve));
    }
    return JSON.parse(lines.shift() as string) as RpcMessage;
  };

  const request = async (id: number, method: string, params?: unknown) => {
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    const message = await nextMessage();
    assert.equal(message.id, id, `response id mismatch for ${method}; stderr=${stderr}`);
    return message;
  };
  return { child, request, notify: (method: string) => child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method })}\n`), nextMessage, get stderr() { return stderr; } };
}

test('stdio session: initialize, tools/list, validate and render a real example model', async () => {
  const server = startServer(projectRoot);
  try {
    const initialized = await server.request(1, 'initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'ai-diagram-tool-test', version: '1' },
    });
    assert.equal(initialized.result.serverInfo.name, 'diagram-mcp');
    assert.equal(initialized.result.protocolVersion, '2024-11-05');
    assert.equal(initialized.result.capabilities.tools.listChanged, false);
    assert.match(initialized.result.instructions, /ELK computes every position/);

    server.notify('notifications/initialized');

    const listed = await server.request(2, 'tools/list', {});
    assert.deepEqual(
      listed.result.tools.map((tool: { name: string }) => tool.name).sort(),
      [
        'diagram_generate', 'diagram_patch', 'diagram_plan_request', 'diagram_plan_submit',
        'diagram_render', 'diagram_review_request', 'diagram_review_submit', 'diagram_validate',
      ],
      'the server exposes structure in / answers out, and never a raw XML or coordinate tool',
    );
    for (const tool of listed.result.tools) {
      // Positions must never be an accepted argument name.
      assert.doesNotMatch(JSON.stringify(tool.inputSchema), /"properties":\{[^}]*"x"\s*:/);
    }

    const validated = await server.request(3, 'tools/call', {
      name: 'diagram_validate',
      arguments: { modelPath: 'examples/01-system-architecture/system-architecture.model.json' },
    });
    assert.equal(validated.result.isError, undefined);
    const report = JSON.parse(validated.result.content[0].text);
    assert.equal(report.valid, true, JSON.stringify(report.issues));
    assert.ok(report.counts.nodes >= 5);

    const unknown = await server.request(4, 'tools/call', { name: 'diagram_write_xml', arguments: {} });
    assert.equal(unknown.error?.code, -32602);
    assert.match(unknown.error?.message ?? '', /available tools: diagram_generate/);

    const unsupported = await server.request(5, 'resources/list', {});
    assert.equal(unsupported.error?.code, -32601);
  } finally {
    server.child.stdin.end();
    server.child.kill();
  }
});

test('handleRequest answers notifications without emitting a frame', async () => {
  assert.equal(await handleRequest({ method: 'notifications/initialized' }, projectRoot), null);
  assert.equal((await handleRequest({ id: 9, method: 'ping' }, projectRoot))?.result !== undefined, true);
});
