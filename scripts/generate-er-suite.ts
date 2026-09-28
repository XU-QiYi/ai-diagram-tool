/**
 * Complete ER figure set for the tool-share system, driven by scripts/er-schema.ts
 * (verified against the entities, the Flyway migrations and the 2026-09-21 schema dump).
 *
 * Five groups, each answering one question:
 *   er-00-concept      概念层总体 E-R：核心实体与联系，不画属性
 *   er-1x-module-*     分模块 E-R：该模块实体 + 联系 + 关键属性
 *   er-2x-<table>      每张表一张实体图：该表 + 它的全部属性 + 它参与的联系
 *   er-3x-module-cols  分模块表结构：全部列、类型、PK/FK/UK
 *   er-9x-schema       逻辑关系模式图：15 张表，只列主外键与唯一键
 *
 * Every figure is laid out and validated before it is written; the console prints
 * errors / min gap / bends per figure so nothing ships on an unverified claim.
 *
 *   npx tsx scripts/generate-er-suite.ts [输出目录]
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDiagram } from '../src/model/index.js';
import { layoutDiagram } from '../src/layout/elk.js';
import { renderDrawio } from '../src/render/drawio.js';
import { renderSvg } from '../src/render/svg.js';
import { AUDIT_COLUMNS, labelOf, modules, overviewRelations, relations, tableOf, tables } from './er-schema.js';
import type { Relation } from './er-schema.js';
import type { Diagram } from '../src/model/types.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.resolve(process.argv.slice(2).find((a) => !a.startsWith('--')) ?? path.join(root, 'output', 'er-suite'));
const BASE = { fill: '#FFFFFF', stroke: '#1F2937', text: '#111827' };
const attrLabel = (t: string, col: string) => `${t}-${col}`;

/** Chen diagram: entities, optional attribute ellipses, relationship diamonds. */
function chen(id: string, title: string, entityNames: string[], opts: {
  attributesFor?: string[]; attrFilter?: (t: string, col: string) => boolean; withRelations?: boolean; relationSet?: Relation[];
} = {}): Diagram {
  const nodes: any[] = [];
  const edges: any[] = [];
  const entityIds: string[] = [];
  const attributeIds: string[] = [];
  const relationshipIds: string[] = [];
  const involved = new Set(entityNames);
  for (const name of entityNames) {
    entityIds.push(`entity.${name}`);
    nodes.push({ id: `entity.${name}`, label: labelOf(name), kind: 'entity', style: { ...BASE, shape: 'shape=rectangle;rounded=0' }, width: 150, height: 64 });
  }
  for (const t of opts.attributesFor ?? []) {
    for (const c of tableOf(t).columns) {
      if (opts.attrFilter && !opts.attrFilter(t, c.name)) continue;
      const aid = `attribute.${attrLabel(t, c.name)}`;
      attributeIds.push(aid);
      nodes.push({ id: aid, label: c.name, kind: c.key === 'PK' ? 'key-attribute' : 'attribute', style: { ...BASE, shape: 'shape=ellipse' } });
      edges.push({ id: `attr.${attrLabel(t, c.name)}`, source: `entity.${t}`, target: aid, type: 'association' });
    }
  }
  if (opts.withRelations !== false) {
    for (const r of (opts.relationSet ?? relations).filter((x) => involved.has(x.a) && involved.has(x.b))) {
      const rid = `relationship.${r.name}`;
      if (!relationshipIds.includes(rid)) {
        relationshipIds.push(rid);
        nodes.push({ id: rid, label: r.name, kind: 'relationship', style: { ...BASE, shape: 'shape=rhombus' }, width: 110, height: 64 });
      }
      edges.push({ id: `chen.${r.name}.${r.a}`, source: `entity.${r.a}`, target: rid, label: r.cardA, type: 'association' });
      edges.push({ id: `chen.${r.name}.${r.b}`, source: `entity.${r.b}`, target: rid, label: r.cardB, type: 'association' });
    }
  }
  return { id, title, type: 'chen-er', direction: 'LEFT_TO_RIGHT', layout: { density: 'balanced', targetAspectRatio: 1.25 }, nodes, edges, chenEr: { entityIds, attributeIds, relationshipIds } } as unknown as Diagram;
}

/** uml-class diagram listing every column with its type and key role. */
function classDiagram(id: string, title: string, names: string[]): Diagram {
  return {
    id, title, type: 'uml-class', direction: 'LEFT_TO_RIGHT',
    layout: { density: 'balanced', targetAspectRatio: 1.35 },
    nodes: names.map((n) => ({
      id: `table.${n}`, label: `${labelOf(n)} ${n}`, kind: 'class',
      classMeta: { attributes: tableOf(n).columns.map((c) => ({ name: c.name, type: c.type, key: c.key })) },
    })),
    edges: relations.filter((r) => r.via.every((v) => names.includes(v.child)) && names.includes(r.a) && names.includes(r.b))
      .map((r) => ({ id: `rel.${r.name}`, source: `table.${r.via[0].child}`, target: `table.${r.a === r.via[0].child ? r.b : r.a}`, type: 'association', label: r.physical ? r.name : `${r.name}(逻辑)`, sourceMultiplicity: 'N', targetMultiplicity: '1' })),
  } as unknown as Diagram;
}

const CORE = ['user', 'tool', 'category', 'rental_order', 'review', 'credit_log', 'message', 'dispute'];
/** Key columns only: drawing every column of every table in a module E-R is what turns
 *  a 12-node figure into a 45-node one with negative gaps (measured). Full columns live
 *  in the per-table entity diagrams and the *-cols figures. */
const isKeyColumn = (col: string) => col === 'id' || col.endsWith('_id');
// Pinning the hub table to the first layer is the one structural lever measured to
// remove crossings on this engine (see docs/superpowers/specs/...-ai-led-drawing-authority.md §12/§16).
const pinHub = (model: Diagram): Diagram => ({ ...model, constraints: { ...(model.constraints ?? {}), placement: { 'entity.user': 'FIRST', 'table.user': 'FIRST' } } });

const suite: Diagram[] = [
  pinHub(chen('er-00-concept', '总体 E-R 图（核心实体与联系）', CORE, { relationSet: overviewRelations() })),
  // Only the module's own tables. Pulling "neighbours" as well makes user - a hub with ten
  // relations - drag in half the schema and turns a 15-node figure into a 42-node one.
  ...modules.map((m, i) => pinHub(chen(`er-1${i}-module-${m.id}`, `${m.title} E-R 图`, m.tables,
    { attributesFor: m.tables, attrFilter: (_t, c) => isKeyColumn(c) }))),
  // 教科书口径：实体图只画实体与其属性，联系留给分 E-R 图，所以这里不放菱形。
  ...tables.map((t, i) => chen(`er-2${String(i).padStart(2, '0')}-${t.name}-entity`, `${t.label}（${t.name}）实体图`, [t.name], { attributesFor: [t.name], withRelations: false, attrFilter: (_t, c) => !AUDIT_COLUMNS.has(c) })),
  ...modules.map((m, i) => classDiagram(`er-3${i}-module-${m.id}-cols`, `${m.title} 表结构`, m.tables)),
  pinHub(classDiagram('er-90-schema', '逻辑关系模式图（仅列主键、外键与唯一键）', tables.map((t) => t.name))),
];

function minGapPx(nodes: Array<{ x: number; y: number; width: number; height: number }>): number {
  let min = Number.POSITIVE_INFINITY;
  for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
    const a = nodes[i], b = nodes[j];
    min = Math.min(min, Math.max(Math.max(b.x - a.x - a.width, a.x - b.x - b.width), Math.max(b.y - a.y - a.height, a.y - b.y - b.height)));
  }
  return Number.isFinite(min) ? Math.round(min) : -1;
}

await fs.mkdir(out, { recursive: true });
const rows: string[] = [];
for (const model of suite) {
  let best: { label: string; layout: Awaited<ReturnType<typeof layoutDiagram>>; gap: number; score: number } | undefined;
  // uml-class lays out with layered, where direction is honoured; chen-er defaults to the
  // force-directed engine, where direction was measured to change nothing.
  const directions = model.type === 'uml-class' ? (['LEFT_TO_RIGHT', 'TOP_TO_BOTTOM'] as const) : [model.direction ?? 'LEFT_TO_RIGHT'];
  // A "one entity + fifteen attribute ellipses" figure is exactly where the force-directed
  // default starts throwing a line through a box, so layered competes for it too.
  const algorithms = model.type === 'chen-er' ? (['auto', 'layered'] as const) : ['auto'] as const;
  for (const direction of directions) for (const algorithm of algorithms) for (const density of ['balanced', 'spacious'] as const) {
    const diagram = createDiagram(JSON.parse(JSON.stringify({ ...model, direction, layout: { ...(model.layout ?? {}), algorithm, density } })));
    const layout = await layoutDiagram(diagram, 5);
    const ar = layout.width / layout.height;
    const gap = minGapPx(layout.nodes);
    const errors = (layout.issues ?? []).filter((i) => i.severity === 'ERROR').length;
    const score = -errors * 1e9 + (ar >= 0.8 && ar <= 1.7 ? 1e6 : 0) + gap;
    if (!best || score > best.score) best = { label: `${direction}/${algorithm}/${density}`, layout, gap, score };
  }
  const errors = (best.layout.issues ?? []).filter((i) => i.severity === 'ERROR');
  const bends = best.layout.edges.reduce((n, e) => n + (e.sections?.[0]?.bendPoints?.length ?? 0), 0);
  const chosen = best.layout.diagram;
  await fs.writeFile(path.join(out, `${model.id}.model.json`), JSON.stringify({ ...model, direction: chosen.direction, layout: { ...(model.layout ?? {}), algorithm: chosen.layout?.algorithm, density: chosen.layout?.density } }, null, 2), 'utf8');
  await fs.writeFile(path.join(out, `${model.id}.drawio`), renderDrawio(best.layout), 'utf8');
  await fs.writeFile(path.join(out, `${model.id}.svg`), renderSvg(best.layout), 'utf8');
  rows.push(`${model.id.padEnd(30)} ${String(best.layout.nodes.length).padStart(2)} 节点 ${Math.round(best.layout.width)}x${Math.round(best.layout.height)} ar=${(best.layout.width / best.layout.height).toFixed(2)} ${best.label.padEnd(20)} errors=${errors.length}${errors.length ? ' [' + [...new Set(errors.map((e) => e.code))].join(',') + ']' : ''} minGap=${best.gap}px 拐点=${bends}`);
}
console.log(rows.join('\n'));
const bad = rows.filter((r) => !r.includes('errors=0')).length;
console.log(`\n${suite.length} figures -> ${out}；其中 ${suite.length - bad} 张 0 错误，${bad} 张仍有问题。`);
