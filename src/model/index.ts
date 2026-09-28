export * from './types.js';
import { DIAGRAM_TYPES, type Diagram, type Node, type Edge, type Style } from './types.js';

const STYLE_COLOR_FIELDS = ['fill', 'stroke', 'text'] as const;
const STYLE_NUMBER_RANGES = {
  opacity: [0, 1],
  fontSize: [6, 72],
  strokeWidth: [0, 20],
  lineHeight: [1, 200],
  paddingX: [0, 2000],
  minWidth: [0, 2000],
  minHeight: [0, 2000],
} as const;
/** Legal `style.shape` names. The renderers must honor every one of them. */
export const ALLOWED_SHAPES = new Set([
  'ellipse',
  'rectangle',
  'rounded',
  'rhombus',
  'cylinder',
  'component',
  'cube',
  'umlActor',
  'doubleEllipse',
  'arc',
  'note',
  'swimlane',
]);
/** Legal `ClassAttribute.key` roles; anything else must fail rather than render «BOGUS». */
export const KEY_ROLES = new Set(['PK', 'FK', 'UK']);
const SHAPE_OPTIONS: Record<string, RegExp> = {
  rounded: /^[01]$/,
  double: /^[01]$/,
  dashed: /^[01]$/,
  aspect: /^fixed$/,
  verticalLabelPosition: /^(?:top|bottom)$/,
  verticalAlign: /^(?:top|middle|bottom)$/,
  labelPosition: /^(?:left|center|right)$/,
  align: /^(?:left|center|right)$/,
  spacingTop: /^(?:0|[1-9]\d{0,2})$/,
  spacing: /^(?:0|[1-9]\d{0,2})$/,
  overflow: /^(?:fill|hidden|visible)$/,
};
function validateStyle(style: Style | undefined, owner: string): void {
  if (!style) return;
  for (const field of STYLE_COLOR_FIELDS) {
    const value = style[field];
    if (value !== undefined && (!/^(?:#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})|[A-Za-z]+)$/i.test(value) || value.length > 32)) {
      throw new Error(`Invalid style ${field} for ${owner}: ${String(value)}`);
    }
  }
  for (const [field, range] of Object.entries(STYLE_NUMBER_RANGES)) {
    const value = style[field as keyof typeof STYLE_NUMBER_RANGES];
    if (value !== undefined && (!Number.isFinite(value) || value < range[0] || value > range[1])) {
      throw new Error(`Invalid style ${field} for ${owner}: ${String(value)}`);
    }
  }
  if (style.shape !== undefined) {
    const parts = style.shape.split(';');
    const first = parts[0] ?? '';
    const shapeMatch = first.match(/^shape=([A-Za-z][A-Za-z0-9]*)$/);
    const bareMatch = first.match(/^([A-Za-z][A-Za-z0-9]*)$/);
    const roundedMatch = first.match(/^rounded=(?:0|1)$/);
    const shapeName = shapeMatch?.[1] ?? bareMatch?.[1] ?? (roundedMatch ? 'rounded' : undefined);
    const validParts = parts.slice(1).every((part) => {
      const option = part.match(/^([A-Za-z][A-Za-z0-9]*)=([A-Za-z0-9]+)$/);
      return option !== null && SHAPE_OPTIONS[option[1]]?.test(option[2]) === true;
    });
    if (!shapeName || !ALLOWED_SHAPES.has(shapeName) || !validParts || style.shape.length > 240) {
      throw new Error(`Invalid style shape for ${owner}: ${style.shape}`);
    }
  }
}

export function createDiagram(input: Omit<Diagram, 'nodes' | 'edges'> & { nodes?: Node[]; edges?: Edge[] }): Diagram {
  if (!DIAGRAM_TYPES.includes(input.type)) throw new Error(`Unsupported diagram type: ${String(input.type)}`);
  const nodes = input.nodes ?? [];
  const edges = input.edges ?? [];
  const nodeIds = new Set<string>();
  for (const n of nodes) { if (nodeIds.has(n.id)) throw new Error(`Duplicate node id: ${n.id}`); nodeIds.add(n.id); }
  const edgeIds = new Set<string>();
  for (const e of edges) { if (edgeIds.has(e.id)) throw new Error(`Duplicate edge id: ${e.id}`); edgeIds.add(e.id); }
  const cellIds=new Set<string>(); const reserve=(id:string,kind:string)=>{if(cellIds.has(id))throw new Error(`Duplicate stable id (${kind}): ${id}`);cellIds.add(id);};
  for(const n of nodes){reserve(n.id,'node');for(const p of n.ports??[])reserve(p.id,'port');}
  const nodeById = new Map(nodes.map(node => [node.id, node]));
  for (const n of nodes)
    for (const a of n.classMeta?.attributes ?? [])
      if (a.key !== undefined && !KEY_ROLES.has(a.key))
        throw new Error(`Invalid attribute key role "${String(a.key)}" on ${n.id}.${a.name}: expected PK, FK or UK`);
  for(const e of edges){
    reserve(e.id,'edge');
    if (!nodeById.has(e.source)) throw new Error(`Edge ${e.id} references missing node: ${e.source}`);
    if (!nodeById.has(e.target)) throw new Error(`Edge ${e.id} references missing node: ${e.target}`);
    const sourcePorts = new Set((nodeById.get(e.source)?.ports ?? []).map(port => port.id));
    const targetPorts = new Set((nodeById.get(e.target)?.ports ?? []).map(port => port.id));
    if (e.sourcePort && !sourcePorts.has(e.sourcePort)) throw new Error(`Edge ${e.id} sourcePort ${e.sourcePort} does not belong to ${e.source}`);
    if (e.targetPort && !targetPorts.has(e.targetPort)) throw new Error(`Edge ${e.id} targetPort ${e.targetPort} does not belong to ${e.target}`);
  }
  const containers = input.containers ?? [];
  const containerIds = new Set<string>();
  const containerById = new Map<string, (typeof containers)[number]>();
  for (const container of containers) {
    reserve(container.id, 'container');
    containerIds.add(container.id);
    containerById.set(container.id, container);
  }
  for (const n of nodes) {
    if (n.containerId && !containerIds.has(n.containerId)) {
      throw new Error(`Node ${n.id} references missing container: ${n.containerId}`);
    }
  }
  for (const c of containers) {
    for (const nodeId of c.nodeIds) {
      if (!nodeById.has(nodeId)) throw new Error(`Container ${c.id} references missing node: ${nodeId}`);
    }
    for (const childId of c.containerIds ?? []) {
      if (!containerIds.has(childId)) throw new Error(`Container ${c.id} references missing container: ${childId}`);
      if (childId === c.id) throw new Error(`Container hierarchy cycle: ${c.id}`);
    }
    if (c.parentId && !containerIds.has(c.parentId)) {
      throw new Error(`Container ${c.id} parentId references missing container: ${c.parentId}`);
    }
    if (c.parentId) {
      const parent = containerById.get(c.parentId)!;
      if (!(parent.containerIds ?? []).includes(c.id)) {
        throw new Error(`Container ${c.id} parentId ${c.parentId} is not listed in ${c.parentId}.containerIds`);
      }
    }
    for (const childId of c.containerIds ?? []) {
      const child = containerById.get(childId)!;
      if (child.parentId !== c.id) {
        throw new Error(`Container ${c.id} lists child ${childId} but its parentId is ${child.parentId ?? 'missing'}`);
      }
    }
  }
  const parentOf = new Map<string, string>();
  for (const container of containers) if (container.parentId) parentOf.set(container.id, container.parentId);
  for (const container of containers) {
    const seen = new Set<string>();
    let current = container.id;
    while (parentOf.has(current)) {
      if (seen.has(current)) throw new Error(`Container hierarchy cycle: ${container.id}`);
      seen.add(current);
      current = parentOf.get(current)!;
    }
  }
  const owners = new Map<string, Set<string>>();
  const addOwner = (nodeId: string, containerId: string) => {
    const set = owners.get(nodeId) ?? new Set<string>();
    set.add(containerId);
    owners.set(nodeId, set);
  };
  for (const n of nodes) if (n.containerId) addOwner(n.id, n.containerId);
  for (const c of containers) for (const nodeId of c.nodeIds) addOwner(nodeId, c.id);
  for (const [nodeId, nodeOwners] of owners) {
    if (nodeOwners.size > 1) {
      throw new Error(`Node ${nodeId} belongs to multiple containers: ${[...nodeOwners].sort().join(', ')}`);
    }
  }
  for (const n of nodes) validateStyle(n.style, `node ${n.id}`);
  for (const e of edges) validateStyle(e.style, `edge ${e.id}`);
  for (const c of containers) validateStyle(c.style, `container ${c.id}`);
  for(const a of input.sequence?.activations??[])reserve(a.id,'activation');
  for(const f of input.sequence?.fragments??[])reserve(f.id,'fragment');
  for(const lane of input.activity?.swimlanes??[])reserve(lane.id,'swimlane');
  for(const composite of input.state?.composites??[])reserve(composite.id,'composite');
  for(const a of input.deployment?.artifacts??[])reserve(a.id,'artifact');
  return { ...input, nodes, edges };
}

export function mergeDiagram(base: Diagram, patch: Partial<Diagram> & { addNodes?: Node[]; addEdges?: Edge[]; removeNodeIds?: string[] }): Diagram {
  const remove = new Set(patch.removeNodeIds ?? []);
  const nodes = [...base.nodes.filter(n => !remove.has(n.id)), ...(patch.addNodes ?? [])];
  const edges = [...base.edges.filter(e => !remove.has(e.source) && !remove.has(e.target)), ...(patch.addEdges ?? [])];
  return createDiagram({ ...base, ...patch, nodes, edges, addNodes: undefined, addEdges: undefined, removeNodeIds: undefined } as any);
}
