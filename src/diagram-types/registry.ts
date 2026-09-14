import type { Diagram, DiagramType, Direction } from '../model/types.js';
import { createDiagram } from '../model/index.js';
import { systemArchitecture, umlClass, umlComponent, umlUseCase, flowchart, erDiagram, chenErDiagram } from './examples.js';
import { sequenceDiagram, stateDiagram, stateMachineDiagram, activityDiagram, deploymentDiagram, mindMap, timeline, networkGraph } from './extensions.js';
import { architectureForRequest } from './architecture.js';
import { parseChenErRequest } from './chen-er.js';

export interface DiagramTypeDefinition { type: DiagramType; aliases: string[]; defaultDirection: Direction; factory?: (title?: string) => Diagram; }
export const diagramTypeRegistry: DiagramTypeDefinition[] = [
  { type: 'system-architecture', aliases: ['system architecture', 'architecture', '架构图', '系统架构'], defaultDirection: 'LEFT_TO_RIGHT', factory: systemArchitecture },
  { type: 'uml-class', aliases: ['uml class', 'class diagram', '类图', '继承', '聚合', '组合'], defaultDirection: 'TOP_TO_BOTTOM', factory: umlClass },
  { type: 'uml-component', aliases: ['uml component', 'component diagram', '组件图', '组件', '接口'], defaultDirection: 'LEFT_TO_RIGHT', factory: umlComponent },
  { type: 'uml-usecase', aliases: ['uml use case', 'use case', 'usecase', '用例图', '用例'], defaultDirection: 'LEFT_TO_RIGHT', factory: umlUseCase },
  { type: 'flowchart', aliases: ['flowchart', 'flow chart', '流程图', '流程'], defaultDirection: 'TOP_TO_BOTTOM', factory: flowchart },
  { type: 'er', aliases: ['er diagram', 'er 图', 'er图', 'erd', '实体关系图', '数据库关系'], defaultDirection: 'LEFT_TO_RIGHT', factory: erDiagram },
  { type: 'chen-er', aliases: ['chen er', 'chen-er', 'chne er', 'chne-er', 'chen notation', '陈氏 er 图', '陈氏er图', '陈氏实体关系图', '实体属性联系图', '实体图'], defaultDirection: 'LEFT_TO_RIGHT', factory: chenErDiagram },
  { type: 'sequence', aliases: ['sequence diagram', '时序图', '序列图'], defaultDirection: 'TOP_TO_BOTTOM', factory: sequenceDiagram },
  { type: 'state', aliases: ['state diagram', '状态图'], defaultDirection: 'LEFT_TO_RIGHT', factory: stateDiagram },
  { type: 'state-machine', aliases: ['state machine diagram', 'state machine', '状态机图', '状态机'], defaultDirection: 'TOP_TO_BOTTOM', factory: stateMachineDiagram },
  { type: 'activity', aliases: ['activity diagram', '活动图'], defaultDirection: 'TOP_TO_BOTTOM', factory: activityDiagram },
  { type: 'deployment', aliases: ['deployment diagram', '部署图'], defaultDirection: 'LEFT_TO_RIGHT', factory: deploymentDiagram },
  { type: 'mindmap', aliases: ['mind map', 'mindmap', '思维导图'], defaultDirection: 'LEFT_TO_RIGHT', factory: mindMap },
  { type: 'timeline', aliases: ['timeline', '时间线', '时间轴'], defaultDirection: 'LEFT_TO_RIGHT', factory: timeline },
  { type: 'network', aliases: ['network graph', 'network diagram', '网络图'], defaultDirection: 'LEFT_TO_RIGHT', factory: networkGraph }
];
export function getDiagramTypeDefinition(type: DiagramType) { return diagramTypeRegistry.find(d => d.type === type); }
export function inferDiagramType(request: string): DiagramType { const s = request.toLowerCase(); const match = [...diagramTypeRegistry].sort((a,b) => Math.max(...b.aliases.map(x=>x.length)) - Math.max(...a.aliases.map(x=>x.length))).find(d => d.aliases.some(a => s.includes(a.toLowerCase()))); return match?.type ?? 'system-architecture'; }
function stableId(label: string) { return [...label.trim().toLowerCase()].map(c => /[a-z0-9]/.test(c) ? c : `u${c.codePointAt(0)!.toString(16)}`).join('').slice(0, 42); }
function parseChain(request: string) { const match = request.match(/(?:：|:)(.*)$/); const body = match?.[1] ?? request; const parts = body.split(/\s*(?:->|→|➜|—>|调用|访问|连接到|到)\s*/).map(x => x.replace(/[。；;,，].*$/, '').trim()).filter(x => x.length > 0 && x.length < 80); return parts.length >= 2 ? parts : []; }
function parsedDiagram(request: string, type: DiagramType, direction: Direction): Diagram | undefined {
  if (type === 'chen-er') return parseChenErRequest(request);
  if (type === 'uml-class') {
    const relationPatterns: Array<[RegExp, NonNullable<Diagram['edges'][number]['type']>]> = [
      [/([\w\u4e00-\u9fa5]+)\s*(?:继承|extends|inherits)\s*([\w\u4e00-\u9fa5]+)/gi, 'inheritance'],
      [/([\w\u4e00-\u9fa5]+)\s*(?:实现|implements|realizes)\s*([\w\u4e00-\u9fa5]+)/gi, 'realization'],
      [/([\w\u4e00-\u9fa5]+)\s*(?:组合|composes)\s*([\w\u4e00-\u9fa5]+)/gi, 'composition'],
      [/([\w\u4e00-\u9fa5]+)\s*(?:聚合|aggregates)\s*([\w\u4e00-\u9fa5]+)/gi, 'aggregation'],
      [/([\w\u4e00-\u9fa5]+)\s*(?:依赖|depends on)\s*([\w\u4e00-\u9fa5]+)/gi, 'dependency'],
      [/([\w\u4e00-\u9fa5]+)\s*(?:关联|associates with|关联到)\s*([\w\u4e00-\u9fa5]+)/gi, 'association'],
    ];
    const relations: Array<{ source: string; target: string; type: NonNullable<Diagram['edges'][number]['type']> }> = [];
    for (const [pattern, relationType] of relationPatterns) {
      for (const match of request.matchAll(pattern)) {
        if (match[1] && match[2]) relations.push({ source: match[1], target: match[2], type: relationType });
      }
    }
    if (relations.length) {
      const labels = [...new Set(relations.flatMap(relation => [relation.source, relation.target]))];
      const interfaceLabels = new Set(relations.filter(relation => relation.type === 'realization').map(relation => relation.target));
      const nodes = labels.map(label => ({ id: `class.${stableId(label)}`, label, kind: 'class', classMeta: interfaceLabels.has(label) ? { stereotype: 'interface' as const } : undefined }));
      return createDiagram({ id: 'generated-diagram', title: request, type, direction, nodes, edges: relations.map((relation, index) => ({ id: `${relation.type}.${stableId(relation.source)}-${stableId(relation.target)}-${index + 1}`, source: `class.${stableId(relation.source)}`, target: `class.${stableId(relation.target)}`, type: relation.type })) });
    }
  }
  if (type === 'uml-usecase') {
    const body = request.match(/(?:用例图|use\s*case(?:\s*diagram)?)\s*[:：]?\s*(.*)$/i)?.[1] ?? request;
    const actorActions = body.match(/^(.+?)\s*(?:可以|能够|可|can)\s*(.+)$/i);
    const explicitActor = body.match(/(?:Actor|参与者|用户|角色)\s*[:：]?\s*([^，,。；;]+?)(?:可以|能够|可|can|$)/i);
    const actorLabel = (actorActions?.[1] ?? explicitActor?.[1] ?? '').replace(/^(?:画一个|绘制|生成|uml|use\s*case|用例图|系统)\s*/i, '').trim() || (request.includes('管理员') ? 'Admin' : 'User');
    const actionText = actorActions?.[2] ?? body.replace(explicitActor?.[0] ?? '', '').replace(/(?:画一个|绘制|生成|uml|use\s*case|用例图|系统)/gi, '');
    const actions = actionText.split(/[，,、；;]|\s+and\s+|\s+以及\s+/i)
      .map(value => value.replace(/^(可以|能够|可|can)\s*/i, '').trim())
      .filter(value => value.length >= 2 && value.length < 60);
    if (actions.length) {
      const actor = { id: `actor.${stableId(actorLabel)}`, label: actorLabel, kind: 'actor', width: 130, height: 100 } as const;
      const usecases = actions.map((label, index) => ({ id: `usecase.${stableId(label) || index + 1}`, label, kind: 'usecase', width: 210, height: 70 } as const));
      return createDiagram({ id: 'generated-diagram', title: request, type, direction, nodes: [actor, ...usecases], edges: usecases.map(usecase => ({ id: `association.${stableId(actorLabel)}-${stableId(usecase.label)}`, source: actor.id, target: usecase.id, type: 'association' as const })), containers: [{ id: 'boundary.system', label: 'System Boundary', nodeIds: usecases.map(usecase => usecase.id) }] });
    }
  }
  const chain = parseChain(request); if (chain.length < 2) return undefined;
  const kind = type === 'er' ? 'database' : type === 'uml-usecase' ? 'usecase' : type === 'uml-class' ? 'class' : 'service';
  const nodes = chain.map((label, i) => ({ id: `node.${stableId(label) || i}`, label, kind }));
  const edges = nodes.slice(0, -1).map((n, i) => ({ id: `edge.${stableId(n.label)}-${stableId(nodes[i + 1].label)}`, source: n.id, target: nodes[i + 1].id, type: type === 'er' ? 'foreign-key' as const : type === 'uml-class' ? 'association' as const : type === 'uml-usecase' ? 'association' as const : 'flow' as const }));
  return createDiagram({ id: 'generated-diagram', title: request, type, direction, nodes, edges });
}
export function createDiagramFromRequest(request: string): Diagram {
  const type = inferDiagramType(request); const def = getDiagramTypeDefinition(type)!;
  const parsed = parsedDiagram(request, type, def.defaultDirection);
  const diagram = parsed ?? (type === 'system-architecture' ? architectureForRequest(request) : def.factory ? def.factory(request) : createDiagram({ id: 'generated-diagram', title: request, type, direction: def.defaultDirection, nodes: [], edges: [] }));
  return { ...diagram, id: 'generated-diagram', title: type === 'chen-er' && parsed ? diagram.title : request, type, direction: diagram.direction ?? def.defaultDirection };
}
