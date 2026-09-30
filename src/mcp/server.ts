import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { TOOL_DEFINITIONS, callTool } from './tools.js';

const PROTOCOL_VERSION = '2025-06-18';
const SUPPORTED_PROTOCOLS = new Set(['2025-06-18', '2025-03-26', '2024-11-05']);
const SERVER_INFO = { name: 'diagram-mcp', version: '1.0.0' };

const SERVER_INSTRUCTIONS =
  'Generates editable Draw.io (.drawio) and SVG diagrams from a semantic Diagram model. ' +
  'The caller describes nodes, edges, containers, and layout preferences; ELK computes every position, size, ' +
  'and edge route, and the validators reject models that cannot be drawn cleanly. ' +
  'Requests that carry coordinates, sizes, edge routes, or Draw.io XML are rejected: use the "layout" ' +
  'preferences (direction, density, nodeSpacing, layerSpacing, containerPadding, targetAspectRatio) instead. ' +
  'Use diagram_generate for natural-language and document input, diagram_patch to revise an existing model ' +
  'without changing its stable IDs, diagram_validate to inspect problems, and diagram_render to write artifacts.';

interface JsonRpcId {
  id?: string | number | null;
}

function reply(id: string | number | null | undefined, result: unknown) {
  return { jsonrpc: '2.0', id: id ?? null, result };
}

function failure(id: string | number | null | undefined, code: number, message: string) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
}

/** `stdout` carries JSON-RPC frames only; diagnostics go to stderr. */
function write(stream: NodeJS.WritableStream, message: unknown): void {
  stream.write(`${JSON.stringify(message)}\n`);
}

function debug(message: string): void {
  process.stderr.write(`[MCP] ${message}\n`);
}

async function handleRequest(
  frame: JsonRpcId & { method?: string; params?: unknown },
  workspaceRoot: string,
): Promise<Record<string, unknown> | null> {
  const id = frame.id ?? null;
  const isNotification = frame.id === undefined;
  const params = (frame.params ?? {}) as Record<string, unknown>;

  switch (frame.method) {
    case 'initialize': {
      const requested = typeof params.protocolVersion === 'string' ? params.protocolVersion : PROTOCOL_VERSION;
      const protocolVersion = SUPPORTED_PROTOCOLS.has(requested) ? requested : PROTOCOL_VERSION;
      debug(`initialize client=${String((params.clientInfo as Record<string, unknown> | undefined)?.name ?? 'unknown')} protocol=${protocolVersion}`);
      return reply(id, {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: SERVER_INSTRUCTIONS,
      });
    }
    case 'notifications/initialized':
    case 'notifications/cancelled':
      return null;
    case 'ping':
      return reply(id, {});
    case 'tools/list':
      return reply(id, { tools: TOOL_DEFINITIONS });
    case 'tools/call': {
      const name = typeof params.name === 'string' ? params.name : '';
      if (!TOOL_DEFINITIONS.some(tool => tool.name === name)) {
        return failure(id, -32602, `Unknown tool "${name}"; available tools: ${TOOL_DEFINITIONS.map(tool => tool.name).join(', ')}`);
      }
      try {
        // Tool failures are reported inside the result so the client keeps working.
        return reply(id, await callTool(name, params.arguments, { root: workspaceRoot }));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const code = typeof (error as { code?: unknown })?.code === 'string' ? (error as { code: string }).code : 'MCP_TOOL_ERROR';
        debug(`${name} failed: ${message}`);
        return reply(id, { content: [{ type: 'text', text: `[${code}] ${message}` }], isError: true });
      }
    }
    default:
      if (isNotification) return null;
      return failure(id, -32601, `Unsupported method: ${String(frame.method)}`);
  }
}

/**
 * Reject a drive-root workspace: on Windows `C:\` is not writable (reserved names such
 * as `C:\perflogs` answer EPERM), so writing `<root>\output\...` would fail with a
 * confusing I/O error instead of a usable message.
 */
export function resolveWorkspaceRoot(value: string | undefined): string {
  const root = path.resolve(value ?? process.cwd());
  if (path.parse(root).root === path.normalize(root)) {
    throw new Error(
      `Refusing to use the drive root "${root}" as the diagram workspace: writing there can fail with EPERM on Windows. ` +
        'Set DIAGRAM_MCP_ROOT to a real project directory, or start the server with that directory as its working directory.',
    );
  }
  return root;
}

async function main(): Promise<void> {
  const root = resolveWorkspaceRoot(process.env.DIAGRAM_MCP_ROOT);
  debug(`serving ${SERVER_INFO.name} with workspace root ${root}`);
  // Streamable HTTP mode: `--http` or a DIAGRAM_MCP_HTTP_PORT env switches this entry
  // point from the stdio loop to an HTTP endpoint; both share the same dispatcher.
  const wantsHttp = process.argv.includes('--http') || process.env.DIAGRAM_MCP_HTTP_PORT !== undefined;
  if (wantsHttp) {
    const { startHttpServer } = await import('./http.js');
    const port = Number(process.env.DIAGRAM_MCP_HTTP_PORT ?? 3000);
    if (!Number.isInteger(port) || port < 0 || port > 65535) {
      throw new Error(`DIAGRAM_MCP_HTTP_PORT "${process.env.DIAGRAM_MCP_HTTP_PORT}" is not a valid port number.`);
    }
    const host = process.env.DIAGRAM_MCP_HTTP_HOST ?? '127.0.0.1';
    const allowedOrigins = (process.env.DIAGRAM_MCP_HTTP_ORIGIN ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    const server = await startHttpServer({ workspaceRoot: root, host, port, allowedOrigins, log: debug });
    const address = server.address();
    const shown = typeof address === 'object' && address !== null ? `${address.address}:${address.port}` : String(port);
    debug(`MCP endpoint listening on http://${shown}${'/mcp'}`);
    debug('security: Origin header validated, Host header validated, bound to the address above only.');
    debug('set DIAGRAM_MCP_HTTP_HOST=0.0.0.0 to expose it beyond this machine — only with DIAGRAM_MCP_HTTP_ORIGIN set to the origins you trust.');
    return;
  }
  const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  // Serialize tool calls: concurrent ELK runs would interleave their logs and
  // fight over the same output files.
  let queue: Promise<unknown> = Promise.resolve();

  lines.on('line', line => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let frame: JsonRpcId & { method?: string; params?: unknown };
    try {
      frame = JSON.parse(trimmed) as JsonRpcId & { method?: string; params?: unknown };
    } catch {
      write(process.stdout, failure(null, -32700, 'Parse error: expected one JSON-RPC object per line'));
      return;
    }
    queue = queue
      .then(() => handleRequest(frame, root))
      .then(message => {
        if (message) write(process.stdout, message);
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        debug(`handler error: ${message}`);
        write(process.stdout, failure(frame.id ?? null, -32603, `Internal error: ${message}`));
      });
  });
  lines.on('close', () => {
    debug('stdin closed, shutting down');
    void queue.finally(() => process.exit(0));
  });
}

// Match only this module's own entry point, so importing the server from the
// test suite or another tool never starts a stdio loop.
const isDirectRun = Boolean(process.argv[1]) && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isDirectRun) {
  main().catch((error: unknown) => {
    debug(`fatal: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}

export { SERVER_INSTRUCTIONS, SERVER_INFO, SUPPORTED_PROTOCOLS, handleRequest, main };
export const jsonRpcFailure = failure;
