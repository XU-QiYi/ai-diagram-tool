import fs from 'node:fs/promises';
import path from 'node:path';
import { createDiagram } from '../model/index.js';
import { loadDiagramModel } from '../model/io.js';
import { layoutDiagram } from '../layout/elk.js';
import { validateLayout } from '../validate/index.js';
import { validateRenderOutputs } from '../validate/render.js';
import { renderDrawio } from '../render/drawio.js';
import { renderSvg } from '../render/svg.js';
import { applyDiagramPatch, splitLargeDiagram, type DiagramPatch } from '../pipeline/index.js';
import { prepareInput } from '../ai/input.js';
import { DEFAULT_VISUAL_MAX_ROUNDS } from '../validate/visual.js';
import { buildPlanTask, buildReviewTask, submitPlanAnswer, submitReviewAnswer } from '../agent/intake.js';
import type { PlannedDiagram } from '../ai/types.js';
import { createDiagramFromRequest } from '../diagram-types/registry.js';
import type { Diagram, LayoutResult, ValidationIssue, ValidationReport } from '../model/types.js';
import { LAYOUT_ALGORITHMS } from '../model/types.js';
import { assertNoGeometry, asRecord, clampNumber, requireString, ToolError, type JsonRecord } from './guards.js';

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

const GEOMETRY_NOTE =
  'Geometry (x, y, size, edge routes) is computed by ELK; requests that carry it are rejected.';

const diagramSchema = {
  type: 'object',
  description: `Diagram model. ${GEOMETRY_NOTE} Use "layout" for spacing preferences, "layout.algorithm" (${LAYOUT_ALGORITHMS.join(', ')}) for the composition strategy, and top-level "direction" for orientation.`,
  additionalProperties: false,
  properties: {
    id: { type: 'string' },
    title: { type: 'string' },
    type: {
      type: 'string',
      enum: [
        'system-architecture', 'uml-class', 'uml-component', 'uml-usecase', 'flowchart',
        'er', 'chen-er', 'sequence', 'state', 'state-machine', 'activity', 'deployment',
        'mindmap', 'timeline', 'network',
      ],
    },
    direction: { type: 'string', enum: ['LEFT_TO_RIGHT', 'RIGHT_TO_LEFT', 'TOP_TO_BOTTOM', 'BOTTOM_TO_TOP'] },
    routing: { type: 'string', enum: ['ORTHOGONAL', 'POLYLINE', 'SPLINES'] },
    nodes: { type: 'array' },
    edges: { type: 'array' },
    containers: { type: 'array' },
    layout: {
      type: 'object',
      properties: {
        algorithm: { type: 'string', enum: [...LAYOUT_ALGORITHMS] },
        density: { type: 'string', enum: ['compact', 'balanced', 'spacious'] },
      },
    },
    constraints: { type: 'object' },
    theme: { type: 'object' },
    metadata: { type: 'object' },
  },
  required: ['title', 'type', 'nodes', 'edges'],
};

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'diagram_generate',
    description:
      'Generate a diagram with the arrow-chain parser only ("chain": true). This tool never calls a model, and the parser reads only ' +
      '"类型：A -> B -> C" chains — a free-form sentence is rejected with DIAGRAM_REQUEST_UNPARSED. For natural-language, document or ' +
      'image input use diagram_plan_request, answer the task with your own model, then diagram_plan_submit. ' +
      `Writes <id>.model.json, .drawio, .svg. ${GEOMETRY_NOTE}`,
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        text: { type: 'string', description: 'Arrow chain for the parser, e.g. 系统架构：前端 -> API -> 数据库.' },
        chain: { type: 'boolean', description: 'Required and must be true: use the arrow-chain parser instead of any model.' },
        out: { type: 'string', description: 'Output directory (relative paths resolve against the server working directory).' },
      },
      required: ['chain', 'text'],
    },
  },
  {
    name: 'diagram_validate',
    description:
      'Run ELK layout plus semantic and geometric validation for a model, without writing files. ' +
      'Returns the structured report so callers can see errors, warnings, layout status, and iteration count.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        model: diagramSchema,
        modelPath: { type: 'string', description: 'Path to a .model.json file.' },
      },
    },
  },
  {
    name: 'diagram_render',
    description:
      `Lay out a model with ELK, validate it, and write .model.json, .drawio, and .svg into "out". ${GEOMETRY_NOTE} ` +
      'Models above 40 nodes are split into subsystem diagrams.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        model: diagramSchema,
        modelPath: { type: 'string' },
        out: { type: 'string', description: 'Output directory; defaults to "output".' },
      },
    },
  },
  {
    name: 'diagram_patch',
    description:
      'Apply a stable-id based patch (addNodes/updateNodes/removeNodeIds/addEdges/updateEdges/removeEdgeIds/' +
      'addContainers/updateContainers/removeContainerIds/set) to an existing model, then re-run ELK, validate, and render. ' +
      'Existing IDs are preserved; ids that are not touched stay byte-identical.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        model: diagramSchema,
        modelPath: { type: 'string' },
        patch: {
          type: 'object',
          description: `Patch language from src/pipeline/update.ts. ${GEOMETRY_NOTE}`,
          additionalProperties: false,
          properties: {
            addNodes: { type: 'array' },
            updateNodes: { type: 'array' },
            removeNodeIds: { type: 'array', items: { type: 'string' } },
            addEdges: { type: 'array' },
            updateEdges: { type: 'array' },
            removeEdgeIds: { type: 'array', items: { type: 'string' } },
            addContainers: { type: 'array' },
            updateContainers: { type: 'array' },
            removeContainerIds: { type: 'array', items: { type: 'string' } },
            set: { type: 'object' },
          },
        },
        out: { type: 'string' },
      },
      required: ['patch'],
    },
  },
  {
    name: 'diagram_plan_request',
    description:
      'Package sources (text, document, image, template) into a semantic planning task for the caller to answer with its OWN model. ' +
      'This project performs no model requests and stores no credential. The task states the answer contract, including that coordinates are forbidden.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        text: { type: 'string' },
        document: { type: 'string', description: 'Path to .md/.txt/.pdf/.docx inside the server root.' },
        image: { type: 'string', description: 'Path to a PNG/JPEG/WebP reference inside the server root.' },
        template: { type: 'string', description: 'Path to a reference .model.json whose stable ids to follow.' },
      },
    },
  },
  {
    name: 'diagram_plan_submit',
    description:
      'Submit an answered planning task. The answer runs through the same gates (evidence quotes re-verified verbatim, stable ids, UML semantics, ' +
      `geometry refusal), then ELK lays it out and the artifacts are written. ${GEOMETRY_NOTE}`,
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        text: { type: 'string' },
        document: { type: 'string' },
        image: { type: 'string' },
        template: { type: 'string' },
        answer: { type: 'object', description: 'The reasoner reply: { diagram, confidence, uncertainties }.' },
        audit: {
          type: 'object',
          description: 'Optional independent audit { confidence, missing, unsupportedElementIds }. Omit it only deliberately; the report then states the plan was not independently reviewed.',
        },
        findings: { type: 'object', description: 'Optional reviewer findings, applied as layout preferences only.' },
        out: { type: 'string' },
      },
      required: ['answer'],
    },
  },
  {
    name: 'diagram_review_request',
    description:
      'Lay out a model, render a bitmap (real draw.io CLI when available, otherwise sharp over the SVG) and return the bitmap path plus the geometry facts ' +
      'and element ids a reviewer may reference. The reviewer answers with findings only, never coordinates.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        model: diagramSchema,
        modelPath: { type: 'string' },
        round: { type: 'integer', minimum: 1, maximum: 9 },
        maxRounds: { type: 'integer', minimum: 0, maximum: 5, description: 'Review-round budget reported back with the task, so a caller knows when to stop re-reviewing (default 2).' },
        out: { type: 'string' },
      },
    },
  },
  {
    name: 'diagram_review_submit',
    description:
      'Apply a reviewer answer: unknown ids and any coordinates are discarded, accepted findings become LayoutPreferences, and ELK re-computes the layout. ' +
      `Findings no preference can fix are reported as needing a semantic change. ${GEOMETRY_NOTE}`,
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        model: diagramSchema,
        modelPath: { type: 'string' },
        findings: { type: 'object', description: '{ findings: [{ code, elementId, severity, observation, hint }] }' },
        out: { type: 'string' },
      },
      required: ['findings'],
    },
  },
];

/** `isError` is omitted on success so clients can branch on its presence. */
function json(payload: unknown): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] };
}

function resolveInside(root: string, target: string): string {
  const resolved = path.resolve(root, target);
  const base = path.resolve(root);
  if (resolved !== base && !resolved.startsWith(base + path.sep)) {
    throw new ToolError(
      'PATH_OUTSIDE_WORKSPACE',
      `Refusing to access "${target}" outside the server root ${base}`,
      'Pass a path inside the server root, or start the server with DIAGRAM_MCP_ROOT set to the directory that holds your models.',
    );
  }
  return resolved;
}

async function readModel(args: JsonRecord, root: string): Promise<Diagram> {
  if (args.model !== undefined) {
    const inline = asRecord(args.model, 'model');
    assertNoGeometry(inline, 'model');
    return createDiagram(inline as unknown as Diagram);
  }
  const modelPath = requireString(args, 'modelPath');
  return loadDiagramModel(resolveInside(root, modelPath));
}

function summarize(layout: LayoutResult, report: ValidationReport, renderIssues: ValidationIssue[]) {
  const issues = [...report.issues, ...renderIssues];
  return {
    valid: report.valid && !renderIssues.some(issue => issue.severity === 'ERROR'),
    status: layout.status ?? 'passed',
    iterations: layout.iterations,
    canvas: { width: layout.width, height: layout.height },
    counts: {
      nodes: layout.nodes.length,
      edges: layout.edges.length,
      containers: layout.containers.length,
    },
    issues: issues.map(issue => ({
      severity: issue.severity,
      code: issue.code,
      phase: issue.phase,
      message: issue.message,
      ...(issue.elementId ? { elementId: issue.elementId } : {}),
    })),
  };
}

async function buildSourceInput(args: JsonRecord, root: string) {
  const text = args.text === undefined ? undefined : requireString(args, 'text');
  const document = args.document === undefined ? undefined : resolveInside(root, requireString(args, 'document'));
  const image = args.image === undefined ? undefined : resolveInside(root, requireString(args, 'image'));
  const template = args.template === undefined ? undefined : resolveInside(root, requireString(args, 'template'));
  if (text === undefined && document === undefined && image === undefined && template === undefined) {
    throw new ToolError('MISSING_SOURCE', 'This call needs at least one of "text", "document", "image" or "template".', 'Pass the material the reasoner should work from; evidence is re-verified verbatim on submit.');
  }
  return prepareInput({ text, document, image, template });
}

/** Write the four planning artifacts and summarize the result for the caller. */
async function writePlanArtifacts(planned: PlannedDiagram, out: string) {
  const diagram = planned.plan.diagram;
  const layout = planned.layout;
  const quality = planned.quality;
  const drawio = renderDrawio(layout);
  const svg = renderSvg(layout);
  const renderIssues = validateRenderOutputs(layout, drawio, svg);
  quality.issues.push(...renderIssues);
  if (renderIssues.some(issue => issue.severity === 'ERROR')) {
    quality.valid = false;
    quality.status = 'failed';
  }
  await fs.mkdir(out, { recursive: true });
  const files = {
    model: path.join(out, `${diagram.id}.model.json`),
    drawio: path.join(out, `${diagram.id}.drawio`),
    svg: path.join(out, `${diagram.id}.svg`),
    quality: path.join(out, `${diagram.id}.quality.json`),
  };
  await Promise.all([
    fs.writeFile(files.model, JSON.stringify(diagram, null, 2), 'utf8'),
    fs.writeFile(files.drawio, drawio, 'utf8'),
    fs.writeFile(files.svg, svg, 'utf8'),
    fs.writeFile(files.quality, JSON.stringify(quality, null, 2), 'utf8'),
  ]);
  return {
    diagramId: diagram.id,
    files,
    valid: quality.valid,
    status: quality.status,
    layoutIterations: layout.iterations,
    canvas: { width: layout.width, height: layout.height },
    counts: { nodes: layout.nodes.length, edges: layout.edges.length, containers: layout.containers.length },
    evidence: quality.evidence,
    auditConfidence: quality.auditConfidence,
    issues: quality.issues.map(issue => ({
      severity: issue.severity,
      code: issue.code,
      phase: issue.phase,
      message: issue.message,
      ...(issue.elementId ? { elementId: issue.elementId } : {}),
    })),
  };
}

async function renderAndWrite(diagram: Diagram, out: string) {
  const parts = splitLargeDiagram(diagram);
  const results: Array<Record<string, unknown>> = [];
  await fs.mkdir(out, { recursive: true });
  for (const part of parts) {
    const base = parts.length === 1 ? diagram.id : part.name;
    const layout = await layoutDiagram(part.diagram);
    const report = validateLayout(layout);
    const [drawio, svg] = [renderDrawio(layout), renderSvg(layout)];
    const renderIssues = validateRenderOutputs(layout, drawio, svg);
    const files = {
      model: path.join(out, `${base}.model.json`),
      drawio: path.join(out, `${base}.drawio`),
      svg: path.join(out, `${base}.svg`),
    };
    await Promise.all([
      fs.writeFile(files.model, JSON.stringify(part.diagram, null, 2), 'utf8'),
      fs.writeFile(files.drawio, drawio, 'utf8'),
      fs.writeFile(files.svg, svg, 'utf8'),
    ]);
    results.push({ diagramId: part.diagram.id, files, ...summarize(layout, report, renderIssues) });
  }
  return { split: parts.length > 1 ? { of: diagram.id, parts: parts.map(part => part.name) } : undefined, diagrams: results };
}

export interface ToolCallOptions {
  /** Directory that relative `modelPath` / `out` values resolve against. */
  root?: string;
  env?: NodeJS.ProcessEnv;
}

export async function callTool(name: string, rawArgs: unknown, options: ToolCallOptions = {}): Promise<ToolResult> {
  const args = rawArgs === undefined || rawArgs === null ? {} : asRecord(rawArgs, 'arguments');
  const root = path.resolve(options.root ?? process.cwd());
  const env = options.env ?? process.env;
  const out = args.out === undefined ? path.join(root, 'output') : resolveInside(root, String(args.out));

  switch (name) {
    case 'diagram_validate': {
      // A model that cannot even be constructed is still a validation answer, so it
      // is reported as issues instead of throwing at the caller. Geometry smuggling
      // stays a hard error (see `assertNoGeometry`).
      let diagram: Diagram;
      try {
        diagram = await readModel(args, root);
      } catch (error) {
        // Request-level refusals (走私坐标、越界路径) stay hard errors; only a
        // model that fails to construct becomes a validation answer.
        if (error instanceof ToolError) throw error;
        const message = error instanceof Error ? error.message : String(error);
        return json({
          model: typeof args.modelPath === 'string' ? args.modelPath : 'inline',
          valid: false,
          status: 'rejected_before_layout',
          iterations: 0,
          canvas: { width: 0, height: 0 },
          counts: { nodes: 0, edges: 0, containers: 0 },
          issues: [{ severity: 'ERROR', code: 'INVALID_MODEL', phase: 'semantic', message }],
        });
      }
      const layout = await layoutDiagram(diagram);
      const report = validateLayout(layout);
      return json({ model: diagram.id, ...summarize(layout, report, []) });
    }
    case 'diagram_render': {
      const diagram = await readModel(args, root);
      return json({ written: await renderAndWrite(diagram, out) });
    }
    case 'diagram_patch': {
      const base = await readModel(args, root);
      const patch = asRecord(args.patch, 'patch');
      assertNoGeometry(patch, 'patch');
      const patched = applyDiagramPatch(base, patch as DiagramPatch);
      const carriedIds = new Set(patched.nodes.map(node => node.id));
      const preserved = base.nodes.filter(node => carriedIds.has(node.id)).map(node => node.id);
      const removed = base.nodes.filter(node => !carriedIds.has(node.id)).map(node => node.id);
      const renamed = patched.nodes
        .filter(node => !base.nodes.some(old => old.id === node.id))
        .map(node => node.id);
      return json({
        stableIds: { preserved, removed, added: renamed },
        written: await renderAndWrite(patched, out),
      });
    }
    case 'diagram_generate': {
      if (args.chain !== true) {
        throw new ToolError(
          'AGENT_PLAN_REQUIRED',
          'diagram_generate only runs the arrow-chain parser; nothing in this project calls a model or holds an API key.',
          'Use diagram_plan_request to get a plan task, answer it with your own model, then diagram_plan_submit. Set "chain": true to use the arrow-chain parser.',
        );
      }
      if (args.document || args.image || args.template) throw new Error('chain mode accepts "text" only; drop the document/image/template argument');
      const diagram = createDiagramFromRequest(requireString(args, 'text'));
      return json({ mode: 'chain', written: await renderAndWrite(diagram, out) });
    }
    case 'diagram_plan_request': {
      const input = await buildSourceInput(args, root);
      const task = buildPlanTask(input);
      return json({ task, note: 'Answer task.messages with any model, then call diagram_plan_submit with the same sources plus { answer }.' });
    }
    case 'diagram_plan_submit': {
      const input = await buildSourceInput(args, root);
      if (args.answer === undefined) throw new ToolError('MISSING_ANSWER', 'diagram_plan_submit needs "answer": the reasoner reply containing { diagram, confidence, uncertainties }.', 'Call diagram_plan_request first.');
      const planned = await submitPlanAnswer(input, { submission: args.answer, audit: args.audit });
      if (args.findings !== undefined) {
        const answered = await submitReviewAnswer(planned.plan.diagram, planned.layout, args.findings);
        planned.plan.diagram = answered.diagram;
        planned.layout = answered.layout;
        planned.quality.issues.push(...answered.issues);
      }
      return json({ mode: 'agent-plan', written: await writePlanArtifacts(planned, out) });
    }
    case 'diagram_review_request': {
      const diagram = await readModel(args, root);
      const layout = await layoutDiagram(diagram);
      const round = clampNumber(args.round, 1, 1, 9);
      const maxRounds = clampNumber(args.maxRounds, DEFAULT_VISUAL_MAX_ROUNDS, 0, 5);
      const task = await buildReviewTask(layout, { dir: out, round, env });
      return json({
        task,
        note: 'Look at task.pngPath, then answer with findings JSON using only ids from task.elementIds and fields from task.allowedFields.',
        reviewBudget: {
          round,
          maxRounds,
          advice: `Round ${round} of a ${maxRounds}-round budget: re-issue this call after diagram_review_submit to review the re-laid-out diagram, and stop when a round returns no ERROR finding.`,
        },
      });
    }
    case 'diagram_review_submit': {
      const base = await readModel(args, root);
      if (args.findings === undefined) throw new ToolError('MISSING_FINDINGS', 'diagram_review_submit needs "findings": the reviewer answer from diagram_review_request.', 'Request a review first, inspect the bitmap, then submit findings.');
      const layout = await layoutDiagram(base);
      const answered = await submitReviewAnswer(base, layout, args.findings);
      return json({
        applied: answered.issues.filter(issue => issue.code.startsWith('VISUAL_CORRECTION_APPLIED')),
        discarded: answered.issues.filter(issue => !issue.code.startsWith('VISUAL_CORRECTION_APPLIED')),
        needsSemanticChange: answered.needsSemanticChange,
        layout: answered.diagram.layout,
        written: await renderAndWrite(answered.diagram, out),
      });
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
