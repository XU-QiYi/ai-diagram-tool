import fs from 'node:fs/promises';
import path from 'node:path';
import type { Diagram, LayoutResult, ValidationIssue } from '../model/types.js';
import type { PreparedInput } from '../ai/types.js';
import { acceptAgentPlan, type AgentPlanSubmission } from '../ai/pipeline.js';
import type { PlannedDiagram } from '../ai/types.js';
import { layoutDiagram } from '../layout/elk.js';
import { renderDrawio } from '../render/drawio.js';
import { renderSvg } from '../render/svg.js';
import { rasterizeForReview } from '../render/png.js';
import {
  DEFAULT_VISUAL_MAX_ROUNDS,
  VISUAL_LAYOUT_FIELDS,
  VISUAL_REVIEW_SYSTEM_PROMPT,
  applyVisualCorrection,
  describeVisualGeometry,
  sanitizeVisualFindings,
  visualElementIds,
  visualFindingsToIssues,
} from '../validate/visual.js';
import type { RasterResult } from '../render/png.js';
import { AUDIT_SYSTEM_PROMPT, PLAN_SYSTEM_PROMPT, auditUserContent, planUserContent, reviseUserContent } from './prompts.js';

/**
 * The agent-facing half of the pipeline.
 *
 * The project performs no model request and holds no credential: a host agent (or any
 * other reasoner) asks for a task, answers it, and submits the answer here. Every gate
 * that used to guard the in-project HTTP call still applies to the submitted answer.
 */

export interface PlanTask {
  system: string;
  messages: Array<Record<string, unknown>>;
  /** Extra turn to request an independent audit of a submitted answer. */
  audit: { system: string; extraContent: Array<Record<string, unknown>> };
  rules: string[];
}

/** Assemble the semantic planning task for an external reasoner. */
export function buildPlanTask(input: PreparedInput, previous?: unknown, problems?: ValidationIssue[]): PlanTask {
  const content = planUserContent(input.sources);
  if (previous !== undefined) content.push(...reviseUserContent(previous, problems ?? []));
  return {
    system: PLAN_SYSTEM_PROMPT,
    messages: [{ role: 'system', content: PLAN_SYSTEM_PROMPT }, { role: 'user', content }],
    audit: { system: AUDIT_SYSTEM_PROMPT, extraContent: auditUserContent(previous ?? {}) },
    rules: [
      'Return one JSON object: { diagram, confidence, uncertainties }.',
      'Every node, edge and container carries provenance whose quote occurs verbatim in its source.',
      'No x, y, width, height, edge routes or Draw.io XML: geometry belongs to ELK.',
      'confidence and each provenance.confidence must be at least 0.7.',
    ],
  };
}

export type PlanAnswer = Omit<AgentPlanSubmission, 'input'>;

/** Validate an answered plan through the existing gates, then lay it out with ELK. */
export function submitPlanAnswer(input: PreparedInput, answer: PlanAnswer): Promise<PlannedDiagram> {
  return acceptAgentPlan({ input, ...answer });
}

export interface ReviewTask {
  pngPath: string;
  backend: RasterResult['backend'];
  width: number;
  height: number;
  round: number;
  diagramId: string;
  elementIds: string[];
  geometryFacts: string;
  allowedFields: readonly string[];
  system: string;
  /** One line per accepted finding shape, so the answer cannot drift. */
  answerContract: string;
}

export interface ReviewTaskOptions {
  dir: string;
  round?: number;
  scale?: number;
  timeoutMs?: number;
  /** Reuse an existing bitmap instead of rasterizing again. */
  pngPath?: string;
}

/** Render the laid-out diagram and package it for a reviewer that can look at images. */
export async function buildReviewTask(layout: LayoutResult, options: ReviewTaskOptions): Promise<ReviewTask> {
  const round = options.round ?? 1;
  const dir = path.resolve(options.dir);
  await fs.mkdir(dir, { recursive: true });
  let pngPath = options.pngPath ? path.resolve(options.pngPath) : '';
  let raster: RasterResult | undefined;
  if (!pngPath) {
    const svgPath = path.join(dir, `${layout.diagram.id}.r${round}.svg`);
    const drawioPath = path.join(dir, `${layout.diagram.id}.r${round}.drawio`);
    await Promise.all([
      fs.writeFile(svgPath, renderSvg(layout), 'utf8'),
      fs.writeFile(drawioPath, renderDrawio(layout), 'utf8'),
    ]);
    raster = await rasterizeForReview({ drawioPath, svgPath, outPath: path.join(dir, `${layout.diagram.id}.r${round}.png`), scale: options.scale ?? 2, timeoutMs: options.timeoutMs ?? 60_000 });
    pngPath = raster.pngPath;
  }
  return {
    pngPath,
    backend: raster?.backend ?? 'unknown' as RasterResult['backend'],
    width: raster?.width ?? 0,
    height: raster?.height ?? 0,
    round,
    diagramId: layout.diagram.id,
    elementIds: visualElementIds(layout.diagram),
    geometryFacts: describeVisualGeometry(layout),
    allowedFields: VISUAL_LAYOUT_FIELDS,
    system: VISUAL_REVIEW_SYSTEM_PROMPT,
    answerContract: '{"findings":[{"code":"VISUAL_CROWDED","elementId":"<one of elementIds>","severity":"ERROR|WARNING|INFO","observation":"...","hint":"increase nodeSpacing"}]} — coordinates are discarded.',
  };
}

export interface ReviewAnswerResult {
  diagram: Diagram;
  layout: LayoutResult;
  findings: ReturnType<typeof sanitizeVisualFindings>['findings'];
  issues: ValidationIssue[];
  /** True when the answer could not be fixed by layout preferences alone. */
  needsSemanticChange: boolean;
}

export interface ReviewAnswerOptions {
  /** Skip re-layout when the answer contained nothing actionable. */
  relayout?: (diagram: Diagram) => Promise<LayoutResult>;
}

/**
 * Apply a reviewer answer: sanitize the findings (coordinates and unknown ids are
 * dropped), move them into `LayoutPreferences`, and re-run ELK. The reviewer never
 * places anything; ELK stays the only authority over geometry.
 */
export async function submitReviewAnswer(diagram: Diagram, layout: LayoutResult, rawFindings: unknown, options: ReviewAnswerOptions = {}): Promise<ReviewAnswerResult> {
  const sanitized = sanitizeVisualFindings(rawFindings, visualElementIds(diagram));
  const changed = applyVisualCorrection(diagram, sanitized.findings, layout);
  const corrections = diagramPreferencesDiff(diagram.layout, changed.layout);
  const issues: ValidationIssue[] = [
    ...sanitized.issues,
    ...visualFindingsToIssues(sanitized.findings, 'visual'),
    ...corrections.map(item => ({
      severity: 'INFO' as const,
      code: 'VISUAL_CORRECTION_APPLIED:visual',
      message: `Applied ${item.field}: ${String(item.from)} -> ${String(item.to)}`,
      phase: 'render' as const,
    })),
  ];
  if (!corrections.length) {
    return { diagram, layout, findings: sanitized.findings, issues, needsSemanticChange: sanitized.findings.length > 0 };
  }
  const relayout = options.relayout ?? ((next: Diagram) => layoutDiagram(next));
  return { diagram: changed, layout: await relayout(changed), findings: sanitized.findings, issues, needsSemanticChange: false };
}

function diagramPreferencesDiff(before: Diagram['layout'], after: Diagram['layout']): Array<{ field: string; from: unknown; to: unknown }> {
  const changed: Array<{ field: string; from: unknown; to: unknown }> = [];
  for (const field of VISUAL_LAYOUT_FIELDS) {
    const from = before?.[field as keyof typeof before];
    const to = after?.[field as keyof typeof after];
    if (from !== to) changed.push({ field, from, to });
  }
  return changed;
}

export const VISUAL_ROUNDS_DEFAULT = DEFAULT_VISUAL_MAX_ROUNDS;
