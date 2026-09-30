import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type {
  VisualFinding,
  VisualGateStatus,
  VisualLayoutAdjustment,
  VisualLayoutField,
  VisualLayoutPreferenceDelta,
  VisualQualitySection,
  VisualReviewer,
  VisualReviewRequest,
  VisualRoundRecord,
} from '../ai/types.js';
import { effectiveContainers, layoutDiagram } from '../layout/elk.js';
import type {
  Diagram,
  LayoutDensity,
  LayoutPreferences,
  LayoutResult,
  ValidationIssue,
  ValidationSeverity,
} from '../model/types.js';
import { renderDrawio } from '../render/drawio.js';
import type { RasterBackend, RasterResult } from '../render/png.js';
import { pngDimensions, rasterizeForReview } from '../render/png.js';
import { renderSvg } from '../render/svg.js';

// Spec B: post-render visual review gate. The vision model is ONLY a reviewer: it may name
// problems and suggest LayoutPreferences actions; any model-supplied coordinate is discarded
// and never applied (AGENTS.md §2/§3/§29). All fixes flow into diagram.layout and a fresh
// layoutDiagram() (ELK) run — layoutDiagram's own iteration/profile machinery is reused as-is.

export const DEFAULT_VISUAL_MAX_ROUNDS = 2;
export const VISUAL_DISCLAIMER =
  'The visual gate reports only what the reviewer model saw on rendered bitmaps; zero findings means nothing was detected, not that nothing is wrong (same completeness semantics as the AI semantic audit).';

export type NumericLayoutField =
  | 'nodeSpacing'
  | 'layerSpacing'
  | 'containerPadding'
  | 'targetAspectRatio'
  | 'edgeLabelFontSize'
  | 'edgeLength';

/** Adjustment whitelist — mirrors the fields that actually exist on LayoutPreferences
 *  (src/model/types.ts). edgeSpacing/edgeLabelGap/portSpread/portDistribute/portDistancer/portCoord
 *  do NOT exist in the DSL and are rejected as unknown keys by sanitize. */
export const VISUAL_LAYOUT_FIELDS = [
  'density',
  'nodeSpacing',
  'layerSpacing',
  'containerPadding',
  'targetAspectRatio',
  'wrapping',
  'edgeLabelFontSize',
  'edgeLength',
] as const satisfies readonly VisualLayoutField[];
const NUMERIC_VISUAL_FIELDS = [
  'nodeSpacing',
  'layerSpacing',
  'containerPadding',
  'targetAspectRatio',
  'edgeLabelFontSize',
  'edgeLength',
] as const satisfies readonly NumericLayoutField[];
const DENSITY_VALUES: readonly LayoutDensity[] = ['compact', 'balanced', 'spacious'];
const WRAPPING_VALUES: ReadonlySet<string> = new Set(['AUTO', 'OFF', 'SINGLE_EDGE', 'MULTI_EDGE']);
const SEVERITIES: readonly ValidationSeverity[] = ['ERROR', 'WARNING', 'INFO'];

interface NumericBound {
  min: number;
  max: number;
  minStep: number;
  stepPct: number;
}
// Bounded adjustment (spec §3.3): per round |to - from| <= max(minStep, from * 0.2); hard absolute
// bounds also cap the cumulative drift of multiple rounds (总量上限).
const NUMERIC_BOUNDS: Record<NumericLayoutField, NumericBound> = {
  nodeSpacing: { min: 8, max: 240, minStep: 8, stepPct: 0.12 },
  layerSpacing: { min: 8, max: 320, minStep: 10, stepPct: 0.12 },
  containerPadding: { min: 0, max: 120, minStep: 6, stepPct: 0.15 },
  targetAspectRatio: { min: 0.4, max: 2.6, minStep: 0.05, stepPct: 0.08 },
  edgeLabelFontSize: { min: 6, max: 16, minStep: 1, stepPct: 0 },
  edgeLength: { min: 20, max: 900, minStep: 12, stepPct: 0.12 },
};

// Mirror of elk.ts layoutProfile()/densitySpacing/defaultAspectRatio (elk.ts is off-limits to me;
// keep in sync if those defaults ever change).
const DENSITY_SPACING: Record<string, { node: number; layer: number; padding: number }> = {
  compact: { node: 45, layer: 60, padding: 22 },
  balanced: { node: 60, layer: 78, padding: 28 },
  spacious: { node: 85, layer: 110, padding: 36 },
};

const round2 = (value: number): number => Math.round(value * 100) / 100;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const clip = (value: string): string => (value.length > 400 ? `${value.slice(0, 400)}…` : value);

/** Visual issues keep the existing ValidationPhase union: phase 'render', code suffix ':visual' (spec §3.4). */
function visualIssue(severity: ValidationSeverity, code: string, message: string, elementId?: string): ValidationIssue {
  return { severity, code: `${code}:visual`, message, elementId, phase: 'render' };
}

function modelCodeText(text: string): string {
  const ascii = text
    .replace(/[^\x20-\x7e]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim();
  const words = ascii
    .split(' ')
    .filter((word) => word.length > 2)
    .slice(0, 4)
    .map((word) => word.toUpperCase());
  return words.length ? `VISUAL_${words.join('_')}` : 'VISUAL_OBSERVATION';
}

/** Field names that betray an attempt to smuggle geometry through the review channel. */
const COORDINATE_FIELD_PATTERN =
  /^(x|y|x1|y1|x2|y2|dx|dy|cx|cy|left|right|top|bottom|width|height|radius|diameter|size|position|pos|point|points|coordinate|coordinates|geometry|bbox|bounds|offset|offsets|route|routing|routepoints|segment|segments|bendpoints?|anchor|anchors|mxgeometry|mxcell)$/i;

export interface VisualHintRule {
  code: string;
  patterns: RegExp[];
  effects: Array<{ field: NumericLayoutField; direction: 'up' | 'down' | 'toward-one' }>;
  note: string;
}

/** Explicit hint -> LayoutPreferences mapping table. Order matters: first match wins
 *  (specific problems before the generic crowding catch-all). Monotonicity is documented per rule. */
export const VISUAL_HINT_RULES: VisualHintRule[] = [
  {
    code: 'VISUAL_LABEL_TRUNCATED',
    patterns: [/truncat|cut[- ]?off|clipped|ellipsis/i, /截断/, /看不全/],
    effects: [],
    note: 'root cause is label text or shape semantics; no spacing field can fix it -> semantic change, not auto-corrected',
  },
  {
    code: 'VISUAL_EDGE_LABEL_PRESSURE',
    patterns: [
      /edge ?label|label .{0,25}(?:edge|line|arrow)|(?:edge|line|arrow).{0,25}label|压线|标签.{0,8}(?:压|叠|挡).{0,8}(?:线|边)/i,
    ],
    effects: [{ field: 'edgeLabelFontSize', direction: 'down' }],
    note: 'monotonic: labels pressed against edge lines -> edgeLabelFontSize only decreases (floor 6)',
  },
  {
    code: 'VISUAL_LABEL_ON_NODE',
    patterns: [
      /label.{0,30}(?:node|box|shape|rect)|(?:node|box|shape|rect).{0,30}label|leg?end.{0,25}(?:cover|over|obscur)|(?:cover|obscur).{0,25}(?:node|label|text)/i,
      /标签.{0,8}盖.{0,8}(?:节点|框)/,
      /图例.{0,10}遮/,
      /遮挡/,
    ],
    effects: [
      { field: 'nodeSpacing', direction: 'up' },
      { field: 'containerPadding', direction: 'up' },
    ],
    note: 'monotonic: labels/legend overlap nodes -> spacing and padding only increase',
  },
  {
    code: 'VISUAL_LABEL_ILLEGIBLE',
    patterns: [/illegible|unreadable|too small to read|font too small|不可读|看不清|字太小/],
    effects: [{ field: 'edgeLabelFontSize', direction: 'up' }],
    note: 'monotonic: tiny edge label -> edgeLabelFontSize only increases (cap 16); node fonts are fixed at 12, illegible *node* text matches no numeric rule and becomes a semantic finding',
  },
  {
    code: 'VISUAL_CONTAINER_TIGHT',
    patterns: [/container|boundary|swimlane|group box|padding/i, /容器|泳道|贴边|边框.{0,6}挤/],
    effects: [{ field: 'containerPadding', direction: 'up' }],
    note: 'monotonic: elements hug their container wall -> containerPadding only increases (cap 120)',
  },
  {
    code: 'VISUAL_ASPECT_SKEW',
    patterns: [/too (?:tall|narrow|wide|flat)|aspect ratio|unbalanced whitespace|太高|太窄|太扁|太长|太宽|整体比例/],
    effects: [{ field: 'targetAspectRatio', direction: 'toward-one' }],
    note: 'monotonic: skewed canvas -> targetAspectRatio steps toward 1.0, bounded per round',
  },
  {
    code: 'VISUAL_EDGE_ROUTE_LONG',
    patterns: [/detour|long back[- ]edge|very long edge|wraps? around|绕远|长边过/],
    effects: [{ field: 'edgeLength', direction: 'up' }],
    note: 'edgeLength only increases per round, but the effect is NOT monotonic: measured on a Chen ER stress layout, spacing x1 errored, x1.5 was clean, x2.5 errored again, x4 was clean. Under `radial` these options do not reach the engine at all, so repeated bumps change nothing.',
  },
  {
    code: 'VISUAL_SPACING_LOOSE',
    patterns: [/too (?:far apart|spread|loose|distant)|excessive whitespace|dead space|大片空白|太散|太空|太松/],
    effects: [
      { field: 'nodeSpacing', direction: 'down' },
      { field: 'layerSpacing', direction: 'down' },
    ],
    note: 'monotonic opposite of VISUAL_CROWDED: over-spread layout -> spacing decreases (cap -15%/round); if a round has both signals the field is skipped (anti-oscillation)',
  },
  {
    code: 'VISUAL_CROWDED',
    patterns: [
      /crowd|cramped|too tight|too close|overlaps?|collid|no room|insufficient (?:gap|space)/i,
      /太挤|过密|密集|重叠|挤在/,
    ],
    effects: [
      { field: 'nodeSpacing', direction: 'up' },
      { field: 'layerSpacing', direction: 'up' },
    ],
    note: 'monotonic: crowded render -> node/layer spacing only increases (step = max(8 or 10, 12%), cap +20%/round)',
  },
];

const RULE_BY_CODE = new Map(VISUAL_HINT_RULES.map((rule) => [rule.code, rule]));

export function classifyVisualText(text: string): VisualHintRule | null {
  return VISUAL_HINT_RULES.find((rule) => rule.patterns.some((pattern) => pattern.test(text))) ?? null;
}

/** Text matching wins over the model's own code label (the label is untrusted); the container
 *  rule additionally requires a real container to exist in the layout. */
function matchRuleForFinding(finding: VisualFinding, layout: LayoutResult): VisualHintRule | null {
  const text = `${finding.observation} ${finding.hint}`;
  const rule = classifyVisualText(text) ?? RULE_BY_CODE.get(finding.code) ?? null;
  if (rule && rule.code === 'VISUAL_CONTAINER_TIGHT' && layout.containers.length === 0) return null;
  return rule;
}

// ---------------------------------------------------------------- review payload

export function visualElementIds(diagram: Diagram): string[] {
  const ids = new Set<string>(['general']);
  for (const node of diagram.nodes) ids.add(node.id);
  for (const edge of diagram.edges) ids.add(edge.id);
  for (const container of effectiveContainers(diagram)) ids.add(container.id);
  return [...ids];
}

/** Textual ground truth from the ELK LayoutResult so the reviewer argues from rendered geometry
 *  and can only reference real ids — never guesses, never new coordinates. */
export function describeVisualGeometry(layout: LayoutResult): string {
  const { diagram } = layout;
  const owner = new Map<string, string>();
  for (const node of diagram.nodes) if (node.containerId) owner.set(node.id, node.containerId);
  for (const container of effectiveContainers(diagram)) {
    for (const id of container.nodeIds) if (!owner.has(id)) owner.set(id, container.id);
    if (container.parentId) owner.set(container.id, container.parentId);
  }
  const r = (value: number): number => Math.round(value);
  const preferences = {
    density: diagram.layout?.density ?? 'balanced',
    nodeSpacing: effectiveNumber(diagram, 'nodeSpacing'),
    layerSpacing: effectiveNumber(diagram, 'layerSpacing'),
    containerPadding: effectiveNumber(diagram, 'containerPadding'),
    targetAspectRatio: effectiveNumber(diagram, 'targetAspectRatio'),
    wrapping: diagram.layout?.wrapping ?? 'AUTO',
    edgeLabelFontSize: effectiveNumber(diagram, 'edgeLabelFontSize'),
    edgeLength: effectiveNumber(diagram, 'edgeLength'),
  };
  return [
    `CANVAS ${r(layout.width)} x ${r(layout.height)}`,
    'UNITS: 1 unit = 1 SVG model coordinate unit. Regular node label font is 12 units; container labels 14; edge labels as configured below. Gaps under 8 units count as too tight. Never think or answer in pt/cm/inches.',
    'FONTS: node label 12 units, container label 14 units, edge label ' +
      preferences.edgeLabelFontSize +
      ' units; SVG uses plain <text> elements with system-default font-family (Chinese falls back to Microsoft YaHei on Windows); the draw.io backend embeds its own fonts, so text problems you see on the bitmap are genuine render observations.',
    `LAYOUT_PREFERENCES ${JSON.stringify(preferences)}`,
    'NODES ' +
      JSON.stringify(
        layout.nodes.map((node) => ({
          id: node.id,
          label: node.label,
          kind: node.kind ?? null,
          container: owner.get(node.id) ?? null,
          fontSize: node.style?.fontSize ?? 12,
          bbox: [r(node.x), r(node.y), r(node.width), r(node.height)],
        })),
      ),
    'CONTAINERS ' +
      JSON.stringify(
        layout.containers.map((container) => ({
          id: container.id,
          label: container.label,
          depth: container.depth,
          bbox: [r(container.x), r(container.y), r(container.width), r(container.height)],
        })),
      ),
    'EDGES ' +
      JSON.stringify(
        layout.edges.map((edge) => ({
          id: edge.id,
          source: edge.source,
          target: edge.target,
          label: edge.label ?? null,
          labelBox: (edge.labels ?? []).map((label) => [r(label.x), r(label.y), r(label.width), r(label.height)]),
          routePoints: (edge.sections ?? []).reduce((sum, section) => sum + 2 + (section.bendPoints?.length ?? 0), 0),
        })),
      ),
  ].join('\n');
}

// ---------------------------------------------------------------- defensive sanitize

export interface VisualSanitizeResult {
  findings: VisualFinding[];
  issues: ValidationIssue[];
}

function parseModelPreference(
  rawPreference: unknown,
  elementId: string,
  issues: ValidationIssue[],
): VisualLayoutPreferenceDelta | undefined {
  if (rawPreference === undefined || rawPreference === null) return undefined;
  if (!isRecord(rawPreference)) {
    issues.push(
      visualIssue(
        'INFO',
        'VISUAL_PREFERENCE_REJECTED',
        `preference for ${elementId} is not an object; ignored and not applied`,
        elementId,
      ),
    );
    return undefined;
  }
  const delta: VisualLayoutPreferenceDelta = {};
  let used = false;
  for (const [key, value] of Object.entries(rawPreference)) {
    if (COORDINATE_FIELD_PATTERN.test(key)) {
      issues.push(
        visualIssue(
          'WARNING',
          'VISUAL_COORDINATE_REJECTED',
          `preference field "${key}" on ${elementId} is a coordinate/geometry field; discarded — the visual gate never applies model-supplied geometry`,
          elementId,
        ),
      );
      continue;
    }
    if (key === 'density' || key === 'wrapping') {
      const allowed: readonly string[] = key === 'density' ? DENSITY_VALUES : [...WRAPPING_VALUES];
      if (typeof value === 'string' && allowed.includes(value)) {
        (delta as Record<string, string>)[key] = value;
        used = true;
      } else
        issues.push(
          visualIssue(
            'INFO',
            'VISUAL_PREFERENCE_REJECTED',
            `preference.${key}="${String(value)}" on ${elementId} is not a valid enum value; ignored`,
            elementId,
          ),
        );
      continue;
    }
    if ((NUMERIC_VISUAL_FIELDS as readonly string[]).includes(key)) {
      const field = key as NumericLayoutField;
      if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
        (delta as Record<string, number>)[field] = value;
        used = true;
      } else
        issues.push(
          visualIssue(
            'INFO',
            'VISUAL_PREFERENCE_REJECTED',
            `preference.${field} on ${elementId} is not a positive finite number; ignored`,
            elementId,
          ),
        );
      continue;
    }
    issues.push(
      visualIssue(
        'INFO',
        'VISUAL_PREFERENCE_REJECTED',
        `preference field "${key}" on ${elementId} is not in the LayoutPreferences whitelist (${VISUAL_LAYOUT_FIELDS.join('/')}); rejected and not applied`,
        elementId,
      ),
    );
  }
  return used ? delta : undefined;
}

/** Enforce the review contract in code, not only in the prompt (spec §3.2):
 *  unknown elementIds downgrade to "general" with a WARNING, coordinate-flavoured fields are
 *  dropped with a WARNING and never applied, illegal severities degrade to INFO (never escalated). */
export function sanitizeVisualFindings(raw: unknown, elementIds: Iterable<string>): VisualSanitizeResult {
  const known = new Set(elementIds);
  known.add('general');
  const issues: ValidationIssue[] = [];
  const list = Array.isArray(raw) ? raw : isRecord(raw) && Array.isArray(raw.findings) ? raw.findings : null;
  if (!list) {
    issues.push(
      visualIssue(
        'WARNING',
        'VISUAL_INVALID_FINDINGS',
        'Reviewer returned neither a findings array nor {findings: []}; the round counts as unproven, not as a pass',
      ),
    );
    return { findings: [], issues };
  }
  if (list.length === 0) {
    issues.push(
      visualIssue(
        'INFO',
        'VISUAL_REVIEWER_FOUND_NOTHING',
        'Reviewer reported no findings this round; absence of findings is not proof of completeness (AGENTS.md audit semantics)',
      ),
    );
    return { findings: [], issues };
  }
  const findings: VisualFinding[] = [];
  for (const [index, value] of list.entries()) {
    if (!isRecord(value)) {
      issues.push(
        visualIssue('WARNING', 'VISUAL_INVALID_FINDING', `Finding #${index + 1} is not an object and was skipped`),
      );
      continue;
    }
    let elementId =
      typeof value.elementId === 'string' && value.elementId.trim()
        ? value.elementId.trim()
        : typeof value.target === 'string' && value.target.trim()
          ? value.target.trim()
          : 'general';
    if (elementId !== 'general' && !known.has(elementId)) {
      issues.push(
        visualIssue(
          'WARNING',
          'VISUAL_UNKNOWN_ELEMENT_ID',
          `Reviewer referenced unknown elementId "${elementId}"; downgraded to general`,
          'general',
        ),
      );
      elementId = 'general';
    }
    for (const key of Object.keys(value)) {
      if (key === 'preference') {
        if (isRecord(value[key]))
          for (const inner of Object.keys(value[key] as Record<string, unknown>)) {
            if (COORDINATE_FIELD_PATTERN.test(inner))
              issues.push(
                visualIssue(
                  'WARNING',
                  'VISUAL_COORDINATE_REJECTED',
                  `preference.${inner} on ${elementId} is a coordinate/geometry field; discarded and never applied`,
                  elementId,
                ),
              );
          }
        continue;
      }
      if (COORDINATE_FIELD_PATTERN.test(key))
        issues.push(
          visualIssue(
            'WARNING',
            'VISUAL_COORDINATE_REJECTED',
            `Finding for ${elementId} carried coordinate/geometry field "${key}"; the field was discarded and never applied`,
            elementId,
          ),
        );
    }
    const severity = SEVERITIES.includes(value.severity as ValidationSeverity)
      ? (value.severity as ValidationSeverity)
      : 'INFO';
    const rawCode =
      typeof value.code === 'string' && /^[A-Za-z][A-Za-z0-9_]{1,48}$/.test(value.code)
        ? value.code.toUpperCase()
        : undefined;
    const observation = typeof value.observation === 'string' ? clip(value.observation.trim()) : '';
    const hint = typeof value.hint === 'string' ? clip(value.hint.trim()) : '';
    const code =
      rawCode ??
      classifyVisualText(`${observation} ${hint}`)?.code ??
      modelCodeText(observation || hint || 'observation');
    const preference = parseModelPreference(value.preference, elementId, issues);
    findings.push({ elementId, severity, code, observation, hint, ...(preference ? { preference } : {}) });
  }
  findings.sort(
    (a, b) =>
      SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity) ||
      a.elementId.localeCompare(b.elementId) ||
      a.observation.localeCompare(b.observation),
  );
  return { findings, issues };
}

// ---------------------------------------------------------------- hint -> LayoutPreferences corrections

interface CorrectionVote {
  field: NumericLayoutField;
  kind: 'up' | 'down' | 'toward-one';
  elementId: string;
  reason: string;
}
interface ExplicitVote {
  field: NumericLayoutField;
  value: number;
  elementId: string;
  reason: string;
}

/** Mirror of elk.ts layoutProfile(): the number ELK would actually run with for this field. */
function effectiveNumber(diagram: Diagram, field: NumericLayoutField): number {
  const explicit = diagram.layout?.[field];
  if (typeof explicit === 'number' && Number.isFinite(explicit)) return explicit;
  const density = diagram.layout?.density ?? 'balanced';
  const defaults = DENSITY_SPACING[density] ?? DENSITY_SPACING.balanced;
  switch (field) {
    case 'nodeSpacing':
      return diagram.type === 'flowchart' ? 30 : diagram.type === 'state-machine' ? 40 : defaults.node;
    case 'layerSpacing':
      return diagram.type === 'flowchart' ? 28 : diagram.type === 'state-machine' ? 46 : defaults.layer;
    case 'containerPadding':
      return defaults.padding;
    case 'edgeLabelFontSize':
      return 12;
    case 'edgeLength':
      return effectiveNumber(diagram, 'nodeSpacing') + (diagram.type === 'chen-er' ? 120 : 160);
    case 'targetAspectRatio':
      if (diagram.type === 'flowchart') return 1.05;
      if (diagram.type === 'state' || diagram.type === 'state-machine' || diagram.type === 'activity') return 0.9;
      if (diagram.type === 'system-architecture' || diagram.type === 'deployment') return 1.2;
      if (
        diagram.type === 'uml-class' ||
        diagram.type === 'uml-usecase' ||
        diagram.type === 'uml-component' ||
        diagram.type === 'er' ||
        diagram.type === 'chen-er'
      )
        return 1.35;
      return 1.15;
  }
}

export interface VisualCorrectionPlan {
  /** Full LayoutPreferences for the next ELK run — merged, never contains coordinates. */
  layout: LayoutPreferences;
  adjustments: VisualLayoutAdjustment[];
  notes: ValidationIssue[];
  semanticRequiredCount: number;
}

function resolveNumericField(
  diagram: Diagram,
  field: NumericLayoutField,
  votes: CorrectionVote[],
  explicitVotes: ExplicitVote[],
  notes: ValidationIssue[],
): { from: number; to: number; reasons: string[] } | null {
  const bounds = NUMERIC_BOUNDS[field];
  const from = effectiveNumber(diagram, field);
  const capUp = Math.max(bounds.minStep, round2(from * 0.2));
  const capDown = Math.max(round2(bounds.minStep / 2), round2(from * 0.15));
  let candidate: number | undefined;
  const reasons: string[] = [];

  if (explicitVotes.length > 0) {
    if (votes.length > 0)
      notes.push(
        visualIssue(
          'INFO',
          'VISUAL_CORRECTION_CONFLICT',
          `model preference overrides hint direction for ${field} this round`,
          explicitVotes[0].elementId,
        ),
      );
    // Multiple explicit values for one field: take the smallest |change| (anti-oscillation).
    let best: number | undefined;
    for (const vote of explicitVotes) {
      const limited = Math.min(Math.max(vote.value, from - capDown), from + capUp);
      if (best === undefined || Math.abs(limited - from) < Math.abs(best - from)) {
        best = limited;
        reasons.length = 0;
        reasons.push(vote.reason);
      }
    }
    candidate = best;
  } else {
    const ups = votes.filter((vote) => vote.kind === 'up');
    const downs = votes.filter((vote) => vote.kind === 'down');
    const toOne = votes.filter((vote) => vote.kind === 'toward-one');
    if (ups.length > 0 && downs.length > 0) {
      notes.push(
        visualIssue(
          'INFO',
          'VISUAL_CORRECTION_CONFLICT',
          `${field}: conflicting crowded/loose signals this round; skipped to avoid oscillation`,
          ups[0].elementId,
        ),
      );
      return null;
    }
    if (ups.length > 0) {
      reasons.push(ups.map((vote) => vote.reason).join('; '));
      const step = Math.max(bounds.minStep, round2(from * bounds.stepPct));
      candidate = from + Math.min(ups.length * step, capUp);
    } else if (downs.length > 0) {
      reasons.push(downs.map((vote) => vote.reason).join('; '));
      const step = bounds.stepPct === 0 ? 1 : Math.max(round2(bounds.minStep / 2), round2(from * bounds.stepPct * 0.8));
      candidate = Math.max(from - Math.min(downs.length * step, capDown), bounds.min);
    } else if (toOne.length > 0 && field === 'targetAspectRatio') {
      reasons.push(toOne.map((vote) => vote.reason).join('; '));
      const step = Math.max(0.05, round2(from * 0.08));
      candidate = from > 1.02 ? Math.max(1, from - step) : from < 0.98 ? Math.min(1, from + step) : from;
    }
  }
  if (candidate === undefined) return null;
  let to = Math.min(Math.max(candidate, bounds.min), bounds.max);
  if (field === 'edgeLabelFontSize' || field === 'nodeSpacing' || field === 'layerSpacing' || field === 'edgeLength')
    to = Math.round(to);
  to = round2(to);
  if (Math.abs(to - from) < 1e-9) return null;
  return { from, to, reasons };
}

/** Map ERROR findings onto bounded LayoutPreferences adjustments (spec §3.3). Hints that map to no
 *  existing field produce a WARNING ("needs semantic-layer change") and are recorded, never faked. */
export function planVisualCorrections(
  diagram: Diagram,
  layout: LayoutResult,
  findings: readonly VisualFinding[],
): VisualCorrectionPlan {
  const notes: ValidationIssue[] = [];
  const votes: CorrectionVote[] = [];
  const explicit: ExplicitVote[] = [];
  let wantedDensity: string | undefined;
  let wantedWrapping: string | undefined;
  let semanticRequiredCount = 0;

  for (const finding of findings) {
    if (finding.severity !== 'ERROR') continue;
    let consumed = false;
    if (finding.preference) {
      for (const field of NUMERIC_VISUAL_FIELDS) {
        const value = finding.preference[field];
        if (typeof value === 'number') {
          explicit.push({
            field,
            value,
            elementId: finding.elementId,
            reason: `model-suggested ${field}=${value} for [${finding.code}] ${finding.observation || finding.hint}`,
          });
          consumed = true;
        }
      }
      if (finding.preference.density) {
        wantedDensity = finding.preference.density;
        consumed = true;
      }
      if (finding.preference.wrapping) {
        wantedWrapping = finding.preference.wrapping;
        consumed = true;
      }
    }
    if (consumed) continue;
    const rule = matchRuleForFinding(finding, layout);
    if (!rule || rule.effects.length === 0) {
      semanticRequiredCount++;
      notes.push(
        visualIssue(
          'WARNING',
          'VISUAL_SEMANTIC_REQUIRED',
          `[${finding.code}] on ${finding.elementId}: ${finding.observation || finding.hint || 'visual problem'} — needs a semantic-layer change (wording/type/split); recorded, NOT auto-corrected`,
          finding.elementId,
        ),
      );
      continue;
    }
    for (const effect of rule.effects) {
      votes.push({
        field: effect.field,
        kind: effect.direction,
        elementId: finding.elementId,
        reason: `[${rule.code}] ${finding.observation || 'visual problem'} -> ${effect.direction} ${effect.field} (${rule.note})`,
      });
    }
  }

  const nextLayout: LayoutPreferences = { ...(diagram.layout ?? {}) };
  const adjustments: VisualLayoutAdjustment[] = [];

  for (const field of NUMERIC_VISUAL_FIELDS) {
    const fieldVotes = votes.filter((vote) => vote.field === field);
    const fieldExplicit = explicit.filter((vote) => vote.field === field);
    if (fieldVotes.length === 0 && fieldExplicit.length === 0) continue;
    const resolved = resolveNumericField(diagram, field, fieldVotes, fieldExplicit, notes);
    if (!resolved) continue;
    adjustments.push({
      field,
      from: resolved.from,
      to: resolved.to,
      reason: `${resolved.reasons.join('; ')} [bounded: per-round step ${resolved.from}->${resolved.to}]`,
      elementId: fieldExplicit[0]?.elementId ?? fieldVotes[0]?.elementId ?? 'general',
    });
    (nextLayout as Record<string, number>)[field] = resolved.to;
  }

  if (wantedDensity) {
    const current = diagram.layout?.density ?? 'balanced';
    const currentIndex = DENSITY_VALUES.indexOf(current);
    const wantedIndex = DENSITY_VALUES.indexOf(wantedDensity as LayoutDensity);
    if (currentIndex >= 0 && wantedIndex >= 0) {
      const bounded = DENSITY_VALUES[Math.min(Math.max(wantedIndex, currentIndex - 1), currentIndex + 1)];
      if (bounded !== current) {
        adjustments.push({
          field: 'density',
          from: current,
          to: bounded,
          reason: `model density=${wantedDensity} bounded to one density step`,
          elementId: 'general',
        });
        nextLayout.density = bounded;
      }
    }
  }
  if (wantedWrapping && WRAPPING_VALUES.has(wantedWrapping)) {
    const current = diagram.layout?.wrapping ?? 'AUTO';
    if (wantedWrapping !== current) {
      adjustments.push({
        field: 'wrapping',
        from: current,
        to: wantedWrapping,
        reason: `model-suggested wrapping=${wantedWrapping} (ELK wrapping fallback logic still guards the actual run)`,
        elementId: 'general',
      });
      nextLayout.wrapping = wantedWrapping as LayoutPreferences['wrapping'];
    }
  }

  return { layout: nextLayout, adjustments, notes, semanticRequiredCount };
}

/** Apply a correction plan without touching any structural field: only whitelisted
 *  LayoutPreferences keys may change; nodes/edges/containers are carried by reference. */
export function applyVisualCorrectionPlan(diagram: Diagram, plan: VisualCorrectionPlan): Diagram {
  if (plan.adjustments.length === 0) return { ...diagram };
  const merged: Record<string, unknown> = { ...(diagram.layout ?? {}) };
  for (const key of Object.keys(plan.layout) as Array<keyof LayoutPreferences>) {
    if ((VISUAL_LAYOUT_FIELDS as readonly string[]).includes(key as string)) merged[key] = plan.layout[key];
  }
  return { ...diagram, layout: merged as LayoutPreferences };
}

/** Spec §3.3 entry point: returns a NEW Diagram with adjusted LayoutPreferences (or the same
 *  layout if nothing is mappable). Never writes geometry into the model. */
export function applyVisualCorrection(
  diagram: Diagram,
  findings: readonly VisualFinding[],
  layout?: LayoutResult,
): Diagram {
  const plan = planVisualCorrections(diagram, layout ?? emptyLayoutView(diagram), findings);
  return applyVisualCorrectionPlan(diagram, plan);
}

function emptyLayoutView(diagram: Diagram): LayoutResult {
  return {
    diagram,
    nodes: [],
    containers: [],
    edges: [],
    width: 0,
    height: 0,
    warnings: [],
    iterations: diagram.layout ? 1 : 1,
  };
}

// ---------------------------------------------------------------- reviewer provider

export const VISUAL_REVIEW_SYSTEM_PROMPT = `You are a post-render visual review gate for an automatically laid-out diagram. ELK produced the geometry; you only REVIEW the rendered bitmap.
Report ONLY render-level readability problems visible in the supplied PNG, cross-checked against the supplied textual geometry facts (bboxes, container membership, edge label positions, font settings): text clipped or truncated, labels sitting on lines or other shapes, legends or containers covering elements, spacing too tight to read, edge crossings a reader cannot trace, UML/ER markers silently degraded to plain boxes.
Hard prohibitions:
- NEVER output coordinates or sizes of your own: no x, y, dx, dy, width, height, bbox, points, routes, geometry. Any such field is discarded and logged; the pipeline never applies it and re-invokes ELK instead.
- NEVER output Draw.io XML or mxCell content.
- "elementId" MUST be one of the provided element ids or the literal string "general"; unknown ids are downgraded to "general".
- Remedy suggestions may ONLY use these LayoutPreferences fields: density|nodeSpacing|layerSpacing|containerPadding|targetAspectRatio|wrapping|edgeLabelFontSize|edgeLength. Anything else (edgeSpacing, portSpread, "move slightly left", …) is rejected and ignored. If spacing fields cannot fix the problem, say what semantic change is needed (shorter label, different node kind, split the diagram) in "hint" only.
- Units: 1 unit = 1 SVG model coordinate unit; regular node label font is 12 units; gaps under 8 units count as too tight. Never convert to pt/cm.
Each finding: {"elementId": string, "severity": "ERROR"|"WARNING"|"INFO", "code": UPPER_SNAKE_ASCII, "observation": "<=200 chars of what you see", "hint": "<=200 chars, cause + LayoutPreferences or semantic remedy", "preference"?: object limited to the fields above; numbers in model units}.
Severity: ERROR = unreadable/broken render; WARNING = readable but strained; INFO = cosmetic.
Return {"findings": []} when the render is readable; an empty list only means you detected nothing, it is not a completeness proof.
Output exactly one JSON object, no markdown fences, no extra keys.`;

export interface VisualReviewerDeps {
  fetchFn?: (url: string, init: Record<string, unknown>) => Promise<Response>;
}
export async function pngToDataUrl(pngPath: string): Promise<string> {
  let bytes: Buffer;
  try {
    bytes = await fs.readFile(pngPath);
  } catch (error) {
    throw new Error(
      `[validate:visual] cannot read review bitmap "${pngPath}": ${error instanceof Error ? error.message : String(error)} — solution: use a rasterize backend that actually wrote the PNG`,
    );
  }
  const { width, height } = pngDimensions(bytes);
  if (!width || !height)
    throw new Error(`[validate:visual] review bitmap "${pngPath}" has zero dimensions; refusing to send it for review`);
  return `data:image/png;base64,${bytes.toString('base64')}`;
}

// ---------------------------------------------------------------- the gate itself

export interface VisualRasterContext {
  layout: LayoutResult;
  round: number;
  dir: string;
  baseName: string;
  scale: number;
  timeoutMs: number;
}

export interface VisualGateOptions {
  reviewer: VisualReviewer;
  /** Directory receiving review bitmaps and sidecar renderings. */
  dir?: string;
  /** Correction rounds; review calls <= maxRounds + 1. Default 2 (spec §3.3). */
  maxRounds?: number;
  scale?: number;
  timeoutMs?: number;
  rasterize?: (context: VisualRasterContext) => Promise<RasterResult>;
  relayout?: (diagram: Diagram) => Promise<LayoutResult>;
  log?: (message: string) => void;
}

export interface VisualGateResult {
  status: VisualGateStatus;
  diagram: Diagram;
  layout: LayoutResult;
  rounds: VisualRoundRecord[];
  backends: RasterBackend[];
  reviewRounds: number;
  correctionRounds: number;
  maxRounds: number;
  /** Visual-layer issues only. Codes end with ":visual"; phase stays 'render' (spec §3.4). */
  issues: ValidationIssue[];
  /** Final review round's findings (empty when the render passed). */
  findings: VisualFinding[];
  adjustments: VisualLayoutAdjustment[];
  /** Hard-coded false: the reviewer can never prove completeness (AGENTS.md audit semantics). */
  reviewerProvedCompleteness: false;
}

async function rasterizeLayoutForReview(context: VisualRasterContext): Promise<RasterResult> {
  await fs.mkdir(context.dir, { recursive: true });
  const svgPath = path.join(context.dir, `${context.baseName}.r${context.round}.svg`);
  const drawioPath = path.join(context.dir, `${context.baseName}.r${context.round}.drawio`);
  await Promise.all([
    fs.writeFile(svgPath, renderSvg(context.layout), 'utf8'),
    fs.writeFile(drawioPath, renderDrawio(context.layout), 'utf8'),
  ]);
  return rasterizeForReview({
    drawioPath,
    svgPath,
    outPath: path.join(context.dir, `${context.baseName}.r${context.round}.png`),
    scale: context.scale,
    timeoutMs: context.timeoutMs,
  });
}

export function visualFindingsToIssues(findings: readonly VisualFinding[], tag: string): ValidationIssue[] {
  return findings.map((finding) =>
    visualIssue(
      finding.severity,
      finding.code,
      `review:${tag}; ${finding.elementId === 'general' ? 'diagram-level finding' : `finding on ${finding.elementId}`}: ${finding.observation || '(no observation)'}${finding.hint ? ` | hint: ${finding.hint}` : ''}`,
      finding.elementId,
    ),
  );
}

/**
 * Third validation stage: rasterize -> review (injected reviewer) -> defensive sanitize ->
 * bounded LayoutPreferences corrections -> relayout through the existing layoutDiagram()
 * iteration machinery. Hard stop after maxRounds correction rounds: remaining ERRORs keep
 * their severity and set status 'visual_failed_after_max_rounds' (never a fake pass, spec §14).
 */
export async function runVisualGate(
  start: { diagram: Diagram; layout: LayoutResult },
  options: VisualGateOptions,
): Promise<VisualGateResult> {
  const maxRounds = Number.isFinite(options.maxRounds)
    ? Math.max(0, Math.floor(options.maxRounds as number))
    : DEFAULT_VISUAL_MAX_ROUNDS;
  const relayout = options.relayout ?? ((diagram: Diagram) => layoutDiagram(diagram, 5));
  const rasterize = options.rasterize ?? rasterizeLayoutForReview;
  const log = options.log ?? (() => {});
  const dir = options.dir ?? path.join(os.tmpdir(), 'ai-diagram-visual-gate');

  let diagram = start.diagram;
  let layout = start.layout;
  const issues: ValidationIssue[] = [];
  const seenIssueKeys = new Set<string>();
  const addIssue = (issue: ValidationIssue): void => {
    const key = `${issue.code}|${issue.elementId ?? ''}|${issue.message}`;
    if (seenIssueKeys.has(key)) return;
    seenIssueKeys.add(key);
    issues.push(issue);
  };
  const rounds: VisualRoundRecord[] = [];
  const adjustments: VisualLayoutAdjustment[] = [];
  const backends = new Set<RasterBackend>();
  let findings: VisualFinding[] = [];
  let correctionRounds = 0;

  for (let reviewRound = 1; ; reviewRound++) {
    const raster = await rasterize({
      layout,
      round: reviewRound,
      dir,
      baseName: `${diagram.id}.visual-review`,
      scale: options.scale ?? 2,
      timeoutMs: options.timeoutMs ?? 60_000,
    });
    backends.add(raster.backend);
    const request: VisualReviewRequest = {
      round: reviewRound,
      diagramId: diagram.id,
      backend: raster.backend,
      dataUrl: await pngToDataUrl(raster.pngPath),
      geometryFacts: describeVisualGeometry(layout),
      elementIds: visualElementIds(diagram),
    };
    const sanitized = sanitizeVisualFindings(await options.reviewer.review(request), request.elementIds);
    sanitized.issues.forEach(addIssue);
    const errors = sanitized.findings.filter((finding) => finding.severity === 'ERROR');
    log(
      `[VISUAL] Review round ${reviewRound} via ${raster.backend} ${raster.width}x${raster.height}: ${sanitized.findings.length} finding(s), ${errors.length} error(s)`,
    );
    findings = sanitized.findings;

    let planned: VisualCorrectionPlan | null = null;
    if (errors.length > 0 && correctionRounds < maxRounds) {
      planned = planVisualCorrections(diagram, layout, errors);
      if (planned.adjustments.length === 0) planned.notes.forEach(addIssue);
      else {
        addIssue(
          visualIssue(
            'INFO',
            'VISUAL_PARTIALLY_CORRECTED',
            `${errors.length} ERROR finding(s); ${planned.semanticRequiredCount} of them need semantic-layer changes recorded as warnings, ${planned.adjustments.length} layout adjustment(s) will be applied this round`,
          ),
        );
        planned.notes.forEach(addIssue);
      }
    }
    const activePlan: VisualCorrectionPlan | null = planned !== null && planned.adjustments.length > 0 ? planned : null;
    rounds.push({
      round: reviewRound,
      backend: raster.backend,
      pngPath: raster.pngPath,
      findings: sanitized.findings,
      errorCount: errors.length,
      adjustments: activePlan ? activePlan.adjustments : [],
      uncorrectable: planned
        ? planned.semanticRequiredCount
        : errors.length > 0 && correctionRounds >= maxRounds
          ? errors.length
          : 0,
    });
    if (!activePlan) break;
    for (const adjustment of activePlan.adjustments) {
      addIssue(
        visualIssue(
          'INFO',
          'VISUAL_CORRECTION_APPLIED',
          `${adjustment.field}: ${adjustment.from} -> ${adjustment.to} — ${adjustment.reason}`,
          adjustment.elementId,
        ),
      );
      adjustments.push({ ...adjustment, reason: `round ${reviewRound}: ${adjustment.reason}` });
    }
    diagram = applyVisualCorrectionPlan(diagram, activePlan);
    log(
      `[LAYOUT] Visual correction ${correctionRounds + 1}/${maxRounds}: re-running ELK with adjusted LayoutPreferences`,
    );
    layout = await relayout(diagram);
    correctionRounds++;
  }

  // Findings from non-final rounds were superseded by the corrections that followed them.
  for (const round of rounds.slice(0, -1)) {
    for (const finding of round.findings.filter((item) => item.severity === 'ERROR')) {
      addIssue(
        visualIssue(
          'INFO',
          'VISUAL_SUPERSEDED',
          `[${finding.code}] on ${finding.elementId} responded to with adjustment(s): ${round.adjustments.map((adjustment) => `${adjustment.field} ${adjustment.from}->${adjustment.to}`).join(', ') || 'none'}`,
          finding.elementId,
        ),
      );
    }
  }
  for (const issue of visualFindingsToIssues(findings, `final-r${rounds.length}`)) addIssue(issue);
  if (layout.status === 'failed_after_max_iterations') {
    addIssue(
      visualIssue(
        'WARNING',
        'ELK_LAYOUT_ISSUES',
        'The underlying ELK layout itself hit its re-layout limit; visual findings may partly reflect unresolved numeric geometry problems',
      ),
    );
  }

  const finalErrors = findings.filter((finding) => finding.severity === 'ERROR');
  const finalWarnings = findings.filter((finding) => finding.severity === 'WARNING');
  const status: VisualGateStatus =
    finalErrors.length > 0
      ? 'visual_failed_after_max_rounds'
      : finalWarnings.length > 0
        ? 'passed_with_warnings'
        : 'passed';
  if (finalErrors.length > 0) {
    log(
      `[VALIDATE] Visual gate ${status} after ${rounds.length} review round(s), ${correctionRounds} correction round(s); ${finalErrors.length} ERROR(s) remain — artifacts are still emitted with warnings (no relaxed validation)`,
    );
  } else {
    log(
      `[VALIDATE] Visual gate ${status} after ${rounds.length} review round(s), ${correctionRounds} correction round(s)`,
    );
  }
  return {
    status,
    diagram,
    layout,
    rounds,
    backends: [...backends],
    reviewRounds: rounds.length,
    correctionRounds,
    maxRounds,
    issues,
    findings,
    adjustments,
    reviewerProvedCompleteness: false,
  };
}

// ---------------------------------------------------------------- quality report integration

export function buildVisualQualitySection(gate: VisualGateResult): VisualQualitySection {
  return {
    status: gate.status,
    maxRounds: gate.maxRounds,
    reviewRounds: gate.reviewRounds,
    correctionRounds: gate.correctionRounds,
    backends: gate.backends,
    unresolvedFindings: gate.findings.filter((finding) => finding.severity === 'ERROR'),
    disclaimer: VISUAL_DISCLAIMER,
  };
}

export interface QualityLike {
  valid: boolean;
  status: 'passed' | 'passed_with_warnings' | 'failed';
  issues: ValidationIssue[];
}

/** Merge the visual rounds/findings/remaining issues into the .quality.json payload (spec §3.4).
 *  Pure function over any QualityReport-shaped object so the pipeline can adopt it without the
 *  visual gate touching existing code paths (pipeline.ts / cli.ts are off-limits in this task). */
export function augmentQualityWithVisualGate<T extends QualityLike>(
  quality: T,
  gate: VisualGateResult,
): T & { visual: VisualQualitySection } {
  const merged: ValidationIssue[] = [...quality.issues, ...gate.issues];
  const hasError = merged.some((issue) => issue.severity === 'ERROR');
  const hasWarning = merged.some((issue) => issue.severity === 'WARNING');
  return {
    ...quality,
    issues: merged,
    valid: quality.valid && !hasError,
    status: hasError || quality.status === 'failed' ? 'failed' : hasWarning ? 'passed_with_warnings' : 'passed',
    visual: buildVisualQualitySection(gate),
  };
}

/**
 * A reviewer backed by a fixed list of findings, one entry per review round.
 *
 * `runVisualGate` already takes an injected `VisualReviewer`, so a host whose reasoner is
 * a stateless MCP round-trip can hand its answers in as a sequence instead of being
 * limited to one round. The gate keeps applying its own bounds, rounds and validators;
 * this helper only satisfies the reviewer interface.
 */
export function createScriptedReviewer(rounds: readonly unknown[]): VisualReviewer {
  if (!Array.isArray(rounds) || rounds.length === 0) {
    throw new Error(
      '[validate:visual] createScriptedReviewer needs a non-empty array of findings payloads (one per review round)',
    );
  }
  let call = 0;
  return {
    async review() {
      if (call >= rounds.length) {
        throw new Error(
          `[validate:visual] scripted reviewer exhausted after ${rounds.length} round(s) but round ${call + 1} was requested — supply one more findings payload or lower maxRounds`,
        );
      }
      const next = rounds[call];
      call += 1;
      return next;
    },
  };
}
