import assert from 'node:assert/strict';
import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { runCli } from '../src/cli.js';
import { resolveWorkspaceRoot } from '../src/mcp/server.js';
import { loadSharpDefault, resolveDrawioExecutable } from '../src/render/png.js';

/**
 * End-to-end over a real stdio session: a caller that shares nothing with this process
 * asks for a plan task, submits an answer, asks for a review, submits findings, and gets
 * artifacts back. Written outputs stay inside a temp workspace, never the repository.
 */

// The two review-round-trip tests need one raster backend (sharp locally, draw.io Desktop
// on render machines). Where neither exists they skip LOUDLY instead of failing — the
// backend contracts themselves are covered in visual-gate.test.ts.
const rasterBackendSkip = await (async () => {
  try {
    await loadSharpDefault(process.env);
    return false;
  } catch {
    /* fall through to the draw.io probe */
  }
  // resolveDrawioExecutable never throws: it reports unavailability via kind, so a
  // truthiness check on the object would always pass and never skip.
  const resolution = await resolveDrawioExecutable(process.env, async (target) => existsSync(target));
  return resolution.kind === 'resolved'
    ? false
    : `no raster backend on this machine (sharp not loadable, draw.io not resolvable: ${resolution.kind}); covered where a backend exists`;
})();

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REQUEST = '用户调用订单服务，订单服务写入数据库';
const evidence = (quote: string) => ({ source: 'request', quote, confidence: 0.95 });

function answer() {
  return {
    diagram: {
      id: 'wire-order-flow',
      title: 'Order Flow',
      type: 'flowchart',
      direction: 'TOP_TO_BOTTOM',
      nodes: [
        { id: 'node.user', label: '用户', kind: 'actor', provenance: evidence('用户') },
        { id: 'node.order', label: '订单服务', kind: 'service', provenance: evidence('订单服务') },
        { id: 'node.db', label: '数据库', kind: 'database', provenance: evidence('数据库') },
      ],
      edges: [
        {
          id: 'edge.user-order',
          source: 'node.user',
          target: 'node.order',
          type: 'flow',
          provenance: evidence('用户调用订单服务'),
        },
        {
          id: 'edge.order-db',
          source: 'node.order',
          target: 'node.db',
          type: 'flow',
          provenance: evidence('订单服务写入数据库'),
        },
      ],
    },
    confidence: 0.95,
    uncertainties: [],
  };
}

interface Frame {
  id?: number;
  method?: string;
  params?: unknown;
  result?: any;
  error?: { code: number; message: string };
}

function startServer(entry: string, toolsRoot: string) {
  const child: ChildProcess = spawn(process.execPath, entry.endsWith('.ts') ? ['--import', 'tsx', entry] : [entry], {
    // `--import tsx` resolves the bare specifier against the process working directory,
    // so cwd must stay the project root; the tools root is passed separately.
    cwd: projectRoot,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, DIAGRAM_MCP_ROOT: toolsRoot },
  });
  let buffer = '';
  let stderr = '';
  const lines: string[] = [];
  const waiters: Array<() => void> = [];
  let callCounter = 0;
  child.stdout!.setEncoding('utf8');
  child.stdout!.on('data', (chunk: string) => {
    buffer += chunk;
    for (;;) {
      const at = buffer.indexOf('\n');
      if (at < 0) break;
      const line = buffer.slice(0, at).trim();
      buffer = buffer.slice(at + 1);
      if (line) {
        lines.push(line);
        waiters.shift()?.();
      }
    }
  });
  child.stderr!.setEncoding('utf8');
  child.stderr!.on('data', (chunk: string) => {
    stderr += chunk;
  });

  const next = async (timeoutMs = 240_000): Promise<Frame> => {
    const deadline = Date.now() + timeoutMs;
    while (!lines.length) {
      if (Date.now() > deadline) throw new Error(`no frame within ${timeoutMs}ms; stderr=${stderr.slice(0, 400)}`);
      await new Promise<void>((resolve) => waiters.push(resolve));
    }
    return JSON.parse(lines.shift() as string) as Frame;
  };
  const request = async (id: number, method: string, params?: unknown) => {
    child.stdin!.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    const frame = await next();
    assert.equal(frame.id, id, `${method} response id mismatch; stderr=${stderr.slice(0, 300)}`);
    return frame;
  };
  const call = async (name: string, args: unknown) => {
    callCounter += 1;
    const frame = await request(100 + callCounter, 'tools/call', { name, arguments: args });
    if (frame.error) throw new Error(`${name} protocol error ${frame.error.code}: ${frame.error.message}`);
    const text = frame.result!.content[0].text as string;
    if (frame.result!.isError === true) throw new Error(`${name} refused: ${text.slice(0, 400)}`);
    return JSON.parse(text) as Record<string, any>;
  };
  const close = async () => {
    child.stdin!.end();
    child.kill();
    // A child that already exited never emits 'close', so resolve immediately in that
    // case; otherwise this await hangs the whole run.
    await new Promise((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) resolve(null);
      else child.once('close', () => resolve(null));
    });
  };
  const notify = (method: string) => child.stdin!.write(`${JSON.stringify({ jsonrpc: '2.0', method })}\n`);
  return { request, notify, call, close };
}

async function handshake(server: ReturnType<typeof startServer>, name: string) {
  await server.request(1, 'initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name, version: '1' },
  });
  server.notify('notifications/initialized');
}

let workspace = '';
before(async () => {
  workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-mcp-e2e-'));
});
after(async () => {
  await fs.rm(workspace, { recursive: true, force: true });
});

test('stdio session drives plan -> submit -> review -> apply and writes editable Draw.io', {
  skip: rasterBackendSkip,
}, async () => {
  const server = startServer(path.join(projectRoot, 'src', 'mcp', 'server.ts'), workspace);
  try {
    await handshake(server, 'e2e');

    const task = await server.call('diagram_plan_request', { text: REQUEST });
    assert.match(task.task.system, /Do not output x, y, width, height/);
    assert.ok(task.task.rules.length >= 4);

    const submitted = await server.call('diagram_plan_submit', {
      text: REQUEST,
      answer: answer(),
      audit: { confidence: 0.9, missing: [], unsupportedElementIds: [] },
      out: 'built',
    });
    assert.equal(submitted.written.valid, true, JSON.stringify(submitted.written.issues));
    assert.equal(submitted.written.evidence.verified, 5, 'each quote is re-verified against the request');
    assert.ok(
      submitted.written.files.drawio.startsWith(workspace),
      `artifact escaped the workspace: ${submitted.written.files.drawio}`,
    );

    const review = await server.call('diagram_review_request', {
      modelPath: 'built/wire-order-flow.model.json',
      out: 'review',
      maxRounds: 3,
    });
    assert.ok((await fs.stat(review.task.pngPath)).size > 1_000, 'the review bitmap must be a real image');
    assert.equal(review.reviewBudget.maxRounds, 3, 'the caller may widen the round budget');
    assert.ok(review.task.allowedFields.includes('nodeSpacing'));

    const applied = await server.call('diagram_review_submit', {
      model: JSON.parse(await fs.readFile(path.join(workspace, 'built', 'wire-order-flow.model.json'), 'utf8')),
      findings: {
        findings: [
          {
            code: 'VISUAL_CROWDED',
            elementId: 'node.order',
            severity: 'ERROR',
            observation: 'boxes sit too close',
            hint: 'increase nodeSpacing',
            x: 5,
            y: 5,
          },
        ],
      },
      out: 'reviewed',
    });
    assert.match(JSON.stringify(applied.applied), /nodeSpacing/, 'an accepted finding must move a layout preference');
    assert.match(JSON.stringify(applied.discarded), /COORDINATE/, 'reviewer coordinates must be discarded');
    assert.equal(applied.written.diagrams[0].valid, true, 'the re-laid-out diagram must still validate');

    const drawio = await fs.readFile(path.join(workspace, 'reviewed', 'wire-order-flow.drawio'), 'utf8');
    assert.match(drawio, /<mxfile/);
    assert.match(drawio, /<mxCell/);
    const model = await fs.readFile(path.join(workspace, 'reviewed', 'wire-order-flow.model.json'), 'utf8');
    assert.ok(!model.includes('"x"'), 'the written model must carry no coordinates');
  } finally {
    await server.close();
  }
});

test('the compiled entry that MiMo registers exposes the same eight tools', async () => {
  const distEntry = path.join(projectRoot, 'dist', 'src', 'mcp', 'server.js');
  if (
    !(await fs.stat(distEntry).then(
      () => true,
      () => false,
    ))
  ) {
    console.log('SKIPPED: dist/src/mcp/server.js is absent — run `npm run build` first; this is not a pass');
    return;
  }
  const server = startServer(distEntry, workspace);
  try {
    await handshake(server, 'e2e-dist');
    const listed = await server.request(2, 'tools/list', {});
    assert.deepEqual((listed.result as { tools: Array<{ name: string }> }).tools.map((tool) => tool.name).sort(), [
      'diagram_generate',
      'diagram_patch',
      'diagram_plan_request',
      'diagram_plan_submit',
      'diagram_render',
      'diagram_review_request',
      'diagram_review_submit',
      'diagram_validate',
    ]);
  } finally {
    await server.close();
  }
});

test('draw.io renders every bundled example it is given (renderer compatibility smoke)', {
  skip: rasterBackendSkip,
}, async () => {
  const exampleDirs = (await fs.readdir(path.join(projectRoot, 'examples'), { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(projectRoot, 'examples', entry.name));
  const models: Array<{ name: string; model: unknown }> = [];
  for (const dir of exampleDirs) {
    const file = (await fs.readdir(dir)).find((name) => name.endsWith('.model.json'));
    if (file) models.push({ name: file, model: JSON.parse(await fs.readFile(path.join(dir, file), 'utf8')) });
  }
  assert.ok(models.length >= 15, `expected the bundled examples, found ${models.length}`);

  const detection = await resolveDrawioExecutable(process.env);
  const server = startServer(path.join(projectRoot, 'src', 'mcp', 'server.ts'), workspace);
  try {
    await handshake(server, 'smoke');
    for (const { name, model } of models) {
      const task = await server.call('diagram_review_request', { model, out: 'smoke' });
      assert.ok(task.task.width > 0 && task.task.height > 0, `${name} produced no bitmap`);
      assert.ok(task.task.elementIds.length >= 2, `${name} offered no ids to review`);
      if (detection.kind === 'resolved') {
        assert.equal(
          task.task.backend,
          'drawio-cli',
          `${name} must be reviewed through the real Draw.io renderer while draw.io is installed`,
        );
      }
    }
  } finally {
    await server.close();
  }
});

test('retired model flags fail with a migration message instead of being ignored', async () => {
  const dir = path.join(workspace, 'retired');
  assert.equal(await runCli(['generate', '--text', REQUEST, '--visual-review', '--out', dir]), 1);
  assert.equal(
    await fs.stat(dir).then(
      () => true,
      () => false,
    ),
    false,
    'a refused flag must not write anything',
  );
});

test('a drive-root workspace is refused before any write can fail with EPERM', () => {
  const driveRoot = process.platform === 'win32' ? 'C:\\' : '/';
  assert.throws(() => resolveWorkspaceRoot(driveRoot), /drive root/i);
  const nested = resolveWorkspaceRoot(path.join(os.tmpdir(), 'ai-diagram-work'));
  assert.equal(path.basename(nested), 'ai-diagram-work');
});
