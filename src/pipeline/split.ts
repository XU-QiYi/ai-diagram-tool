import { createDiagram } from '../model/index.js';
import type { Container, Diagram, Node } from '../model/types.js';

export interface DiagramPart {
  name: string;
  diagram: Diagram;
  role: 'single' | 'overview' | 'subsystem';
}
const slug = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48) || 'part';

function ownedNodeIds(container: Container, containers: Container[]): Set<string> {
  const ids = new Set(container.nodeIds);
  const children = containers.filter((c) => c.parentId === container.id || container.containerIds?.includes(c.id));
  for (const child of children) for (const id of ownedNodeIds(child, containers)) ids.add(id);
  return ids;
}

function subset(diagram: Diagram, id: string, title: string, nodes: Node[], containers: Container[]): Diagram {
  const nodeIds = new Set(nodes.map((n) => n.id));
  const containerIds = new Set(containers.map((c) => c.id));
  // Edge ids that survive in this part: both endpoints belong here. Sequence activations
  // must be checked against this set, not just participant membership — an activation
  // whose message crossed the split boundary would otherwise keep pointing at an edge
  // this part no longer has, and semantic validation would flag the dangling reference.
  const partEdgeIds = new Set(
    diagram.edges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target)).map((e) => e.id),
  );
  return createDiagram({
    ...diagram,
    id,
    title,
    nodes,
    edges: diagram.edges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target)),
    containers: containers.map((c) => ({
      ...c,
      parentId: c.parentId && containerIds.has(c.parentId) ? c.parentId : undefined,
      containerIds: c.containerIds?.filter((x) => containerIds.has(x)),
      nodeIds: c.nodeIds.filter((x) => nodeIds.has(x)),
    })),
    constraints: diagram.constraints
      ? {
          ...diagram.constraints,
          forceSingle: true,
          placement: Object.fromEntries(
            Object.entries(diagram.constraints.placement ?? {}).filter(([key]) => nodeIds.has(key)),
          ),
        }
      : { forceSingle: true },
    sequence: diagram.sequence
      ? {
          activations: diagram.sequence.activations?.filter(
            (a) =>
              nodeIds.has(a.participantId) &&
              partEdgeIds.has(a.startMessageId) &&
              (!a.endMessageId || partEdgeIds.has(a.endMessageId)),
          ),
          fragments: diagram.sequence.fragments
            ?.map((f) => ({
              ...f,
              messageIds: f.messageIds.filter((mid) => partEdgeIds.has(mid)),
            }))
            .filter((f) => f.messageIds.length),
        }
      : undefined,
    activity: diagram.activity
      ? {
          swimlanes: diagram.activity.swimlanes
            ?.map((l) => ({
              ...l,
              nodeIds: l.nodeIds.filter((x) => nodeIds.has(x)),
            }))
            .filter((l) => l.nodeIds.length),
          objectFlows: diagram.activity.objectFlows?.filter((id) => partEdgeIds.has(id)),
        }
      : undefined,
    state: diagram.state
      ? {
          composites: diagram.state.composites
            ?.map((c) => ({
              ...c,
              nodeIds: c.nodeIds.filter((x) => nodeIds.has(x)),
            }))
            .filter((c) => c.nodeIds.length),
        }
      : undefined,
    deployment: diagram.deployment
      ? {
          artifacts: diagram.deployment.artifacts?.filter((a) => nodeIds.has(a.deployedOn)),
        }
      : undefined,
    er: diagram.er ? { entities: diagram.er.entities?.filter((e) => nodeIds.has(e.nodeId)) } : undefined,
    chenEr: diagram.chenEr
      ? {
          entityIds: diagram.chenEr.entityIds?.filter((id) => nodeIds.has(id)),
          attributeIds: diagram.chenEr.attributeIds?.filter((id) => nodeIds.has(id)),
          relationshipIds: diagram.chenEr.relationshipIds?.filter((id) => nodeIds.has(id)),
        }
      : undefined,
  });
}

function overview(diagram: Diagram, groups: Array<{ key: string; label: string; nodes: Set<string> }>): Diagram {
  const owner = new Map<string, string>();
  for (const g of groups) for (const id of g.nodes) owner.set(id, g.key);
  const nodes = groups.map((g) => ({
    id: `overview.${g.key}`,
    label: g.label,
    kind: 'subsystem',
  }));
  const pairEdges = new Map<string, Diagram['edges'][number]>();
  for (const edge of diagram.edges) {
    const a = owner.get(edge.source),
      b = owner.get(edge.target);
    if (!a || !b || a === b) continue;
    const key = `${a}->${b}`;
    if (!pairEdges.has(key))
      pairEdges.set(key, {
        id: `overview.edge.${a}-${b}`,
        source: `overview.${a}`,
        target: `overview.${b}`,
        label: 'dependency',
        type: 'dependency',
      });
  }
  return createDiagram({
    id: `${diagram.id}-main`,
    title: `${diagram.title} — Overview`,
    type: diagram.type,
    metadata: { ...diagram.metadata, overviewOf: diagram.type },
    direction: diagram.direction,
    routing: diagram.routing,
    theme: diagram.theme,
    nodes,
    edges: [...pairEdges.values()],
    constraints: { forceSingle: true },
  });
}

export function splitLargeDiagram(diagram: Diagram, limit = 40): DiagramPart[] {
  if (diagram.nodes.length <= limit || diagram.constraints?.forceSingle)
    return [{ name: diagram.id, diagram, role: 'single' }];
  const containers = diagram.containers ?? [];
  const top = containers.filter((c) => !c.parentId && !containers.some((p) => p.containerIds?.includes(c.id)));
  if (top.length) {
    const groups = top.map((c) => ({
      key: slug(c.id.replace(/^container\./, '')),
      label: c.label,
      nodes: ownedNodeIds(c, containers),
    }));
    const assigned = new Set([...groups.flatMap((g) => [...g.nodes])]);
    const outside = diagram.nodes.filter((n) => !assigned.has(n.id));
    if (outside.length)
      groups.push({
        key: 'shared',
        label: 'Shared / External',
        nodes: new Set(outside.map((n) => n.id)),
      });
    const parts: DiagramPart[] = [{ name: 'main', diagram: overview(diagram, groups), role: 'overview' }];
    for (const group of groups) {
      const childContainers = containers.filter((c) => [...group.nodes].some((id) => c.nodeIds.includes(id)));
      parts.push({
        name: group.key,
        diagram: subset(
          diagram,
          `${diagram.id}-${group.key}`,
          `${diagram.title} — ${group.label}`,
          diagram.nodes.filter((n) => group.nodes.has(n.id)),
          childContainers,
        ),
        role: 'subsystem',
      });
    }
    return parts;
  }
  const chunks: Array<{ key: string; label: string; nodes: Set<string> }> = [];
  for (let i = 0; i < diagram.nodes.length; i += limit) {
    const index = i / limit + 1;
    chunks.push({
      key: `part-${index}`,
      label: `Part ${index}`,
      nodes: new Set(diagram.nodes.slice(i, i + limit).map((n) => n.id)),
    });
  }
  return [
    { name: 'main', diagram: overview(diagram, chunks), role: 'overview' },
    ...chunks.map((g) => ({
      name: g.key,
      diagram: subset(
        diagram,
        `${diagram.id}-${g.key}`,
        `${diagram.title} — ${g.label}`,
        diagram.nodes.filter((n) => g.nodes.has(n.id)),
        [],
      ),
      role: 'subsystem' as const,
    })),
  ];
}
