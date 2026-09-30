import fs from 'node:fs/promises';
import path from 'node:path';
import { createDiagram } from '../src/model/index.js';
import { layoutDiagram } from '../src/layout/elk.js';
import { renderDrawio, renderSvg } from '../src/render/index.js';
import type { Diagram, Node, Edge, Style } from '../src/model/types.js';

// Keep every generated artifact inside this project folder.
const outDir = path.resolve('output', 'drawio-tool');
const blackWhite: Style = { fill: '#FFFFFF', stroke: '#000000', text: '#000000', fontSize: 16 };
const actorStyle: Style = { ...blackWhite, shape: 'shape=umlActor' };
const boxStyle: Style = { ...blackWhite, shape: 'rounded=1' };
const decisionStyle: Style = { ...blackWhite, shape: 'rhombus' };

// 节点尺寸按「打印可读」口径收敛：文档内显示宽 15cm，逻辑宽控制在 ~750px 内，
// 使 14px 字号打印后约 8-10pt（与旧版文档图一致）。
const node = (id: string, label: string, kind = 'process', style: Style = boxStyle, width = 170, height = 54): Node => ({ id, label, kind, style, width, height });
const flowNode = (id: string, label: string, kind = 'process', style: Style = boxStyle, width = 150, height = 46): Node => ({ id, label, kind, style, width, height });
const edge = (id: string, source: string, target: string, label?: string, type: Edge['type'] = 'flow'): Edge => ({ id, source, target, label, type, style: blackWhite });
const uc = (id: string, label: string): Node => node(id, label, 'usecase', { ...blackWhite, shape: 'ellipse' }, 180, 60);
const big: Style = { ...blackWhite, fontSize: 20 };
const bigBox: Style = { ...big, shape: 'rounded=1' };
const bigDb: Style = { ...big, shape: 'shape=cylinder' };
const bigEdge = (id: string, source: string, target: string, label?: string, type: Edge['type'] = 'flow'): Edge => ({ id, source, target, label, type, style: big });

function diagrams(): Diagram[] {
  return [
    createDiagram({ id: '01-业务流程', title: '系统业务流程', type: 'flowchart', direction: 'TOP_TO_BOTTOM', routing: 'ORTHOGONAL', layout: { edgeLabelFontSize: 14 }, nodes: [
      flowNode('flow.start', '开始', 'start', { ...blackWhite, shape: 'ellipse' }, 90, 40),
      flowNode('flow.login', '注册/登录'),
      flowNode('flow.browse', '浏览搜索收藏'),
      flowNode('flow.slot', '查时段并申请'),
      flowNode('flow.check', '信用≥60且\n时段无冲突？', 'decision', decisionStyle, 150, 66),
      flowNode('flow.reject', '拒绝并提示'),
      flowNode('flow.review', '发布者审核'),
      flowNode('flow.renting', '租借中\n留言/续借'),
      flowNode('flow.returnApply', '申请归还'),
      flowNode('flow.confirm', '确认归还'),
      flowNode('flow.settle', '信用结算\n恢复工具\n发送消息', 'process', boxStyle, 150, 66),
      flowNode('flow.end', '结束', 'end', { ...blackWhite, shape: 'ellipse' }, 90, 40)
    ], edges: [
      edge('flow.e1', 'flow.start', 'flow.login'), edge('flow.e2', 'flow.login', 'flow.browse'), edge('flow.e3', 'flow.browse', 'flow.slot'), edge('flow.e4', 'flow.slot', 'flow.check'),
      edge('flow.e5', 'flow.check', 'flow.reject', '否'), edge('flow.e6', 'flow.check', 'flow.review', '是'), edge('flow.e7', 'flow.review', 'flow.renting', '同意'), edge('flow.e8', 'flow.renting', 'flow.returnApply'),
      edge('flow.e9', 'flow.returnApply', 'flow.confirm'), edge('flow.e10', 'flow.confirm', 'flow.settle'), edge('flow.e11', 'flow.settle', 'flow.end')
    ]}),

    createDiagram({ id: '02-系统角色', title: '系统角色', type: 'system-architecture', direction: 'LEFT_TO_RIGHT', routing: 'ORTHOGONAL', layout: { edgeLabelFontSize: 14 }, nodes: [
      node('role.user', '普通用户', 'actor', actorStyle, 100, 90),
      node('role.account', '账户与个人信息'),
      node('role.rent', '发布、浏览、收藏、租借'),
      node('role.service', '归还、续借、消息、信用、评价'),
      node('role.admin', '管理员', 'actor', actorStyle, 100, 90),
      node('role.adminOps', '治理：用户/分类/举报/申诉/纠纷'),
      node('role.adminStats', '统计、审计、导出')
    ], edges: [
      edge('role.e1', 'role.user', 'role.account'), edge('role.e2', 'role.user', 'role.rent'), edge('role.e3', 'role.user', 'role.service'),
      edge('role.e4', 'role.admin', 'role.adminOps'), edge('role.e5', 'role.admin', 'role.adminStats')
    ]}),

    createDiagram({ id: '03-普通用户用例', title: '普通用户用例', type: 'uml-usecase', direction: 'LEFT_TO_RIGHT', routing: 'ORTHOGONAL', layout: { edgeLabelFontSize: 14 }, nodes: [
      node('user.actor', '普通用户', 'actor', actorStyle, 100, 90),
      uc('user.auth', '注册登录与个人信息'),
      uc('user.tools', '浏览搜索收藏工具'),
      uc('user.publish', '发布编辑下架工具'),
      uc('user.orders', '租借申请续借归还'),
      uc('user.after', '留言纠纷与信用申诉'),
      uc('user.review', '多维评价回复撤回')
    ], edges: [
      edge('user.e1', 'user.actor', 'user.auth', undefined, 'association'), edge('user.e2', 'user.actor', 'user.tools', undefined, 'association'),
      edge('user.e3', 'user.actor', 'user.publish', undefined, 'association'), edge('user.e4', 'user.actor', 'user.orders', undefined, 'association'),
      edge('user.e5', 'user.actor', 'user.after', undefined, 'association'), edge('user.e6', 'user.actor', 'user.review', undefined, 'association')
    ], containers: [{ id: 'user.boundary', label: '闲置工具共享系统', nodeIds: ['user.auth','user.tools','user.publish','user.orders','user.after','user.review'], style: blackWhite }]}),

    createDiagram({ id: '04-管理员用例', title: '管理员用例', type: 'uml-usecase', direction: 'LEFT_TO_RIGHT', routing: 'ORTHOGONAL', layout: { edgeLabelFontSize: 14 }, nodes: [
      node('admin.actor', '管理员', 'actor', actorStyle, 100, 90),
      uc('admin.users', '用户搜索封禁解封'),
      uc('admin.tools', '分类维护强制下架'),
      uc('admin.handle', '举报申诉纠纷处置'),
      uc('admin.rules', '信用规则系统通知'),
      uc('admin.stats', '统计趋势数据导出'),
      uc('admin.audit', '审计日志查询')
    ], edges: [
      edge('admin.e1', 'admin.actor', 'admin.users', undefined, 'association'), edge('admin.e2', 'admin.actor', 'admin.tools', undefined, 'association'),
      edge('admin.e3', 'admin.actor', 'admin.handle', undefined, 'association'), edge('admin.e4', 'admin.actor', 'admin.rules', undefined, 'association'),
      edge('admin.e5', 'admin.actor', 'admin.stats', undefined, 'association'), edge('admin.e6', 'admin.actor', 'admin.audit', undefined, 'association')
    ], containers: [{ id: 'admin.boundary', label: '闲置工具共享系统', nodeIds: ['admin.users','admin.tools','admin.handle','admin.rules','admin.stats','admin.audit'], style: blackWhite }]}),

    createDiagram({ id: '05-订单状态机', title: '租借订单状态机', type: 'state-machine', direction: 'TOP_TO_BOTTOM', routing: 'ORTHOGONAL', layout: { edgeLabelFontSize: 18 }, nodes: [
      node('state.start', 'Initial', 'start', blackWhite, 30, 30),
      node('state.pending', '待审核（0）', 'state', bigBox, 190, 50),
      node('state.rejected', '已拒绝（1）', 'state', bigBox, 190, 50),
      node('state.renting', '租借中（2）', 'state', bigBox, 190, 50),
      node('state.cancelled', '已取消（6）', 'state', bigBox, 190, 50),
      node('state.returnPending', '待确认归还（3）', 'state', bigBox, 190, 50),
      node('state.overdue', '已逾期（5）', 'state', bigBox, 190, 50),
      node('state.returned', '已归还（4）', 'state', bigBox, 190, 50),
      node('state.end', 'Final', 'end', blackWhite, 30, 30)
    ], edges: [
      bigEdge('state.e0', 'state.start', 'state.pending', '提交申请'),
      bigEdge('state.e1', 'state.pending', 'state.rejected', '拒绝'),
      bigEdge('state.e2', 'state.pending', 'state.renting', '同意'),
      bigEdge('state.e3', 'state.pending', 'state.cancelled', '取消/超时/结案'),
      bigEdge('state.e4', 'state.renting', 'state.returnPending', '申请/发起归还'),
      bigEdge('state.e5', 'state.renting', 'state.overdue', '标记逾期'),
      bigEdge('state.e6', 'state.renting', 'state.cancelled', '终止/结案'),
      bigEdge('state.e7', 'state.returnPending', 'state.returned', '确认/自动确认'),
      bigEdge('state.e8', 'state.returnPending', 'state.cancelled', '强制结案'),
      bigEdge('state.e9', 'state.overdue', 'state.returned', '逾期收回'),
      bigEdge('state.e10', 'state.overdue', 'state.cancelled', '自动结案'),
      bigEdge('state.e11', 'state.rejected', 'state.end', '终态'),
      bigEdge('state.e12', 'state.returned', 'state.end', '终态'),
      bigEdge('state.e13', 'state.cancelled', 'state.end', '终态')
    ]}),

    createDiagram({ id: '06-系统架构', title: '系统分层架构', type: 'system-architecture', direction: 'TOP_TO_BOTTOM', routing: 'ORTHOGONAL', layout: { edgeLabelFontSize: 18 }, nodes: [
      node('arch.frontend', 'Vue 3 前端', 'frontend', bigBox, 170, 50),
      node('arch.controller', 'Controller（11个）', 'process', bigBox, 210, 50),
      node('arch.service', 'Service 层', 'process', bigBox, 170, 50),
      node('arch.common', 'common 策略类', 'process', bigBox, 190, 50),
      node('arch.mapper', 'Mapper 层', 'process', bigBox, 170, 50),
      node('arch.db', 'MySQL（15表）', 'database', bigDb, 180, 72),
      node('arch.jwt', 'JWT+token_version', 'process', bigBox, 220, 50),
      node('arch.gex', '全局异常处理', 'process', bigBox, 180, 50),
      node('arch.task', '定时任务兜底', 'process', bigBox, 180, 50)
    ], edges: [
      bigEdge('arch.e1', 'arch.frontend', 'arch.controller', 'HTTP+Bearer'),
      bigEdge('arch.e2', 'arch.controller', 'arch.service'),
      bigEdge('arch.e3', 'arch.service', 'arch.common', '规则校验', 'dependency'),
      bigEdge('arch.e4', 'arch.service', 'arch.mapper'),
      bigEdge('arch.e5', 'arch.mapper', 'arch.db', 'SQL'),
      bigEdge('arch.e6', 'arch.jwt', 'arch.controller', '认证', 'dependency'),
      bigEdge('arch.e7', 'arch.gex', 'arch.controller', '异常映射', 'dependency'),
      bigEdge('arch.e8', 'arch.task', 'arch.service', '超时兜底', 'dependency')
    ]}),

    createDiagram({ id: '07-核心数据关系', title: '核心数据关系', type: 'er', direction: 'TOP_TO_BOTTOM', routing: 'ORTHOGONAL', layout: { edgeLabelFontSize: 18 }, nodes: [
      node('table.user', 'user\n用户\nPK id', 'database', bigDb, 170, 86),
      node('table.category', 'category\n分类\nPK id', 'database', bigDb, 170, 86),
      node('table.tool', 'tool\n工具\nFK owner_id', 'database', bigDb, 190, 86),
      node('table.order', 'rental_order\n租借订单\nFK tool_id', 'database', bigDb, 200, 86),
      node('table.credit', 'credit_log\n信用流水\nFK order_id', 'database', bigDb, 180, 86),
      node('table.review', 'review\n评价\nFK order_id', 'database', bigDb, 170, 86),
      node('table.message', 'message\n消息\nFK user_id', 'database', bigDb, 170, 86),
      node('table.favorite', 'favorite\n收藏\nUK user+tool', 'database', bigDb, 190, 86)
    ], edges: [
      bigEdge('er.e1', 'table.user', 'table.tool', '发布', 'foreign-key'),
      bigEdge('er.e2', 'table.category', 'table.tool', '归类', 'foreign-key'),
      bigEdge('er.e3', 'table.tool', 'table.order', '产生', 'foreign-key'),
      bigEdge('er.e4', 'table.user', 'table.order', '借用', 'foreign-key'),
      bigEdge('er.e5', 'table.order', 'table.credit', '结算', 'foreign-key'),
      bigEdge('er.e6', 'table.order', 'table.review', '评价', 'foreign-key'),
      bigEdge('er.e7', 'table.order', 'table.message', '通知', 'foreign-key'),
      bigEdge('er.e8', 'table.user', 'table.favorite', '收藏', 'foreign-key'),
      bigEdge('er.e9', 'table.tool', 'table.favorite', '被收藏', 'foreign-key')
    ]})
  ];
}

async function main() {
  await fs.mkdir(outDir, { recursive: true });
  for (const diagram of diagrams()) {
    const layout = await layoutDiagram(diagram, 5);
    await fs.writeFile(path.join(outDir, `${diagram.id}.model.json`), JSON.stringify(diagram, null, 2));
    await fs.writeFile(path.join(outDir, `${diagram.id}.drawio`), renderDrawio(layout));
    await fs.writeFile(path.join(outDir, `${diagram.id}.svg`), renderSvg(layout));
    console.log(`[GENERATE] ${diagram.id}: ${layout.width}x${layout.height} / ${layout.nodes.length} nodes / ${layout.edges.length} edges`);
    if (layout.warnings.length) console.warn(`[VALIDATE] ${diagram.id}: ${layout.warnings.join('; ')}`);
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
