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

// ── 版式规格（Word 17cm 版心直接插图，缩放比 ≥0.9，有效字号 ≥7pt）──────────────
// 中文实体/表名 11px；框内列名 10px；基数与边标签 9px；行高 12；黑白线框、无阴影。
const svgPad = 10; // SVG 四周留白（默认 80 会白白撑大画布）
const rootPad = 32; // ELK 图内边距（顶部需容纳 20px 标题）
const compactTriggers = ['Node overlap', 'Edge through node', 'Canvas overflow', 'Text overflow'];

const base: Style = { fill: '#FFFFFF', stroke: '#000000', text: '#000000' };
const boxStyle: Style = { ...base, shape: 'shape=rectangle;rounded=0', fontSize: 10, lineHeight: 12, paddingX: 4, minWidth: 40, strokeWidth: 1.1 };
const entityStyle: Style = { ...base, shape: 'shape=rectangle;rounded=0', fontSize: 11, lineHeight: 12, paddingX: 4, minWidth: 50, minHeight: 22, strokeWidth: 1.1 };
const attributeStyle: Style = { ...base, shape: 'shape=ellipse', fontSize: 11, lineHeight: 12, paddingX: 4, minWidth: 56, minHeight: 22, strokeWidth: 1 };
const relationshipStyle: Style = { ...base, shape: 'shape=rhombus', fontSize: 11, lineHeight: 12, paddingX: 4, minWidth: 44, minHeight: 24, strokeWidth: 1 };

const entityNode = (id: string, label: string): Node => ({ id: `entity.${id}`, label, kind: 'entity', style: entityStyle, height: 22 });
const attributeNode = (entity: string, id: string, label: string, key = false): Node => ({
  id: `attribute.${entity}.${id}`,
  label,
  kind: key ? 'key-attribute' : 'attribute',
  style: attributeStyle,
  height: 22,
});
const relationshipNode = (id: string, label: string): Node => ({ id: `relationship.${id}`, label, kind: 'relationship', style: relationshipStyle, height: 24 });
const association = (id: string, source: string, target: string, label?: string): Edge => ({ id, source, target, type: 'association', label });

function coreEntityDiagram(): Diagram {
  const nodes: Node[] = [
    { id: 'entity.user', label: '用户 user\nPK id\nusername\nrole\ncredit_score\ntoken_version\ncreate_time', kind: 'database', style: boxStyle },
    { id: 'entity.tool', label: '工具 tool\nPK id\nFK owner_id\nFK category_id\nname\ndeposit\nstatus\nview_count', kind: 'database', style: boxStyle },
    { id: 'entity.rental-order', label: '租借订单 rental_order\nPK id\nFK tool_id\nFK borrower_id\nFK owner_id\nstart_time / end_time\nextend_status\nstatus\ndeposit / deposit_original', kind: 'database', style: boxStyle },
  ];
  const edges: Edge[] = [
    { id: 'entity-edge.user-tool', source: 'entity.user', target: 'entity.tool', type: 'association', label: '发布 1:N', sourceMultiplicity: '1', targetMultiplicity: '0..*' },
    { id: 'entity-edge.user-order', source: 'entity.user', target: 'entity.rental-order', type: 'association', label: '借用/处理 1:N', sourceMultiplicity: '1', targetMultiplicity: '0..*' },
    { id: 'entity-edge.tool-order', source: 'entity.tool', target: 'entity.rental-order', type: 'association', label: '产生 1:N', sourceMultiplicity: '1', targetMultiplicity: '0..*' },
  ];
  return {
    id: '01-core-entities',
    title: '社区闲置工具共享租借平台核心实体属性图',
    type: 'er',
    direction: 'LEFT_TO_RIGHT',
    routing: 'ORTHOGONAL',
    layout: { density: 'balanced', nodeSpacing: 14, layerSpacing: 20, targetAspectRatio: 2.6, svgPad, rootPadding: rootPad, edgeLabelFontSize: 10, relayoutTriggers: compactTriggers },
    theme: { name: 'monochrome', showLegend: false },
    nodes,
    edges,
    er: { entities: nodes.map((node) => ({ nodeId: node.id })) },
  };
}

function fullErDiagram(): Diagram {
  const entityDefinitions = [
    ['user', '用户'],
    ['category', '工具分类'],
    ['tool', '工具'],
    ['rental-order', '租借订单'],
    ['credit-log', '信用记录'],
    ['review', '评价'],
    ['message', '消息通知'],
    ['tool-report', '工具举报'],
    ['favorite', '工具收藏'],
    ['order-message', '订单留言'],
    ['order-event', '订单事件'],
    ['credit-rule', '信用规则\n全局配置'],
    ['admin-operation-log', '管理员操作日志'],
    ['credit-appeal', '信用申诉'],
    ['dispute', '纠纷仲裁'],
  ] as const;
  const attributeDefinitions = [
    ['user', 'id', '用户ID'],
    ['tool', 'id', '工具ID'],
    ['rental-order', 'id', '订单ID'],
  ] as const;
  // [id, 名称, 源实体, 目标实体, 源端基数, 目标端基数]
  const relationshipDefinitions = [
    ['publish', '发布', 'user', 'tool', '1', 'N'],
    ['classify', '归类', 'category', 'tool', '1', 'N'],
    ['borrow', '申请', 'user', 'rental-order', '1', 'N'],
    ['create-order', '出借', 'tool', 'rental-order', '1', 'N'],
    ['credit-change', '结算', 'rental-order', 'credit-log', '1', 'N'],
    ['order-review', '评价', 'rental-order', 'review', '1', 'N'],
    ['order-message-send', '通知', 'rental-order', 'message', '1', 'N'],
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
  const entityNodes = entityDefinitions.map(([id, label]) => entityNode(id, label));
  const attributeNodes = attributeDefinitions.map(([entity, id, label]) => attributeNode(entity, id, label, true));
  const relationshipNodes = relationshipDefinitions.map(([id, label]) => relationshipNode(id, label));
  const nodes: Node[] = [...entityNodes, ...attributeNodes, ...relationshipNodes];
  const edges: Edge[] = [
    ...attributeDefinitions.map(([entity, id]) => association(`attribute-edge.${entity}.${id}`, `entity.${entity}`, `attribute.${entity}.${id}`)),
    ...relationshipDefinitions.flatMap(([id, , source, target, sourceCard, targetCard]) => [
      association(`relationship-edge.${id}.source`, `entity.${source}`, `relationship.${id}`, sourceCard),
      association(`relationship-edge.${id}.target`, `relationship.${id}`, `entity.${target}`, targetCard),
    ]),
  ];
  return {
    id: '02-full-er',
    title: '社区闲置工具共享租借平台 E-R 关系图',
    type: 'chen-er',
    direction: 'TOP_TO_BOTTOM',
    routing: 'ORTHOGONAL',
    layout: { density: 'balanced', nodeSpacing: 9, layerSpacing: 13, targetAspectRatio: 1.3, svgPad, rootPadding: 26, edgeLabelFontSize: 9, algorithm: 'layered', relayoutTriggers: compactTriggers },
    theme: { name: 'monochrome', showLegend: false },
    // 信用规则放到末列侧栏，与主图实体阵列隔离
    constraints: { placement: { 'entity.credit-rule': 'LAST_SEPARATE' } },
    nodes,
    edges,
    chenEr: {
      entityIds: entityNodes.map((node) => node.id),
      attributeIds: attributeNodes.map((node) => node.id),
      relationshipIds: relationshipNodes.map((node) => node.id),
    },
  };
}

function logicalDiagram(): Diagram {
  // 完整列定义由第 6 章表结构承担，此图只画 表名 + PK/FK/UQ + 治理表说明
  const tableDefinitions: Array<[id: string, title: string, lines: string[]]> = [
    ['user', 'user 用户表', ['PK id', 'UQ username']],
    ['category', 'category\n分类表', ['PK id']],
    ['tool', 'tool 工具表', ['PK id', 'FK owner_id', 'FK category_id']],
    ['rental-order', 'rental_order\n租借订单表', ['PK id', 'FK tool_id', 'FK borrower_id', 'FK owner_id']],
    ['credit-log', 'credit_log\n信用记录表', ['PK id', 'FK user_id', 'FK order_id']],
    ['review', 'review 评价表', ['PK id', 'FK order_id', 'FK user_id', 'UQ order_id+user_id']],
    ['message', 'message\n消息通知表', ['PK id', 'FK user_id', 'FK order_id']],
    ['favorite', 'favorite 工具收藏表', ['PK id', 'FK user_id', 'FK tool_id', 'UQ user_id+tool_id']],
    ['order-message', 'order_message\n订单留言表', ['PK id', 'FK order_id', 'FK user_id']],
    ['order-event', 'order_event\n订单事件流水表', ['PK id', 'FK order_id']],
    ['credit-rule', 'credit_rule\n信用规则配置表', ['PK id', '单行配置 id=1']],
    ['admin-operation-log', 'admin_operation_log\n管理员操作审计日志表', ['PK id', '无外键(逻辑引用)']],
    ['tool-report', 'tool_report\n工具违规举报表', ['PK id', '无外键(逻辑引用)', 'UQ tool_id+reporter_id']],
    ['credit-appeal', 'credit_appeal\n信用分申诉表', ['PK id', '无外键(逻辑引用)']],
    ['dispute', 'dispute\n订单纠纷仲裁表', ['PK id', '无外键(逻辑引用)', 'UQ order_id']],
  ];
  const nodes: Node[] = tableDefinitions.map(([id, cn, lines]) => ({
    id: `table.${id}`,
    label: [cn, ...lines].join('\n'),
    kind: 'database',
    style: boxStyle,
  }));
  const relation = (id: string, source: string, target: string): Edge => ({
    id,
    source,
    target,
    type: 'foreign-key',
    sourceMultiplicity: '1',
    targetMultiplicity: '0..*',
  });
  // 数据库层真实存在的 FOREIGN KEY 约束（borrower_id/owner_id 同为 user 引用，合并一条边，列名已在框内标注）
  const edges: Edge[] = [
    relation('fk.tool.owner', 'table.user', 'table.tool'),
    relation('fk.tool.category', 'table.category', 'table.tool'),
    relation('fk.order.user', 'table.user', 'table.rental-order'),
    relation('fk.order.tool', 'table.tool', 'table.rental-order'),
    relation('fk.creditlog.user', 'table.user', 'table.credit-log'),
    relation('fk.creditorder.order', 'table.rental-order', 'table.credit-log'),
    relation('fk.review.user', 'table.user', 'table.review'),
    relation('fk.review.order', 'table.rental-order', 'table.review'),
    relation('fk.message.user', 'table.user', 'table.message'),
    relation('fk.message.order', 'table.rental-order', 'table.message'),
    relation('fk.favorite.user', 'table.user', 'table.favorite'),
    relation('fk.favorite.tool', 'table.tool', 'table.favorite'),
    relation('fk.ordermsg.user', 'table.user', 'table.order-message'),
    relation('fk.ordermsg.order', 'table.rental-order', 'table.order-message'),
    relation('fk.orderevent.order', 'table.rental-order', 'table.order-event'),
  ];
  return {
    id: '03-logical-schema',
    title: '社区闲置工具共享租借平台逻辑关系模式图',
    type: 'er',
    direction: 'TOP_TO_BOTTOM',
    routing: 'ORTHOGONAL',
    layout: { density: 'balanced', nodeSpacing: 12, layerSpacing: 12, targetAspectRatio: 1.1, svgPad, rootPadding: 28, edgeLabelFontSize: 9, relayoutTriggers: compactTriggers },
    theme: { name: 'monochrome', showLegend: false },
    constraints: {
      // 无外键约束的 5 张治理/配置表统一压到末列，避免散点撑大画布
      placement: Object.fromEntries(
        ['credit-rule', 'admin-operation-log', 'tool-report', 'credit-appeal', 'dispute'].map((id) => [`table.${id}`, 'LAST_SEPARATE']),
      ),
    },
    nodes,
    edges,
    er: { entities: nodes.map((node) => ({ nodeId: node.id })) },
  };
}

async function convertPng(diagramId: string): Promise<{ width: number; height: number }> {
  let sharp: any;
  try {
    sharp = require('sharp');
  } catch {
    const modules = process.env.MIMO_NODE_MODULES;
    if (!modules) throw new Error('sharp not resolvable and MIMO_NODE_MODULES is not set');
    sharp = require(path.join(modules, 'sharp'));
  }
  const svgPath = path.join(outputDir, `${diagramId}.svg`);
  const svg = await fs.readFile(svgPath, 'utf8');
  const width = Number(/width="(\d+)"/.exec(svg)?.[1]);
  const height = Number(/height="(\d+)"/.exec(svg)?.[1]);
  if (!width || !height) throw new Error(`cannot read pixel size from ${svgPath}`);
  // density 72*3 => 原生尺寸 x3（Word 打印清晰度）
  const png = await sharp(Buffer.from(svg), { density: 216 })
    .flatten({ background: '#FFFFFF' })
    .png()
    .toFile(`${svgPath.replace(/\.svg$/, '.png')}`);
  return { width: png.width, height: png.height, svgWidth: width, svgHeight: height };
}

function effectiveFont(svgWidth: number, fontSizePx: number): string {
  // 插入 Word 版心 17cm(=643px@96dpi)：缩放比 = min(643/svgWidth, 1) 之上还会被放大，按 643/svgWidth 折算
  const scale = 643 / svgWidth;
  return (fontSizePx * scale * 0.75).toFixed(1);
}

async function writeDiagram(diagram: Diagram): Promise<Record<string, unknown>> {
  const layout = await layoutDiagram(diagram);
  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(path.join(outputDir, `${diagram.id}.model.json`), JSON.stringify(diagram, null, 2), 'utf8');
  await fs.writeFile(path.join(outputDir, `${diagram.id}.drawio`), renderDrawio(layout), 'utf8');
  await fs.writeFile(path.join(outputDir, `${diagram.id}.svg`), renderSvg(layout), 'utf8');
  const png = await convertPng(diagram.id);
  return {
    id: diagram.id,
    warnings: layout.warnings,
    nodes: layout.nodes.length,
    edges: layout.edges.length,
    iterations: layout.iterations,
    svg: { width: png.svgWidth, height: png.svgHeight },
    png: { width: png.width, height: png.height },
    effectivePtAt17cm: { box: effectiveFont(png.svgWidth, 10), entity: effectiveFont(png.svgWidth, 11), edgeLabel: effectiveFont(png.svgWidth, 9) },
  };
}

async function main(): Promise<void> {
  const results = [];
  for (const diagram of [coreEntityDiagram(), fullErDiagram(), logicalDiagram()]) {
    results.push(await writeDiagram(diagram));
  }
  await fs.writeFile(path.join(outputDir, 'validation.json'), JSON.stringify(results, null, 2), 'utf8');
  for (const result of results) {
    console.log(`[DATABASE REPORT] ${result.id}: ${result.nodes} nodes, ${result.edges} edges, ${result.iterations} iteration(s), svg ${result.svg.width}x${result.svg.height}, png ${result.png.width}x${result.png.height}, effPt ${JSON.stringify(result.effectivePtAt17cm)}`);
    if ((result.warnings as string[]).length) console.warn(`[DATABASE REPORT WARNING] ${result.id}: ${(result.warnings as string[]).join('; ')}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
