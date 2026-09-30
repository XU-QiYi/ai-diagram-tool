import fs from 'node:fs/promises';
import path from 'node:path';
import { layoutDiagram } from '../src/layout/elk.js';
import { createDiagram } from '../src/model/index.js';
import type { Diagram, Edge, Node, Style } from '../src/model/types.js';
import { renderDrawio, renderSvg } from '../src/render/index.js';

const outDir = path.resolve('output', 'architecture-report');
const bw: Style = { fill: '#FFFFFF', stroke: '#000000', text: '#000000' };
const box: Style = { ...bw, shape: 'rounded=1' };
const decision: Style = { ...bw, shape: 'rhombus' };
const database: Style = { ...bw, shape: 'shape=cylinder' };
const n = (id: string, label: string, kind = 'process', width = 190, height = 56, style: Style = box): Node => ({
  id,
  label,
  kind,
  width,
  height,
  style,
});
const e = (id: string, source: string, target: string, label: string, type: Edge['type'] = 'flow'): Edge => ({
  id,
  source,
  target,
  label,
  type,
  style: bw,
});

const moduleDiagram = (id: string, title: string, root: string, features: string[]): Diagram => {
  const nodes = [
    n(`${id}.root`, root, 'component', 210, 64),
    ...features.map((x, i) => n(`${id}.f${i + 1}`, x, 'process', 200, 56)),
  ];
  const edges = features.map((_, i) => e(`${id}.e${i + 1}`, `${id}.root`, `${id}.f${i + 1}`, '提供'));
  return createDiagram({
    id,
    title,
    type: 'uml-component',
    direction: 'LEFT_TO_RIGHT',
    routing: 'ORTHOGONAL',
    nodes,
    edges,
  });
};

function diagrams(): Diagram[] {
  // 总体结构采用与用户示例一致的树状层级：平台 → 前端/后端 → 业务模块 → 功能点。
  const overallLayers = [
    [
      'Vue前端',
      [
        ['用户与工具', ['用户注册', '用户登录', '个人信息查询', '工具列表', '工具详情', '发布工具', '编辑工具']],
        ['租借交互', ['申请租借', '取消申请', '申请归还', '我的租借订单']],
        ['消息评价', ['消息列表', '标记已读', '提交评价']],
      ],
    ],
    [
      'Spring Boot接口',
      [
        ['分类管理', ['分类列表', '新增分类', '编辑分类', '删除分类']],
        ['订单服务', ['审核申请', '确认归还', '双方订单查询', '信用结算']],
        ['管理员统计', ['用户治理', '统计概览', '订单趋势']],
      ],
    ],
  ] as const;
  const overallNodes: Node[] = [n('overall.root', '社区闲置工具共享租借平台', 'root', 250, 68)];
  const overallEdges: Edge[] = [];
  overallLayers.forEach(([layer, modules], li) => {
    const lid = `overall.layer${li + 1}`;
    overallNodes.push(n(lid, layer, 'component', 210, 62));
    overallEdges.push(e(`overall.le${li + 1}`, 'overall.root', lid, '划分'));
    modules.forEach(([module, features], mi) => {
      const mid = `${lid}.m${mi + 1}`;
      overallNodes.push(n(mid, module, 'component', 180, 58));
      overallEdges.push(e(`${lid}.me${mi + 1}`, lid, mid, '包含'));
      features.forEach((feature, fi) => {
        const fid = `${mid}.f${fi + 1}`;
        overallNodes.push(n(fid, feature, 'process', 170, 52));
        overallEdges.push(
          e(`${mid}.e${fi + 1}`, fi === 0 ? mid : `${mid}.f${fi}`, fid, fi === 0 ? '包含' : '下一功能'),
        );
      });
    });
  });

  return [
    createDiagram({
      id: '01-系统总体结构',
      title: '系统总体结构',
      type: 'system-architecture',
      direction: 'TOP_TO_BOTTOM',
      routing: 'ORTHOGONAL',
      nodes: overallNodes,
      edges: overallEdges,
    }),
    createDiagram({
      id: '02-系统架构',
      title: '系统架构设计',
      type: 'system-architecture',
      direction: 'TOP_TO_BOTTOM',
      routing: 'ORTHOGONAL',
      nodes: [
        n('arch.client', 'Vue 3 前端\n页面组件 + axios', 'frontend', 240, 70),
        n('arch.controller', 'Controller 层\n7个 REST Controller', 'component', 240, 70),
        n('arch.service', 'Service 层\n业务接口 + 实现', 'component', 240, 70),
        n('arch.mapper', 'Mapper 层\nMyBatis-Plus', 'component', 240, 70),
        n('arch.mysql', 'MySQL 数据库\n7张核心业务表', 'database', 220, 82, database),
        n('arch.jwt', 'JWT 拦截器\n身份与角色校验', 'component', 220, 66),
        n('arch.task', 'OverdueOrderTask\n逾期订单扫描', 'component', 220, 66),
      ],
      edges: [
        e('arch.e1', 'arch.client', 'arch.controller', 'HTTP/JSON'),
        e('arch.e2', 'arch.controller', 'arch.service', '调用'),
        e('arch.e3', 'arch.service', 'arch.mapper', '访问'),
        e('arch.e4', 'arch.mapper', 'arch.mysql', 'JDBC/SQL'),
        e('arch.e5', 'arch.jwt', 'arch.controller', '认证授权', 'dependency'),
        e('arch.e6', 'arch.task', 'arch.service', '触发逾期处理', 'dependency'),
      ],
    }),
    createDiagram({
      id: '03-四加一架构',
      title: '4+1 软件架构视图',
      type: 'system-architecture',
      direction: 'TOP_TO_BOTTOM',
      routing: 'ORTHOGONAL',
      nodes: [
        n('view.scenario', '场景视图\n发布、租借、归还、管理', 'root', 250, 72),
        n('view.logical', '逻辑视图\n用户/工具/订单/消息/评价', 'component', 240, 72),
        n('view.process', '进程视图\nHTTP请求、事务、定时任务', 'component', 240, 72),
        n('view.development', '开发视图\nController/Service/Mapper', 'component', 240, 72),
        n('view.physical', '物理视图\n浏览器、应用服务器、MySQL', 'component', 240, 72),
      ],
      edges: [
        e('view.e1', 'view.scenario', 'view.logical', '验证需求'),
        e('view.e2', 'view.scenario', 'view.process', '驱动交互'),
        e('view.e3', 'view.scenario', 'view.development', '映射实现'),
        e('view.e4', 'view.scenario', 'view.physical', '约束部署'),
      ],
    }),
    moduleDiagram('04-用户认证子系统', '用户认证子系统结构', '用户认证子系统', [
      '用户注册',
      '用户登录',
      'JWT签发与校验',
      '个人信息查询',
      '个人信息更新',
    ]),
    moduleDiagram('05-分类管理子系统', '分类管理子系统结构', '分类管理子系统', [
      '分类公开查询',
      '分类名称查重',
      '管理员新增分类',
      '管理员编辑分类',
      '引用检查后删除',
    ]),
    moduleDiagram('06-工具管理子系统', '工具管理子系统结构', '工具管理子系统', [
      '工具发布',
      '分页与条件查询',
      '工具详情查询',
      '本人编辑工具',
      '无进行中订单时下架',
    ]),
    moduleDiagram('07-租借订单子系统', '租借订单子系统结构', '租借订单子系统', [
      '申请租借',
      '发布者审核',
      '借用人取消',
      '申请归还',
      '发布者确认归还',
      '双方订单查询',
    ]),
    moduleDiagram('08-信用管理子系统', '信用管理子系统结构', '信用管理子系统', [
      '初始信用100分',
      '60分租借准入',
      '按时归还加2分',
      '逾期归还扣5分',
      '信用流水记录',
    ]),
    moduleDiagram('09-消息评价子系统', '消息评价子系统结构', '消息评价子系统', [
      '订单状态消息',
      '消息列表与未读数',
      '单条/全部已读',
      '归还后双方评价',
      '订单/工具评价查询',
    ]),
    moduleDiagram('10-管理员统计子系统', '管理员统计子系统结构', '管理员统计子系统', [
      '用户分页与搜索',
      '封禁与解封',
      '分类维护',
      '统计概览',
      '7至90天订单趋势',
    ]),
    createDiagram({
      id: '11-订单流程',
      title: '租借订单业务流程',
      type: 'flowchart',
      direction: 'TOP_TO_BOTTOM',
      routing: 'ORTHOGONAL',
      nodes: [
        n('flow.start', '开始', 'start', 130, 44, { ...bw, shape: 'ellipse' }),
        n('flow.apply', '借用人提交租借申请'),
        n('flow.validate', '工具、时间、信用校验通过？', 'decision', 230, 86, decision),
        n('flow.fail', '返回业务错误'),
        n('flow.pending', '创建待审核订单并通知发布者'),
        n('flow.approve', '发布者同意？', 'decision', 200, 82, decision),
        n('flow.reject', '订单已拒绝并通知借用人'),
        n('flow.renting', '订单租借中，工具锁定'),
        n('flow.return', '借用人申请归还'),
        n('flow.confirm', '发布者确认归还'),
        n('flow.settle', '恢复工具并结算信用'),
        n('flow.end', '结束', 'end', 130, 44, { ...bw, shape: 'ellipse' }),
      ],
      edges: [
        e('flow.e1', 'flow.start', 'flow.apply', '发起'),
        e('flow.e2', 'flow.apply', 'flow.validate', '校验'),
        e('flow.e3', 'flow.validate', 'flow.fail', '否'),
        e('flow.e4', 'flow.validate', 'flow.pending', '是'),
        e('flow.e5', 'flow.pending', 'flow.approve', '审核'),
        e('flow.e6', 'flow.approve', 'flow.reject', '否'),
        e('flow.e7', 'flow.approve', 'flow.renting', '是'),
        e('flow.e8', 'flow.renting', 'flow.return', '使用完成'),
        e('flow.e9', 'flow.return', 'flow.confirm', '通知'),
        e('flow.e10', 'flow.confirm', 'flow.settle', '确认'),
        e('flow.e11', 'flow.settle', 'flow.end', '完成'),
      ],
    }),
    {
      ...createDiagram({
        id: '12-订单时序',
        title: '租借申请与审核时序',
        type: 'sequence',
        direction: 'LEFT_TO_RIGHT',
        routing: 'ORTHOGONAL',
        nodes: [
          n('seq.borrower', '借用人', 'participant'),
          n('seq.controller', 'RentalOrderController', 'participant', 210),
          n('seq.service', 'RentalOrderServiceImpl', 'participant', 210),
          n('seq.mapper', 'Mapper', 'participant'),
          n('seq.owner', '发布者', 'participant'),
        ],
        edges: [
          e('seq.e1', 'seq.borrower', 'seq.controller', 'POST /api/order/apply'),
          e('seq.e2', 'seq.controller', 'seq.service', 'applyRental()'),
          e('seq.e3', 'seq.service', 'seq.mapper', '查询工具/用户/冲突订单'),
          e('seq.e4', 'seq.mapper', 'seq.service', '返回校验数据'),
          e('seq.e5', 'seq.service', 'seq.mapper', '写入订单和消息'),
          e('seq.e6', 'seq.service', 'seq.controller', '返回订单ID'),
          e('seq.e7', 'seq.owner', 'seq.controller', 'PUT /{id}/approve'),
          e('seq.e8', 'seq.controller', 'seq.service', 'approveRental()'),
          e('seq.e9', 'seq.service', 'seq.mapper', '更新订单/工具并写消息'),
          e('seq.e10', 'seq.service', 'seq.owner', '返回审核结果'),
        ],
      }),
      sequence: {
        activations: [
          { id: 'seq.a1', participantId: 'seq.service', startMessageId: 'seq.e2', endMessageId: 'seq.e6' },
          { id: 'seq.a2', participantId: 'seq.service', startMessageId: 'seq.e8', endMessageId: 'seq.e10' },
        ],
      },
    },
    createDiagram({
      id: '13-核心类图',
      title: '核心业务类图',
      type: 'uml-class',
      direction: 'LEFT_TO_RIGHT',
      routing: 'ORTHOGONAL',
      nodes: [
        {
          ...n('class.user', 'User', 'class', 230, 150),
          classMeta: {
            attributes: [
              { name: 'id', type: 'Long', visibility: '-' },
              { name: 'username', type: 'String', visibility: '-' },
              { name: 'role', type: 'Integer', visibility: '-' },
              { name: 'creditScore', type: 'Integer', visibility: '-' },
            ],
          },
        },
        {
          ...n('class.tool', 'Tool', 'class', 230, 150),
          classMeta: {
            attributes: [
              { name: 'id', type: 'Long', visibility: '-' },
              { name: 'ownerId', type: 'Long', visibility: '-' },
              { name: 'categoryId', type: 'Long', visibility: '-' },
              { name: 'status', type: 'Integer', visibility: '-' },
            ],
          },
        },
        {
          ...n('class.order', 'RentalOrder', 'class', 250, 180),
          classMeta: {
            attributes: [
              { name: 'id', type: 'Long', visibility: '-' },
              { name: 'toolId', type: 'Long', visibility: '-' },
              { name: 'borrowerId', type: 'Long', visibility: '-' },
              { name: 'ownerId', type: 'Long', visibility: '-' },
              { name: 'status', type: 'Integer', visibility: '-' },
            ],
          },
        },
        {
          ...n('class.credit', 'CreditLog', 'class', 220, 140),
          classMeta: {
            attributes: [
              { name: 'userId', type: 'Long', visibility: '-' },
              { name: 'orderId', type: 'Long', visibility: '-' },
              { name: 'changeScore', type: 'Integer', visibility: '-' },
            ],
          },
        },
        {
          ...n('class.message', 'Message', 'class', 220, 140),
          classMeta: {
            attributes: [
              { name: 'userId', type: 'Long', visibility: '-' },
              { name: 'orderId', type: 'Long', visibility: '-' },
              { name: 'isRead', type: 'Integer', visibility: '-' },
            ],
          },
        },
        {
          ...n('class.review', 'Review', 'class', 220, 140),
          classMeta: {
            attributes: [
              { name: 'orderId', type: 'Long', visibility: '-' },
              { name: 'userId', type: 'Long', visibility: '-' },
              { name: 'rating', type: 'Integer', visibility: '-' },
            ],
          },
        },
      ],
      edges: [
        {
          ...e('class.e1', 'class.user', 'class.tool', '发布', 'association'),
          sourceMultiplicity: '1',
          targetMultiplicity: '0..*',
        },
        {
          ...e('class.e2', 'class.user', 'class.order', '参与', 'association'),
          sourceMultiplicity: '1',
          targetMultiplicity: '0..*',
        },
        {
          ...e('class.e3', 'class.tool', 'class.order', '产生', 'association'),
          sourceMultiplicity: '1',
          targetMultiplicity: '0..*',
        },
        {
          ...e('class.e4', 'class.order', 'class.credit', '生成', 'composition'),
          sourceMultiplicity: '1',
          targetMultiplicity: '0..*',
        },
        {
          ...e('class.e5', 'class.order', 'class.message', '触发', 'composition'),
          sourceMultiplicity: '1',
          targetMultiplicity: '0..*',
        },
        {
          ...e('class.e6', 'class.order', 'class.review', '形成', 'composition'),
          sourceMultiplicity: '1',
          targetMultiplicity: '0..2',
        },
      ],
    }),
  ];
}

async function main() {
  await fs.mkdir(outDir, { recursive: true });
  for (const diagram of diagrams()) {
    const layout = await layoutDiagram(diagram, 5);
    await fs.writeFile(path.join(outDir, `${diagram.id}.model.json`), JSON.stringify(diagram, null, 2));
    await fs.writeFile(path.join(outDir, `${diagram.id}.drawio`), renderDrawio(layout));
    await fs.writeFile(path.join(outDir, `${diagram.id}.svg`), renderSvg(layout));
    console.log(
      `[GENERATE] ${diagram.id}: ${layout.nodes.length} nodes / ${layout.edges.length} edges / ${layout.iterations} iteration(s)`,
    );
    if (layout.warnings.length) console.warn(`[VALIDATE] ${diagram.id}: ${layout.warnings.join('; ')}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
