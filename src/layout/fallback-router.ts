import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import type { LayoutEdge, LayoutNode, Point } from '../model/types.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ENGINE = path.join(root, 'vendor', 'libavoid', 'libavoid.min.js');
const CORE = path.join(root, 'vendor', 'libavoid', 'libavoid-routing.js');

type AvoidRouting = (
  avoid: unknown,
  vertices: Array<{ id: string; x: number; y: number; w: number; h: number }>,
  edges: Array<{ id: string; source: string; target: string }>,
  options: Record<string, number>,
) => Record<string, Point[]>;

let loaded: { Avoid: unknown; computeRoutes: AvoidRouting } | undefined;

/** Loads the vendored router only when it is actually needed - it is ~560KB of script. */
async function loadRouter(): Promise<{ Avoid: unknown; computeRoutes: AvoidRouting }> {
  if (loaded) return loaded;
  for (const file of [ENGINE, CORE]) {
    try {
      vm.runInThisContext(await fs.readFile(file, 'utf8'), { filename: file });
    } catch (error) {
      const reason = (error as { code?: string })?.code === 'ENOENT' ? 'the file is missing' : (error as Error).message;
      throw new Error(
        `[fallback-router] cannot load vendored libavoid from ${file}: ${reason}. ` +
          'Restore vendor/libavoid/ (see vendor/libavoid/NOTES.md for provenance) or remove the fallback call site.',
      );
    }
  }
  const global = globalThis as { Avoid?: unknown; AvoidRouting?: { computeRoutes?: AvoidRouting } };
  if (!global.Avoid || typeof global.AvoidRouting?.computeRoutes !== 'function') {
    throw new Error('[fallback-router] the vendored scripts loaded but did not publish globalThis.Avoid / AvoidRouting.computeRoutes; vendor/libavoid/ is probably not the expected build.');
  }
  loaded = { Avoid: global.Avoid, computeRoutes: global.AvoidRouting.computeRoutes };
  return loaded;
}

/** The side midpoint facing the other box - the same attach rule draw.io uses for floating ends. */
function anchor(from: LayoutNode, towards: LayoutNode): Point {
  const dx = towards.x + towards.width / 2 - (from.x + from.width / 2);
  const dy = towards.y + towards.height / 2 - (from.y + from.height / 2);
  return Math.abs(dx) >= Math.abs(dy)
    ? { x: dx >= 0 ? from.x + from.width : from.x, y: from.y + from.height / 2 }
    : { x: from.x + from.width / 2, y: dy >= 0 ? from.y + from.height : from.y };
}

export interface FallbackRoute {
  startPoint: Point;
  endPoint: Point;
  bendPoints: Point[];
}

/**
 * Route the edges ELK left without a path. Containers are deliberately not passed as
 * obstacles - a box another box lives inside is not something to route around (the same
 * conclusion draw.io reached in `filterEnclosing`).
 */
export async function routeMissingEdges(
  nodes: LayoutNode[],
  missing: LayoutEdge[],
): Promise<Map<string, FallbackRoute>> {
  const result = new Map<string, FallbackRoute>();
  if (!missing.length) return result;
  const { Avoid, computeRoutes } = await loadRouter();
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const vertices = nodes.map((n) => ({ id: n.id, x: n.x, y: n.y, w: n.width, h: n.height }));
  const edges = missing
    .filter((e) => byId.has(e.source) && byId.has(e.target))
    .map((e) => ({ id: e.id, source: e.source, target: e.target }));
  const bends = computeRoutes(Avoid, vertices, edges, {}) ?? {};
  for (const edge of edges) {
    if (!(edge.id in bends)) continue;
    const from = byId.get(edge.source)!;
    const to = byId.get(edge.target)!;
    result.set(edge.id, {
      startPoint: anchor(from, to),
      endPoint: anchor(to, from),
      bendPoints: bends[edge.id] ?? [],
    });
  }
  return result;
}
