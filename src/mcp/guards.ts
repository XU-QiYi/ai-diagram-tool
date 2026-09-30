/**
 * Guards for untrusted diagram input arriving over MCP.
 *
 * Positions, routes, and renderer markup are owned by ELK and the renderers
 * (AGENTS.md sections 2, 3, and 29), so callers may not supply them. The key
 * list mirrors the geometry check in `src/ai/pipeline.ts`.
 */
export const FORBIDDEN_GEOMETRY_KEYS: readonly string[] = [
  'x',
  'y',
  'sections',
  'bendPoints',
  'waypoints',
  'wayPoint',
  'points',
  'geometry',
  'mxGeometry',
  'mxCell',
  'mxGraphModel',
  'layoutPositions',
];

/** A request the server understands but refuses; reported as a structured tool error. */
export class ToolError extends Error {
  constructor(readonly code: string, message: string, readonly hint?: string) {
    super(message);
    this.name = 'ToolError';
  }
}

export class GeometryInputError extends ToolError {
  constructor(readonly findings: string[]) {
    super(
      'INPUT_GEOMETRY_FORBIDDEN',
      `Geometry must not be supplied by the caller: ${findings.join('; ')}. ` +
        'The Diagram model describes nodes, edges, containers, and layout preferences only. ' +
        'ELK computes every position, size, and edge route; pass "layout" preferences ' +
        '(algorithm, density, nodeSpacing, layerSpacing, ...) and top-level "direction" instead of coordinates.',
    );
    this.name = 'GeometryInputError';
  }
}

/** `width` and `height` are size hints the model already allows; see utils/text.ts. */
const ALLOWED_SIZE_HINTS = new Set(['width', 'height']);

function scan(value: unknown, path: string, findings: string[], depth = 0): void {
  if (depth > 12 || findings.length > 20) return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      scan(item, `${path}/${index}`, findings, depth + 1);
    });
    return;
  }
  if (value === null || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const where = `${path}/${key}`;
    if (FORBIDDEN_GEOMETRY_KEYS.includes(key) && !ALLOWED_SIZE_HINTS.has(key)) {
      findings.push(`${where} is a geometry field`);
      continue;
    }
    if (typeof child === 'string' && /<mx(Geometry|Cell|GraphModel)\b/i.test(child)) {
      findings.push(`${where} contains renderer markup`);
      continue;
    }
    scan(child, where, findings, depth + 1);
  }
}

/** Throws `GeometryInputError` when the payload tries to dictate layout geometry. */
export function assertNoGeometry(value: unknown, rootLabel = 'input'): void {
  const findings: string[] = [];
  scan(value, rootLabel, findings);
  if (findings.length) throw new GeometryInputError(findings);
}

/** Requires at least one of the named string properties to be present and non-empty. */
export function requireString(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  if (typeof value !== 'string' || !value.trim()) {
    throw new TypeError(`Argument "${key}" must be a non-empty string`);
  }
  return value;
}

/** Bounds a caller supplied number so a bad request cannot exhaust memory or disk. */
export function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : fallback;
  return Math.min(max, Math.max(min, parsed));
}

export type JsonRecord = Record<string, unknown>;

export function asRecord(value: unknown, label: string): JsonRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`Argument "${label}" must be an object`);
  }
  return value as JsonRecord;
}
