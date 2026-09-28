/**
 * Generates the ER figure suite for the tool-share system: one concept overview, one
 * table-relationship diagram, and one Chen sub-diagram per table. Every diagram is laid
 * out and checked before it is written, so a figure that would ship broken is reported
 * instead of silently emitted.
 *
 *   npm run diagram -- --suite        (or)  npx tsx scripts/generate-er-suite.ts
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
const out = path.resolve(process.argv[2] ?? path.join(root, 'output', 'er-suite'));

const BASE = { fill: '#FFFFFF', stroke: '#1F2937', text: '#111827' };
type Field = { name: string; type: string; key?: 'PK' | 'FK' | 'UK' };
type Table = { key: string; label: string; fields: Field[] };
type Relation = { label: string; from: string; fromCard: string; to: string; toCard: string };

const tables: Table[] = [
  { key: 'user', label: '用户', fields: [
    { name: 'user_id', type: 'BIGINT', key: 'PK' }, { name: 'username', type: 'VARCHAR(64)', key: 'UK' },
    { name: 'password_hash', type: 'VARCHAR(255)' }, { name: 'role', type: 'VARCHAR(32)' },
    { name: 'credit_score', type: 'INT' }, { name: 'status', type: 'VARCHAR(32)' }] },
  { key: 'tool', label: '工具', fields: [
    { name: 'tool_id', type: 'BIGINT', key: 'PK' }, { name: 'category_id', type: 'BIGINT', key: 'FK' },
    { name: 'owner_id', type: 'BIGINT', key: 'FK' }, { name: 'name', type: 'VARCHAR(128)' },
    { name: 'description', type: 'TEXT' }, { name: 'deposit', type: 'DECIMAL(10,2)' },
    { name: 'daily_rate', type: 'DECIMAL(10,2)' }, { name: 'total_count', type: 'INT' },
    { name: 'available_count', type: 'INT' }, { name: 'status', type: 'VARCHAR(32)' }] },
  { key: 'category', label: '分类', fields: [
    { name: 'category_id', type: 'BIGINT', key: 'PK' }, { name: 'name', type: 'VARCHAR(64)', key: 'UK' },
    { name: 'icon', type: 'VARCHAR(64)' }, { name: 'sort_order', type: 'INT' }, { name: 'status', type: 'VARCHAR(32)' }] },
  { key: 'order', label: '租借订单', fields: [
    { name: 'order_id', type: 'BIGINT', key: 'PK' }, { name: 'tool_id', type: 'BIGINT', key: 'FK' },
    { name: 'borrower_id', type: 'BIGINT', key: 'FK' }, { name: 'start_date', type: 'DATETIME' },
    { name: 'end_date', type: 'DATETIME' }, { name: 'actual_return', type: 'DATETIME' },
    { name: 'status', type: 'VARCHAR(32)' }, { name: 'overdue', type: 'TINYINT(1)' }, { name: 'cancel_reason', type: 'VARCHAR(255)' }] },
  { key: 'review', label: '评价', fields: [
    { name: 'review_id', type: 'BIGINT', key: 'PK' }, { name: 'order_id', type: 'BIGINT', key: 'FK' },
    { name: 'rating', type: 'TINYINT' }, { name: 'content', type: 'TEXT' }, { name: 'anonymous', type: 'TINYINT(1)' }] },
  { key: 'creditlog', label: '信用日志', fields: [
    { name: 'log_id', type: 'BIGINT', key: 'PK' }, { name: 'user_id', type: 'BIGINT', key: 'FK' },
    { name: 'delta', type: 'INT' }, { name: 'reason', type: 'VARCHAR(255)' }] },
  { key: 'notification', label: '消息通知', fields: [
    { name: 'notification_id', type: 'BIGINT', key: 'PK' }, { name: 'user_id', type: 'BIGINT', key: 'FK' },
    { name: 'title', type: 'VARCHAR(128)' }, { name: 'body', type: 'TEXT' }, { name: 'is_read', type: 'TINYINT(1)' }] },
];

const relations: Relation[] = [
  { label: '发布', from: 'user', fromCard: '1', to: 'tool', toCard: 'N' },
  { label: '归属', from: 'tool', fromCard: 'N', to: 'category', toCard: '1' },
  { label: '下单', from: 'user', fromCard: '1', to: 'order', toCard: 'N' },
  { label: '涉及', from: 'order', fromCard: 'N', to: 'tool', toCard: '1' },
  { label: '获得', from: 'order', fromCard: '1', to: 'review', toCard: '1' },
  { label: '记入', from: 'user', fromCard: '1', to: 'creditlog', toCard: 'N' },
  { label: '接收', from: 'user', fromCard: '1', to: 'notification', toCard: 'N' },
  { label: '触发', from: 'order', fromCard: '1', to: 'notification', toCard: 'N' },
];

const label = (key: string) => tables.find((t) => t.key === key)!.label;

function conceptDiagram(): Diagram {
  const nodes: any[] = [];
  const edges: any[] = [];
  const entityIds: string[] = [];
  const relationshipIds: string[] = [];
  for (const t of tables) {
    entityIds.push(`entity.${t.key}`);
    nodes.push({ id: `entity.${t.key}`, label: t.label, kind: 'entity', style: { ...BASE, shape: 'shape=rectangle;rounded=0' }, width: 150, height: 64 });
  }
  for (const r of relations) {
    const rid = `relationship.${r.label}`;
    relationshipIds.push(rid);
    nodes.push({ id: rid, label: r.label, kind: 'relationship', style: { ...BASE, shape: 'shape=rhombus' }, width: 110, height: 64 });
    edges.push({ id: `chen.${r.from}-${r.label}`, source: `entity.${r.from}`, target: rid, label: r.fromCard, type: 'association' });
    edges.push({ id: `chen.${r.to}-${r.label}`, source: `entity.${r.to}`, target: rid, label: r.toCard, type: 'association' });
  }
  return { id: 'er-00-concept', title: '概念结构总图', type: 'chen-er', direction: 'LEFT_TO_RIGHT', layout: { density: 'balanced', targetAspectRatio: 1.3 }, nodes, edges, chenEr: { entityIds, relationshipIds, attributeIds: [] } } as Diagram;
}

function schemaDiagram(): Diagram {
  const nodes = tables.map((t) => ({
    id: `table.${t.key}`, label: `${t.label}（${t.key}）`, kind: 'class',
    classMeta: { attributes: t.fields.map((f) => ({ name: f.name, type: f.type, key: f.key })) },
  }));
  const edges = relations.map((r) => ({
    id: `fk.${r.from}-${r.to}`, source: `table.${r.from}`, target: `table.${r.to}`, type: 'association',
    label: r.label, sourceMultiplicity: r.fromCard === '1' ? '1' : '0..*', targetMultiplicity: r.toCard === '1' ? '1' : '0..*',
  }));
  return { id: 'er-01-schema', title: '表关系总图（含字段与主外键）', type: 'uml-class', direction: 'LEFT_TO_RIGHT', layout: { density: 'balanced', targetAspectRatio: 1.35 }, nodes, edges } as unknown as Diagram;
}

/** One table and its own attributes, plus the relations it takes part in. */
function tableDiagram(table: Table): Diagram {
  const nodes: any[] = [{ id: `entity.${table.key}`, label: table.label, kind: 'entity', style: { ...BASE, shape: 'shape=rectangle;rounded=0' }, width: 150, height: 64 }];
  const edges: any[] = [];
  const entityIds = [`entity.${table.key}`];
  const attributeIds: string[] = [];
  const relationshipIds: string[] = [];
  for (const f of table.fields) {
    const aid = `attribute.${table.key}-${f.name}`;
    attributeIds.push(aid);
    nodes.push({ id: aid, label: f.name, kind: f.key === 'PK' ? 'key-attribute' : 'attribute', style: { ...BASE, shape: 'shape=ellipse' } });
    edges.push({ id: `attr.${table.key}-${f.name}`, source: `entity.${table.key}`, target: aid, type: 'association' });
  }
  for (const r of relations.filter((x) => x.from === table.key || x.to === table.key)) {
    const other = r.from === table.key ? r.to : r.from;
    const card = r.from === table.key ? r.toCard : r.fromCard;
    const rid = `relationship.${r.label}`;
    if (!relationshipIds.includes(rid)) {
      relationshipIds.push(rid);
      nodes.push({ id: rid, label: r.label, kind: 'relationship', style: { ...BASE, shape: 'shape=rhombus' }, width: 110, height: 64 });
    }
    if (!entityIds.includes(`entity.${other}`)) {
      entityIds.push(`entity.${other}`);
      nodes.push({ id: `entity.${other}`, label: label(other), kind: 'entity', style: { ...BASE, shape: 'shape=rectangle;rounded=0', dashed: true }, width: 150, height: 64 });
    }
    edges.push({ id: `chen.${other}-${r.label}`, source: `entity.${other}`, target: rid, label: other === r.from ? r.fromCard : r.toCard, type: 'association' });
    edges.push({ id: `chen.${table.key}-${r.label}.${other}`, source: `entity.${table.key}`, target: rid, label: card, type: 'association' });
  }
  return {
    id: `er-${tables.indexOf(table) + 2}-${table.key}`, title: `${table.label} 实体局部图`, type: 'chen-er',
    direction: 'LEFT_TO_RIGHT', layout: { density: 'balanced', targetAspectRatio: 1.2 },
    nodes, edges, chenEr: { entityIds, attributeIds, relationshipIds },
  } as unknown as Diagram;
}

await fs.mkdir(out, { recursive: true });
const suite = [conceptDiagram(), schemaDiagram(), ...tables.map(tableDiagram)];
const summary: string[] = [];
for (const model of suite) {
  const diagram = createDiagram(JSON.parse(JSON.stringify(model)));
  const layout = await layoutDiagram(diagram, 5);
  const errors = (layout.issues ?? []).filter((i) => i.severity === 'ERROR');
  await fs.writeFile(path.join(out, `${model.id}.model.json`), JSON.stringify(model, null, 2), 'utf8');
  await fs.writeFile(path.join(out, `${model.id}.drawio`), renderDrawio(layout), 'utf8');
  await fs.writeFile(path.join(out, `${model.id}.svg`), renderSvg(layout), 'utf8');
  summary.push(`${model.id.padEnd(22)} ${String(diagram.nodes.length).padStart(2)} 节点 ${Math.round(layout.width)}x${Math.round(layout.height)} iter=${layout.iterations} errors=${errors.length}${errors.length ? ' ' + [...new Set(errors.map((e) => e.code))].join(',') : ''}`);
}
console.log(summary.join('\n'));
console.log(`\nwrote ${suite.length} figures to ${out}`);
