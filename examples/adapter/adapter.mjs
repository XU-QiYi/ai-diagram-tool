#!/usr/bin/env node
/**
 * Reference adapter: turns a `--emit-plan` task JSON into an `--plan` answer JSON.
 *
 * THIS FILE IS NOT PART OF THE PIPELINE. The tool never calls a model and holds no
 * credential (see README "语义由调用方提供"); this adapter exists to show, in ~150 lines
 * of zero-dependency JavaScript, how any host does that call itself.
 *
 * Two modes:
 *   - OpenAI-compatible HTTP when DIAGRAM_ADAPTER_API_KEY is set (POST {base}/chat/completions).
 *   - Deterministic offline mock when it is not, so the demo runs with no key and CI runs
 *     with no network. The mock extracts a usecase diagram from the task's own request
 *     text — it is deliberately crude and must never be mistaken for a working planner.
 *
 * Usage:
 *   node examples/adapter/adapter.mjs <task.json> <answer.json>
 *
 * OpenAI-compatible config (all optional except API key):
 *   DIAGRAM_ADAPTER_API_KEY   enables the HTTP mode
 *   DIAGRAM_ADAPTER_BASE_URL  default https://api.openai.com/v1
 *   DIAGRAM_ADAPTER_MODEL     default gpt-4o-mini
 */

import fs from 'node:fs/promises';

const ARGV = process.argv.slice(2);
const MODEL = process.env.DIAGRAM_ADAPTER_MODEL || 'gpt-4o-mini';
const BASE_URL = (process.env.DIAGRAM_ADAPTER_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
const API_KEY = process.env.DIAGRAM_ADAPTER_API_KEY;

const fail = (message, hint) => {
  process.stderr.write(`[adapter] ${message}${hint ? `\n  hint: ${hint}` : ''}\n`);
  process.exit(1);
};

if (ARGV.length !== 2) {
  fail('needs exactly two arguments: <task.json> <answer.json>', 'node examples/adapter/adapter.mjs task.json answer.json');
}

/** First user text in the task, which is where the request itself lives. */
function requestText(task) {
  const user = task.messages.find((m) => m.role === 'user');
  if (!user) return '';
  const parts = Array.isArray(user.content) ? user.content : [{ type: 'text', text: String(user.content) }];
  const texts = parts.filter((p) => p?.type === 'text').map((p) => String(p.text));
  return texts.join('\n');
}

/** Strips the "SOURCE <name> (<kind>):" framing, then the boilerplate line above it. */
function sourceValue(request, kind) {
  const marker = new RegExp(`SOURCE\\s+\\S+\\s+\\(${kind}\\):\\s*`, 'i');
  const at = request.search(marker);
  if (at === -1) return '';
  return request.slice(at).replace(marker, '').split('\n').filter(Boolean)[0] ?? '';
}

const ID_SAFE = (value, fallback) =>
  value.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || fallback;

/**
 * Mock planner: a usecase diagram straight out of the request sentence, with provenance
 * whose quote is an exact substring of the source (the one gate the project re-verifies
 * under `strict`, and the one that proves the answer came from the material).
 */
function mockPlan(request) {
  const ask = sourceValue(request, 'request');
  const cleaned = ask.replace(/^(画|请画|draw)\s*(一个|an?)\s*/i, '').replace(/用例图[:：]?/i, '').trim();
  const verbs = [...cleaned.matchAll(/可以([\u4e00-\u9fa5a-zA-Z0-9、,， ]+)/g)]
    .flatMap((m) => m[1].split(/[、,，\s]+/).filter(Boolean))
    .slice(0, 6);
  const usecases = verbs.length ? verbs : ['使用系统'];
  const title = cleaned.split(/[：:]/)[0].slice(0, 40) || 'Use Case Diagram';
  const id = ID_SAFE(title, 'usecase');

  const provenance = { source: 'request', quote: ask.slice(0, 60), confidence: 0.9 };
  const nodes = [
    { id: 'actor.user', label: 'User', kind: 'actor', provenance },
    ...usecases.map((text, i) => ({
      id: `usecase.${ID_SAFE(text, `u${i + 1}`)}`,
      label: text,
      kind: 'usecase',
      provenance,
    })),
  ];
  const edges = usecases.map((text, i) => ({
    id: `edge.user-${ID_SAFE(text, `u${i + 1}`)}`,
    source: 'actor.user',
    target: `usecase.${ID_SAFE(text, `u${i + 1}`)}`,
    type: 'association',
    provenance,
  }));

  return {
    diagram: { id, title, type: 'uml-usecase', nodes, edges },
    confidence: 0.85,
    uncertainties: [{ description: 'Mock adapter: use cases were split out of the request text mechanically, not understood.', blocking: false }],
  };
}

function extractJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = (fenced ? fenced[1] : text).trim();
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) fail('model returned no JSON object', text.slice(0, 400));
  return JSON.parse(raw.slice(start, end + 1));
}

async function callModel(task) {
  const messages = task.messages.filter((m) => m.role !== 'system');
  const response = await fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: 'system', content: task.system }, ...messages],
      temperature: 0,
    }),
  });
  if (!response.ok) {
    fail(`model request failed: HTTP ${response.status}`, `${BASE_URL}/chat/completions model=${MODEL} — ${(await response.text()).slice(0, 400)}`);
  }
  const body = await response.json();
  return extractJson(body.choices?.[0]?.message?.content ?? '');
}

const task = JSON.parse(await fs.readFile(ARGV[0], 'utf-8'));
if (!task.system || !Array.isArray(task.messages)) {
  fail('not a plan task file', 'produce one with: npm run generate -- --emit-plan <task.json> "<request>"');
}

const answer = API_KEY ? await callModel(task) : mockPlan(requestText(task));
const mode = API_KEY ? `OpenAI-compatible (${BASE_URL} model=${MODEL})` : 'offline mock (no DIAGRAM_ADAPTER_API_KEY)';

await fs.writeFile(ARGV[1], `${JSON.stringify(answer, null, 2)}\n`, 'utf-8');
process.stdout.write(`[adapter] answered via ${mode}\n`);
process.stdout.write(`[adapter] wrote ${ARGV[1]} — submit it with: npm run generate -- --plan ${ARGV[1]} --out <out-dir>\n`);
