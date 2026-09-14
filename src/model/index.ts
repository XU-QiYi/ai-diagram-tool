export * from './types.js';
import type { Diagram, Node, Edge } from './types.js';

export function createDiagram(input: Omit<Diagram, 'nodes' | 'edges'> & { nodes?: Node[]; edges?: Edge[] }): Diagram {
  const nodes = input.nodes ?? [];
  const edges = input.edges ?? [];
  const nodeIds = new Set<string>();
  for (const n of nodes) { if (nodeIds.has(n.id)) throw new Error(`Duplicate node id: ${n.id}`); nodeIds.add(n.id); }
  const edgeIds = new Set<string>();
  for (const e of edges) { if (edgeIds.has(e.id)) throw new Error(`Duplicate edge id: ${e.id}`); edgeIds.add(e.id); }
  const cellIds=new Set<string>(); const reserve=(id:string,kind:string)=>{if(cellIds.has(id))throw new Error(`Duplicate stable id (${kind}): ${id}`);cellIds.add(id);};
  for(const n of nodes){reserve(n.id,'node');for(const p of n.ports??[])reserve(p.id,'port');}
  for(const e of edges)reserve(e.id,'edge');
  for(const c of input.containers??[])reserve(c.id,'container');
  for(const a of input.sequence?.activations??[])reserve(a.id,'activation');
  for(const f of input.sequence?.fragments??[])reserve(f.id,'fragment');
  for(const a of input.deployment?.artifacts??[])reserve(a.id,'artifact');
  return { ...input, nodes, edges };
}

export function mergeDiagram(base: Diagram, patch: Partial<Diagram> & { addNodes?: Node[]; addEdges?: Edge[]; removeNodeIds?: string[] }): Diagram {
  const remove = new Set(patch.removeNodeIds ?? []);
  const nodes = [...base.nodes.filter(n => !remove.has(n.id)), ...(patch.addNodes ?? [])];
  const edges = [...base.edges.filter(e => !remove.has(e.source) && !remove.has(e.target)), ...(patch.addEdges ?? [])];
  return createDiagram({ ...base, ...patch, nodes, edges, addNodes: undefined, addEdges: undefined, removeNodeIds: undefined } as any);
}
