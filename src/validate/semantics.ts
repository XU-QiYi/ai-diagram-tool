import type { Diagram, ValidationIssue } from '../model/types.js';

function pushIssue(
  issues: ValidationIssue[],
  severity: ValidationIssue['severity'],
  code: string,
  message: string,
  elementId?: string,
  path?: string,
) {
  issues.push({ severity, code, message, elementId, path, phase: 'semantic' });
}

function uniqueIssues(issues: ValidationIssue[]): ValidationIssue[] {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = `${issue.code}|${issue.message}|${issue.path ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Diagram-type rules are intentionally separate from geometric validation. */
export function validateSemanticIssues(diagram: Diagram): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const nodes = new Map(diagram.nodes.map((n) => [n.id, n]));
  const edgeKinds = new Set(diagram.edges.map((e) => e.type));
  const isOverview = diagram.metadata?.overviewOf === diagram.type;
  const warning = (code: string, message: string, elementId?: string, path?: string) =>
    pushIssue(issues, 'WARNING', code, message, elementId, path);
  const error = (code: string, message: string, elementId?: string, path?: string) =>
    pushIssue(issues, 'ERROR', code, message, elementId, path);

  if (!isOverview && diagram.type === 'uml-class') {
    if ([...edgeKinds].some((k) => ['flow', 'foreign-key'].includes(k ?? '')))
      warning(
        'UML_CLASS_INVALID_EDGE_TYPE',
        'UML class diagrams should use UML relationships, not flow/foreign-key edges',
      );
    if (!diagram.edges.some((e) => e.type === 'inheritance' || e.type === 'realization'))
      warning('UML_CLASS_MISSING_GENERALIZATION', 'UML class diagram has no inheritance/realization relationship');
  }
  if (
    !isOverview &&
    diagram.type === 'uml-component' &&
    diagram.edges.some((e) => e.type === 'inheritance' || e.type === 'composition')
  )
    warning(
      'UML_COMPONENT_INVALID_RELATIONSHIP',
      'Component diagrams should use dependency/realization/association relationships',
    );
  if (!isOverview && diagram.type === 'uml-usecase') {
    if (!diagram.nodes.some((n) => n.kind === 'actor'))
      warning('USECASE_MISSING_ACTOR', 'Use case diagram needs at least one Actor');
    if (!diagram.nodes.some((n) => n.kind === 'usecase'))
      warning('USECASE_MISSING_USECASE', 'Use case diagram needs at least one Use Case');
    if (diagram.edges.some((e) => e.type === 'flow'))
      warning('USECASE_INVALID_FLOW', 'Use case associations must not be generic flow arrows');
  }
  if (
    !isOverview &&
    diagram.type === 'er' &&
    diagram.edges.some((e) => !['foreign-key', 'association'].includes(e.type ?? ''))
  )
    warning('ER_INVALID_RELATIONSHIP', 'ER diagrams should use foreign-key or association relationships');
  if (!isOverview && diagram.type === 'chen-er') {
    const isEntity = (kind?: string) => kind?.endsWith('entity') ?? false;
    const isAttribute = (kind?: string) => kind?.endsWith('attribute') ?? false;
    const isRelationship = (kind?: string) => kind?.endsWith('relationship') ?? false;
    if (!diagram.nodes.some((n) => isEntity(n.kind)))
      warning('CHEN_ER_MISSING_ENTITY', 'Chen ER diagrams need entity nodes');
    if (!diagram.nodes.some((n) => isAttribute(n.kind)))
      warning('CHEN_ER_MISSING_ATTRIBUTE', 'Chen ER diagrams need attribute nodes');
    if (!diagram.nodes.some((n) => isRelationship(n.kind)))
      warning('CHEN_ER_MISSING_RELATIONSHIP', 'Chen ER diagrams need relationship nodes');
    if (diagram.edges.some((e) => e.type !== 'association'))
      warning('CHEN_ER_INVALID_RELATIONSHIP', 'Chen ER diagrams should use association relationships');
    const relationshipIds = new Set(diagram.nodes.filter((n) => isRelationship(n.kind)).map((n) => n.id));
    for (const id of relationshipIds) {
      const incident = diagram.edges.filter((e) => e.source === id || e.target === id);
      if (incident.length < 2)
        error('CHEN_RELATIONSHIP_TOO_FEW_ENDPOINTS', `Chen relationship should connect at least two nodes: ${id}`, id);
      else if (incident.some((edge) => !edge.label))
        warning('CHEN_RELATIONSHIP_MISSING_CARDINALITY', `Chen relationship cardinality is unspecified: ${id}`, id);
    }
  }
  if (!isOverview && diagram.type === 'sequence' && !diagram.nodes.some((n) => n.kind === 'participant'))
    warning('SEQUENCE_MISSING_PARTICIPANT', 'Sequence diagram needs participant nodes');
  if (
    !isOverview &&
    (diagram.type === 'state' || diagram.type === 'state-machine') &&
    diagram.edges.some((e) => e.type !== 'flow')
  )
    warning('STATE_INVALID_TRANSITION', 'State transitions should use flow edges with transition labels');
  if (!isOverview && diagram.type === 'sequence' && diagram.sequence?.fragments?.some((f) => f.messageIds.length === 0))
    warning('SEQUENCE_EMPTY_FRAGMENT', 'Combined fragments must contain message IDs');
  if (
    !isOverview &&
    diagram.type === 'deployment' &&
    diagram.deployment?.artifacts?.some((a) => !nodes.has(a.deployedOn))
  )
    error('DEPLOYMENT_MISSING_TARGET', 'Deployment artifact references a missing node');
  if (
    !isOverview &&
    diagram.type === 'activity' &&
    diagram.activity?.swimlanes?.some((l) => l.nodeIds.some((id) => !nodes.has(id)))
  )
    error('ACTIVITY_SWIMLANE_MISSING_NODE', 'Activity swimlane references a missing node');
  if (!isOverview && (diagram.type === 'state' || diagram.type === 'state-machine')) {
    if (!diagram.nodes.some((n) => n.kind === 'start'))
      warning('STATE_MISSING_INITIAL', 'State machine needs an initial pseudo-state');
    if (!diagram.nodes.some((n) => n.kind === 'end'))
      warning('STATE_MISSING_FINAL', 'State machine needs a final state');
  }
  if (!isOverview && diagram.type === 'activity') {
    if (!diagram.nodes.some((n) => n.kind === 'start'))
      warning('ACTIVITY_MISSING_INITIAL', 'Activity diagram needs an initial node');
    if (!diagram.nodes.some((n) => n.kind === 'end'))
      warning('ACTIVITY_MISSING_FINAL', 'Activity diagram needs a final node');
  }
  if (
    !isOverview &&
    diagram.type === 'deployment' &&
    !diagram.nodes.some((n) => n.kind === 'device' || n.kind === 'node')
  )
    warning('DEPLOYMENT_MISSING_DEVICE', 'Deployment diagram needs device/node elements');
  if (!isOverview && diagram.type === 'mindmap' && !diagram.nodes.some((n) => n.kind === 'root'))
    warning('MINDMAP_MISSING_ROOT', 'Mind map needs one root topic');
  if (!isOverview && diagram.type === 'timeline' && !diagram.nodes.some((n) => n.kind === 'milestone'))
    warning('TIMELINE_MISSING_MILESTONE', 'Timeline needs milestone nodes');

  const edgeIds = new Set(diagram.edges.map((e) => e.id));
  for (const [compositeIndex, composite] of (diagram.state?.composites ?? []).entries()) {
    for (const [nodeIndex, nodeId] of composite.nodeIds.entries()) {
      if (!nodes.has(nodeId))
        error(
          'STATE_COMPOSITE_MISSING_NODE',
          `State composite ${composite.id} references missing node: ${nodeId}`,
          nodeId,
          `/state/composites/${compositeIndex}/nodeIds/${nodeIndex}`,
        );
    }
  }
  for (const [index, edgeId] of (diagram.activity?.objectFlows ?? []).entries()) {
    if (!edgeIds.has(edgeId))
      error(
        'ACTIVITY_OBJECT_FLOW_MISSING_EDGE',
        `Activity object flow references missing edge: ${edgeId}`,
        edgeId,
        `/activity/objectFlows/${index}`,
      );
  }
  for (const [index, entity] of (diagram.er?.entities ?? []).entries()) {
    if (!nodes.has(entity.nodeId))
      error(
        'ER_ENTITY_MISSING_NODE',
        `ER entity references missing node: ${entity.nodeId}`,
        entity.nodeId,
        `/er/entities/${index}/nodeId`,
      );
  }
  const chenGroups: Array<[string, string[]]> = [
    ['entity', diagram.chenEr?.entityIds ?? []],
    ['attribute', diagram.chenEr?.attributeIds ?? []],
    ['relationship', diagram.chenEr?.relationshipIds ?? []],
  ];
  for (const [kind, ids] of chenGroups) {
    for (const [index, nodeId] of ids.entries()) {
      if (!nodes.has(nodeId))
        error(
          `CHEN_ER_${kind.toUpperCase()}_MISSING_NODE`,
          `Chen ER ${kind} references missing node: ${nodeId}`,
          nodeId,
          `/chenEr/${kind}Ids/${index}`,
        );
    }
  }
  for (const [index, e] of diagram.edges.entries()) {
    if (!nodes.has(e.source) || !nodes.has(e.target))
      error('RELATIONSHIP_MISSING_NODE', `Relationship references missing node: ${e.id}`, e.id, `/edges/${index}`);
    // A node pointing at itself is legal structure (UML self transitions, retry loops,
    // follow-on relationships). ELK routes it and both renderers draw it, so judging it
    // away was the tool overstepping - measured before removing, see spec §10 item 3.
  }
  return uniqueIssues(issues);
}

/** Backward-compatible message API used by existing callers and reports. */
export function validateSemantics(diagram: Diagram): string[] {
  return validateSemanticIssues(diagram).map((issue) => issue.message);
}
