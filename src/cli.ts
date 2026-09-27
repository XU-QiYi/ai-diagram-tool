import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exampleDiagrams } from './diagram-types/examples.js';
import { createDiagramFromRequest } from './diagram-types/index.js';
import { layoutDiagram } from './layout/elk.js';
import { renderDrawio, renderSvg } from './render/index.js';
import type { Diagram } from './model/types.js';
import type { QualityReport, VisualQualitySection } from './ai/types.js';
import { splitLargeDiagram } from './pipeline/index.js';
import { applyDiagramPatch, type DiagramPatch } from './pipeline/index.js';
import { loadDiagramModel } from './model/io.js';
import { architecturePresets, type ArchitecturePreset } from './diagram-types/architecture.js';
import { validateLayout } from './validate/index.js';
import { validateRenderOutputs } from './validate/render.js';
import { prepareInput } from './ai/input.js';
import { buildPlanTask, buildReviewTask, submitPlanAnswer, submitReviewAnswer } from './agent/intake.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const exampleNames = ['01-system-architecture','02-uml-class','03-uml-component','04-uml-usecase','05-flowchart','06-er','07-sequence','08-state','09-activity','10-deployment','11-mindmap','12-timeline','13-network','14-microservices-architecture','15-event-driven-architecture','16-cloud-architecture','17-production-deployment','18-state-machine','19-chen-er'];
const HELP_TEXT = `Usage: npm run generate -- <command> <input.model.json> [options]

Commands:
  generate <request>       Build with the rule parser (--offline) or an agent-supplied plan
  validate <input>         Run semantic and layout validation
  layout <input>           Write the ELK layout JSON
  render <input>           Write .drawio, .svg, and .model.json artifacts
  generate --examples      Generate all bundled examples

The project performs no model request and stores no API key. A reasoner (the host
agent, or any model it calls) supplies the semantics and the visual review:

  1. generate --emit-plan task.json --text "..." [--document f] [--image f]
  2. answer task.json with your model, save the answer as answer.json
  3. generate --plan answer.json [--audit audit.json] [--out DIR]
  4. optionally: render/review --emit-review task.png-pack, look at the bitmap,
     then generate --plan answer.json --review-findings findings.json

Options:
  --out <directory>        Output directory for layout/render/generate
  --text <request>         Natural-language request
  --document <file>        Markdown, TXT, PDF, or DOCX input
  --image <file>           PNG, JPEG, or WebP input
  --template <file>        Reference .model.json or image
  --offline                Use the limited rule parser
  --emit-plan <file>       Write the planning task for an agent/model to answer
  --plan <file>            Submit an answered planning task
  --audit <file>           Submit an independent audit of that answer
  --emit-review <file>     Render a bitmap + ids + geometry facts for a visual reviewer
  --review-findings <file> Apply reviewer findings (layout preferences only; no coordinates)
  --report <file>          Write validate JSON to a file
  --help                   Show this help

MCP server (for agents that draw diagrams as a tool):
  npm run mcp              Serve the pipeline over stdio MCP (plan/review/validate/render/patch)
`;

function option(args: string[], name: string): string | undefined { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; }
/** Reads an optional numeric flag; throws when the value is missing or not a number. */
function parseOptionNumber(args: string[], name: string, fallback: number): number {
  const raw = option(args, name);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > 5) throw new Error(`${name} must be a number between 0 and 5, received "${raw}"`);
  return Math.floor(value);
}
function parseOptions(args: string[]) { return { out: option(args, '--out'), report: option(args, '--report') }; }
function withoutOptions(args: string[]): string[] { const values: string[] = []; for (let i = 0; i < args.length; i++) { if (['--out', '--report'].includes(args[i])) { i++; continue; } if (args[i] === '--json') continue; values.push(args[i]); } return values; }
async function layoutAndReport(diagram: Diagram) { const layout = await layoutDiagram(diagram); return { layout, report: validateLayout(layout) }; }

async function writeSingle(diagram: Diagram, dir: string, fileBase = diagram.id, strict = false) {
  const { layout, report } = await layoutAndReport(diagram);
  const drawio = renderDrawio(layout);
  const svg = renderSvg(layout);
  const renderIssues = validateRenderOutputs(layout, drawio, svg);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, `${fileBase}.model.json`), JSON.stringify(diagram, null, 2));
  await fs.writeFile(path.join(dir, `${fileBase}.drawio`), drawio);
  await fs.writeFile(path.join(dir, `${fileBase}.svg`), svg);
  if (layout.warnings.length) console.warn(`[Layout Warning] ${diagram.id}: ${layout.warnings.join('; ')}`);
  if (renderIssues.length) console.error(`[Render Error] ${diagram.id}: ${renderIssues.map(issue => issue.message).join('; ')}`);
  console.log(`Generated ${diagram.id} (${layout.nodes.length} nodes, ${layout.edges.length} edges, ${layout.iterations} iteration(s))`);
  return strict && (!report.valid || renderIssues.some(issue => issue.severity === 'ERROR')) ? 1 : 0;
}
async function writeDiagram(diagram: Diagram, dir: string, strict = false) {
  const parts = splitLargeDiagram(diagram);
  let exitCode = 0;
  for (const part of parts) {
    exitCode = Math.max(exitCode, await writeSingle(part.diagram, dir, parts.length === 1 ? diagram.id : part.name, strict));
  }
  if (parts.length > 1) console.log(`Split ${diagram.id} into ${parts.length} editable diagrams: ${parts.map(p => p.name).join(', ')}`);
  return exitCode;
}
async function loadInput(file: string | undefined): Promise<Diagram> { if (!file) throw new Error('A .model.json input path is required'); return loadDiagramModel(path.resolve(file)); }

async function runValidate(args: string[]): Promise<number> { const values = withoutOptions(args); const { report, layout } = await layoutAndReport(await loadInput(values[0])); const output = { ...report, status: layout.status, iterationHistory: layout.iterationHistory ?? [], iterations: layout.iterations, width: layout.width, height: layout.height }; const reportFile = parseOptions(args).report; if (reportFile) await fs.writeFile(path.resolve(reportFile), JSON.stringify(output, null, 2), 'utf8'); console.log(JSON.stringify(output, null, 2)); return report.valid ? 0 : 1; }
async function runLayout(args: string[]): Promise<number> { const values = withoutOptions(args); const options = parseOptions(args); const { layout, report } = await layoutAndReport(await loadInput(values[0])); const out = path.resolve(options.out ?? path.join(root, 'output')); await fs.mkdir(out, { recursive: true }); await fs.writeFile(path.join(out, `${layout.diagram.id}.layout.json`), JSON.stringify({ ...layout, validation: report }, null, 2), 'utf8'); console.log(`Laid out ${layout.diagram.id} (${layout.nodes.length} nodes, ${layout.edges.length} edges)`); return report.valid ? 0 : 1; }
async function runRender(args: string[]): Promise<number> { const values = withoutOptions(args); const options = parseOptions(args); return writeSingle(await loadInput(values[0]), path.resolve(options.out ?? path.join(root, 'output')), undefined, true); }

function requestText(args: string[]): string | undefined {
  const explicit = option(args, '--text');
  if (explicit !== undefined) return explicit;
  const values: string[] = [];
  const valued = new Set(['--out', '--report', '--document', '--image', '--template', '--title', '--plan', '--audit', '--review-findings', '--review-round', '--emit-review', '--emit-plan']);
  for (let i = 0; i < args.length; i++) {
    if (valued.has(args[i])) { i++; continue; }
    if (args[i] === '--text') { i++; continue; }
    if (args[i].startsWith('--')) continue;
    values.push(args[i]);
  }
  return values.join(' ').trim() || undefined;
}

async function buildInput(args: string[]) {
  return prepareInput({ text: requestText(args), document: option(args, '--document'), image: option(args, '--image'), template: option(args, '--template') });
}

const AGENT_USAGE = 'This project performs no model request and stores no API key. Ask a reasoner for theDiagram DSL with --emit-plan <task.json>, then submit its answer with --plan <answer.json> [--audit <audit.json>]. --offline, --preset, --input and --examples need no model at all.';

/** Plan task emission and answer intake: the model side belongs to the caller. */
async function runAgentPlanFlow(args: string[]): Promise<number> {
  const emitFile = option(args, '--emit-plan');
  const planFile = option(args, '--plan');
  if (!emitFile && !planFile) throw new Error(AGENT_USAGE);
  const input = await buildInput(args);
  const dir = path.resolve(parseOptions(args).out ?? path.join(root, 'output'));
  await fs.mkdir(dir, { recursive: true });
  if (emitFile) {
    const task = buildPlanTask(input);
    const file = path.resolve(emitFile);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify(task, null, 2), 'utf8');
    console.log(`[AGENT] Plan task written: ${file} (${task.messages.length} message(s), ${input.sources.length} source(s)). Answer it with any model, then rerun with --plan <answer.json>.`);
    return 0;
  }
  const submission = JSON.parse(await fs.readFile(path.resolve(planFile as string), 'utf8')) as unknown;
  const auditFile = option(args, '--audit');
  const audit = auditFile ? (JSON.parse(await fs.readFile(path.resolve(auditFile), 'utf8')) as unknown) : undefined;
  const result = await submitPlanAnswer(input, { submission, audit });
  let diagram = result.plan.diagram;
  let layout = result.layout;
  const quality: QualityReport & { visual?: VisualQualitySection } = result.quality;
  const reviewFindings = option(args, '--review-findings');
  if (reviewFindings) {
    const findings = JSON.parse(await fs.readFile(path.resolve(reviewFindings), 'utf8')) as unknown;
    const answered = await submitReviewAnswer(diagram, layout, findings);
    diagram = answered.diagram;
    layout = answered.layout;
    quality.issues.push(...answered.issues);
    if (answered.needsSemanticChange) console.warn(`[AGENT] ${answered.findings.length} finding(s) need a semantic change; layout preferences alone cannot fix them`);
  }
  const drawio = renderDrawio(layout);
  const svg = renderSvg(layout);
  const renderIssues = validateRenderOutputs(layout, drawio, svg);
  quality.issues.push(...renderIssues);
  if (renderIssues.some(item => item.severity === 'ERROR')) { quality.valid = false; quality.status = 'failed'; }
  await Promise.all([
    fs.writeFile(path.join(dir, `${diagram.id}.model.json`), JSON.stringify(diagram, null, 2), 'utf8'),
    fs.writeFile(path.join(dir, `${diagram.id}.drawio`), drawio, 'utf8'),
    fs.writeFile(path.join(dir, `${diagram.id}.svg`), svg, 'utf8'),
    fs.writeFile(path.join(dir, `${diagram.id}.quality.json`), JSON.stringify(quality, null, 2), 'utf8'),
  ]);
  console.log(`Agent-supplied diagram ${diagram.id}: ${quality.status}, ${layout.iterations} ELK iteration(s), ${quality.evidence.verified} evidence quote(s) verified${quality.auditConfidence ? `, audit ${quality.auditConfidence}` : ', audit skipped'}`);
  if (!quality.valid) console.error(`Quality errors: ${quality.issues.filter(item => item.severity === 'ERROR').map(item => item.code).join(', ')}`);
  return quality.valid ? 0 : 1;
}

/** Emit a review task for an existing model: bitmap + referenceable ids + geometry facts. */
async function runReviewRequest(args: string[]): Promise<number> {
  const positional = withoutOptions(args).find(value => !value.startsWith('-'));
  const diagram = await loadInput(option(args, '--input') ?? positional);
  const layout = await layoutDiagram(diagram);
  const dir = path.resolve(parseOptions(args).out ?? path.join(root, 'output'));
  const task = await buildReviewTask(layout, { dir, round: parseOptionNumber(args, '--review-round', 1) });
  const file = path.resolve(option(args, '--emit-review') ?? path.join(dir, `${diagram.id}.review-request.json`));
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(task, null, 2), 'utf8');
  console.log(`[AGENT] Review task written: ${file} (bitmap ${task.backend}: ${task.pngPath}, ${task.elementIds.length} referenceable id(s)). Answer with findings JSON, then rerun with --plan … --review-findings <file>.`);
  return 0;
}

/** The 2026-09-26 redesign replaced these flags; ignore them loudly rather than silently. */
function rejectRetiredFlags(args: string[]): void {
  const retired = ['--visual-review', '--visual-rounds'];
  const used = retired.filter(flag => args.includes(flag));
  if (!used.length) return;
  throw new Error(
    `${used.join(' and ')} no longer exist: this project performs no model request. ` +
      'Emit a review task with --emit-review, inspect the bitmap it names, then apply the answer with --plan <answer.json> --review-findings <findings.json>.',
  );
}

async function runGenerate(args: string[]): Promise<number> {
  if (args.includes('--examples') || args.length === 0) { const base = path.resolve(parseOptions(args).out ?? path.join(root, 'examples')); let exitCode = 0; for (let i = 0; i < exampleDiagrams.length; i++) exitCode = Math.max(exitCode, await writeDiagram(exampleDiagrams[i](), path.join(base, exampleNames[i]), true)); return exitCode; }
  rejectRetiredFlags(args);
  const inputIndex = args.indexOf('--input');
  if (inputIndex >= 0) { let diagram = await loadInput(args[inputIndex + 1]); const patchFile = option(args, '--patch'); if (patchFile) diagram = applyDiagramPatch(diagram, JSON.parse(await fs.readFile(path.resolve(patchFile), 'utf8')) as DiagramPatch); return writeDiagram(diagram, path.resolve(parseOptions(args).out ?? path.join(root, 'output')), true); }
  const presetIndex = args.indexOf('--preset');
  if (presetIndex >= 0) { const name = args[presetIndex + 1] as ArchitecturePreset; const factory = architecturePresets[name]; if (!factory) throw new Error(`Unknown architecture preset: ${name}`); return writeDiagram(factory(option(args, '--title')), path.join(root, 'output'), true); }
  if (args.includes('--offline')) {
    if (args.includes('--document') || args.includes('--image') || args.includes('--template')) throw new Error('--offline accepts text only');
    return writeDiagram(createDiagramFromRequest(requestText(args) ?? ''), path.resolve(parseOptions(args).out ?? path.join(root, 'output')), true);
  }
  if (args.includes('--emit-review')) return runReviewRequest(args);
  return runAgentPlanFlow(args);
}

async function dispatchCli(args: string[]): Promise<number> {
  const [command, ...rest] = args;
  if (command === 'help' || command === '--help' || command === '-h') {
    console.log(HELP_TEXT);
    return 0;
  }
  if (command === 'validate') return runValidate(rest);
  if (command === 'layout') return runLayout(rest);
  if (command === 'render') return runRender(rest);
  if (command === 'generate') return runGenerate(rest);
  return runGenerate(args);
}

export async function runCli(args: string[]): Promise<number> {
  try {
    return await dispatchCli(args);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const code = error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : 'CLI_ERROR';
    console.error(`[${code}] ${message}`);
    return 1;
  }
}
const entry = process.argv[1] ? path.resolve(process.argv[1]) : ''; if (entry === path.resolve(fileURLToPath(import.meta.url))) runCli(process.argv.slice(2)).then(code => { process.exitCode = code; }).catch(error => { console.error(error); process.exitCode = 1; });
