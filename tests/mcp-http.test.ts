import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { startHttpServer } from '../src/mcp/http.js';

let workspace = '';
let port = 0;
let closeServer: () => Promise<void> = async () => {};

before(async () => {
  workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-diagram-mcp-http-'));
  const server = await startHttpServer({ workspaceRoot: workspace, port: 0 });
  const address = server.address();
  assert.ok(address && typeof address === 'object', 'server listens on an ephemeral port');
  port = address.port;
  closeServer = () =>
    new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
});

after(async () => {
  await closeServer();
  await fs.rm(workspace, { recursive: true, force: true });
});

const endpoint = () => `http://127.0.0.1:${port}/mcp`;

async function post(
  body: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; json: any; text: string }> {
  const response = await fetch(endpoint(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, json: text ? JSON.parse(text) : undefined, text };
}

function rawRequest(
  method: string,
  requestPath: string,
  headers: Record<string, string>,
  body?: Buffer,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: requestPath, method, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

test('initialize negotiates the protocol version over Streamable HTTP', async () => {
  const { status, json } = await post({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2025-06-18' },
  });
  assert.equal(status, 200);
  assert.equal(json.result.protocolVersion, '2025-06-18');
  assert.equal(json.result.serverInfo.name, 'diagram-mcp');
});

test('notifications are accepted with 202 and no body', async () => {
  const response = await fetch(endpoint(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
  });
  assert.equal(response.status, 202);
  assert.equal(await response.text(), '');
});

test('tools/list answers over HTTP', async () => {
  const { status, json } = await post({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  assert.equal(status, 200);
  assert.equal(json.result.tools.length, 8);
});

test('diagram_generate runs the real pipeline through HTTP', async () => {
  const { status, json } = await post({
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: { name: 'diagram_generate', arguments: { chain: true, text: '流程图：下单 -> 发货' } },
  });
  assert.equal(status, 200);
  assert.equal(json.result.isError, undefined);
  const payload = JSON.parse(json.result.content[0].text);
  assert.ok(Array.isArray(payload.written?.diagrams) && payload.written.diagrams.length === 1, 'one part written');
  assert.match(String(payload.written.diagrams[0].files.drawio), /\.drawio$/);
  assert.match(String(payload.written.diagrams[0].files.model), /\.model\.json$/);
});

test('geometry smuggling is refused through HTTP exactly like through stdio', async () => {
  const { status, json } = await post({
    jsonrpc: '2.0',
    id: 4,
    method: 'tools/call',
    params: {
      name: 'diagram_render',
      arguments: {
        model: {
          id: 'sneaky',
          title: 'Sneaky',
          type: 'flowchart',
          nodes: [{ id: 'node.a', label: 'A', x: 10 }],
          edges: [],
        },
      },
    },
  });
  assert.equal(status, 200);
  assert.equal(json.result.isError, true);
  assert.match(json.result.content[0].text, /GEOMETRY_FORBIDDEN|geometry/i);
});

test('GET answers 405: this server offers no server-initiated stream', async () => {
  const response = await fetch(endpoint(), { method: 'GET' });
  assert.equal(response.status, 405);
  assert.ok(response.headers.get('allow')?.includes('POST'));
});

test('DELETE answers 405: the server is stateless and holds no sessions', async () => {
  const response = await fetch(endpoint(), { method: 'DELETE' });
  assert.equal(response.status, 405);
});

test('JSON-RPC batching (removed in 2025-06-18) is rejected with 400', async () => {
  const { status, json } = await post([
    { jsonrpc: '2.0', id: 1, method: 'ping' },
    { jsonrpc: '2.0', id: 2, method: 'ping' },
  ]);
  assert.equal(status, 400);
  assert.equal(json.error.code, -32600);
});

test('a parse error answers 400 with the -32700 code', async () => {
  const { status, json } = await post('{not json');
  assert.equal(status, 400);
  assert.equal(json.error.code, -32700);
});

test('a non-object body answers 400 as an invalid request', async () => {
  const { status, json } = await post('42');
  assert.equal(status, 400);
  assert.equal(json.error.code, -32600);
});

test('a JSON-RPC response frame (no method) is accepted and discarded with 202', async () => {
  const { status } = await post({ jsonrpc: '2.0', id: 9, result: {} });
  assert.equal(status, 202);
});

test('unknown paths answer 404', async () => {
  const { status } = await post({ jsonrpc: '2.0', id: 1, method: 'ping' }, {});
  assert.equal(status, 200);
  const raw = await rawRequest(
    'POST',
    '/other',
    { 'Content-Type': 'application/json' },
    Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' })),
  );
  assert.equal(raw.status, 404);
});

test('an unsupported MCP-Protocol-Version header answers 400; a supported one passes', async () => {
  const bad = await post({ jsonrpc: '2.0', id: 1, method: 'ping' }, { 'MCP-Protocol-Version': '1999-01-01' });
  assert.equal(bad.status, 400);
  const good = await post({ jsonrpc: '2.0', id: 1, method: 'ping' }, { 'MCP-Protocol-Version': '2025-03-26' });
  assert.equal(good.status, 200);
});

test('foreign origins are rejected; loopback origins and originless requests pass', async () => {
  const evil = await post({ jsonrpc: '2.0', id: 1, method: 'ping' }, { Origin: 'http://evil.example' });
  assert.equal(evil.status, 403);
  const own = await post({ jsonrpc: '2.0', id: 1, method: 'ping' }, { Origin: `http://127.0.0.1:${port}` });
  assert.equal(own.status, 200);
  const originless = await post({ jsonrpc: '2.0', id: 1, method: 'ping' });
  assert.equal(originless.status, 200);
});

test('a rebound Host header is rejected even without an Origin header', async () => {
  const raw = await rawRequest(
    'POST',
    '/mcp',
    { 'Content-Type': 'application/json', Host: 'evil.example' },
    Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' })),
  );
  assert.equal(raw.status, 403);
});

test('an oversized body answers 413 instead of being parsed', async () => {
  const big = Buffer.alloc(10 * 1024 * 1024 + 1, 0x61);
  const raw = await rawRequest('POST', '/mcp', { 'Content-Type': 'application/json' }, big);
  assert.equal(raw.status, 413);
});
