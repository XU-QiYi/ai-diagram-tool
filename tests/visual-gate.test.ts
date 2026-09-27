import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { layoutDiagram } from '../src/layout/elk.js';
import { renderDrawio } from '../src/render/drawio.js';
import { renderSvg } from '../src/render/svg.js';
import type { Diagram, LayoutResult, Provenance } from '../src/model/types.js';
import type { VisualFinding, VisualReviewRequest } from '../src/ai/types.js';
import {
  buildDrawioArgs, loadSharpDefault, pngDimensions, rasterizeForReview, resolveDrawioExecutable,
} from '../src/render/png.js';
import {
  DEFAULT_VISUAL_MAX_ROUNDS, VISUAL_LAYOUT_FIELDS, VISUAL_REVIEW_SYSTEM_PROMPT,
  applyVisualCorrection, augmentQualityWithVisualGate,
  planVisualCorrections, runVisualGate, sanitizeVisualFindings, visualElementIds,
} from '../src/validate/visual.js';
import type { VisualGateResult, VisualGateOptions } from '../src/validate/visual.js';

const provenance: Provenance = { source: 'request', quote: 'q', confidence: 1 };

function fixtureDiagram(extra?: Partial<Diagram>): Diagram {
  return {
    id: 'gate-fixture', title: 'Gate fixture', type: 'system-architecture',
    layout: { nodeSpacing: 60, layerSpacing: 78 },
    nodes: [
      { id: 'node.user', label: '用户 Web', provenance },
      { id: 'node.api', label: 'API 服务', provenance },
      { id: 'node.db', label: '数据库', provenance },
    ],
    edges: [
      { id: 'edge.user-api', source: 'node.user', target: 'node.api', label: 'HTTP', type: 'uses', provenance },
      { id: 'edge.api-db', source: 'node.api', target: 'node.db', label: 'SQL', type: 'uses', provenance },
    ],
    ...extra,
  };
}

async function fixtureLayout(): Promise<{ diagram: Diagram; layout: LayoutResult }> {
  const diagram = fixtureDiagram();
  return { diagram, layout: await layoutDiagram(diagram) };
}

function pngBytes(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer, 0);
  buffer.writeUInt32BE(13, 8);
  buffer.write('IHDR', 12, 'ascii');
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}

/** Fake rasterizer: writes a small but header-valid PNG so the gate's data URL step works offline. */
function makeFakeRasterize() {
  const seen: Array<{ round: number; baseName: string }> = [];
  const rasterize: NonNullable<VisualGateOptions['rasterize']> = async (context) => {
    seen.push({ round: context.round, baseName: context.baseName });
    await fs.mkdir(context.dir, { recursive: true });
    const pngPath = path.join(context.dir, `${context.baseName}.r${context.round}.png`);
    await fs.writeFile(pngPath, pngBytes(64, 64));
    return { pngPath, backend: 'sharp-svg', width: 64, height: 64 };
  };
  return { seen, rasterize };
}

function scriptedReviewer(responses: unknown[]) {
  const seenRequests: VisualReviewRequest[] = [];
  const reviewer = {
    async review(request: VisualReviewRequest): Promise<unknown> {
      seenRequests.push(request);
      return responses[Math.min(seenRequests.length - 1, responses.length - 1)];
    },
  };
  return { reviewer, seenRequests };
}

const crowdedResponse = {
  findings: [{
    elementId: 'node.user', severity: 'ERROR', code: 'VISUAL_CROWDED',
    observation: 'Nodes are crowded, labels almost touch each other',
    hint: 'increase node spacing; ELK should re-layout',
  }],
};
const cleanResponse = { findings: [] };

function errorFinding(overrides: Partial<VisualFinding> & { elementId?: string }): VisualFinding {
  return {
    elementId: 'node.user', severity: 'ERROR', code: 'VISUAL_CROWDED',
    observation: 'crowded render', hint: 'increase spacing', ...overrides,
  } as VisualFinding;
}

// ---------------------------------------------------------------- §3.2 defensive sanitize

test('sanitize drops coordinates, downgrades unknown ids and illegal severities, never applies model data', () => {
  const ids = ['node.user', 'node.api', 'node.db', 'edge.user-api', 'edge.api-db', 'general'];
  const { findings, issues } = sanitizeVisualFindings({
    findings: [
      { elementId: 'node.ghost', severity: 'CRITICAL', x: 120, y: 50, observation: 'labels overlap', hint: 'move label right to x=300' },
      { elementId: 'node.api', code: 'evil code!', width: 30, preference: { mxCell: '<mxGeometry x="1"/>', portSpread: 2, nodeSpacing: 'big' }, observation: 'crowded', hint: 'increase spacing' },
      'junk',
      { observation: 'general issue without ids' },
    ],
  }, ids);

  assert.equal(findings.length, 3, 'non-object entry skipped');
  // sanitize sorts by severity/elementId/observation; address findings by content, not position
  const byObservation = (text: string): VisualFinding => findings.find((finding) => finding.observation.startsWith(text))!;
  const ghost = byObservation('labels overlap');
  const api = byObservation('crowded');
  const anonymous = byObservation('general issue');
  assert.ok(!('x' in ghost) && !('y' in ghost) && !('width' in ghost), 'no coordinates survive on sanitized findings');
  assert.equal(ghost.elementId, 'general', 'unknown id downgraded');
  assert.equal(ghost.severity, 'INFO', 'illegal severity degrades to INFO, never escalated');
  assert.equal(api.elementId, 'node.api', 'known id preserved');
  assert.equal(api.preference, undefined, 'all rejected preference fields dropped');
  assert.equal(anonymous.elementId, 'general', 'missing id defaults to general');

  const codes = issues.map((issue) => issue.code);
  for (const issue of issues) {
    assert.equal(issue.phase, 'render');
    assert.ok(issue.code.endsWith(':visual'), `code ${issue.code} must carry the :visual suffix`);
  }
  assert.ok(codes.includes('VISUAL_UNKNOWN_ELEMENT_ID:visual'));
  assert.equal(codes.filter((code) => code === 'VISUAL_COORDINATE_REJECTED:visual').length >= 3, true, 'x, y and preference.mxCell all flagged');
  assert.ok(codes.includes('VISUAL_INVALID_FINDING:visual'));
  assert.ok(codes.includes('VISUAL_PREFERENCE_REJECTED:visual'), 'portSpread rejected as non-whitelisted (INFO)');
  assert.ok(issues.some((issue) => issue.code === 'VISUAL_PREFERENCE_REJECTED:visual' && issue.severity === 'INFO'), 'whitelist rejection is INFO, not escalated');
  assert.ok(issues.some((issue) => issue.message.includes('"node.ghost"')), 'unknown id kept visible in the warning text for debugging');

  const empty = sanitizeVisualFindings({ findings: [] }, ids);
  assert.deepEqual(empty.findings, []);
  assert.ok(empty.issues.some((issue) => issue.code === 'VISUAL_REVIEWER_FOUND_NOTHING:visual' && issue.severity === 'INFO'), 'empty findings documented as unproven, not completeness');
  const arrayShape = sanitizeVisualFindings([{ elementId: 'general', severity: 'WARNING', observation: 'o', hint: 'h' }], ids);
  assert.equal(arrayShape.findings.length, 1, 'tolerates a bare findings array');
});

// ---------------------------------------------------------------- §3.3 hint → LayoutPreferences mapping

test('crowded hints monotonically increase spacing; loose hints monotonically decrease it, bounded', async () => {
  const { diagram, layout } = await fixtureLayout();
  const crowded = planVisualCorrections(diagram, layout, [errorFinding({})]);
  const node = crowded.adjustments.find((adjustment) => adjustment.field === 'nodeSpacing');
  const layer = crowded.adjustments.find((adjustment) => adjustment.field === 'layerSpacing');
  assert.ok(node && layer);
  assert.equal(node.from, 60);
  assert.equal(node.to, 68, 'step = max(8, 12%) of 60, within the +20% cap');
  assert.equal(layer.to, 88);
  assert.ok(node.to > node.from, 'crowded -> spacing strictly increases');
  assert.equal(crowded.layout.nodeSpacing, 68);
  assert.ok(crowded.adjustments.every((adjustment) => (VISUAL_LAYOUT_FIELDS as readonly string[]).includes(adjustment.field)));
  assert.ok(/monotonic/.test(node.reason), 'adjustments carry the monotonicity rationale');

  const loose = planVisualCorrections(diagram, layout, [errorFinding({ code: 'VISUAL_SPACING_LOOSE', observation: 'too spread out with excessive whitespace', hint: 'reduce spacing' })]);
  const looseNode = loose.adjustments.find((adjustment) => adjustment.field === 'nodeSpacing');
  assert.ok(looseNode);
  assert.equal(typeof looseNode.to, 'number');
  assert.equal(typeof looseNode.from, 'number');
  assert.ok((looseNode.to as number) < (looseNode.from as number) && (looseNode.to as number) >= 60 * 0.85, 'loose -> decreases within the -15%/round bound');

  const conflict = planVisualCorrections(diagram, layout, [
    errorFinding({}),
    errorFinding({ code: 'VISUAL_SPACING_LOOSE', observation: 'too spread out', hint: 'reduce' }),
  ]);
  assert.equal(conflict.adjustments.find((adjustment) => adjustment.field === 'nodeSpacing'), undefined, 'conflicting crowded/loose votes cancel (anti-oscillation)');
  assert.ok(conflict.notes.some((note) => note.code === 'VISUAL_CORRECTION_CONFLICT:visual'));

  const huge = planVisualCorrections(diagram, layout, [errorFinding({ preference: { nodeSpacing: 9999 } })]);
  assert.equal(huge.adjustments.find((adjustment) => adjustment.field === 'nodeSpacing')?.to, 72, 'absurd explicit value clamped to base+20%');
  const tiny = planVisualCorrections(diagram, layout, [errorFinding({ code: 'X', preference: { nodeSpacing: 30 }, observation: 'pref', hint: 'reduce nodeSpacing' })]);
  assert.equal(tiny.adjustments.find((adjustment) => adjustment.field === 'nodeSpacing')?.to, 51, 'clamped to the -15% floor');

  const density = planVisualCorrections({ ...diagram, layout: { ...diagram.layout, density: 'compact' } }, layout, [errorFinding({ preference: { density: 'spacious' } })]);
  assert.equal(density.adjustments.find((adjustment) => adjustment.field === 'density')?.to, 'balanced', 'density moves at most one step');
});

test('hints that no LayoutPreferences field can fix produce semantic-change warnings, never faked fixes', async () => {
  const { diagram, layout } = await fixtureLayout();
  const plan = planVisualCorrections(diagram, layout, [errorFinding({ code: 'VISUAL_LABEL_TRUNCATED', observation: 'label text is truncated in the box', hint: 'shorten the wording' })]);
  assert.equal(plan.adjustments.length, 0);
  assert.equal(plan.semanticRequiredCount, 1);
  assert.ok(plan.notes.some((note) => note.code === 'VISUAL_SEMANTIC_REQUIRED:visual' && note.severity === 'WARNING' && /semantic-layer change/.test(note.message)));
});

test('applyVisualCorrection returns a new diagram with adjusted preferences and never mutates or coordinates the model', async () => {
  const { diagram } = await fixtureLayout();
  const next = applyVisualCorrection(diagram, [errorFinding({})]);
  assert.equal(diagram.layout?.nodeSpacing, 60, 'original untouched');
  assert.equal(next.layout?.nodeSpacing, 68);
  assert.equal(next.nodes, diagram.nodes, 'structural fields carried by reference');
  assert.ok(next.nodes.every((node) => !('x' in node) && !('y' in node) && !('width' in node)));
  assert.ok(Object.keys(next.layout ?? {}).every((key) => !(key === 'x' || key === 'y' || key === 'portSpread' || key === 'mxCell')));
});

// ---------------------------------------------------------------- §3.3 bounded gate loop

test('visual gate applies corrections through relayout and passes when a later review round is clean', async () => {
  const { diagram, layout } = await fixtureLayout();
  const { reviewer, seenRequests } = scriptedReviewer([crowdedResponse, cleanResponse]);
  const relayoutCalls: Diagram[] = [];
  const gate = await runVisualGate({ diagram, layout }, {
    reviewer,
    dir: await fs.mkdtemp(path.join(os.tmpdir(), 'vg-pass-')),
    rasterize: makeFakeRasterize().rasterize,
    relayout: async (incoming) => { relayoutCalls.push(incoming); return { ...layout, diagram: incoming }; },
  });
  assert.equal(gate.status, 'passed');
  assert.equal(gate.reviewRounds, 2);
  assert.equal(gate.correctionRounds, 1);
  assert.equal(seenRequests.length, 2);
  assert.equal(relayoutCalls.length, 1);
  assert.equal(gate.diagram.layout?.nodeSpacing, 68);
  assert.equal(gate.layout.diagram, gate.diagram, 'final layout belongs to the corrected diagram');
  const serialized = JSON.stringify(gate.diagram);
  assert.ok(!serialized.includes('"x":') && !serialized.includes('"y":'), 'no coordinates anywhere in the model');
  assert.ok(seenRequests[0].geometryFacts.includes('node.user') && seenRequests[0].geometryFacts.includes('CANVAS'), 'reviewer gets the ids and real bbox facts');
  assert.ok(seenRequests[0].dataUrl.startsWith('data:image/png;base64,'));
  assert.ok(gate.issues.some((issue) => issue.code === 'VISUAL_CORRECTION_APPLIED:visual' && issue.phase === 'render'));
  assert.ok(!gate.issues.some((issue) => issue.severity === 'ERROR'), 'superseded round-1 errors do not remain as errors');
  assert.equal(gate.reviewerProvedCompleteness, false);
});

test('maxRounds is enforced: after the cap the status is visual_failed_after_max_rounds and errors keep ERROR severity', async () => {
  const { diagram, layout } = await fixtureLayout();
  const { reviewer, seenRequests } = scriptedReviewer([crowdedResponse]);
  const logs: string[] = [];
  const gate = await runVisualGate({ diagram, layout }, {
    reviewer,
    maxRounds: 1,
    dir: await fs.mkdtemp(path.join(os.tmpdir(), 'vg-cap-')),
    rasterize: makeFakeRasterize().rasterize,
    relayout: async (incoming) => ({ ...layout, diagram: incoming }),
    log: (message) => logs.push(message),
  });
  assert.equal(DEFAULT_VISUAL_MAX_ROUNDS, 2);
  assert.equal(seenRequests.length, 2, 'exactly maxRounds + 1 reviews');
  assert.equal(gate.reviewRounds, 2);
  assert.equal(gate.correctionRounds, 1);
  assert.equal(gate.status, 'visual_failed_after_max_rounds');
  assert.ok(gate.issues.some((issue) => issue.code === 'VISUAL_CROWDED:visual' && issue.severity === 'ERROR'), 'remaining ERRORs are NOT relaxed into warnings');
  assert.equal(gate.diagram.layout?.nodeSpacing, 68, 'one bounded correction did happen');
  assert.ok(logs.some((line) => line.startsWith('[VISUAL]')) && logs.some((line) => line.startsWith('[VALIDATE]')));
});

test('maxRounds 0 = review-only mode: one pass, no relayout', async () => {
  const { diagram, layout } = await fixtureLayout();
  const { reviewer } = scriptedReviewer([crowdedResponse]);
  const gate = await runVisualGate({ diagram, layout }, {
    reviewer, maxRounds: 0, dir: await fs.mkdtemp(path.join(os.tmpdir(), 'vg-ro-')),
    rasterize: makeFakeRasterize().rasterize,
    relayout: async () => { throw new Error('relayout must not run'); },
  });
  assert.equal(gate.reviewRounds, 1);
  assert.equal(gate.correctionRounds, 0);
  assert.equal(gate.status, 'visual_failed_after_max_rounds');
});

test('clean first review passes immediately and documents that completeness is unproven', async () => {
  const { diagram, layout } = await fixtureLayout();
  const { reviewer } = scriptedReviewer([cleanResponse]);
  const gate = await runVisualGate({ diagram, layout }, {
    reviewer, dir: await fs.mkdtemp(path.join(os.tmpdir(), 'vg-clean-')),
    rasterize: makeFakeRasterize().rasterize,
    relayout: async () => { throw new Error('no relayout expected'); },
  });
  assert.equal(gate.status, 'passed');
  assert.equal(gate.reviewRounds, 1);
  assert.ok(gate.issues.some((issue) => issue.code === 'VISUAL_REVIEWER_FOUND_NOTHING:visual'));
});

// ---------------------------------------------------------------- the iron rule end to end

test('IRON RULE: an adversarial reviewer smuggling coordinates/x-y/mxCell/9999 gets them discarded; ELK re-runs with clamped preferences only', async () => {
  const { diagram, layout } = await fixtureLayout();
  const adversarial = {
    findings: [{
      elementId: 'node.user', severity: 'ERROR',
      x: 555, y: 666, dx: 30,
      observation: 'The three boxes are too crowded horizontally, labels nearly collide',
      hint: 'move x=991 rightward and set position 320,240',
      preference: {
        nodeSpacing: 9999,
        mxCell: '<mxGeometry as="geometry" x="9"/>',
        portSpread: 7,
        density: 'ultra-wide',
      },
    }],
  };
  const { reviewer, seenRequests } = scriptedReviewer([adversarial, cleanResponse]);
  const gate = await runVisualGate({ diagram, layout }, {
    reviewer,
    dir: await fs.mkdtemp(path.join(os.tmpdir(), 'vg-iron-')),
    rasterize: makeFakeRasterize().rasterize,
    relayout: async (incoming) => ({ ...layout, diagram: incoming }),
  });
  const serialized = JSON.stringify(gate.diagram);
  assert.ok(!/9999|555|666|mxCell|portSpread|ultra-wide/.test(serialized), 'no model-supplied coordinate or value ever reaches the diagram');
  assert.ok(!('x' in (gate.diagram.layout ?? {})) && !('y' in (gate.diagram.layout ?? {})));
  assert.ok(gate.diagram.nodes.every((node) => !('x' in node) && !('y' in node) && !('width' in node)));
  assert.equal(gate.diagram.layout?.nodeSpacing, 72, 'the only surviving value is the clamped 12%+cap step owned by our mapping table');
  assert.equal(gate.status, 'passed');
  assert.equal(gate.correctionRounds, 1);
  const codes = gate.issues.map((issue) => issue.code);
  assert.ok(codes.filter((code) => code === 'VISUAL_COORDINATE_REJECTED:visual').length >= 3);
  assert.ok(codes.includes('VISUAL_PREFERENCE_REJECTED:visual'));
  assert.ok(gate.issues.every((issue) => issue.phase === 'render' && issue.code.endsWith(':visual')), 'visual provenance lives in codes, phase union untouched');
  assert.ok(VISUAL_REVIEW_SYSTEM_PROMPT.includes('NEVER output coordinates'));
  assert.ok(VISUAL_REVIEW_SYSTEM_PROMPT.includes('Draw.io XML or mxCell'));
  assert.ok(VISUAL_REVIEW_SYSTEM_PROMPT.includes('1 unit = 1 SVG model coordinate unit'));
  assert.equal(seenRequests.length, 2);
});

// ---------------------------------------------------------------- §2 rasterization backends

const FAKE_EXE = 'C:/fake/draw.io.exe';

test('drawio-cli backend: argv is a pure argument array resolved via DRAWIO_PATH, never shell concatenation', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vg-drawio-argv-'));
  const drawioPath = path.join(dir, 'diagram.drawio');
  await fs.writeFile(drawioPath, '<mxfile/>', 'utf8');
  const outPath = path.join(dir, 'out.png');
  const calls: Array<{ exe: string; args: string[]; timeoutMs: number }> = [];
  const result = await rasterizeForReview({ drawioPath, outPath }, {
    env: { DRAWIO_PATH: FAKE_EXE },
    executableExists: async () => true,
    runDrawioCli: async (exe, args, timeoutMs) => {
      calls.push({ exe, args, timeoutMs });
      await fs.writeFile(args[args.indexOf('-o') + 1], pngBytes(11, 22));
    },
  });
  assert.equal(result.backend, 'drawio-cli');
  assert.deepEqual({ width: result.width, height: result.height }, { width: 11, height: 22 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].exe, FAKE_EXE);
  assert.equal(calls[0].timeoutMs, 60_000);
  assert.deepEqual(calls[0].args, buildDrawioArgs(drawioPath, outPath, 2));
  assert.deepEqual(calls[0].args, ['-x', '-f', 'png', '-s', '2', '-b', '10', '-o', outPath, drawioPath]);
  assert.ok(calls[0].args.every((arg) => typeof arg === 'string' && !/[;&|<>`$\n]/.test(arg)), 'no shell metacharacters anywhere in argv');
  assert.equal(calls[0].args.at(-1), drawioPath, 'input path rides as its own argv slot');
});

test('DRAWIO_PATH set but missing is a loud configuration error; backends both down = explicit error, never a silent skip', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vg-drawio-missing-'));
  const drawioPath = path.join(dir, 'diagram.drawio');
  const svgPath = path.join(dir, 'diagram.svg');
  await fs.writeFile(drawioPath, '<mxfile/>', 'utf8');
  await fs.writeFile(svgPath, '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"/>', 'utf8');
  await assert.rejects(() => rasterizeForReview({ drawioPath }, {
    env: { DRAWIO_PATH: FAKE_EXE },
    executableExists: async () => false,
  }), (error: Error) => /DRAWIO_PATH points to a missing executable/.test(error.message) && /sharp-svg fallback/.test(error.message));

  const resolution = await resolveDrawioExecutable({ DRAWIO_PATH: FAKE_EXE }, async () => false);
  assert.equal(resolution.kind, 'env-missing');

  // Empty env => no DRAWIO_PATH, no ProgramFiles/LOCALAPPDATA candidates; default loadSharp then fails loudly too.
  await assert.rejects(() => rasterizeForReview({ drawioPath, svgPath, outPath: path.join(dir, 'fb.png') }, {
    env: {},
    executableExists: async () => false,
  }), (error: Error) => /sharp-svg backend unavailable/.test(error.message) && /MIMO_NODE_MODULES/.test(error.message));
});

async function sharpProbe(): Promise<{ ok: boolean; reason: string }> {
  try {
    await loadSharpDefault(process.env);
    return { ok: true, reason: '' };
  } catch (error) {
    return { ok: false, reason: `sharp not loadable (require('sharp') and MIMO_NODE_MODULES both failed): ${error instanceof Error ? error.message.slice(0, 120) : String(error)}` };
  }
}

const sharpAvailability = await sharpProbe();
const sharpSkip = sharpAvailability.ok ? false : sharpAvailability.reason;

test('sharp-svg backend really rasterizes a project-style SVG to a non-empty PNG', { skip: sharpSkip }, async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vg-sharp-'));
  const svgPath = path.join(dir, 'tiny.svg');
  await fs.writeFile(svgPath, '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200" viewBox="0 0 400 200"><rect width="400" height="200" fill="#fff"/><text x="40" y="40" font-size="12">中文测试 Label</text></svg>', 'utf8');
  const result = await rasterizeForReview({ svgPath, outPath: path.join(dir, 'tiny.png') });
  assert.equal(result.backend, 'sharp-svg');
  assert.ok(existsSync(result.pngPath));
  const bytes = await fs.readFile(result.pngPath);
  assert.ok(bytes.length > 1000, `real PNG bytes (${bytes.length})`);
  assert.deepEqual(pngDimensions(bytes), { width: result.width, height: result.height });
  assert.equal(result.width, 1200, 'density 216 = 3x the 72-dpi SVG units');
  assert.equal(result.height, 600);
});

test('default gate rasterization renders the laid-out diagram with the real renderers (no injected deps)', { skip: sharpSkip }, async () => {
  const { diagram, layout } = await fixtureLayout();
  const { reviewer, seenRequests } = scriptedReviewer([cleanResponse]);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vg-default-raster-'));
  const gate = await runVisualGate({ diagram, layout }, {
    reviewer,
    dir,
    relayout: async () => { throw new Error('no correction expected'); },
  });
  assert.equal(gate.reviewRounds, 1);
  assert.ok(['drawio-cli', 'sharp-svg'].includes(gate.backends[0]), `backend used: ${gate.backends.join('+')}`);
  assert.ok(seenRequests[0].dataUrl.length > 1000, 'the reviewer receives a real bitmap data URL');
  const sidecars = await fs.readdir(dir);
  assert.ok(sidecars.some((name) => name.endsWith('.drawio')) && sidecars.some((name) => name.endsWith('.svg')), 'review sidecars written per round');
  void renderSvg;
});

const DRAWIO_EXE = 'C:\\Program Files\\draw.io\\draw.io.exe';
const realDrawioSkip = existsSync(DRAWIO_EXE) ? false : `draw.io Desktop executable not found at ${DRAWIO_EXE}; the argv-array contract for the drawio-cli backend is still covered above`;

test('drawio-cli backend really renders our .drawio through the installed draw.io Desktop', { skip: realDrawioSkip }, async () => {
  const { diagram, layout } = await fixtureLayout();
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vg-drawio-real-'));
  const drawioPath = path.join(dir, 'diagram.drawio');
  await fs.writeFile(drawioPath, renderDrawio(layout), 'utf8');
  const result = await rasterizeForReview({ drawioPath }, { env: { ...process.env, DRAWIO_PATH: DRAWIO_EXE } });
  assert.equal(result.backend, 'drawio-cli', 'the preferred real-Drawio rendering must actually be used when the CLI is installed');
  assert.ok(result.width > 100 && result.height > 50);
  const bytes = await fs.readFile(result.pngPath);
  assert.deepEqual(pngDimensions(bytes), { width: result.width, height: result.height });
  void diagram;
});


// ---------------------------------------------------------------- §3.4 quality report integration

test('augmentQualityWithVisualGate merges visual rounds/issues without touching existing phases or the base object', async () => {
  const { diagram, layout } = await fixtureLayout();
  const { reviewer } = scriptedReviewer([crowdedResponse]);
  const gate: VisualGateResult = await runVisualGate({ diagram, layout }, {
    reviewer, maxRounds: 0, dir: await fs.mkdtemp(path.join(os.tmpdir(), 'vg-quality-')),
    rasterize: makeFakeRasterize().rasterize,
    relayout: async () => { throw new Error('no relayout expected'); },
  });
  const base = {
    valid: true, status: 'passed' as const, sources: ['request' as const],
    confidence: 0.91, auditConfidence: 0.88, attempts: 1,
    evidence: { verified: 3, modelReported: 0 },
    issues: [{ severity: 'WARNING' as const, code: 'ORPHAN_NODE', message: 'Orphan node: node.db', phase: 'layout' as const }],
    layoutIterations: 1,
  };
  const snapshot = JSON.stringify(base);
  const augmented = augmentQualityWithVisualGate(base, gate);
  assert.equal(JSON.stringify(base), snapshot, 'pure function: quality input untouched');
  assert.ok(augmented.issues.some((issue) => issue.code === 'VISUAL_CROWDED:visual'));
  assert.ok(augmented.issues.some((issue) => issue.code === 'ORPHAN_NODE' && issue.phase === 'layout'), 'numeric issues keep their phase for filtering');
  assert.equal(augmented.status, 'failed', 'honest failed: a remaining visual ERROR is not relaxed away');
  assert.equal(augmented.valid, false);
  assert.equal(augmented.visual.status, 'visual_failed_after_max_rounds');
  assert.equal(augmented.visual.reviewRounds, 1);
  assert.deepEqual(augmented.visual.unresolvedFindings.length, 1);
  assert.match(augmented.visual.disclaimer, /not that nothing is wrong/);
});
