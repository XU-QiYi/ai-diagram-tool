import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import http from 'node:http';
import { handleRequest, jsonRpcFailure, SUPPORTED_PROTOCOLS } from './server.js';

/**
 * Streamable HTTP transport (MCP 2025-06-18) on top of the same JSON-RPC dispatcher the
 * stdio loop uses — one endpoint (`/mcp`), POST carries a single JSON-RPC message, GET
 * and DELETE answer 405 because this server neither offers server-initiated streams nor
 * holds sessions, and every rule below cites the spec line it implements.
 *
 * Security (spec "Security Warning", all three lines):
 *  1. the `Origin` header is validated on every connection (DNS rebinding);
 *  2. the default bind address is 127.0.0.1, not 0.0.0.0;
 *  3. a second wall checks the `Host` header, so a rebound DNS name cannot slip through
 *     even for clients that omit `Origin`.
 */

const ENDPOINT_PATH = '/mcp';
// Same ceiling the document readers enforce for plan submissions.
const MAX_BODY_BYTES = 10 * 1024 * 1024;
const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

export interface HttpTransportOptions {
  workspaceRoot: string;
  host?: string;
  port?: number;
  /** Extra `Origin` values allowed besides the loopback defaults. */
  allowedOrigins?: string[];
  log?: (message: string) => void;
}

interface JsonRpcFrame {
  id?: string | number | null;
  method?: string;
  params?: unknown;
}

function normalize(origin: string): string {
  return origin.trim().replace(/\/+$/, '').toLowerCase();
}

function originAllowed(origin: string, host: string, port: number, extra: string[]): boolean {
  const candidates = new Set<string>();
  for (const hostname of [host, '127.0.0.1', 'localhost']) {
    candidates.add(normalize(`http://${hostname}:${port}`));
    candidates.add(normalize(`https://${hostname}:${port}`));
  }
  for (const value of extra) candidates.add(normalize(value));
  return candidates.has(normalize(origin));
}

function hostAllowed(hostHeader: string, host: string): boolean {
  const hostname = hostHeader.toLowerCase().replace(/:\d+$/, '');
  return hostname === host.toLowerCase() || LOOPBACK_HOSTNAMES.has(hostname);
}

function sendJson(res: ServerResponse, status: number, body?: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(body === undefined ? undefined : JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let overLimit = false;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        // Stop buffering but keep draining, so the client can finish its upload and
        // actually receive the 413 — destroying the socket here would reset the
        // connection before the status line is written.
        overLimit = true;
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(overLimit ? null : Buffer.concat(chunks)));
    req.on('error', () => resolve(null));
  });
}

/**
 * Tool calls touch the same output directories and print interleaved ELK logs, exactly
 * why the stdio loop serializes them; HTTP callers get the same behavior.
 */
function createQueue() {
  let tail: Promise<unknown> = Promise.resolve();
  return function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = tail.then(task, task);
    tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };
}

export async function startHttpServer(options: HttpTransportOptions): Promise<Server> {
  const host = options.host ?? '127.0.0.1';
  const requestedPort = options.port ?? 3000;
  const allowedOrigins = options.allowedOrigins ?? [];
  const log = options.log ?? (() => undefined);
  const enqueue = createQueue();
  // With port 0 the OS picks the port; the Origin allowlist must match the port the
  // server ACTUALLY bound, so it is resolved after listen() instead of from options.
  let boundPort = requestedPort;

  async function dispatch(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const port = boundPort;
    const pathname = (req.url ?? '/').split('?')[0] ?? '/';
    if (pathname !== ENDPOINT_PATH) {
      return sendJson(res, 404, jsonRpcFailure(null, -32601, `Not found: the MCP endpoint is ${ENDPOINT_PATH}`));
    }
    // Spec security rule 1: validate `Origin` on ALL connections. Requests without one
    // (curl, CLI agents) are not browser-fetches and cannot carry out DNS rebinding.
    const origin = req.headers.origin;
    if (typeof origin === 'string' && !originAllowed(origin, host, port, allowedOrigins)) {
      log(`rejected origin ${origin}`);
      return sendJson(
        res,
        403,
        jsonRpcFailure(
          null,
          -32000,
          `Origin "${origin}" is not allowed. Add it via DIAGRAM_MCP_HTTP_ORIGIN if it is yours.`,
        ),
      );
    }
    // Security rule 3: a rebound host name must not reach the endpoint either.
    const hostHeader = req.headers.host;
    if (typeof hostHeader !== 'string' || !hostAllowed(hostHeader, host)) {
      log(`rejected host ${String(hostHeader)}`);
      return sendJson(res, 403, jsonRpcFailure(null, -32000, `Host "${String(hostHeader)}" is not allowed.`));
    }

    if (req.method === 'GET') {
      // Spec: 405 means the server does not offer a server-initiated SSE stream here.
      return sendJson(
        res,
        405,
        jsonRpcFailure(null, -32000, 'This server sends no server-initiated messages; use POST.'),
        { Allow: 'POST, DELETE' },
      );
    }
    if (req.method === 'DELETE') {
      // Stateless server: there is no session to terminate; the spec explicitly allows 405.
      return sendJson(res, 405, jsonRpcFailure(null, -32000, 'This server is stateless and holds no sessions.'), {
        Allow: 'POST, DELETE',
      });
    }
    if (req.method !== 'POST') {
      return sendJson(
        res,
        405,
        jsonRpcFailure(null, -32000, `Method ${String(req.method)} is not supported; use POST.`),
        { Allow: 'POST, DELETE' },
      );
    }

    // Spec: an unsupported MCP-Protocol-Version header MUST be answered with 400; an
    // absent one falls back to the 2025-03-26 assumption.
    const versionHeader = req.headers['mcp-protocol-version'];
    if (typeof versionHeader === 'string' && versionHeader.trim() && !SUPPORTED_PROTOCOLS.has(versionHeader.trim())) {
      return sendJson(
        res,
        400,
        jsonRpcFailure(
          null,
          -32000,
          `Unsupported MCP-Protocol-Version "${versionHeader.trim()}"; supported: ${[...SUPPORTED_PROTOCOLS].join(', ')}.`,
        ),
      );
    }

    const body = await readBody(req);
    if (body === null) {
      res.setHeader('Connection', 'close');
      return sendJson(res, 413, jsonRpcFailure(null, -32600, `Request body exceeds the ${MAX_BODY_BYTES} byte limit.`));
    }
    let frame: unknown;
    try {
      frame = JSON.parse(body.toString('utf8'));
    } catch {
      return sendJson(
        res,
        400,
        jsonRpcFailure(null, -32700, 'Parse error: the body must be exactly one JSON-RPC message.'),
      );
    }
    if (Array.isArray(frame)) {
      // Batching was removed in protocol revision 2025-06-18.
      return sendJson(
        res,
        400,
        jsonRpcFailure(
          null,
          -32600,
          'JSON-RPC batching is not supported (removed in MCP 2025-06-18); send exactly one message per POST.',
        ),
      );
    }
    if (typeof frame !== 'object' || frame === null) {
      return sendJson(res, 400, jsonRpcFailure(null, -32600, 'Invalid Request: the body must be one JSON-RPC object.'));
    }
    const record = frame as JsonRpcFrame;
    // A frame without `method` is a JSON-RPC response to a server-initiated request;
    // this server issues none, so accepting and discarding it (202) matches the spec.
    if (record.method === undefined) return sendJson(res, 202);

    const message = await enqueue(() => handleRequest(record, options.workspaceRoot));
    if (!message) return sendJson(res, 202);
    return sendJson(res, 200, message);
  }

  const server: Server = http.createServer((req, res) => {
    dispatch(req, res).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      log(`handler error: ${message}`);
      if (!res.headersSent) sendJson(res, 500, jsonRpcFailure(null, -32603, `Internal error: ${message}`));
      else res.end();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(requestedPort, host, () => {
      server.removeListener('error', reject);
      const address = server.address();
      if (address && typeof address === 'object') boundPort = address.port;
      resolve();
    });
  });
  return server;
}
