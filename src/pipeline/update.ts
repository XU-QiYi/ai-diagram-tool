import { createDiagram } from '../model/index.js';
import type { Container, Diagram, Edge, Node } from '../model/types.js';

/**
 * A small, stable-id based update language for existing diagram models.
 * It intentionally operates on model objects and never on Draw.io XML.
 */
export interface DiagramPatch {
  addNodes?: Node[];
  updateNodes?: Array<Partial<Node> & { id: string }>;
  removeNodeIds?: string[];
  addEdges?: Edge[];
  updateEdges?: Array<Partial<Edge> & { id: string }>;
  removeEdgeIds?: string[];
  addContainers?: Container[];
  updateContainers?: Array<Partial<Container> & { id: string }>;
  removeContainerIds?: string[];
  set?: Partial<Pick<Diagram, 'title' | 'direction' | 'routing' | 'layout' | 'theme' | 'constraints' | 'metadata'>>;
}

function mergeById<T extends { id: string }>(
  base: T[],
  additions: T[] | undefined,
  updates: Array<Partial<T> & { id: string }> | undefined,
  removals: string[] | undefined,
  kind: string,
): T[] {
  const remove = new Set(removals ?? []);
  const result = base.filter((item) => !remove.has(item.id)).map((item) => ({ ...item }));
  const index = new Map(result.map((item, i) => [item.id, i]));
  for (const update of updates ?? []) {
    const at = index.get(update.id);
    if (at === undefined) throw new Error(`Cannot update missing ${kind}: ${update.id}`);
    result[at] = { ...result[at], ...update } as T;
  }
  for (const item of additions ?? []) {
    if (index.has(item.id) || result.some((existing) => existing.id === item.id))
      throw new Error(`Cannot add duplicate ${kind}: ${item.id}`);
    index.set(item.id, result.length);
    result.push({ ...item });
  }
  return result;
}

export function applyDiagramPatch(base: Diagram, patch: DiagramPatch): Diagram {
  const removeNodes = new Set(patch.removeNodeIds ?? []);
  const removeContainers = new Set(patch.removeContainerIds ?? []);
  const nodes = mergeById(base.nodes, patch.addNodes, patch.updateNodes, patch.removeNodeIds, 'node');
  const edges = mergeById(base.edges, patch.addEdges, patch.updateEdges, patch.removeEdgeIds, 'edge').filter(
    (edge) => !removeNodes.has(edge.source) && !removeNodes.has(edge.target),
  );
  const containers = mergeById(
    base.containers ?? [],
    patch.addContainers,
    patch.updateContainers,
    patch.removeContainerIds,
    'container',
  ).map((container) => ({
    ...container,
    parentId: container.parentId && !removeContainers.has(container.parentId) ? container.parentId : undefined,
    containerIds: container.containerIds?.filter((id) => !removeContainers.has(id)),
    nodeIds: container.nodeIds.filter((id) => !removeNodes.has(id) && nodes.some((node) => node.id === id)),
  }));
  const nodeIds = new Set(nodes.map((node) => node.id));
  const sequence = base.sequence && {
    ...base.sequence,
    activations: base.sequence.activations?.filter(
      (item) => nodeIds.has(item.participantId) && edges.some((edge) => edge.id === item.startMessageId),
    ),
    fragments: base.sequence.fragments
      ?.map((fragment) => ({
        ...fragment,
        messageIds: fragment.messageIds.filter((id) => edges.some((edge) => edge.id === id)),
      }))
      .filter((fragment) => fragment.messageIds.length),
  };
  const activity = base.activity && {
    ...base.activity,
    swimlanes: base.activity.swimlanes
      ?.map((lane) => ({ ...lane, nodeIds: lane.nodeIds.filter((id) => nodeIds.has(id)) }))
      .filter((lane) => lane.nodeIds.length),
    objectFlows: base.activity.objectFlows?.filter((id) => edges.some((edge) => edge.id === id)),
  };
  const state = base.state && {
    ...base.state,
    composites: base.state.composites
      ?.map((composite) => ({
        ...composite,
        nodeIds: composite.nodeIds.filter((id) => nodeIds.has(id)),
      }))
      .filter((composite) => composite.nodeIds.length),
  };
  const deployment = base.deployment && {
    ...base.deployment,
    artifacts: base.deployment.artifacts?.filter((artifact) => nodeIds.has(artifact.deployedOn)),
  };
  const er = base.er && { ...base.er, entities: base.er.entities?.filter((entity) => nodeIds.has(entity.nodeId)) };
  const chenEr = base.chenEr && {
    ...base.chenEr,
    entityIds: base.chenEr.entityIds?.filter((id) => nodeIds.has(id)),
    attributeIds: base.chenEr.attributeIds?.filter((id) => nodeIds.has(id)),
    relationshipIds: base.chenEr.relationshipIds?.filter((id) => nodeIds.has(id)),
  };
  return createDiagram({
    ...base,
    ...patch.set,
    nodes,
    edges,
    containers,
    sequence,
    activity,
    state,
    deployment,
    er,
    chenEr,
  });
}
