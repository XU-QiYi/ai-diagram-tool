import type { Diagram, LayoutEdge, LayoutNode, LayoutResult } from "../model/types.js";
import { measureNode } from "../utils/text.js";
import { validateLayout } from "../validate/index.js";

const H_GAP = 70;
const V_GAP = 26;

interface Box {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * A mind map radiates from its root in BOTH directions. ELK's tree layout hangs every
 * child off one side, which produced a right-side org chart rather than a mind map;
 * AGENTS §6 reserves a dedicated layout for exactly this case.
 *
 * Depth-1 subtrees are balanced left/right by the height they need (greedy, taller
 * first), each parent is centered on its children, and every edge is the straight
 * segment between the two nodes' facing borders. Geometry is deterministic from model
 * declaration order and the shared node measurement — never from the model, never from
 * an LLM.
 */
export function mindmapLayout(diagram: Diagram): LayoutResult {
  const pad = 80;
  const sizes = new Map(
    diagram.nodes.map((n) => [n.id, measureNode(n, diagram.type)]),
  );
  const childrenOf = new Map<string, string[]>();
  const hasIncoming = new Set<string>();
  for (const e of diagram.edges) {
    childrenOf.set(e.source, [...(childrenOf.get(e.source) ?? []), e.target]);
    hasIncoming.add(e.target);
  }
  const root =
    diagram.nodes.find((n) => n.kind === "root") ??
    diagram.nodes.find((n) => !hasIncoming.has(n.id)) ??
    diagram.nodes[0];
  if (!root) {
    return {
      diagram,
      nodes: [],
      containers: [],
      edges: [],
      width: 2 * pad,
      height: 2 * pad,
      warnings: [],
      iterations: 1,
      status: "passed",
    };
  }

  const visiting = new Set<string>();
  const heightOf = (id: string): number => {
    if (visiting.has(id)) return sizes.get(id)!.height;
    visiting.add(id);
    const h = sizes.get(id)!.height;
    const kids = childrenOf.get(id) ?? [];
    const total =
      kids.reduce((sum, k) => sum + heightOf(k), 0) + V_GAP * (kids.length - 1);
    visiting.delete(id);
    return Math.max(h, total);
  };

  const placed = new Map<string, Box>();
  const placeSubtree = (
    id: string,
    innerX: number,
    yTop: number,
    dir: 1 | -1,
  ): void => {
    if (placed.has(id) || visiting.has(id)) return;
    visiting.add(id);
    const { width: w, height: h } = sizes.get(id)!;
    const kids = childrenOf.get(id) ?? [];
    const spans = kids.map(heightOf);
    const total =
      spans.reduce((sum, s) => sum + s, 0) + V_GAP * (kids.length - 1);
    // A parent taller than its children's stack must not push the stack outside this
    // subtree's slot, or siblings overlap: center the stack inside the parent's height.
    let cy = yTop + Math.max(0, (h - total) / 2);
    const childInnerX = dir > 0 ? innerX + w + H_GAP : innerX - w - H_GAP;
    kids.forEach((k, i) => {
      placeSubtree(k, childInnerX, cy, dir);
      cy += spans[i] + V_GAP;
    });
    const first = placed.get(kids[0]);
    const last = placed.get(kids[kids.length - 1]);
    const yc =
      first && last
        ? (first.y + first.h / 2 + last.y + last.h / 2) / 2
        : yTop + h / 2;
    placed.set(id, { id, x: dir > 0 ? innerX : innerX - w, y: yc - h / 2, w, h });
    visiting.delete(id);
  };

  const rootW = sizes.get(root.id)!.width;
  const rootH = sizes.get(root.id)!.height;
  const rootKids = childrenOf.get(root.id) ?? [];
  const byHeight = [...rootKids].sort((a, b) => heightOf(b) - heightOf(a));
  const load = { right: 0, left: 0 };
  const sideOf = new Map<string, 1 | -1>();
  for (const kid of byHeight) {
    const side = load.right <= load.left ? 1 : -1;
    sideOf.set(kid, side);
    load[side > 0 ? "right" : "left"] += heightOf(kid) + V_GAP;
  }
  const extent = Math.max(1, ...rootKids.map((k) => heightOf(k)));
  for (const side of [1, -1] as const) {
    const kids = rootKids.filter((k) => sideOf.get(k) === side);
    const sideHeight =
      kids.reduce((sum, k) => sum + heightOf(k), 0) + V_GAP * (kids.length - 1);
    let yTop = (extent - sideHeight) / 2;
    for (const kid of kids) {
      placeSubtree(kid, side > 0 ? rootW + H_GAP : -H_GAP, yTop, side);
      yTop += heightOf(kid) + V_GAP;
    }
  }
  placed.set(root.id, {
    id: root.id,
    x: 0,
    y: extent / 2 - rootH / 2,
    w: rootW,
    h: rootH,
  });

  // Normalize into positive coordinates with an even margin.
  const minX = Math.min(...[...placed.values()].map((b) => b.x));
  const maxX = Math.max(...[...placed.values()].map((b) => b.x + b.w));
  const minY = Math.min(...[...placed.values()].map((b) => b.y));
  const maxY = Math.max(...[...placed.values()].map((b) => b.y + b.h));
  const dx = pad - minX;
  const dy = pad - minY;
  const nodes: LayoutNode[] = diagram.nodes.flatMap((n) => {
    const b = placed.get(n.id);
    if (!b) return [];
    return [
      {
        ...n,
        x: b.x + dx,
        y: b.y + dy,
        width: b.w,
        height: b.h,
        layoutPorts: [],
      },
    ];
  });
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const edges: LayoutEdge[] = diagram.edges.flatMap((e) => {
    const s = nodeById.get(e.source);
    const t = nodeById.get(e.target);
    if (!s || !t) return [{ ...e, sections: [] }];
    const toTheRight = t.x + t.width / 2 >= s.x + s.width / 2;
    return [
      {
        ...e,
        sections: [
          {
            startPoint: {
              x: toTheRight ? s.x + s.width : s.x,
              y: s.y + s.height / 2,
            },
            endPoint: { x: toTheRight ? t.x : t.x + t.width, y: t.y + t.height / 2 },
            bendPoints: [],
          },
        ],
      },
    ];
  });
  const result: LayoutResult = {
    diagram,
    nodes,
    containers: [],
    edges,
    width: maxX - minX + 2 * pad,
    height: maxY - minY + 2 * pad,
    warnings: [],
    iterations: 1,
    status: "passed",
  };
  // Same validator contract as the ELK path, same status convention as its
  // iterationStatus(): ERROR → failed, WARNING → passed_with_warnings, INFO → passed.
  const report = validateLayout(result);
  return {
    ...result,
    issues: report.issues,
    status: report.issues.some((i) => i.severity === "ERROR")
      ? "failed_composition_needed"
      : report.issues.some((i) => i.severity === "WARNING")
        ? "passed_with_warnings"
        : "passed",
  };
}
