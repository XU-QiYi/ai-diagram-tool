import type { ValidationIssue, ValidationProfile } from '../model/types.js';

export const DEFAULT_VALIDATION_PROFILE: ValidationProfile = 'ai-led';

/**
 * Layout readouts that describe how busy or how tidy a figure looks, or that note a
 * relationship the author may have meant. None of them make the drawing lie, so under
 * `ai-led` they are reported as INFO and never block or trigger a re-layout.
 * Deliberately absent: NODE_OVERLAP, EDGE_THROUGH_NODE, EDGE_CROSSING, TEXT_OVERFLOW,
 * CANVAS_OVERFLOW, NODE_OUTSIDE_CONTAINER, PORT_OUTSIDE_NODE and every reference check —
 * those are the tool's actual promise, and EDGE_LABEL_OVERLAP is listed here only
 * because overlapping *text* is a taste call, not a broken figure.
 */
export const AESTHETIC_LAYOUT_CODES: ReadonlySet<string> = new Set([
  'EXCESSIVE_DENSITY',
  'EXCESSIVE_WHITESPACE',
  'EXTREMELY_LONG_EDGE',
  'LARGE_DIAGRAM',
  'ORPHAN_NODE',
  'DUPLICATE_EDGE_RELATIONSHIP',
  'EDGE_LABEL_OVERLAP',
  'BROKEN_SAME_LAYER_CONSTRAINT',
]);

/**
 * Plan-gate findings that judge the author's semantics rather than the drawing's
 * integrity. The schema and stable-ID gates are NOT here: a malformed object cannot be
 * laid out at all, and ID drift is mechanical, not a matter of taste.
 * SEMANTIC_AUDIT_SKIPPED is also not here on purpose — it states a fact about review
 * coverage rather than judging the figure, so it stays a WARNING in both profiles.
 */
export const AUTHOR_JUDGEMENT_CODES: ReadonlySet<string> = new Set([
  'MISSING_EVIDENCE',
  'UNSUPPORTED_EVIDENCE',
  'INVALID_EVIDENCE_SOURCE',
  'LOW_ELEMENT_CONFIDENCE',
  'LOW_CONFIDENCE',
  'BLOCKING_UNCERTAINTY',
]);

export function resolveProfile(profile?: ValidationProfile): ValidationProfile {
  return profile === 'strict' ? 'strict' : DEFAULT_VALIDATION_PROFILE;
}

/**
 * Under `ai-led`, notation and aesthetic findings are reported but not judged:
 * the diagram's structure and its notation belong to the author (a person or a model),
 * and the tool stays responsible only for drawing it truthfully.
 */
export function applyProfile(issues: ValidationIssue[], profile?: ValidationProfile): ValidationIssue[] {
  if (resolveProfile(profile) === 'strict') return issues;
  return issues.map((issue) => {
    const judged =
      (issue.phase === 'semantic' && issue.severity === 'WARNING') ||
      AESTHETIC_LAYOUT_CODES.has(issue.code) ||
      AUTHOR_JUDGEMENT_CODES.has(issue.code);
    return judged && issue.severity !== 'INFO' ? { ...issue, severity: 'INFO' as const } : issue;
  });
}
