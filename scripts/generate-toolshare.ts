import fs from 'node:fs/promises';
import path from 'node:path';
import { createDiagram } from '../src/model/index.js';
import { layoutDiagram } from '../src/layout/elk.js';
import { renderDrawio, renderSvg } from '../src/render/index.js';
import type { Diagram, Node, Edge, Style } from '../src/model/types.js';

// Keep every generated artifact inside this project folder.
const outDir = path.resolve('output', 'drawio-tool');
const blackWhite: Style = { fill: '#FFFFFF', stroke: '#000000', text: '#000000' };
const actorStyle: Style = { ...blackWhite, shape: 'shape=umlActor' };
const boxStyle: Style = { ...blackWhite, shape: 'rounded=1' };
const decisionStyle: Style = { ...blackWhite, shape: 'rhombus' };
const dbStyle: Style = { ...blackWhite, shape: 'shape=cylinder' };

const node = (id: string, label: string, kind = 'process', style: Style = boxStyle, width = 210, height = 60): Node => ({ id, label, kind, style, width, height });
const flowNode = (id: string, label: string, kind = 'process', style: Style = boxStyle, width = 180, height = 52): Node => ({ id, label, kind, style, width, height });
const edge = (id: string, source: string, target: string, label?: string, type: Edge['type'] = 'flow'): Edge => ({ id, source, target, label, type, style: blackWhite });

function diagrams(): Diagram[] {
  return [
    createDiagram({ id: '01-业务流程', title: '系统业务流程', type: 'flowchart', direction: 'TOP_TO_BOTTOM', routing: 'ORTHOGONAL', nodes: [
      flowNode('flow.start', '开始', 'start', { ...blackWhite, shape: 'ellipse' }, 120, 44),
      flowNode('flow.login', '用户注册/登录'), flowNode('flow.browse', '浏览与搜索工具'), flowNode('flow.apply', '提交租借申请'),
      flowNode('flow.check', '工具可租且信用分≥60？', 'decision', decisionStyle, 190, 72),
      flowNode('flow.reject', '拒绝并提示原因'), flowNode('flow.review', '发布者审核申请'), flowNode('flow.renting', '订单进入租借中'),
      flowNode('flow.returnApply', '借用人申请归还'), flowNode('flow.confirm', '发布者确认归还'),
      flowNode('flow.settle', '信用结算、恢复工具状态、发送消息', 'process', boxStyle, 240, 52),
      flowNode('flow.end', '结束', 'end', { ...blackWhite, shape: 'ellipse' }, 120, 44)
    ], edges: [
      edge('flow.e1', 'flow.start', 'flow.login'), edge('flow.e2', 'flow.login', 'flow.browse'), edge('flow.e3', 'flow.browse', 'flow.apply'), edge('flow.e4', 'flow.apply', 'flow.check'),
      edge('flow.e5', 'flow.check', 'flow.reject', '否'), edge('flow.e6', 'flow.check', 'flow.review', '是'), edge('flow.e7', 'flow.review', 'flow.renting', '同意'), edge('flow.e8', 'flow.renting', 'flow.returnApply'),
      edge('flow.e9', 'flow.returnApply', 'flow.confirm'), edge('flow.e10', 'flow.confirm', 'flow.settle'), edge('flow.e11', 'flow.settle', 'flow.end')
    ]}),

    createDiagram({ id: '02-系统角色', title: '系统角色', type: 'system-architecture', direction: 'LEFT_TO_RIGHT', routing: 'ORTHOGONAL', nodes: [
      node('role.user', '普通用户', 'actor', actorStyle, 130, 100), node('role.account', '注册、登录、个人信息'), node('role.rent', '工具发布、浏览与租借'), node('role.service', '归还、信用、消息与评价'),
      node('role.admin', '管理员', 'actor', actorStyle, 130, 100), node('role.adminOps', '用户、分类与统计管理')
    ], edges: [
      edge('role.e1', 'role.user', 'role.account'), edge('role.e2', 'role.user', 'role.rent'), edge('role.e3', 'role.user', 'role.service'), edge('role.e4', 'role.admin', 'role.adminOps')
    ]}),

    createDiagram({ id: '03-普通用户用例', title: '普通用户用例', type: 'uml-usecase', direction: 'LEFT_TO_RIGHT', routing: 'ORTHOGONAL', nodes: [
      node('user.actor', '普通用户', 'actor', actorStyle, 130, 100), node('user.auth', '账户注册、登录与个人信息', 'usecase', { ...blackWhite, shape: 'ellipse' }, 220, 70), node('user.tools', '浏览、搜索工具和查看详情', 'usecase', { ...blackWhite, shape: 'ellipse' }, 220, 70), node('user.publish', '发布、编辑和下架本人工具', 'usecase', { ...blackWhite, shape: 'ellipse' }, 220, 70), node('user.orders', '提交、取消和查看租借订单', 'usecase', { ...blackWhite, shape: 'ellipse' }, 220, 70), node('user.after', '归还、消息、信用与评价', 'usecase', { ...blackWhite, shape: 'ellipse' }, 220, 70)
    ], edges: [edge('user.e1', 'user.actor', 'user.auth', undefined, 'association'), edge('user.e2', 'user.actor', 'user.tools', undefined, 'association'), edge('user.e3', 'user.actor', 'user.publish', undefined, 'association'), edge('user.e4', 'user.actor', 'user.orders', undefined, 'association'), edge('user.e5', 'user.actor', 'user.after', undefined, 'association')], containers: [{ id: 'user.boundary', label: '闲置工具共享系统', nodeIds: ['user.auth','user.tools','user.publish','user.orders','user.after'], style: blackWhite }]}),

    createDiagram({ id: '04-管理员用例', title: '管理员用例', type: 'uml-usecase', direction: 'LEFT_TO_RIGHT', routing: 'ORTHOGONAL', nodes: [
      node('admin.actor', '管理员', 'actor', actorStyle, 130, 100), node('admin.users', '用户分页查询与模糊搜索', 'usecase', { ...blackWhite, shape: 'ellipse' }, 220, 70), node('admin.status', '封禁与解封异常账号', 'usecase', { ...blackWhite, shape: 'ellipse' }, 220, 70), node('admin.category', '工具分类新增、编辑、删除', 'usecase', { ...blackWhite, shape: 'ellipse' }, 220, 70), node('admin.stats', '统计概览与订单趋势', 'usecase', { ...blackWhite, shape: 'ellipse' }, 220, 70)
    ], edges: [edge('admin.e1', 'admin.actor', 'admin.users', undefined, 'association'), edge('admin.e2', 'admin.actor', 'admin.status', undefined, 'association'), edge('admin.e3', 'admin.actor', 'admin.category', undefined, 'association'), edge('admin.e4', 'admin.actor', 'admin.stats', undefined, 'association')], containers: [{ id: 'admin.boundary', label: '闲置工具共享系统', nodeIds: ['admin.users','admin.status','admin.category','admin.stats'], style: blackWhite }]}),

    createDiagram({ id: '05-订单状态机', title: '租借订单状态机', type: 'state-machine', direction: 'TOP_TO_BOTTOM', routing: 'ORTHOGONAL', nodes: [
      node('state.start', 'Initial', 'start', blackWhite, 34, 34), node('state.pending', '待审核（0）', 'state'), node('state.rejected', '已拒绝（1）', 'state'), node('state.renting', '租借中（2）', 'state', boxStyle, 210, 78), node('state.cancelled', '已取消（6）', 'state'), node('state.returnPending', '待确认归还（3）', 'state'), node('state.overdue', '已逾期（5）', 'state'), node('state.returned', '已归还（4）', 'state', boxStyle, 210, 78), node('state.end', 'Final', 'end', blackWhite, 34, 34)
    ], edges: [edge('state.e0', 'state.start', 'state.pending', 'submit / createOrder()'), edge('state.e1', 'state.pending', 'state.rejected', 'reject / notifyBorrower()'), edge('state.e2', 'state.pending', 'state.renting', 'approve [toolAvailable] / lockTool()'), edge('state.e3', 'state.pending', 'state.cancelled', 'cancel / releaseRequest()'), edge('state.e4', 'state.renting', 'state.returnPending', 'requestReturn'), edge('state.e5', 'state.renting', 'state.overdue', 'timeout [now > endTime]'), edge('state.e6', 'state.overdue', 'state.returnPending', 'requestReturn'), edge('state.e7', 'state.returnPending', 'state.returned', 'confirm / settleCredit()'), edge('state.e8', 'state.returned', 'state.end', 'complete')]}),

    createDiagram({ id: '06-系统架构', title: '系统分层架构', type: 'system-architecture', direction: 'TOP_TO_BOTTOM', routing: 'ORTHOGONAL', nodes: [
      node('arch.frontend', '前端\nVue 页面组件 + axios', 'frontend', boxStyle, 240, 70), node('arch.controller', 'Controller 层（7个）'), node('arch.service', 'Service 层（接口 + 实现）'), node('arch.mapper', 'Mapper 层（MyBatis-Plus）'), node('arch.db', 'MySQL 数据库', 'database', dbStyle, 190, 80), node('arch.jwt', 'JWT 拦截器 + 白名单'), node('arch.task', 'OverdueOrderTask 定时任务')
    ], edges: [edge('arch.e1', 'arch.frontend', 'arch.controller', 'HTTP + Bearer Token'), edge('arch.e2', 'arch.controller', 'arch.service'), edge('arch.e3', 'arch.service', 'arch.mapper'), edge('arch.e4', 'arch.mapper', 'arch.db', 'SQL'), edge('arch.e5', 'arch.jwt', 'arch.controller', '认证/权限', 'dependency'), edge('arch.e6', 'arch.task', 'arch.service', '扫描逾期订单', 'dependency')]}),

    createDiagram({ id: '07-核心数据关系', title: '核心数据关系', type: 'er', direction: 'TOP_TO_BOTTOM', routing: 'ORTHOGONAL', nodes: [
      node('table.user', 'user\n用户\nPK id', 'database', dbStyle, 180, 90), node('table.category', 'category\n分类\nPK id', 'database', dbStyle, 180, 90), node('table.tool', 'tool\n工具\nPK id / FK owner_id', 'database', dbStyle, 220, 90), node('table.order', 'rental_order\n租借订单\nPK id / FK tool_id', 'database', dbStyle, 230, 100), node('table.credit', 'credit_log\n信用流水\nFK order_id', 'database', dbStyle, 190, 90), node('table.review', 'review\n评价\nFK order_id', 'database', dbStyle, 180, 90), node('table.message', 'message\n消息\nFK order_id', 'database', dbStyle, 180, 90)
    ], edges: [edge('er.e1', 'table.user', 'table.tool', '发布', 'foreign-key'), edge('er.e2', 'table.category', 'table.tool', '归类', 'foreign-key'), edge('er.e3', 'table.tool', 'table.order', '产生', 'foreign-key'), edge('er.e4', 'table.user', 'table.order', '借用/收到申请', 'foreign-key'), edge('er.e5', 'table.order', 'table.credit', '结算', 'foreign-key'), edge('er.e6', 'table.order', 'table.review', '评价', 'foreign-key'), edge('er.e7', 'table.order', 'table.message', '通知', 'foreign-key') ]})
  ];
}

async function main() {
  await fs.mkdir(outDir, { recursive: true });
  for (const diagram of diagrams()) {
    const layout = await layoutDiagram(diagram, 5);
    await fs.writeFile(path.join(outDir, `${diagram.id}.model.json`), JSON.stringify(diagram, null, 2));
    await fs.writeFile(path.join(outDir, `${diagram.id}.drawio`), renderDrawio(layout));
    await fs.writeFile(path.join(outDir, `${diagram.id}.svg`), renderSvg(layout));
    console.log(`[GENERATE] ${diagram.id}: ${layout.nodes.length} nodes / ${layout.edges.length} edges / ${layout.iterations} iteration(s)`);
    if (layout.warnings.length) console.warn(`[VALIDATE] ${diagram.id}: ${layout.warnings.join('; ')}`);
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
