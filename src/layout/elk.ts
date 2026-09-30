import ELK from '@elkjs/elkjs';
import type {
  Container,
  Diagram,
  Direction,
  LayoutContainer,
  LayoutDensity,
  LayoutEdge,
  LayoutIteration,
  LayoutNode,
  LayoutPort,
  LayoutResult,
  ValidationIssue,
} from '../model/types.js';
import { LAYOUT_ALGORITHMS, type LayoutAlgorithm } from '../model/types.js';
import { measureLabel, measureNode } from '../utils/text.js';
import { validateLayout } from '../validate/index.js';
import { routeMissingEdges } from './fallback-router.js';
import { mindmapLayout } from './mindmap.js';
import { timelineLayout } from './timeline.js';

const elk = new (ELK as any)();
const directionMap: Record<Direction, string> = {
  LEFT_TO_RIGHT: 'RIGHT',
  RIGHT_TO_LEFT: 'LEFT',
  TOP_TO_BOTTOM: 'DOWN',
  BOTTOM_TO_TOP: 'UP',
};

interface LayoutProfile {
  nodeSpacing: number;
  layerSpacing: number;
  containerPadding: number;
  targetAspectRatio: number;
  wrapping: 'OFF' | 'SINGLE_EDGE' | 'MULTI_EDGE';
  edgeLength: number;
}

const densitySpacing: Record<LayoutDensity, { node: number; layer: number; padding: number }> = {
  compact: { node: 45, layer: 60, padding: 22 },
  balanced: { node: 60, layer: 78, padding: 28 },
  spacious: { node: 85, layer: 110, padding: 36 },
};

function defaultAspectRatio(diagram: Diagram): number {
  if (diagram.type === 'flowchart') return 1.05;
  if (diagram.type === 'state' || diagram.type === 'state-machine' || diagram.type === 'activity') return 0.9;
  if (diagram.type === 'system-architecture' || diagram.type === 'deployment') return 1.2;
  if (
    diagram.type === 'uml-class' ||
    diagram.type === 'uml-usecase' ||
    diagram.type === 'uml-component' ||
    diagram.type === 'er' ||
    diagram.type === 'chen-er'
  )
    return 1.35;
  return 1.15;
}

function layoutProfile(diagram: Diagram): LayoutProfile {
  const density = diagram.layout?.density ?? 'balanced';
  const defaults = densitySpacing[density];
  // ELK graph wrapping is useful for long acyclic flows, but it can create
  // very long back edges in cyclic state machines. Keep it opt-in for state
  // machines and use the aspect-ratio hint for the normal balanced layout.
  const autoWrap = false;
  const requestedWrapping = diagram.layout?.wrapping ?? 'AUTO';
  const compactFlow = diagram.type === 'flowchart';
  const compactStateMachine = diagram.type === 'state-machine';
  return {
    nodeSpacing: diagram.layout?.nodeSpacing ?? (compactFlow ? 30 : compactStateMachine ? 40 : defaults.node),
    layerSpacing: diagram.layout?.layerSpacing ?? (compactFlow ? 28 : compactStateMachine ? 46 : defaults.layer),
    containerPadding: diagram.layout?.containerPadding ?? defaults.padding,
    targetAspectRatio: diagram.layout?.targetAspectRatio ?? defaultAspectRatio(diagram),
    wrapping: requestedWrapping === 'AUTO' ? (autoWrap ? 'MULTI_EDGE' : 'OFF') : requestedWrapping,
    edgeLength:
      diagram.layout?.edgeLength ??
      (diagram.layout?.nodeSpacing ?? (compactFlow ? 30 : compactStateMachine ? 40 : defaults.node)) +
        (diagram.type === 'chen-er' ? 120 : 160),
  };
}

export function effectiveContainers(diagram: Diagram): Container[] {
  const activity = (diagram.activity?.swimlanes ?? []).map(
    (l) =>
      ({
        id: l.id,
        label: l.label,
        nodeIds: l.nodeIds,
        direction: diagram.direction,
        style: { fill: '#FFFFFF', stroke: '#94A3B8', text: '#334155' },
      }) satisfies Container,
  );
  const states = (diagram.state?.composites ?? []).map(
    (c) =>
      ({
        id: c.id,
        label: c.label,
        nodeIds: c.nodeIds,
        direction: c.direction ?? diagram.direction,
        style: { fill: '#F8FAFC', stroke: '#64748B', text: '#334155' },
      }) satisfies Container,
  );
  return [...(diagram.containers ?? []), ...activity, ...states];
}

function algorithmFor(diagram: Diagram): string {
  const requested = diagram.layout?.algorithm;
  if (requested && requested !== 'auto') {
    // Names outside this list reach ELK unchanged, which rejects the whole layout
    // with an opaque engine error; validate here so the caller learns what to send.
    if (!LAYOUT_ALGORITHMS.includes(requested as LayoutAlgorithm)) {
      throw new Error(
        `Unsupported layout algorithm "${String(requested)}" on diagram "${diagram.id}" ` +
          `(type ${diagram.type}). Supported: ${LAYOUT_ALGORITHMS.join(', ')}.`,
      );
    }
    return requested;
  }
  return diagram.type === 'mindmap'
    ? 'mrtree'
    : diagram.type === 'network' || diagram.type === 'chen-er'
      ? 'stress'
      : 'layered';
}

function buildElkGraph(diagram: Diagram, profile: LayoutProfile) {
  const containers = effectiveContainers(diagram);
  const childOwner = new Map<string, string>();
  for (const c of containers) {
    if (c.parentId) childOwner.set(c.id, c.parentId);
    for (const child of c.containerIds ?? []) childOwner.set(child, c.id);
  }
  const nodeOwner = new Map<string, string>();
  for (const n of diagram.nodes) if (n.containerId) nodeOwner.set(n.id, n.containerId);
  for (const c of containers) for (const id of c.nodeIds) if (!nodeOwner.has(id)) nodeOwner.set(id, c.id);
  const placement = diagram.constraints?.placement ?? {};
  const makeNode = (node: Diagram['nodes'][number]): any => {
    const size = measureNode(node, diagram.type);
    const layoutOptions: Record<string, string> = {};
    if (node.ports?.length) layoutOptions['elk.portConstraints'] = 'FIXED_SIDE';
    if (placement[node.id]) layoutOptions['elk.layered.layering.layerConstraint'] = placement[node.id];
    return {
      id: node.id,
      ...size,
      layoutOptions,
      labels: [{ text: node.label }],
      ports: node.ports?.map((p) => ({
        id: p.id,
        width: p.width ?? 8,
        height: p.height ?? 8,
        layoutOptions: { 'elk.port.side': p.side ?? 'EAST' },
        labels: p.label ? [{ text: p.label }] : undefined,
      })),
    };
  };
  // Declaration order over nodes then containers. This only makes the child order handed to
  // ELK deterministic (a sub-container declared before some node sorts ahead of it). It is
  // NOT a layout lever: this engine build decides in-layer positions itself, which is why
  // the author-facing `constraints.before` knob was deleted instead of kept as a hint.
  const rank = new Map([...diagram.nodes.map((n) => n.id), ...containers.map((c) => c.id)].map((id, i) => [id, i]));
  const makeContainer = (container: Container): any => {
    const children = [
      ...diagram.nodes.filter((n) => nodeOwner.get(n.id) === container.id).map(makeNode),
      ...containers.filter((c) => childOwner.get(c.id) === container.id).map(makeContainer),
    ].sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
    const pad = container.padding ?? profile.containerPadding,
      top = Math.max(45, pad + 15);
    return {
      id: container.id,
      children,
      labels: [{ text: container.label, ...measureLabel(container.label, 14) }],
      layoutOptions: {
        // No per-container "elk.algorithm": the root sets INCLUDE_CHILDREN, so this
        // container's children are laid out by the diagram's algorithm and a nested
        // engine name here was inert (verified: identical output with it removed).
        'elk.direction': directionMap[container.direction ?? diagram.direction ?? 'LEFT_TO_RIGHT'],
        'elk.edgeRouting': 'ORTHOGONAL',
        'elk.spacing.nodeNode': String(container.spacing ?? profile.nodeSpacing),
        'elk.layered.spacing.nodeNodeBetweenLayers': String(container.spacing ?? profile.layerSpacing),
        'elk.padding': `[top=${top},left=${pad},bottom=${pad},right=${pad}]`,
      },
    };
  };
  const children = [
    ...diagram.nodes.filter((n) => !nodeOwner.has(n.id)).map(makeNode),
    ...containers.filter((c) => !childOwner.has(c.id)).map(makeContainer),
  ].sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
  const algorithm = algorithmFor(diagram);
  return {
    id: diagram.id,
    layoutOptions: {
      'elk.algorithm': algorithm,
      'elk.direction':
        directionMap[
          diagram.direction ??
            (diagram.type === 'flowchart' || diagram.type === 'activity' ? 'TOP_TO_BOTTOM' : 'LEFT_TO_RIGHT')
        ],
      'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
      'elk.edgeRouting': diagram.routing === 'POLYLINE' || algorithm !== 'layered' ? 'POLYLINE' : 'ORTHOGONAL',
      'elk.spacing.nodeNode': String(profile.nodeSpacing),
      'elk.layered.spacing.nodeNodeBetweenLayers': String(profile.layerSpacing),
      'elk.aspectRatio': String(profile.targetAspectRatio),
      'elk.layered.wrapping.strategy': profile.wrapping,
      'elk.layered.wrapping.additionalEdgeSpacing': String(Math.max(20, Math.round(profile.nodeSpacing / 2))),
      'elk.layered.wrapping.multiEdge.improveCuts': 'true',
      'elk.layered.wrapping.multiEdge.improveWrappedEdges': 'true',
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
      'elk.layered.nodePlacement.strategy': diagram.type === 'uml-class' ? 'NETWORK_SIMPLEX' : 'BRANDES_KOEPF',
      'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
      'elk.layered.unnecessaryBendpoints': 'true',
      'elk.stress.desiredEdgeLength': String(profile.edgeLength),
      'elk.spacing.componentComponent': String(profile.nodeSpacing),
      'elk.padding': `[top=${diagram.layout?.rootPadding ?? 40},left=${diagram.layout?.rootPadding ?? 40},bottom=${diagram.layout?.rootPadding ?? 40},right=${diagram.layout?.rootPadding ?? 40}]`,
    },
    children,
    edges: diagram.edges.map((e) => {
      const measured = e.label ? measureLabel(e.label, diagram.layout?.edgeLabelFontSize ?? 12) : undefined;
      return {
        id: e.id,
        sources: [e.sourcePort ?? e.source],
        targets: [e.targetPort ?? e.target],
        labels: e.label ? [{ text: e.label, ...measured }] : undefined,
      };
    }),
  };
}

function flattenLayout(diagram: Diagram, result: any) {
  const nodesById = new Map(diagram.nodes.map((n) => [n.id, n]));
  const containersById = new Map(effectiveContainers(diagram).map((c) => [c.id, c]));
  const nodes: LayoutNode[] = [];
  const containers: LayoutContainer[] = [];
  const walk = (children: any[] = [], offsetX = 0, offsetY = 0, depth = 0) => {
    for (const child of children) {
      const x = offsetX + (child.x ?? 0),
        y = offsetY + (child.y ?? 0);
      const modelNode = nodesById.get(child.id),
        modelContainer = containersById.get(child.id);
      if (modelNode) {
        const ports: LayoutPort[] = (child.ports ?? []).map((p: any) => ({
          ...(modelNode.ports?.find((mp) => mp.id === p.id) ?? { id: p.id }),
          nodeId: child.id,
          x: x + (p.x ?? 0),
          y: y + (p.y ?? 0),
          width: p.width ?? 8,
          height: p.height ?? 8,
        }));
        nodes.push({
          ...modelNode,
          x,
          y,
          width: child.width,
          height: child.height,
          layoutPorts: ports,
        });
      } else if (modelContainer) {
        containers.push({
          ...modelContainer,
          x,
          y,
          width: child.width ?? 0,
          height: child.height ?? 0,
          depth,
        });
        walk(child.children, x, y, depth + 1);
      }
    }
  };
  walk(result.children);
  const models = effectiveContainers(diagram),
    parent = new Map<string, string>();
  for (const c of models) {
    if (c.parentId) parent.set(c.id, c.parentId);
    for (const child of c.containerIds ?? []) parent.set(child, c.id);
  }
  const owner = new Map<string, string>();
  for (const n of diagram.nodes) if (n.containerId) owner.set(n.id, n.containerId);
  for (const c of models) for (const id of c.nodeIds) if (!owner.has(id)) owner.set(id, c.id);
  const ancestors = (id?: string) => {
    const values: string[] = [];
    while (id) {
      values.push(id);
      id = parent.get(id);
    }
    return values;
  };
  const commonContainer = (a: string, b: string) => {
    const right = new Set(ancestors(owner.get(b)));
    return ancestors(owner.get(a)).find((id) => right.has(id));
  };
  const absoluteContainer = new Map(containers.map((c) => [c.id, c]));
  const edges: LayoutEdge[] = diagram.edges.map((e) => {
    const p = result.edges?.find((x: any) => x.id === e.id);
    const common = absoluteContainer.get(commonContainer(e.source, e.target) ?? '');
    const ox = common?.x ?? 0,
      oy = common?.y ?? 0;
    const point = (v: any) => ({ x: (v?.x ?? 0) + ox, y: (v?.y ?? 0) + oy });
    return {
      ...e,
      sections: p?.sections?.map((s: any) => ({
        startPoint: point(s.startPoint),
        endPoint: point(s.endPoint),
        bendPoints: s.bendPoints?.map(point),
      })),
      labels: p?.labels?.map((l: any) => ({
        x: (l.x ?? 0) + ox,
        y: (l.y ?? 0) + oy,
        width: l.width ?? 0,
        height: l.height ?? 0,
        text: l.text ?? e.label ?? '',
      })),
    };
  });
  return { nodes, containers, edges };
}

/**
 * Findings that make another layout pass worth running at all. Exported so
 * `scripts/generate-error-codes.ts` documents the column from this set instead of
 * restating it (a restated list is a list that drifts).
 */
export const DEFAULT_RELAYOUT_CODES: ReadonlySet<string> = new Set([
  'NODE_OVERLAP',
  'EDGE_CROSSING',
  'EDGE_THROUGH_NODE',
  'CANVAS_OVERFLOW',
  'EDGE_LABEL_OVERLAP',
  'EXCESSIVE_DENSITY',
]);

export function shouldRelayout(issues: ValidationIssue[], diagram: Diagram) {
  // INFO findings are reported for the author's benefit; burning a re-layout iteration
  // on a knob that cannot change them is how the old loop wasted all five.
  const layoutIssues = issues.filter((issue) => issue.phase === 'layout' && issue.severity !== 'INFO');
  if (!layoutIssues.length) return false;
  const customTriggers = diagram.layout?.relayoutTriggers ?? [];
  if (customTriggers.length) {
    return layoutIssues.some((issue) =>
      customTriggers.some((trigger) => {
        try {
          return new RegExp(trigger, 'i').test(issue.code) || new RegExp(trigger, 'i').test(issue.message);
        } catch {
          return (
            issue.code.toLowerCase() === trigger.toLowerCase() ||
            issue.message.toLowerCase().includes(trigger.toLowerCase())
          );
        }
      }),
    );
  }
  return layoutIssues.some((issue) => DEFAULT_RELAYOUT_CODES.has(issue.code));
}

function iterationStatus(issues: ValidationIssue[]): LayoutIteration['status'] {
  if (issues.some((issue) => issue.severity === 'ERROR')) return 'failed';
  if (issues.some((issue) => issue.severity === 'WARNING')) return 'passed_with_warnings';
  return 'passed';
}

/**
 * Violation classes that raising nodeSpacing / layerSpacing / edgeLength demonstrably
 * clears on elkjs 0.12.0. Everything else keeps its finding after five bumps, so the
 * loop must stop instead of inflating the canvas: measured on a real 11-node model,
 * EDGE_CROSSING stayed at exactly 1 from x1 to x4 spacing while the canvas grew
 * 1839x511 -> 3243x871, and under `radial` every multiplier produced a byte-identical
 * canvas because the layered spacing options never reach that algorithm.
 */
export const SPACING_FIXABLE: ReadonlySet<string> = new Set([
  'NODE_OVERLAP',
  'EXCESSIVE_DENSITY',
  'CANVAS_OVERFLOW',
  'EDGE_THROUGH_NODE',
]);

/** Algorithms where the spacing knobs were measured to have no effect at all. */
const SPACING_INERT_ALGORITHMS: ReadonlySet<string> = new Set(['radial', 'mrtree']);

/** Errors first, then canvas size: a smaller equally-clean layout is the better one. */
function iterationScore(result: LayoutResult): number {
  const errors = (result.issues ?? []).filter((issue) => issue.severity === 'ERROR').length;
  return errors * 1e10 + result.width * result.height;
}

export async function layoutDiagram(diagram: Diagram, maxIterations = 5): Promise<LayoutResult> {
  // AGENTS §6: a timeline (one shared axis) and a mind map (radiation from a root) are
  // not graph-layout problems — ELK layered/mrtree rendered them as a loose bubble row
  // and a one-sided org chart. Their dedicated deterministic layouts take over unless an
  // algorithm was requested explicitly.
  const requestedAlgorithm = diagram.layout?.algorithm;
  if (!requestedAlgorithm || requestedAlgorithm === 'auto') {
    if (diagram.type === 'timeline') return timelineLayout(diagram);
    if (diagram.type === 'mindmap') return mindmapLayout(diagram);
  }
  const base = layoutProfile(diagram);
  const iterationLimit = Number.isFinite(maxIterations) ? Math.max(1, Math.floor(maxIterations)) : 5;
  const algorithm = algorithmFor(diagram);
  let profile: LayoutProfile = { ...base };
  let fallbackWarning: string | undefined;
  let last: LayoutResult | undefined;
  let best: LayoutResult | undefined;
  let bestScore = Number.POSITIVE_INFINITY;
  let stopNote: ValidationIssue | undefined;
  const iterationHistory: LayoutIteration[] = [];
  for (let iteration = 1; iteration <= iterationLimit; iteration++) {
    let result: any;
    try {
      result = await elk.layout(buildElkGraph(diagram, profile));
    } catch (error) {
      if (profile.wrapping === 'OFF') throw error;
      // Some ELK versions reject graph wrapping for cyclic or compound graphs.
      // Preserve a safe result and make the fallback explicit to the caller.
      profile = { ...profile, wrapping: 'OFF' };
      fallbackWarning = 'ELK graph wrapping was not applicable; used safe non-wrapped layout';
      result = await elk.layout(buildElkGraph(diagram, profile));
    }
    const flat = flattenLayout(diagram, result);
    // Edges ELK did not route at all would ship as invisible relationships, so the
    // vendored router fills exactly those - never a line ELK already drew.
    const unrouted = flat.edges.filter((e) => !e.sections?.length);
    const fallbackRoutes = await routeMissingEdges(flat.nodes, unrouted);
    for (const [id, route] of fallbackRoutes) {
      const edge = flat.edges.find((e) => e.id === id);
      if (edge) edge.sections = [route];
    }
    const fallbackIssues: ValidationIssue[] = fallbackRoutes.size
      ? [
          {
            severity: 'WARNING',
            code: 'EDGE_ROUTED_BY_FALLBACK',
            message: `${fallbackRoutes.size} edge(s) got no route from ELK and were drawn by the vendored libavoid fallback: ${[...fallbackRoutes.keys()].join(', ')}`,
            phase: 'layout',
          },
        ]
      : [];
    last = {
      diagram,
      ...flat,
      width: Math.max(1, result.width ?? 0),
      height: Math.max(1, result.height ?? 0),
      warnings: fallbackWarning ? [fallbackWarning] : [],
      iterations: iteration,
    };
    const report = validateLayout(last);
    const issues = [
      ...(fallbackWarning
        ? [
            {
              severity: 'WARNING' as const,
              code: 'ELK_WRAPPING_FALLBACK',
              message: fallbackWarning,
              phase: 'layout' as const,
            },
          ]
        : []),
      ...fallbackIssues,
      ...report.issues,
    ];
    last.issues = issues;
    last.warnings = [...new Set(issues.map((issue) => issue.message))];
    const currentStatus = iterationStatus(issues);
    iterationHistory.push({
      iteration,
      profile: { ...profile },
      issueCount: issues.length,
      errorCount: issues.filter((issue) => issue.severity === 'ERROR').length,
      warnings: last.warnings,
      status: currentStatus,
    });
    last.iterationHistory = iterationHistory;
    const score = iterationScore(last);
    if (!best || score < bestScore) {
      best = last;
      bestScore = score;
    }
    if (!shouldRelayout(issues, diagram)) {
      last.status =
        currentStatus === 'failed'
          ? 'failed_after_max_iterations'
          : currentStatus === 'passed_with_warnings'
            ? 'passed_with_warnings'
            : 'passed';
      return last;
    }
    const blocking = [
      ...new Set(
        issues.filter((issue) => issue.severity === 'ERROR' && issue.phase === 'layout').map((issue) => issue.code),
      ),
    ];
    const knobMightHelp =
      !SPACING_INERT_ALGORITHMS.has(algorithm) && blocking.some((code) => SPACING_FIXABLE.has(code));
    // An explicit relayoutTriggers list is the author asking for another pass; honour it
    // even when the default ladder has nothing left to turn.
    if (!knobMightHelp && !(diagram.layout?.relayoutTriggers ?? []).length) {
      stopNote = {
        severity: 'WARNING',
        code: 'RELAYOUT_NOT_FIXABLE_BY_PREFERENCES',
        message:
          `${blocking.join(', ')} survived layout and no preference the tool can turn affects it ` +
          '(spacing, direction and the layered crossing/order options were measured to leave it unchanged). ' +
          'Change the structure instead: remove or reroute a cross-layer long edge, group nodes into containers, ' +
          'pin layers with constraints.placement, or split the diagram.',
        phase: 'layout',
      };
      break;
    }
    profile = {
      ...profile,
      nodeSpacing: profile.nodeSpacing + Math.max(8, Math.round(profile.nodeSpacing * 0.12)),
      layerSpacing: profile.layerSpacing + Math.max(10, Math.round(profile.layerSpacing * 0.12)),
      edgeLength: profile.edgeLength + Math.max(6, Math.round(profile.edgeLength * 0.12)),
    };
  }
  const chosen = best ?? last;
  if (chosen) {
    if (stopNote) {
      chosen.issues = [...(chosen.issues ?? []), stopNote];
      chosen.warnings = [...new Set(chosen.issues.map((issue) => issue.message))];
    }
    chosen.iterationHistory = iterationHistory;
    // The returned layout may be an earlier, better-scoring attempt, so report the number
    // of attempts actually made rather than the attempt the layout came from.
    chosen.iterations = iterationHistory.length;
    chosen.status = stopNote ? 'failed_composition_needed' : 'failed_after_max_iterations';
  }
  return chosen!;
}
