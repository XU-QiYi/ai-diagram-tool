import { createDiagram } from '../model/index.js';
import { RELATIONSHIP_TYPES, type Diagram, type ValidationIssue } from '../model/types.js';
import { layoutDiagram } from '../layout/elk.js';
import { validateLayout, validateSemanticIssues, validateUmlIssues } from '../validate/index.js';
import type { PlannedDiagram, PreparedInput, QualityReport, SemanticPlan, SemanticPlanner } from './types.js';

const MIN_CONFIDENCE = 0.7;
const MAX_ATTEMPTS = 3;
type RecordValue = Record<string, unknown>;
const isRecord = (value: unknown): value is RecordValue => value !== null && typeof value === 'object' && !Array.isArray(value);
const issue = (code: string, message: string, elementId?: string): ValidationIssue => ({ severity: 'ERROR', code, message, elementId, phase: 'semantic' });

export class SemanticPlanningError extends Error {
  readonly code = 'AI_SEMANTIC_REJECTED';
  constructor(readonly issues: ValidationIssue[]) {
    super(`AI plan rejected: ${issues.map(item => `${item.code}: ${item.message}`).join('; ')}`);
  }
}

function checkEvidence(element: RecordValue, input: PreparedInput, issues: ValidationIssue[], counts: { verified: number; modelReported: number }): void {
  const id = typeof element.id === 'string' ? element.id : undefined;
  const evidence = element.provenance;
  if (!isRecord(evidence) || typeof evidence.quote !== 'string' || !evidence.quote.trim()) {
    issues.push(issue('MISSING_EVIDENCE', `Missing source evidence for ${id ?? 'element'}`, id));
    return;
  }
  const source = input.sources.find(item => item.kind === evidence.source);
  if (!source) { issues.push(issue('INVALID_EVIDENCE_SOURCE', `Unknown evidence source for ${id}`, id)); return; }
  if (typeof evidence.confidence !== 'number' || !Number.isFinite(evidence.confidence) || evidence.confidence < MIN_CONFIDENCE || evidence.confidence > 1) {
    issues.push(issue('LOW_ELEMENT_CONFIDENCE', `Low or invalid confidence for ${id}`, id));
  }
  if (source.text !== undefined) {
    if (!source.text.includes(evidence.quote)) issues.push(issue('UNSUPPORTED_EVIDENCE', `Evidence quote is absent from ${source.kind} for ${id}`, id));
    else counts.verified++;
  } else counts.modelReported++;
}

function checkStableIds(previous: unknown, diagram: Diagram, issues: ValidationIssue[]): void {
  if (!isRecord(previous) || !isRecord(previous.diagram)) return;
  const old = previous.diagram;
  if (!Array.isArray(old.nodes) || !Array.isArray(old.edges)) return;
  for (const node of diagram.nodes) {
    const match = old.nodes.find(value => isRecord(value) && value.label === node.label && value.kind === node.kind);
    if (isRecord(match) && match.id !== node.id) issues.push(issue('UNSTABLE_ID', `Stable ID changed for ${node.label}`, node.id));
  }
  for (const edge of diagram.edges) {
    const match = old.edges.find(value => isRecord(value) && value.source === edge.source && value.target === edge.target && value.type === edge.type && value.label === edge.label);
    if (isRecord(match) && match.id !== edge.id) issues.push(issue('UNSTABLE_ID', `Stable ID changed for edge ${edge.source} -> ${edge.target}`, edge.id));
  }
}

function inspect(raw: unknown, input: PreparedInput, previous?: unknown): { plan?: SemanticPlan; issues: ValidationIssue[]; evidence: { verified: number; modelReported: number } } {
  const issues: ValidationIssue[] = [];
  const evidence = { verified: 0, modelReported: 0 };
  if (!isRecord(raw) || !isRecord(raw.diagram)) return { issues: [issue('INVALID_AI_RESPONSE', 'Expected an object containing diagram')], evidence };
  if (typeof raw.confidence !== 'number' || !Number.isFinite(raw.confidence) || raw.confidence < MIN_CONFIDENCE || raw.confidence > 1) {
    issues.push(issue('LOW_CONFIDENCE', 'Overall semantic confidence is below 0.7 or invalid'));
  }
  if (!Array.isArray(raw.uncertainties) || raw.uncertainties.some(value => !isRecord(value) || typeof value.description !== 'string' || typeof value.blocking !== 'boolean')) {
    issues.push(issue('INVALID_UNCERTAINTIES', 'uncertainties must be an array of {description, blocking}'));
  } else if (raw.uncertainties.some(value => (value as { blocking: boolean }).blocking)) {
    issues.push(issue('BLOCKING_UNCERTAINTY', 'The model reported an unresolved required element'));
  }
  const body = raw.diagram;
  if (typeof body.title !== 'string' || !body.title.trim()) issues.push(issue('INVALID_DIAGRAM_SCHEMA', 'Diagram title is required'));
  if (typeof body.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,100}$/.test(body.id) || body.id.includes('..')) {
    issues.push(issue('INVALID_DIAGRAM_ID', 'Diagram ID must be a safe filename segment'));
  }
  if (!Array.isArray(body.nodes) || !Array.isArray(body.edges) || (body.containers !== undefined && !Array.isArray(body.containers))) {
    issues.push(issue('INVALID_DIAGRAM_SCHEMA', 'Diagram nodes, edges, and containers must be arrays'));
    return { issues, evidence };
  }
  if (body.nodes.length < 2 || body.edges.length < 1) issues.push(issue('INSUFFICIENT_STRUCTURE', 'At least two nodes and one relationship are required'));
  for (const [kind, values] of [['node', body.nodes], ['edge', body.edges], ['container', body.containers ?? []]] as const) {
    for (const value of values) {
      if (!isRecord(value) || typeof value.id !== 'string' || !value.id.trim()) {
        issues.push(issue('INVALID_DIAGRAM_SCHEMA', `Invalid ${kind} object or ID`));
        continue;
      }
      if (['x', 'y', 'width', 'height', 'sections', 'bendPoints', 'mxGeometry', 'mxCell'].some(key => key in value)) {
        issues.push(issue('MODEL_GEOMETRY_FORBIDDEN', `AI supplied geometry for ${value.id}`, value.id));
      }
      if (kind === 'node' && (typeof value.label !== 'string' || !value.label.trim())) issues.push(issue('INVALID_DIAGRAM_SCHEMA', `Missing label for ${value.id}`, value.id));
      if (kind === 'container' && (typeof value.label !== 'string' || !Array.isArray(value.nodeIds))) issues.push(issue('INVALID_DIAGRAM_SCHEMA', `Invalid container ${value.id}`, value.id));
      if (kind === 'edge' && (typeof value.source !== 'string' || typeof value.target !== 'string')) issues.push(issue('INVALID_DIAGRAM_SCHEMA', `Invalid endpoints for ${value.id}`, value.id));
      if (kind === 'edge' && value.type !== undefined && !RELATIONSHIP_TYPES.includes(value.type as typeof RELATIONSHIP_TYPES[number])) issues.push(issue('INVALID_RELATIONSHIP_TYPE', `Unsupported relationship type for ${value.id}`, value.id));
      checkEvidence(value, input, issues, evidence);
    }
  }
  if (['x', 'y', 'mxGraphModel', 'mxCell'].some(key => key in body)) issues.push(issue('MODEL_GEOMETRY_FORBIDDEN', 'AI supplied renderer or layout data'));
  let diagram: Diagram;
  try { diagram = createDiagram(body as unknown as Diagram); }
  catch (error) {
    issues.push(issue('INVALID_DIAGRAM_STRUCTURE', error instanceof Error ? error.message : String(error)));
    return { issues, evidence };
  }
  checkStableIds(previous, diagram, issues);
  issues.push(...validateSemanticIssues(diagram), ...validateUmlIssues(diagram));
  return { plan: { diagram, confidence: raw.confidence as number, uncertainties: raw.uncertainties as SemanticPlan['uncertainties'] }, issues, evidence };
}

function inspectAudit(raw: unknown, input: PreparedInput, plan: SemanticPlan): { confidence: number; issues: ValidationIssue[] } {
  const issues: ValidationIssue[] = [];
  if (!isRecord(raw) || typeof raw.confidence !== 'number' || !Number.isFinite(raw.confidence) || raw.confidence < MIN_CONFIDENCE || raw.confidence > 1 || !Array.isArray(raw.missing) || !Array.isArray(raw.unsupportedElementIds)) {
    return { confidence: 0, issues: [issue('INVALID_SEMANTIC_AUDIT', 'Semantic review response is missing required fields or has low confidence')] };
  }
  const ids = new Set([...plan.diagram.nodes, ...plan.diagram.edges, ...(plan.diagram.containers ?? [])].map(element => element.id));
  for (const item of raw.missing) {
    if (!isRecord(item) || typeof item.quote !== 'string' || !item.quote.trim() || typeof item.reason !== 'string') {
      issues.push(issue('INVALID_SEMANTIC_AUDIT', 'Semantic review contains an invalid omission'));
      continue;
    }
    const source = input.sources.find(value => value.kind === item.source);
    if (!source || (source.text !== undefined && !source.text.includes(item.quote))) {
      issues.push(issue('INVALID_SEMANTIC_AUDIT', 'Semantic review omission has no source evidence'));
      continue;
    }
    issues.push(issue('MISSING_REQUIREMENT', `Missing source requirement: ${item.reason}`));
  }
  for (const id of raw.unsupportedElementIds) {
    if (typeof id !== 'string' || !ids.has(id)) issues.push(issue('INVALID_SEMANTIC_AUDIT', 'Semantic review named an unknown element'));
    else issues.push(issue('UNSUPPORTED_ELEMENT', `Semantic review found an unsupported element: ${id}`, id));
  }
  return { confidence: raw.confidence, issues };
}

/**
 * Gates a submission must pass before geometry is computed: schema, evidence,
 * stable ids, semantic and UML rules, and the no-coordinates rule.
 * Exported so an answer produced outside this project (by a host agent or a model
 * it calls) is held to exactly the same standard as an in-project one.
 */
export const inspectPlan = inspect;
export const inspectAuditAnswer = inspectAudit;

/** Lay out and report a plan that already passed every gate. */
async function finish(plan: SemanticPlan, input: PreparedInput, issues: ValidationIssue[], auditConfidence: number, attempts: number): Promise<PlannedDiagram> {
  const layout = await layoutDiagram(plan.diagram);
  const layoutIssues = layout.issues ?? validateLayout(layout).issues;
  const merged = [...issues, ...layoutIssues.filter(item => !issues.some(existing => existing.code === item.code && existing.elementId === item.elementId))];
  const hasErrors = merged.some(item => item.severity === 'ERROR');
  const status: QualityReport['status'] = hasErrors ? 'failed' : merged.some(item => item.severity === 'WARNING') ? 'passed_with_warnings' : 'passed';
  const quality: QualityReport = {
    valid: !hasErrors,
    status,
    sources: input.sources.map(source => source.kind),
    confidence: plan.confidence,
    auditConfidence,
    attempts,
    evidence: { verified: 0, modelReported: 0 },
    issues: merged,
    layoutIterations: layout.iterations,
  };
  return { plan, layout, quality };
}

export interface AgentPlanSubmission {
  /** The prepared sources the answer claims to be based on (evidence is re-verified). */
  input: PreparedInput;
  /** The reasoner's answer: `{ diagram, confidence, uncertainties }`. */
  submission: unknown;
  /**
   * The reasoner's independent audit of its own answer. Omit it only deliberately:
   * a skipped audit is recorded as a WARNING and never as a pass.
   */
  audit?: unknown;
}

/**
 * Accept a semantic plan produced outside the project (host agent / its model) and run
 * it through the same gates, then ELK. Problems are returned as issues instead of a
 * revise loop: the caller is the reasoner and fixes its own answer.
 */
export async function acceptAgentPlan({ input, submission, audit }: AgentPlanSubmission): Promise<PlannedDiagram> {
  const inspected = inspect(submission, input);
  if (inspected.issues.some(item => item.severity === 'ERROR') || !inspected.plan) {
    throw new SemanticPlanningError(failedStates(inspected.issues));
  }
  const plan = inspected.plan;
  const carried = inspected.issues.filter(item => item.severity !== 'ERROR');
  let auditConfidence = 0;
  const issues = [...carried];
  if (audit === undefined) {
    // A missing audit is reported as a warning, never silently treated as a clean review.
    issues.push({ severity: 'WARNING', code: 'SEMANTIC_AUDIT_SKIPPED', message: 'No independent semantic audit was submitted; the plan is not independently reviewed', phase: 'semantic' });
  } else {
    const audited = inspectAudit(audit, input, plan);
    if (audited.issues.some(item => item.severity === 'ERROR')) throw new SemanticPlanningError(audited.issues);
    auditConfidence = audited.confidence;
    issues.push(...audited.issues);
  }
  const result = await finish(plan, input, issues, auditConfidence, 1);
  result.quality.evidence = inspected.evidence;
  return result;
}

function failedStates(issues: ValidationIssue[]): ValidationIssue[] {
  return issues.length ? issues : [issue('INVALID_AI_RESPONSE', 'Submission produced no usable diagram')];
}

export async function planDiagram(input: PreparedInput, planner: SemanticPlanner): Promise<PlannedDiagram> {
  let raw = await planner.plan(input);
  let previous: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const inspected = inspect(raw, input, previous);
    const semanticErrors = inspected.issues.filter(item => item.severity === 'ERROR');
    if (semanticErrors.length) {
      if (attempt === MAX_ATTEMPTS) throw new SemanticPlanningError(semanticErrors);
      previous = raw;
      raw = await planner.revise(input, raw, { issues: inspected.issues, attempt });
      continue;
    }
    const plan = inspected.plan!;
    const audit = inspectAudit(await planner.audit(input, plan), input, plan);
    if (audit.issues.length) {
      if (attempt === MAX_ATTEMPTS) throw new SemanticPlanningError(audit.issues);
      previous = raw;
      raw = await planner.revise(input, raw, { issues: audit.issues, attempt });
      continue;
    }
    const layout = await layoutDiagram(plan.diagram);
    const layoutIssues = layout.issues ?? validateLayout(layout).issues;
    const issues = [...inspected.issues, ...layoutIssues.filter(item => !inspected.issues.some(existing => existing.code === item.code && existing.elementId === item.elementId))];
    const hasErrors = issues.some(item => item.severity === 'ERROR');
    if (hasErrors && attempt < MAX_ATTEMPTS) {
      previous = raw;
      raw = await planner.revise(input, raw, { issues, attempt });
      continue;
    }
    const status: QualityReport['status'] = hasErrors ? 'failed' : issues.some(item => item.severity === 'WARNING') ? 'passed_with_warnings' : 'passed';
    return { plan, layout, quality: { valid: !hasErrors, status, sources: input.sources.map(source => source.kind), confidence: plan.confidence, auditConfidence: audit.confidence, attempts: attempt, evidence: inspected.evidence, issues, layoutIterations: layout.iterations } };
  }
  throw new Error('AI planning attempt limit reached');
}
