import type { Diagram, LayoutResult, ValidationIssue } from '../model/types.js';

export type SourceKind = 'request' | 'document' | 'image' | 'template';
export interface InputSource { kind: SourceKind; name: string; text?: string; dataUrl?: string; }
export interface PreparedInput { sources: InputSource[]; }
export interface InputOptions { text?: string; document?: string; image?: string; template?: string; }
export interface SemanticUncertainty { description: string; blocking: boolean; }
export interface SemanticPlan { diagram: Diagram; confidence: number; uncertainties: SemanticUncertainty[]; }
export interface SemanticAudit { confidence: number; missing: Array<{ source: SourceKind; quote: string; reason: string }>; unsupportedElementIds: string[]; }
export interface QualityFeedback { issues: ValidationIssue[]; attempt: number; }
export interface SemanticPlanner {
  plan(input: PreparedInput): Promise<unknown>;
  revise(input: PreparedInput, previous: unknown, feedback: QualityFeedback): Promise<unknown>;
  audit(input: PreparedInput, plan: SemanticPlan): Promise<unknown>;
}
export interface QualityReport {
  valid: boolean;
  status: 'passed' | 'passed_with_warnings' | 'failed';
  sources: SourceKind[];
  confidence: number;
  auditConfidence: number;
  attempts: number;
  evidence: { verified: number; modelReported: number };
  issues: ValidationIssue[];
  layoutIterations: number;
}
export interface PlannedDiagram { plan: SemanticPlan; layout: LayoutResult; quality: QualityReport; }

// ---- Visual review gate contracts (spec B). Appended only; nothing above this line was modified. ----
import type { LayoutPreferences, ValidationSeverity } from '../model/types.js';
import type { RasterBackend } from '../render/png.js';

/** LayoutPreferences fields the visual gate may adjust (2026-09-25 design-correction whitelist, restricted to fields that exist in src/model/types.ts). */
export type VisualLayoutField = 'density' | 'nodeSpacing' | 'layerSpacing' | 'containerPadding' | 'targetAspectRatio' | 'wrapping' | 'edgeLabelFontSize' | 'edgeLength';
export type VisualLayoutPreferenceDelta = Partial<Pick<LayoutPreferences, VisualLayoutField>>;
/** Shape the reviewer is asked to return: an observation plus a preference action — never coordinates. */
export interface VisualHint { target: string; observation: string; hint?: string; preference?: VisualLayoutPreferenceDelta; }
export interface VisualFinding { elementId: string; severity: ValidationSeverity; code: string; observation: string; hint: string; preference?: VisualLayoutPreferenceDelta; }
export interface VisualReviewRequest { round: number; diagramId: string; backend: RasterBackend; dataUrl: string; geometryFacts: string; elementIds: string[]; }
export interface VisualReviewer { review(request: VisualReviewRequest): Promise<unknown>; }
export type VisualGateStatus = 'passed' | 'passed_with_warnings' | 'visual_failed_after_max_rounds';
export interface VisualLayoutAdjustment { field: VisualLayoutField; from: number | string | undefined; to: number | string; reason: string; elementId: string; }
export interface VisualRoundRecord { round: number; backend: RasterBackend; pngPath: string; findings: VisualFinding[]; errorCount: number; adjustments: VisualLayoutAdjustment[]; uncorrectable: number; }
export interface VisualQualitySection { status: VisualGateStatus; maxRounds: number; reviewRounds: number; correctionRounds: number; backends: RasterBackend[]; unresolvedFindings: VisualFinding[]; disclaimer: string; }
