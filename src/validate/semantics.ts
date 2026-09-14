import type { Diagram } from '../model/types.js';

/** Diagram-type rules are intentionally separate from geometric validation. */
export function validateSemantics(diagram: Diagram): string[] {
  const warnings: string[] = [];
  const nodes = new Map(diagram.nodes.map(n => [n.id, n]));
  const edgeKinds = new Set(diagram.edges.map(e => e.type));
  if (diagram.type === 'uml-class') {
    if ([...edgeKinds].some(k => ['flow', 'foreign-key'].includes(k ?? ''))) warnings.push('UML class diagrams should use UML relationships, not flow/foreign-key edges');
    if (!diagram.edges.some(e => e.type === 'inheritance' || e.type === 'realization')) warnings.push('UML class diagram has no inheritance/realization relationship');
  }
  if (diagram.type === 'uml-component' && diagram.edges.some(e => e.type === 'inheritance' || e.type === 'composition')) warnings.push('Component diagrams should use dependency/realization/association relationships');
  if (diagram.type === 'uml-usecase') {
    if (!diagram.nodes.some(n => n.kind === 'actor')) warnings.push('Use case diagram needs at least one Actor');
    if (!diagram.nodes.some(n => n.kind === 'usecase')) warnings.push('Use case diagram needs at least one Use Case');
    if (diagram.edges.some(e => e.type === 'flow')) warnings.push('Use case associations must not be generic flow arrows');
  }
  if (diagram.type === 'er' && diagram.edges.some(e => !['foreign-key', 'association'].includes(e.type ?? ''))) warnings.push('ER diagrams should use foreign-key or association relationships');
  if (diagram.type === 'chen-er') {
    const isEntity = (kind?: string) => kind?.endsWith('entity') ?? false;
    const isAttribute = (kind?: string) => kind?.endsWith('attribute') ?? false;
    const isRelationship = (kind?: string) => kind?.endsWith('relationship') ?? false;
    if (!diagram.nodes.some(n => isEntity(n.kind))) warnings.push('Chen ER diagrams need entity nodes');
    if (!diagram.nodes.some(n => isAttribute(n.kind))) warnings.push('Chen ER diagrams need attribute nodes');
    if (!diagram.nodes.some(n => isRelationship(n.kind))) warnings.push('Chen ER diagrams need relationship nodes');
    if (diagram.edges.some(e => e.type !== 'association')) warnings.push('Chen ER diagrams should use association relationships');
    const relationshipIds = new Set(diagram.nodes.filter(n => isRelationship(n.kind)).map(n => n.id));
    for (const id of relationshipIds) {
      const incident = diagram.edges.filter(e => e.source === id || e.target === id);
      if (incident.length < 2) warnings.push(`Chen relationship should connect at least two nodes: ${id}`);
      else if (incident.some(edge => !edge.label)) warnings.push(`Chen relationship cardinality is unspecified: ${id}`);
    }
  }
  if (diagram.type === 'sequence' && !diagram.nodes.some(n => n.kind === 'participant')) warnings.push('Sequence diagram needs participant nodes');
  if ((diagram.type === 'state' || diagram.type === 'state-machine') && diagram.edges.some(e => e.type !== 'flow')) warnings.push('State transitions should use flow edges with transition labels');
  if (diagram.type === 'sequence' && diagram.sequence?.fragments?.some(f => f.messageIds.length === 0)) warnings.push('Combined fragments must contain message IDs');
  if (diagram.type === 'deployment' && diagram.deployment?.artifacts?.some(a => !nodes.has(a.deployedOn))) warnings.push('Deployment artifact references a missing node');
  if (diagram.type === 'activity' && diagram.activity?.swimlanes?.some(l => l.nodeIds.some(id => !nodes.has(id)))) warnings.push('Activity swimlane references a missing node');
  if (diagram.type === 'state' || diagram.type === 'state-machine') { if (!diagram.nodes.some(n => n.kind === 'start')) warnings.push('State machine needs an initial pseudo-state'); if (!diagram.nodes.some(n => n.kind === 'end')) warnings.push('State machine needs a final state'); }
  if (diagram.type === 'activity') { if (!diagram.nodes.some(n => n.kind === 'start')) warnings.push('Activity diagram needs an initial node'); if (!diagram.nodes.some(n => n.kind === 'end')) warnings.push('Activity diagram needs a final node'); }
  if (diagram.type === 'deployment' && !diagram.nodes.some(n => n.kind === 'device' || n.kind === 'node')) warnings.push('Deployment diagram needs device/node elements');
  if (diagram.type === 'mindmap' && !diagram.nodes.some(n => n.kind === 'root')) warnings.push('Mind map needs one root topic');
  if (diagram.type === 'timeline' && !diagram.nodes.some(n => n.kind === 'milestone')) warnings.push('Timeline needs milestone nodes');
  for (const e of diagram.edges) {
    if (!nodes.has(e.source) || !nodes.has(e.target)) warnings.push(`Relationship references missing node: ${e.id}`);
    if (e.source === e.target) warnings.push(`Self relationship is not allowed by default: ${e.id}`);
  }
  return [...new Set(warnings)];
}
