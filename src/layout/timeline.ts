import type { Diagram, LayoutEdge, LayoutNode, LayoutResult } from "../model/types.js";
import { measureNode } from "../utils/text.js";
import { validateLayout } from "../validate/index.js";

/**
 * A timeline is a sequence on one shared axis, not a layered graph — ELK layered rendered
 * milestones as three loose bubbles in a row, which reads as a tiny flowchart instead of
 * a timeline. AGENTS §6 reserves dedicated layouts for exactly this case.
 *
 * Milestones sit on one horizontal axis in model declaration order; the connecting edges
 * ARE the axis segments between them. Geometry is computed deterministically from the
 * same node measurement the ELK path uses — never from the model, never from an LLM.
 */
export function timelineLayout(diagram: Diagram): LayoutResult {
  const pad = 120;
  const gap = 110;
  const axisY = 140;
  const nodes: LayoutNode[] = [];
  let cursor = pad;
  for (const node of diagram.nodes) {
    const size = measureNode(node, diagram.type);
    nodes.push({
      ...node,
      x: cursor,
      y: axisY - size.height / 2,
      width: size.width,
      height: size.height,
      layoutPorts: [],
    });
    cursor += size.width + gap;
  }
  const placed = new Map(nodes.map((n) => [n.id, n]));
  const edges: LayoutEdge[] = diagram.edges.map((e) => {
    const s = placed.get(e.source);
    const t = placed.get(e.target);
    const sections =
      s && t
        ? [
            {
              startPoint: { x: s.x + s.width, y: axisY },
              endPoint: { x: t.x, y: axisY },
              bendPoints: [],
            },
          ]
        : [];
    return { ...e, sections };
  });
  const result: LayoutResult = {
    diagram,
    nodes,
    containers: [],
    edges,
    width: Math.max(cursor - gap + pad, 360),
    height: 280,
    warnings: [],
    iterations: 1,
    status: "passed",
  };
  // The dedicated path answers to the same validator as the ELK path, with the same
  // status convention as its iterationStatus(): ERROR → failed, WARNING →
  // passed_with_warnings, INFO → still passed. Findings stay reported under whichever
  // profile travels with the model.
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
