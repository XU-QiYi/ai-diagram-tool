/**
 * Thesis E-R figure suite, built from the REAL schema (15 entities in
 * backend/src/main/java/com/toolshare/entity, foreign keys from the Flyway migrations
 * and the 2026-09-21 schema dump) - not from AGENTS.md, which still says 7 tables.
 *
 * Every figure is laid out and validated before it is written; the report prints
 * errors, minimum node gap and bend count per figure so "readable" is a number, not
 * an opinion.
 *
 *   npx tsx scripts/generate-thesis-er.ts [输出目录]
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDiagram } from '../src/model/index.js';
import { layoutDiagram } from '../src/layout/elk.js';
import { renderDrawio } from '../src/render/drawio.js';
import { renderSvg } from '../src/render/svg.js';
import type { Diagram } from '../src/model/types.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.resolve(process.argv.slice(2).find((a) => !a.startsWith('--')) ?? path.join(root, 'output', 'thesis-er'));
const BASE = { fill: '#FFFFFF', stroke: '#1F2937', text: '#111827' };

type Chen = { entities: Record<string, string>; attrs: Record<string, [string, string]>; rels: [label: string, a: string, ca: string, b: string, cb: string][] };

function chen(id: string, title: string, spec: Chen, options: { attributes?: boolean } = {}): Diagram {
  const withAttrs = options.attributes !== false;
  const nodes: any[] = [];
  const edges: any[] = [];
  const entityIds: string[] = [];
  const attributeIds: string[] = [];
  const relationshipIds: string[] = [];
  for (const [key, label] of Object.entries(spec.entities)) {
    entityIds.push(`entity.${key}`);
    nodes.push({ id: `entity.${key}`, label, kind: 'entity', style: { ...BASE, shape: 'shape=rectangle;rounded=0' }, width: 150, height: 64 });
  }
  if (withAttrs) {
    for (const [entity, [attrLabel, attrKind]] of Object.entries(spec.attrs)) {
      const aid = `attribute.${entity}-${attrLabel}`;
      attributeIds.push(aid);
      nodes.push({ id: aid, label: attrLabel, kind: attrKind === 'key' ? 'key-attribute' : 'attribute', style: { ...BASE, shape: 'shape=ellipse' } });
      edges.push({ id: `attr.${entity}-${attrLabel}`, source: `entity.${entity}`, target: aid, type: 'association' });
    }
  }
  for (const [label, a, ca, b, cb] of spec.rels) {
    const rid = `relationship.${label}`;
    if (!relationshipIds.includes(rid)) {
      relationshipIds.push(rid);
      nodes.push({ id: rid, label, kind: 'relationship', style: { ...BASE, shape: 'shape=rhombus' }, width: 110, height: 64 });
    }
    edges.push({ id: `chen.${a}-${label}`, source: `entity.${a}`, target: rid, label: ca, type: 'association' });
    edges.push({ id: `chen.${b}-${label}`, source: `entity.${b}`, target: rid, label: cb, type: 'association' });
  }
  return {
    id, title, type: 'chen-er', direction: 'LEFT_TO_RIGHT',
    layout: { density: 'balanced', targetAspectRatio: 1.25 },
    nodes, edges, chenEr: { entityIds, attributeIds, relationshipIds },
  } as unknown as Diagram;
}

const ENT = {
  user: '用户', tool: '工具', category: '分类', order: '租借订单', review: '评价',
  creditlog: '信用记录', message: '消息通知', dispute: '纠纷', event: '订单事件',
  ordermsg: '订单留言', favorite: '收藏', report: '工具举报', appeal: '信用申诉', rule: '信用规则',
};

// ---------- 1) overview: 8 entities, 8 relationships, deliberately no attributes ----------
const overview = chen('er-overview', '总体 E-R 图（核心实体与联系）', {
  entities: { user: ENT.user, tool: ENT.tool, category: ENT.category, order: ENT.order, review: ENT.review, creditlog: ENT.creditlog, message: ENT.message, dispute: ENT.dispute },
  attrs: {},
  rels: [
    ['发布', 'user', '1', 'tool', 'N'],
    ['归类', 'tool', 'N', 'category', '1'],
    ['承租', 'user', '1', 'order', 'N'],
    ['涉及', 'order', 'N', 'tool', '1'],
    ['评价', 'order', '1', 'review', '1'],
    ['记分', 'order', '1', 'creditlog', 'N'],
    ['通知', 'order', '1', 'message', 'N'],
    ['仲裁', 'order', '1', 'dispute', '1'],
  ],
}, { attributes: false });

// ---------- 2) four module diagrams with attributes ----------
const mUserTool = chen('er-m1-user-tool', '用户与工具模块 E-R 图', {
  entities: { user: ENT.user, tool: ENT.tool, category: ENT.category },
  attrs: {
    user: ['用户名', 'key'], tool: ['工具名称', 'normal'], category: ['分类名称', 'normal'],
  },
  rels: [
    ['发布', 'user', '1', 'tool', 'N'],
    ['归类', 'tool', 'N', 'category', '1'],
    ['收藏', 'user', 'M', 'tool', 'N'],
  ],
});
const mOrder = chen('er-m2-order', '订单与流转模块 E-R 图', {
  entities: { user: ENT.user, tool: ENT.tool, order: ENT.order, event: ENT.event, ordermsg: ENT.ordermsg },
  attrs: {
    order: ['订单ID', 'key'], event: ['事件类型', 'normal'], ordermsg: ['留言内容', 'normal'],
  },
  rels: [
    ['承租', 'user', '1', 'order', 'N'],
    ['出借', 'tool', '1', 'order', 'N'],
    ['产生', 'order', '1', 'event', 'N'],
    ['沟通', 'order', '1', 'ordermsg', 'N'],
  ],
});
const mCredit = chen('er-m3-credit', '信用与申诉模块 E-R 图', {
  entities: { user: ENT.user, order: ENT.order, creditlog: ENT.creditlog, rule: ENT.rule, appeal: ENT.appeal },
  attrs: {
    creditlog: ['变动分值', 'normal'], rule: ['可租门槛', 'normal'], appeal: ['申诉理由', 'normal'],
  },
  rels: [
    ['记分', 'user', '1', 'creditlog', 'N'],
    ['因单', 'order', '1', 'creditlog', 'N'],
    ['依据', 'creditlog', 'N', 'rule', '1'],
    ['申诉', 'user', '1', 'appeal', 'N'],
  ],
});
const mInteraction = chen('er-m4-interaction', '评价、举报与消息模块 E-R 图', {
  entities: { user: ENT.user, order: ENT.order, review: ENT.review, report: ENT.report, dispute: ENT.dispute, message: ENT.message },
  attrs: {
    review: ['评分', 'normal'], report: ['举报理由', 'normal'], message: ['消息标题', 'normal'],
  },
  rels: [
    ['评价', 'order', '1', 'review', '1'],
    ['举报', 'user', '1', 'report', 'N'],
    ['仲裁', 'report', '1', 'dispute', '1'],
    ['通知', 'user', '1', 'message', 'N'],
  ],
});

// ---------- 3) logical schema: all 15 tables, key columns only ----------
type Col = { name: string; type: string; key?: 'PK' | 'FK' | 'UK' };
const schema: Record<string, { label: string; cols: Col[]; logical?: string[] }> = {
  user: { label: '用户表 user', cols: [{ name: 'id', type: 'BIGINT', key: 'PK' }, { name: 'username', type: 'VARCHAR(64)', key: 'UK' }] },
  category: { label: '分类表 category', cols: [{ name: 'id', type: 'BIGINT', key: 'PK' }] },
  tool: { label: '工具表 tool', cols: [{ name: 'id', type: 'BIGINT', key: 'PK' }, { name: 'owner_id', type: 'BIGINT', key: 'FK' }, { name: 'category_id', type: 'BIGINT', key: 'FK' }] },
  rental_order: { label: '租借订单 rental_order', cols: [{ name: 'id', type: 'BIGINT', key: 'PK' }, { name: 'tool_id', type: 'BIGINT', key: 'FK' }, { name: 'borrower_id', type: 'BIGINT', key: 'FK' }, { name: 'owner_id', type: 'BIGINT', key: 'FK' }] },
  review: { label: '评价表 review', cols: [{ name: 'id', type: 'BIGINT', key: 'PK' }, { name: 'order_id', type: 'BIGINT', key: 'FK' }, { name: 'user_id', type: 'BIGINT', key: 'FK' }, { name: 'order_id+user_id', type: '唯一', key: 'UK' }] },
  favorite: { label: '收藏表 favorite', cols: [{ name: 'id', type: 'BIGINT', key: 'PK' }, { name: 'user_id', type: 'BIGINT', key: 'FK' }, { name: 'tool_id', type: 'BIGINT', key: 'FK' }, { name: 'user_id+tool_id', type: '唯一', key: 'UK' }] },
  credit_log: { label: '信用记录 credit_log', cols: [{ name: 'id', type: 'BIGINT', key: 'PK' }, { name: 'user_id', type: 'BIGINT', key: 'FK' }, { name: 'order_id', type: 'BIGINT', key: 'FK' }] },
  order_event: { label: '订单事件 order_event', cols: [{ name: 'id', type: 'BIGINT', key: 'PK' }, { name: 'order_id', type: 'BIGINT', key: 'FK' }] },
  order_message: { label: '订单留言 order_message', cols: [{ name: 'id', type: 'BIGINT', key: 'PK' }, { name: 'order_id', type: 'BIGINT', key: 'FK' }, { name: 'user_id', type: 'BIGINT', key: 'FK' }] },
  message: { label: '消息表 message', cols: [{ name: 'id', type: 'BIGINT', key: 'PK' }, { name: 'user_id', type: 'BIGINT', key: 'FK' }, { name: 'order_id', type: 'BIGINT', key: 'FK' }] },
  credit_rule: { label: '信用规则 credit_rule', cols: [{ name: 'id', type: 'BIGINT', key: 'PK' }] },
  admin_operation_log: { label: '审计日志 admin_operation_log', cols: [{ name: 'id', type: 'BIGINT', key: 'PK' }], logical: ['admin_id→user'] },
  tool_report: { label: '工具举报 tool_report', cols: [{ name: 'id', type: 'BIGINT', key: 'PK' }, { name: 'tool_id+reporter_id', type: '唯一', key: 'UK' }], logical: ['tool_id→tool', 'reporter_id→user'] },
  credit_appeal: { label: '信用申诉 credit_appeal', cols: [{ name: 'id', type: 'BIGINT', key: 'PK' }], logical: ['user_id→user'] },
  dispute: { label: '纠纷仲裁 dispute', cols: [{ name: 'id', type: 'BIGINT', key: 'PK' }], logical: ['order_id→rental_order', 'user_id→user'] },
};
const physical: [string, string][] = [
  ['tool', 'user'], ['tool', 'category'], ['rental_order', 'tool'], ['rental_order', 'user'],
  ['review', 'rental_order'], ['review', 'user'], ['favorite', 'user'], ['favorite', 'tool'],
  ['credit_log', 'user'], ['credit_log', 'rental_order'], ['order_event', 'rental_order'],
  ['order_message', 'rental_order'], ['order_message', 'user'], ['message', 'user'], ['message', 'rental_order'],
];
const idOf = (t: string) => `table.${t}`;
// Pinning the hub table to the first layer removes all 5 crossings that every density
// and direction variant kept producing (measured: variant matrix in the spec).
const schemaDiagram = {
  id: 'er-schema', title: '逻辑关系模式图（仅列主键、外键与唯一键）', type: 'uml-class', direction: 'LEFT_TO_RIGHT',
  layout: { density: 'balanced', targetAspectRatio: 1.4 },
  constraints: { placement: { 'table.user': 'FIRST' } },
  nodes: Object.entries(schema).map(([t, s]) => ({
    id: idOf(t), label: s.label, kind: 'class',
    classMeta: { attributes: [...s.cols, ...(s.logical ?? []).map((l) => ({ name: l, type: '逻辑引用' }))] },
  })),
  edges: physical.map(([from, to]) => ({
    id: `fk.${from}-${to}`, source: idOf(from), target: idOf(to), type: 'association',
    sourceMultiplicity: '1', targetMultiplicity: '0..*',
  })),
} as unknown as Diagram;

function minGapPx(nodes: Array<{ x: number; y: number; width: number; height: number }>): number {
  let min = Number.POSITIVE_INFINITY;
  for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
    const a = nodes[i], b = nodes[j];
    const gap = Math.max(Math.max(b.x - (a.x + a.width), a.x - (b.x + b.width)), Math.max(b.y - (a.y + a.height), a.y - (b.y + b.height)));
    if (gap < min) min = gap;
  }
  return Number.isFinite(min) ? Math.round(min) : -1;
}

await fs.mkdir(out, { recursive: true });
const suite = [overview, mUserTool, mOrder, mCredit, mInteraction, schemaDiagram];
/**
 * Pick a density preset by shape first, gap second. Maximising the gap alone chose a
 * 0.73 aspect ratio for the interaction module - roomier, but a vertical snake that
 * cannot sit on a thesis page; the 1.42 alternative still keeps 32px between boxes.
 */
const rank = (layout: { width: number; height: number }) => {
  const ar = layout.width / layout.height;
  return ar >= 0.85 && ar <= 1.6 ? 1 : 0;
};
for (const model of suite) {
  let best: { density: string; layout: Awaited<ReturnType<typeof layoutDiagram>>; gap: number } | undefined;
  for (const density of ['balanced', 'spacious'] as const) {
    const diagram = createDiagram(JSON.parse(JSON.stringify({ ...model, layout: { ...(model.layout ?? {}), density } })));
    const layout = await layoutDiagram(diagram, 5);
    const candidate = { density, layout, gap: minGapPx(layout.nodes) };
    if (!best) { best = candidate; continue; }
    const shapeGain = rank(layout) - rank(best.layout);
    if (shapeGain > 0 || (shapeGain === 0 && candidate.gap > best.gap)) best = candidate;
  }
  const { layout, gap } = best;
  const errors = (layout.issues ?? []).filter((i) => i.severity === 'ERROR');
  const bends = layout.edges.reduce((n, e) => n + (e.sections?.[0]?.bendPoints?.length ?? 0), 0);
  const straight = layout.edges.filter((e) => e.sections?.length === 1 && !e.sections[0].bendPoints?.length).length;
  await fs.writeFile(path.join(out, `${model.id}.model.json`), JSON.stringify({ ...model, layout: { ...(model.layout ?? {}), density: best.density } }, null, 2), 'utf8');
  await fs.writeFile(path.join(out, `${model.id}.drawio`), renderDrawio(layout), 'utf8');
  await fs.writeFile(path.join(out, `${model.id}.svg`), renderSvg(layout), 'utf8');
  console.log(`${model.id.padEnd(18)} ${String(layout.nodes.length).padStart(2)} 节点 ${Math.round(layout.width)}x${Math.round(layout.height)} ar=${(layout.width / layout.height).toFixed(2)} density=${best.density.padEnd(9)} errors=${errors.length}${errors.length ? ' [' + [...new Set(errors.map((e) => e.code))].join(',') + ']' : ''} minGap=${gap}px 直线=${straight}/${layout.edges.length} 拐点=${bends}`);
}
console.log(`\nwrote ${suite.length} figures to ${out}`);
