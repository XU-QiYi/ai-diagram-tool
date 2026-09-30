import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// The adapter is the "one command" demo for the project's core promise: natural language
// in, editable diagram out, with the model supplied by the caller. These tests assert the
// whole loop works offline and that the mock never forgets it is a mock.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const adapter = path.join(root, 'examples', 'adapter', 'adapter.mjs');
const demo = path.join(root, 'examples', 'adapter', 'demo.mjs');
const scratch = path.join(root, 'output', '_adapter-test');

test('adapter turns a plan task into an answer the plan gate accepts, with no key and no network', () => {
  rmSync(scratch, { recursive: true, force: true });
  const request = '画一个 UML 用例图：普通用户可以登录、浏览工具、提交租借申请';
  const taskFile = path.join(scratch, 'task.json');
  const answerFile = path.join(scratch, 'answer.json');

  // Step 1: emit a real task with the real CLI, so the fixture is not hand-made.
  const emitted = spawnSync(
    process.execPath,
    ['--import', 'tsx', 'src/cli.ts', 'generate', '--emit-plan', taskFile, '--text', request],
    { cwd: root, encoding: 'utf8' },
  );
  assert.equal(emitted.status, 0, emitted.stderr);
  assert.ok(existsSync(taskFile), 'the CLI must write the task file');

  // Step 2: the adapter must run with NO key set, proving the offline mode is real.
  const answered = spawnSync(process.execPath, [adapter, taskFile, answerFile], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, DIAGRAM_ADAPTER_API_KEY: '' },
  });
  assert.equal(answered.status, 0, answered.stderr);
  assert.match(answered.stdout, /offline mock/, 'the mode must say which one it used');

  // Step 3: the answer must survive the real gate and produce artifacts.
  const submitted = spawnSync(
    process.execPath,
    ['--import', 'tsx', 'src/cli.ts', 'generate', '--plan', answerFile, '--text', request, '--out', scratch],
    { cwd: root, encoding: 'utf8' },
  );
  assert.equal(submitted.status, 0, submitted.stderr);

  const answer = JSON.parse(readFileSync(answerFile, 'utf8')) as {
    diagram: { type: string; id: string; nodes: Array<{ kind: string; id: string; provenance: { quote: string } }> };
    confidence: number;
    uncertainties: Array<{ description: string; blocking: boolean }>;
  };
  assert.equal(answer.diagram.type, 'uml-usecase', 'the mock must derive the type, not hardcode a preset');
  assert.ok(
    answer.diagram.nodes.some((node: { kind: string }) => node.kind === 'actor'),
    'a usecase diagram needs an Actor',
  );
  assert.ok(answer.confidence >= 0.7, 'the mock must not fake a low confidence to dodge the gate');
  assert.ok(
    answer.uncertainties.some((u) => /mock/i.test(u.description)),
    'the mock must say it is a mock',
  );
  // Provenance quotes are re-verified as exact substrings of the source, so they must be
  // derived from the task, not invented.
  const taskJson = JSON.parse(readFileSync(taskFile, 'utf8')) as {
    messages: Array<{ role: string; content: unknown }>;
  };
  const user = taskJson.messages.find((m) => m.role === 'user')!;
  const sources = (user.content as Array<{ type: string; text: string }>)
    .filter((p) => p.type === 'text')
    .map((p) => p.text)
    .join('\n');
  for (const node of answer.diagram.nodes) {
    assert.ok(sources.includes(node.provenance.quote), `provenance quote for ${node.id} must occur in the source`);
  }

  assert.ok(existsSync(path.join(scratch, `${answer.diagram.id}.drawio`)), 'the gate must produce an editable .drawio');
  assert.ok(existsSync(path.join(scratch, `${answer.diagram.id}.svg`)));
  rmSync(scratch, { recursive: true, force: true });
});

test('npm run demo runs the three steps end to end with no shell and no key', () => {
  const run = spawnSync(process.execPath, [demo], { cwd: root, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.match(run.stdout, /offline mock/, 'the demo must state which adapter mode ran');
  assert.ok(existsSync(path.join(root, 'output', 'demo', 'task.json')));
  assert.ok(existsSync(path.join(root, 'output', 'demo', 'answer.json')));
  // The diagram id comes from the mock, not a fixed name: whatever it is, an editable
  // .drawio must exist next to the quality report.
  const demoAnswer = JSON.parse(readFileSync(path.join(root, 'output', 'demo', 'answer.json'), 'utf8')) as {
    diagram: { id: string };
  };
  assert.ok(
    existsSync(path.join(root, 'output', 'demo', `${demoAnswer.diagram.id}.drawio`)),
    'the demo must end with an editable diagram',
  );
});

/**
 * Async child run. The HTTP-mode tests serve the fake endpoint from THIS process, so the
 * child must run while the event loop stays live — `spawnSync` here would block the very
 * server the child is talking to, deadlocking until undici's 300s header timeout.
 */
function runAsync(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ status: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, env });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk));
    child.on('error', reject);
    child.on('close', (code) => resolve({ status: code ?? -1, stdout, stderr }));
  });
}

/** A fake OpenAI-compatible endpoint: records what the adapter sent, replies with canned content. */
function fakeOpenAi(
  content: string,
  status = 200,
): Promise<{ url: string; seen: Record<string, unknown>; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const seen: Record<string, unknown> = {};
    const server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        seen.authorization = req.headers.authorization;
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
          model?: string;
          messages?: Array<{ role?: string }>;
        };
        seen.model = body.model;
        seen.systemIncluded = (body.messages ?? []).some((m) => m.role === 'system');
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(
          status === 200
            ? JSON.stringify({ choices: [{ message: { content: `\`\`\`json\n${content}\n\`\`\`` } }] })
            : JSON.stringify({ error: { message: 'canned failure' } }),
        );
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port;
      resolve({
        url: `http://127.0.0.1:${port}/v1`,
        seen,
        close: () => new Promise<void>((done) => server.close(() => done())),
      });
    });
  });
}

test('adapter HTTP mode: real endpoint round-trip, and the answer passes the plan gate', async () => {
  rmSync(scratch, { recursive: true, force: true });
  const request = '画一个 UML 用例图：普通用户可以登录、浏览工具、提交租借申请';
  const taskFile = path.join(scratch, 'task.json');
  const answerFile = path.join(scratch, 'answer.json');
  const emitted = await runAsync(process.execPath, [
    '--import',
    'tsx',
    'src/cli.ts',
    'generate',
    '--emit-plan',
    taskFile,
    '--text',
    request,
  ]);
  assert.equal(emitted.status, 0, emitted.stderr);

  // A known-good answer comes from the mock; the fake endpoint serves it fenced, so the
  // adapter's fence-stripping and JSON extraction are exercised for real.
  const mockRun = await runAsync(process.execPath, [adapter, taskFile, answerFile], {
    ...process.env,
    DIAGRAM_ADAPTER_API_KEY: '',
  });
  assert.equal(mockRun.status, 0, mockRun.stderr);
  const servedAnswer = readFileSync(answerFile, 'utf8');

  const fake = await fakeOpenAi(servedAnswer);
  try {
    const httpRun = await runAsync(process.execPath, [adapter, taskFile, answerFile], {
      ...process.env,
      DIAGRAM_ADAPTER_API_KEY: 'test-key-123',
      DIAGRAM_ADAPTER_BASE_URL: fake.url,
      DIAGRAM_ADAPTER_MODEL: 'test-model',
    });
    assert.equal(httpRun.status, 0, httpRun.stderr);
    assert.match(httpRun.stdout, /OpenAI-compatible/, 'the mode must say it used HTTP');
    assert.equal(fake.seen.authorization, 'Bearer test-key-123', 'the key must travel as a bearer token');
    assert.equal(fake.seen.model, 'test-model');
    assert.equal(fake.seen.systemIncluded, true, 'the task system prompt must be sent');
    assert.equal(readFileSync(answerFile, 'utf8'), servedAnswer, 'the HTTP answer is what the endpoint returned');

    const submitted = await runAsync(process.execPath, [
      '--import',
      'tsx',
      'src/cli.ts',
      'generate',
      '--plan',
      answerFile,
      '--text',
      request,
      '--out',
      scratch,
    ]);
    assert.equal(submitted.status, 0, submitted.stderr);
    const answer = JSON.parse(readFileSync(answerFile, 'utf8')) as { diagram: { id: string } };
    assert.ok(
      existsSync(path.join(scratch, `${answer.diagram.id}.drawio`)),
      'the gate must produce an editable .drawio',
    );
  } finally {
    await fake.close();
    rmSync(scratch, { recursive: true, force: true });
  }
});

test('adapter HTTP mode: a failing endpoint is a loud error with the status code, not a silent mock fallback', async () => {
  rmSync(scratch, { recursive: true, force: true });
  const taskFile = path.join(scratch, 'task.json');
  const answerFile = path.join(scratch, 'answer.json');
  const emitted = await runAsync(process.execPath, [
    '--import',
    'tsx',
    'src/cli.ts',
    'generate',
    '--emit-plan',
    taskFile,
    '--text',
    '画一个 UML 用例图：普通用户可以登录',
  ]);
  assert.equal(emitted.status, 0, emitted.stderr);

  const fake = await fakeOpenAi('irrelevant', 500);
  try {
    const run = await runAsync(process.execPath, [adapter, taskFile, answerFile], {
      ...process.env,
      DIAGRAM_ADAPTER_API_KEY: 'test-key-123',
      DIAGRAM_ADAPTER_BASE_URL: fake.url,
    });
    assert.notEqual(run.status, 0, 'a failed model request must fail the adapter');
    assert.match(run.stderr, /model request failed: HTTP 500/);
    assert.ok(!existsSync(answerFile), 'no answer file may be written from a failed call');
  } finally {
    await fake.close();
    rmSync(scratch, { recursive: true, force: true });
  }
});
