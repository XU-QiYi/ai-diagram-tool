import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { layoutDiagram } from '../src/layout/elk.js';
import { renderDrawio, renderSvg } from '../src/render/index.js';
import type { Diagram, Edge, Node, Style } from '../src/model/types.js';

const require = createRequire(import.meta.url);
const toolRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = path.resolve(toolRoot, '..', 'docs', 'database-report-diagrams');

const svgPad = 10;
const rootPad = 30;
const compactTriggers = ['Node overlap', 'Edge through node', 'Canvas overflow', 'Text overflow'];

const base: Style = { fill: '#FFFFFF', stroke: '#000000', text: '#000000' };
const boxStyle: Style = { ...base, shape: 'shape=rectangle;rounded=0', fontSize: 10, lineHeight: 12, paddingX: 4, minWidth: 40, strokeWidth: 1.1 };
const entityStyle: Style = { ...base, shape: 'shape=rectangle;rounded=0', fontSize: 12, lineHeight: 13, paddingX: 4, minWidth: 52, minHeight: 24, strokeWidth: 1.2 };
const attributeStyle: Style = { ...base, shape: 'shape=ellipse', fontSize: 11, lineHeight: 12, paddingX: 4, minWidth: 56, minHeight: 22, strokeWidth: 1 };
const relationshipStyle: Style = { ...base, shape: 'shape=rhombus', fontSize: 11, lineHeight: 12, paddingX: 4, minWidth: 44, minHeight: 24, strokeWidth: 1.1 };

const entityNode = (ekey: string, label: string): Node => ({ id: `entity.${ekey}`, label, kind: 'entity', style: entityStyle, height: 24 });
const attributeNode = (ekey: string, idx: number, label: string, key = false): Node => ({
  id: `attribute.${ekey}.${idx}`, label, kind: key ? 'key-attribute' : 'attribute', style: attributeStyle, height: 22,
});
const relationshipNode = (id: string, label: string): Node => ({ id: `relationship.${id}`, label, kind: 'relationship', style: relationshipStyle, height: 24 });
const assoc = (id: string, source: string, target: string, label?: string): Edge => ({ id, source, target, type: 'association', label });

// ── module entity-attribute diagrams (Chen: entity + attributes, no relationship diamonds) ──
type ModEnt = { key: string; cn: string; attrs: string[] };
function moduleDiagram(id: string, title: string, ents: ModEnt[]): Diagram {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  for (const e of ents) {
    nodes.push(entityNode(e.key, `${e.cn}\n${e.key}`));
    e.attrs.forEach((a, i) => {
      const isKey = i === 0;
      nodes.push(attributeNode(e.key, i, a, isKey));
      edges.push(assoc(`ae.${e.key}.${i}`, `entity.${e.key}`, `attribute.${e.key}.${i}`));
    });
  }
  return {
    id, title, type: 'chen-er', direction: 'TOP_TO_BOTTOM', routing: 'ORTHOGONAL',
    layout: { density: 'balanced', nodeSpacing: 10, layerSpacing: 16, targetAspectRatio: 1.5, svgPad, rootPadding: rootPad, edgeLabelFontSize: 9, algorithm: 'layered', relayoutTriggers: compactTriggers },
    theme: { name: 'monochrome', showLegend: false },
    nodes, edges,
    chenEr: {
      entityIds: nodes.filter((n) => n.id.startsWith('entity.')).map((n) => n.id),
      attributeIds: nodes.filter((n) => n.id.startsWith('attribute.')).map((n) => n.id),
      relationshipIds: [],
    },
  };
}

// ── overall E-R (entities + relationships + PK attributes) ──
function fullErDiagram(): Diagram {
  const entities = [
    ['user', '用户'], ['category', '工具分类'], ['tool', '工具'], ['rental-order', '租借订单'],
    ['credit-log', '信用记录'], ['review', '评价'], ['message', '消息通知'], ['tool-report', '工具举报'],
    ['favorite', '工具收藏'], ['order-message', '订单留言'], ['order-event', '订单事件'],
    ['credit-rule', '信用规则'], ['admin-operation-log', '管理员操作日志'], ['credit-appeal', '信用申诉'],
    ['dispute', '纠纷仲裁'],
  ] as const;
  const attrs = [['user', '用户ID'], ['tool', '工具ID'], ['rental-order', '订单ID']] as const;
  const rels = [
    ['publish', '发布', 'user', 'tool', '1', 'N'],
    ['classify', '归类', 'category', 'tool', '1', 'N'],
    ['borrow', '申请', 'user', 'rental-order', '1', 'N'],
    ['create-order', '出借', 'tool', 'rental-order', '1', 'N'],
    ['credit-change', '结算', 'rental-order', 'credit-log', '1', 'N'],
    ['order-review', '评价', 'rental-order', 'review', '1', 'N'],
    ['order-msg-notify', '通知', 'rental-order', 'message', '1', 'N'],
    ['report', '举报', 'user', 'tool-report', '1', 'N'],
    ['reported', '被举报', 'tool', 'tool-report', '1', 'N'],
    ['favorite', '收藏', 'user', 'favorite', '1', 'N'],
    ['favorite-tool', '被收藏', 'tool', 'favorite', '1', 'N'],
    ['order-msg', '留言', 'rental-order', 'order-message', '1', 'N'],
    ['order-event-log', '记录', 'rental-order', 'order-event', '1', 'N'],
    ['appeal', '申诉', 'user', 'credit-appeal', '1', 'N'],
    ['dispute', '仲裁', 'rental-order', 'dispute', '1', '1'],
    ['admin-op', '操作', 'user', 'admin-operation-log', '1', 'N'],
  ] as const;
  const entityNodes = entities.map(([id, label]) => entityNode(id, label));
  const attrNodes = attrs.map(([e, a]) => attributeNode(e, 0, a, true));
  const relNodes = rels.map(([id, label]) => relationshipNode(id, label));
  const nodes: Node[] = [...entityNodes, ...attrNodes, ...relNodes];
  const edges: Edge[] = [
    ...attrs.map(([e]) => assoc(`aedge.${e}`, `entity.${e}`, `attribute.${e}.0`)),
    ...rels.flatMap(([id, , s, t, sc, tc]) => [
      assoc(`re.${id}.s`, `entity.${s}`, `relationship.${id}`, sc),
      assoc(`re.${id}.t`, `relationship.${id}`, `entity.${t}`, tc),
    ]),
  ];
  return {
    id: '4-8-full-er', title: '社区闲置工具共享租借平台 总体 E-R 图', type: 'chen-er',
    direction: 'TOP_TO_BOTTOM', routing: 'ORTHOGONAL',
    layout: { density: 'balanced', nodeSpacing: 9, layerSpacing: 14, targetAspectRatio: 1.3, svgPad, rootPadding: 26, edgeLabelFontSize: 9, algorithm: 'layered', relayoutTriggers: compactTriggers },
    theme: { name: 'monochrome', showLegend: false },
    constraints: { placement: { 'entity.credit-rule': 'LAST_SEPARATE' } },
    nodes, edges,
    chenEr: { entityIds: entityNodes.map((n) => n.id), attributeIds: attrNodes.map((n) => n.id), relationshipIds: relNodes.map((n) => n.id) },
  };
}

// ── logical schema (relational, crow's-foot FK) ──
function logicalDiagram(): Diagram {
  const tables: Array<[string, string, string[]]> = [
    ['user', 'user 用户表', ['PK id', 'UQ username']],
    ['category', 'category 分类表', ['PK id']],
    ['tool', 'tool 工具表', ['PK id', 'FK owner_id', 'FK category_id']],
    ['rental-order', 'rental_order 租借订单表', ['PK id', 'FK tool_id', 'FK borrower_id', 'FK owner_id']],
    ['credit-log', 'credit_log 信用记录表', ['PK id', 'FK user_id', 'FK order_id']],
    ['review', 'review 评价表', ['PK id', 'FK order_id', 'FK user_id', 'UQ order_id+user_id']],
    ['message', 'message 消息通知表', ['PK id', 'FK user_id', 'FK order_id']],
    ['favorite', 'favorite 工具收藏表', ['PK id', 'FK user_id', 'FK tool_id', 'UQ user_id+tool_id']],
    ['order-message', 'order_message 订单留言表', ['PK id', 'FK order_id', 'FK user_id']],
    ['order-event', 'order_event 订单事件流水表', ['PK id', 'FK order_id']],
    ['credit-rule', 'credit_rule 信用规则配置表', ['PK id', '单行配置 id=1']],
    ['admin-operation-log', 'admin_operation_log 审计日志表', ['PK id', '无外键(逻辑引用)']],
    ['tool-report', 'tool_report 工具违规举报表', ['PK id', '无外键(逻辑引用)', 'UQ tool_id+reporter_id']],
    ['credit-appeal', 'credit_appeal 信用分申诉表', ['PK id', '无外键(逻辑引用)']],
    ['dispute', 'dispute 订单纠纷仲裁表', ['PK id', '无外键(逻辑引用)', 'UQ order_id']],
  ];
  const nodes: Node[] = tables.map(([id, cn, lines]) => ({ id: `table.${id}`, label: [cn, ...lines].join('\n'), kind: 'database', style: boxStyle }));
  const rel = (id: string, s: string, t: string): Edge => ({ id, source: s, target: t, type: 'foreign-key', sourceMultiplicity: '1', targetMultiplicity: '0..*' });
  const edges: Edge[] = [
    rel('fk.tool.owner', 'table.user', 'table.tool'), rel('fk.tool.category', 'table.category', 'table.tool'),
    rel('fk.order.user', 'table.user', 'table.rental-order'), rel('fk.order.tool', 'table.tool', 'table.rental-order'),
    rel('fk.creditlog.user', 'table.user', 'table.credit-log'), rel('fk.creditlog.order', 'table.rental-order', 'table.credit-log'),
    rel('fk.review.user', 'table.user', 'table.review'), rel('fk.review.order', 'table.rental-order', 'table.review'),
    rel('fk.message.user', 'table.user', 'table.message'), rel('fk.message.order', 'table.rental-order', 'table.message'),
    rel('fk.favorite.user', 'table.user', 'table.favorite'), rel('fk.favorite.tool', 'table.tool', 'table.favorite'),
    rel('fk.ordermsg.user', 'table.user', 'table.order-message'), rel('fk.ordermsg.order', 'table.rental-order', 'table.order-message'),
    rel('fk.orderevent.order', 'table.rental-order', 'table.order-event'),
  ];
  return {
    id: '5-1-logical', title: '社区闲置工具共享租借平台 逻辑关系模式图', type: 'er',
    direction: 'TOP_TO_BOTTOM', routing: 'ORTHOGONAL',
    layout: { density: 'balanced', nodeSpacing: 12, layerSpacing: 12, targetAspectRatio: 1.15, svgPad, rootPadding: 28, edgeLabelFontSize: 9, relayoutTriggers: compactTriggers },
    theme: { name: 'monochrome', showLegend: false },
    constraints: { placement: Object.fromEntries(['credit-rule', 'admin-operation-log', 'tool-report', 'credit-appeal', 'dispute'].map((id) => [`table.${id}`, 'LAST_SEPARATE'])) },
    nodes, edges, er: { entities: nodes.map((n) => ({ nodeId: n.id })) },
  };
}

// ── module definitions (compact: keep attrs/figure small so text stays readable) ──
const MODULES: Array<{ id: string; title: string; ents: ModEnt[] }> = [
  { id: '4-1-user', title: '用户模块实体图', ents: [
    { key: 'user', cn: '用户', attrs: ['用户ID', '用户名', '密码', '手机号', '角色', '信用分', '状态'] } ] },
  { id: '4-2-tool', title: '工具模块实体图', ents: [
    { key: 'category', cn: '工具分类', attrs: ['分类ID', '名称', '图标'] },
    { key: 'tool', cn: '工具', attrs: ['工具ID', '名称', '押金', '状态', '浏览量'] } ] },
  { id: '4-3-rental', title: '租借订单实体图', ents: [
    { key: 'rental-order', cn: '租借订单', attrs: ['订单ID', '起止时间', '状态', '应缴押金', '用途'] },
    { key: 'review', cn: '评价', attrs: ['评价ID', '总评分', '内容', '图片'] } ] },
  { id: '4-4-orderaux', title: '订单辅助实体图', ents: [
    { key: 'order-event', cn: '订单事件', attrs: ['事件ID', '事件类型', '操作人'] },
    { key: 'order-message', cn: '订单留言', attrs: ['留言ID', '内容'] },
    { key: 'dispute', cn: '纠纷仲裁', attrs: ['纠纷ID', '理由', '裁决状态'] } ] },
  { id: '4-5-credit', title: '信用模块实体图', ents: [
    { key: 'credit-log', cn: '信用记录', attrs: ['记录ID', '变动分值', '原因'] },
    { key: 'credit-rule', cn: '信用规则', attrs: ['规则ID', '可租门槛', '按时加分', '逾期扣分'] },
    { key: 'credit-appeal', cn: '信用申诉', attrs: ['申诉ID', '理由', '状态'] } ] },
  { id: '4-6-message', title: '消息模块实体图', ents: [
    { key: 'message', cn: '消息通知', attrs: ['消息ID', '标题', '内容', '已读状态', '类型'] } ] },
  { id: '4-7-admin', title: '管理模块实体图', ents: [
    { key: 'admin-operation-log', cn: '操作日志', attrs: ['日志ID', '操作类型', '目标', '详情'] },
    { key: 'tool-report', cn: '工具举报', attrs: ['举报ID', '理由', '处置状态'] } ] },
];

async function convertPng(diagramId: string) {
  let sharp: any;
  try { sharp = require('sharp'); } catch {
    const modules = process.env.MIMO_NODE_MODULES;
    if (!modules) throw new Error('sharp not resolvable and MIMO_NODE_MODULES is not set');
    sharp = require(path.join(modules, 'sharp'));
  }
  const svgPath = path.join(outputDir, `${diagramId}.svg`);
  const svg = await fs.readFile(svgPath, 'utf8');
  const width = Number(/width="(\d+)"/.exec(svg)?.[1]);
  const height = Number(/height="(\d+)"/.exec(svg)?.[1]);
  const png = await sharp(Buffer.from(svg), { density: 216 }).flatten({ background: '#FFFFFF' }).png().toFile(`${svgPath.replace(/\.svg$/, '.png')}`);
  return { width: png.width, height: png.height, svgWidth: width, svgHeight: height };
}

async function writeDiagram(diagram: Diagram) {
  const layout = await layoutDiagram(diagram);
  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(path.join(outputDir, `${diagram.id}.model.json`), JSON.stringify(diagram, null, 2), 'utf8');
  await fs.writeFile(path.join(outputDir, `${diagram.id}.drawio`), renderDrawio(layout), 'utf8');
  await fs.writeFile(path.join(outputDir, `${diagram.id}.svg`), renderSvg(layout), 'utf8');
  const png = await convertPng(diagram.id);
  console.log(`[CONCEPT] ${diagram.id}: ${layout.nodes.length}n/${layout.edges.length}e, svg ${png.svgWidth}x${png.svgHeight}, png ${png.width}x${png.height}${(layout.warnings?.length ? ' WARN: ' + layout.warnings.join('; ') : '')}`);
}

async function main() {
  for (const m of MODULES) await writeDiagram(moduleDiagram(m.id, m.title, m.ents));
  await writeDiagram(fullErDiagram());
  await writeDiagram(logicalDiagram());
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
