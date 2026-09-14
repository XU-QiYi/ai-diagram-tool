import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { layoutDiagram } from '../src/layout/elk.js';
import { renderDrawio, renderSvg } from '../src/render/index.js';
import type { Diagram, Edge, Node } from '../src/model/types.js';

const toolRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = path.resolve(toolRoot, '..', 'docs', 'database-report-diagrams');

const entityStyle = { fill: '#FFFFFF', stroke: '#000000', text: '#000000', shape: 'shape=rectangle;rounded=0', fontSize: 18, strokeWidth: 1.4 };
const attributeStyle = { fill: '#FFFFFF', stroke: '#000000', text: '#000000', shape: 'shape=ellipse', fontSize: 16, strokeWidth: 1.2 };
const relationshipStyle = { fill: '#FFFFFF', stroke: '#000000', text: '#000000', shape: 'shape=rhombus', fontSize: 16, strokeWidth: 1.2 };
const tableStyle = { fill: '#FFFFFF', stroke: '#000000', text: '#000000', shape: 'shape=rectangle;rounded=0', fontSize: 16, strokeWidth: 1.3 };

const entityNode = (id: string, label: string): Node => ({ id: `entity.${id}`, label, kind: 'entity', style: entityStyle, width: 155, height: 62 });
const attributeNode = (entity: string, id: string, label: string, key = false): Node => ({
  id: `attribute.${entity}.${id}`,
  label,
  kind: key ? 'key-attribute' : 'attribute',
  style: attributeStyle,
  width: 150,
  height: 54,
});
const relationshipNode = (id: string, label: string): Node => ({ id: `relationship.${id}`, label, kind: 'relationship', style: relationshipStyle, width: 115, height: 66 });
const association = (id: string, source: string, target: string, label?: string): Edge => ({ id, source, target, type: 'association', label });

function coreEntityDiagram(): Diagram {
  const nodes: Node[] = [
    {
      id: 'entity.user', label: '用户实体\nPK id\nusername\nrole\ncredit_score', kind: 'database', style: tableStyle, width: 240, height: 165,
    },
    {
      id: 'entity.tool', label: '工具实体\nPK id\nFK owner_id\nname\ndeposit\nstatus', kind: 'database', style: tableStyle, width: 240, height: 180,
    },
    {
      id: 'entity.rental-order', label: '租借订单实体\nPK id\nFK tool_id\nFK borrower_id\nFK owner_id\nstart_time / end_time\nstatus\nreject_reason', kind: 'database', style: tableStyle, width: 270, height: 220,
    },
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
    layout: { density: 'balanced', nodeSpacing: 55, layerSpacing: 105, targetAspectRatio: 1.7 },
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
  ] as const;
  const attributeDefinitions = [
    ['user', 'id', '用户ID'],
    ['tool', 'id', '工具ID'],
    ['rental-order', 'id', '订单ID'],
  ] as const;
  const relationshipDefinitions = [
    ['publish', '发布', 'user', 'tool'],
    ['classify', '归类', 'category', 'tool'],
    ['borrow', '申请租借', 'user', 'rental-order'],
    ['create-order', '产生订单', 'tool', 'rental-order'],
    ['credit-change', '信用结算', 'rental-order', 'credit-log'],
    ['order-review', '形成评价', 'rental-order', 'review'],
    ['order-message', '触发消息', 'rental-order', 'message'],
  ] as const;
  const entityNodes = entityDefinitions.map(([id, label]) => entityNode(id, label));
  const attributeNodes = attributeDefinitions.map(([entity, id, label]) => attributeNode(entity, id, label, true));
  const relationshipNodes = relationshipDefinitions.map(([id, label]) => relationshipNode(id, label));
  const nodes: Node[] = [...entityNodes, ...attributeNodes, ...relationshipNodes];
  const edges: Edge[] = [
    ...attributeDefinitions.map(([entity, id]) => association(`attribute-edge.${entity}.${id}`, `entity.${entity}`, `attribute.${entity}.${id}`)),
    ...relationshipDefinitions.flatMap(([id, , source, target]) => [
      association(`relationship-edge.${id}.source`, `entity.${source}`, `relationship.${id}`, '1'),
      association(`relationship-edge.${id}.target`, `relationship.${id}`, `entity.${target}`, 'N'),
    ]),
  ];
  return {
    id: '02-full-er',
    title: '社区闲置工具共享租借平台 E-R 关系图',
    type: 'chen-er',
    direction: 'LEFT_TO_RIGHT',
    routing: 'POLYLINE',
    layout: { density: 'balanced', nodeSpacing: 65, layerSpacing: 90, targetAspectRatio: 1.4 },
    theme: { name: 'monochrome', showLegend: false },
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
  const logicalTableStyle = { ...tableStyle, fontSize: 20 };
  const nodes: Node[] = [
    { id: 'table.user', label: 'user 用户表\nPK id\nUQ username\npassword\nphone\navatar\nrole\ncredit_score\nstatus\ncreate_time', kind: 'database', style: logicalTableStyle, width: 250, height: 250 },
    { id: 'table.category', label: 'category 分类表\nPK id\nname\nicon', kind: 'database', style: logicalTableStyle, width: 230, height: 135 },
    { id: 'table.tool', label: 'tool 工具表\nPK id\nFK owner_id\nFK category_id\nname\nimages\ndescription\ndeposit\nstatus\ncreate_time', kind: 'database', style: logicalTableStyle, width: 250, height: 250 },
    { id: 'table.rental-order', label: 'rental_order 租借订单表\nPK id\nFK tool_id\nFK borrower_id\nFK owner_id\nstart_time\nend_time\nactual_return_time\nstatus\npurpose\nreject_reason\ncreate_time', kind: 'database', style: logicalTableStyle, width: 280, height: 295 },
    { id: 'table.credit-log', label: 'credit_log 信用记录表\nPK id\nFK user_id\nFK order_id\nchange_score\nreason\ncreate_time', kind: 'database', style: logicalTableStyle, width: 250, height: 195 },
    { id: 'table.review', label: 'review 评价表\nPK id\nFK order_id\nFK user_id\nrating\ncontent\ncreate_time', kind: 'database', style: logicalTableStyle, width: 240, height: 195 },
    { id: 'table.message', label: 'message 消息通知表\nPK id\nFK user_id\nFK order_id\ncontent\nis_read\ncreate_time', kind: 'database', style: logicalTableStyle, width: 250, height: 195 },
  ];
  const relation = (id: string, source: string, target: string, label: string): Edge => ({
    id,
    source,
    target,
    type: 'foreign-key',
    label: undefined,
    sourceMultiplicity: '1',
    targetMultiplicity: '0..*',
  });
  const edges: Edge[] = [
    relation('fk.tool.owner', 'table.user', 'table.tool', 'owner_id'),
    relation('fk.tool.category', 'table.category', 'table.tool', 'category_id'),
    relation('fk.order.tool', 'table.tool', 'table.rental-order', 'tool_id'),
    relation('fk.order.user', 'table.user', 'table.rental-order', 'borrower_id / owner_id'),
    relation('fk.credit.order', 'table.rental-order', 'table.credit-log', 'order_id'),
    relation('fk.review.order', 'table.rental-order', 'table.review', 'order_id'),
    relation('fk.message.order', 'table.rental-order', 'table.message', 'order_id'),
  ];
  return {
    id: '03-logical-schema',
    title: '社区闲置工具共享租借平台逻辑关系模式图',
    type: 'er',
    direction: 'TOP_TO_BOTTOM',
    routing: 'ORTHOGONAL',
    layout: { density: 'balanced', nodeSpacing: 65, layerSpacing: 85, targetAspectRatio: 0.85 },
    theme: { name: 'monochrome', showLegend: false },
    nodes,
    edges,
    er: { entities: nodes.map((node) => ({ nodeId: node.id })) },
  };
}

async function writeDiagram(diagram: Diagram): Promise<{ id: string; warnings: string[]; nodes: number; edges: number; iterations: number }> {
  const layout = await layoutDiagram(diagram);
  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(path.join(outputDir, `${diagram.id}.model.json`), JSON.stringify(diagram, null, 2), 'utf8');
  await fs.writeFile(path.join(outputDir, `${diagram.id}.drawio`), renderDrawio(layout), 'utf8');
  await fs.writeFile(path.join(outputDir, `${diagram.id}.svg`), renderSvg(layout), 'utf8');
  return { id: diagram.id, warnings: layout.warnings, nodes: layout.nodes.length, edges: layout.edges.length, iterations: layout.iterations };
}

async function main(): Promise<void> {
  const results = [];
  for (const diagram of [coreEntityDiagram(), fullErDiagram(), logicalDiagram()]) {
    results.push(await writeDiagram(diagram));
  }
  await fs.writeFile(path.join(outputDir, 'validation.json'), JSON.stringify(results, null, 2), 'utf8');
  for (const result of results) {
    console.log(`[DATABASE REPORT] ${result.id}: ${result.nodes} nodes, ${result.edges} edges, ${result.iterations} iteration(s)`);
    if (result.warnings.length) console.warn(`[DATABASE REPORT WARNING] ${result.id}: ${result.warnings.join('; ')}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
