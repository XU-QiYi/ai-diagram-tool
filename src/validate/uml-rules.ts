import type { Diagram, RelationshipType, ValidationIssue } from '../model/types.js';

/**
 * 验证 UML 图的语义规则
 * 返回警告列表，不会阻止生成，但会提示用户潜在问题
 */
export function validateUmlSemantics(diagram: Diagram): string[] {
  if (diagram.metadata?.overviewOf === diagram.type) return [];
  const warnings: string[] = [];

  switch (diagram.type) {
    case 'uml-usecase':
      warnings.push(...validateUseCaseDiagram(diagram));
      break;
    case 'uml-class':
      warnings.push(...validateClassDiagram(diagram));
      break;
    case 'sequence':
      warnings.push(...validateSequenceDiagram(diagram));
      break;
    case 'state':
    case 'state-machine':
      warnings.push(...validateStateDiagram(diagram));
      break;
    case 'uml-component':
      warnings.push(...validateComponentDiagram(diagram));
      break;
  }

  return warnings;
}

/** Structured form used by the pipeline while preserving the legacy message API. */
export function validateUmlIssues(diagram: Diagram): ValidationIssue[] {
  return validateUmlSemantics(diagram).map((message) => {
    const elementId = message.match(/:\s*([^:/]+?)(?:\s*\/\s*[^:]+)?$/)?.[1]?.trim();
    const code = message.replace(/^\[UML\]\s*/i, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '').toUpperCase().slice(0, 80) || 'UML_VALIDATION_ISSUE';
    return { severity: 'WARNING', code, message, elementId, phase: 'semantic' };
  });
}

/**
 * 用例图语义验证
 */
function validateUseCaseDiagram(diagram: Diagram): string[] {
  const warnings: string[] = [];
  const nodes = diagram.nodes;
  const edges = diagram.edges;

  // 规则1: include/extend 只能在 usecase 之间
  for (const e of edges) {
    if (e.type === 'include' || e.type === 'extend') {
      const src = nodes.find(n => n.id === e.source);
      const tgt = nodes.find(n => n.id === e.target);

      if (src?.kind !== 'usecase' || tgt?.kind !== 'usecase') {
        warnings.push(`[UML] ${e.type} must connect usecases only: ${e.id}`);
      }
    }
  }

  // 规则2: actor 到 actor 应该使用 generalization 而不是 association
  for (const e of edges) {
    if (e.type === 'association') {
      const src = nodes.find(n => n.id === e.source);
      const tgt = nodes.find(n => n.id === e.target);

      if (src?.kind === 'actor' && tgt?.kind === 'actor') {
        warnings.push(`[UML] Actor-to-actor should use generalization, not association: ${e.id}`);
      }
    }
  }

  // 规则3: usecase 不能直接关联 usecase（应该用 include/extend）
  for (const e of edges) {
    if (e.type === 'association') {
      const src = nodes.find(n => n.id === e.source);
      const tgt = nodes.find(n => n.id === e.target);

      if (src?.kind === 'usecase' && tgt?.kind === 'usecase') {
        warnings.push(`[UML] Use-case to use-case should use <<include>> or <<extend>>: ${e.id}`);
      }
    }
  }

  // 规则4: 每个用例应该至少被一个 actor 使用
  const usedUseCases = new Set<string>();
  for (const e of edges) {
    if (e.type === 'association') {
      const src = nodes.find(n => n.id === e.source);
      const tgt = nodes.find(n => n.id === e.target);

      if (src?.kind === 'actor' && tgt?.kind === 'usecase') {
        usedUseCases.add(e.target);
      }
    }
  }

  for (const n of nodes) {
    if (n.kind === 'usecase' && !usedUseCases.has(n.id)) {
      // 检查是否是被 include/extend 引用的用例（这是合法的）
      const isIncludedOrExtended = edges.some(e =>
        (e.type === 'include' || e.type === 'extend') && (e.source === n.id || e.target === n.id)
      );

      if (!isIncludedOrExtended) {
        warnings.push(`[UML] Use-case not connected to any actor: ${n.id}`);
      }
    }
  }

  return warnings;
}

/**
 * 类图语义验证
 */
function validateClassDiagram(diagram: Diagram): string[] {
  const warnings: string[] = [];
  const edges = diagram.edges;

  // 规则1: 检测继承环
  const inheritanceGraph = new Map<string, string[]>();
  for (const e of edges.filter(x => x.type === 'inheritance')) {
    if (!inheritanceGraph.has(e.source)) {
      inheritanceGraph.set(e.source, []);
    }
    inheritanceGraph.get(e.source)!.push(e.target);
  }

  // DFS 检测环
  for (const [startNode, _] of inheritanceGraph) {
    const visited = new Set<string>();
    const recStack = new Set<string>();

    if (hasCycle(startNode, inheritanceGraph, visited, recStack)) {
      warnings.push(`[UML] Inheritance cycle detected involving: ${startNode}`);
    }
  }

  // 规则2: 组合关系不能双向
  const compositions = edges.filter(e => e.type === 'composition');
  for (let i = 0; i < compositions.length; i++) {
    for (let j = i + 1; j < compositions.length; j++) {
      const a = compositions[i];
      const b = compositions[j];

      if (a.source === b.target && a.target === b.source) {
        warnings.push(`[UML] Bidirectional composition detected: ${a.id} / ${b.id}`);
      }
    }
  }

  // 规则3: 聚合关系不能双向
  const aggregations = edges.filter(e => e.type === 'aggregation');
  for (let i = 0; i < aggregations.length; i++) {
    for (let j = i + 1; j < aggregations.length; j++) {
      const a = aggregations[i];
      const b = aggregations[j];

      if (a.source === b.target && a.target === b.source) {
        warnings.push(`[UML] Bidirectional aggregation detected: ${a.id} / ${b.id}`);
      }
    }
  }

  // 规则4: 一个类不能组合/聚合自己
  for (const e of edges) {
    if ((e.type === 'composition' || e.type === 'aggregation') && e.source === e.target) {
      warnings.push(`[UML] Self-composition/aggregation detected: ${e.id}`);
    }
  }

  // 规则5: 实现关系应该指向接口
  for (const e of edges.filter(x => x.type === 'realization')) {
    const target = diagram.nodes.find(n => n.id === e.target);
    if (target?.classMeta?.stereotype !== 'interface') {
      warnings.push(`[UML] Realization should target an interface: ${e.id}`);
    }
  }

  return warnings;
}

/**
 * 时序图语义验证
 */
function validateSequenceDiagram(diagram: Diagram): string[] {
  const warnings: string[] = [];
  const nodes = diagram.nodes;
  const edges = diagram.edges;
  const sequence = diagram.sequence;

  // 规则1: 消息必须在参与者之间
  for (const e of edges) {
    const src = nodes.find(n => n.id === e.source);
    const tgt = nodes.find(n => n.id === e.target);

    if (!src || !tgt) {
      warnings.push(`[UML] Message references non-existent participant: ${e.id}`);
    }
  }

  // 规则2: 激活条引用的消息必须存在
  if (sequence?.activations) {
    for (const activation of sequence.activations) {
      const startMsg = edges.find(e => e.id === activation.startMessageId);
      if (!startMsg) {
        warnings.push(`[UML] Activation references non-existent start message: ${activation.id}`);
      }

      if (activation.endMessageId) {
        const endMsg = edges.find(e => e.id === activation.endMessageId);
        if (!endMsg) {
          warnings.push(`[UML] Activation references non-existent end message: ${activation.id}`);
        }
      }

      // 检查激活条所属的参与者是否存在
      const participant = nodes.find(n => n.id === activation.participantId);
      if (!participant) {
        warnings.push(`[UML] Activation references non-existent participant: ${activation.id}`);
      }
    }
  }

  // 规则3: 组合片段引用的消息必须存在
  if (sequence?.fragments) {
    for (const fragment of sequence.fragments) {
      for (const msgId of fragment.messageIds) {
        const msg = edges.find(e => e.id === msgId);
        if (!msg) {
          warnings.push(`[UML] Combined fragment references non-existent message: ${fragment.id} -> ${msgId}`);
        }
      }
    }
  }

  // 规则4: 创建消息的目标必须是新参与者
  for (const e of edges.filter(x => x.messageKind === 'create')) {
    const firstMsgToTarget = edges.find(msg => msg.target === e.target);
    if (firstMsgToTarget && firstMsgToTarget.id !== e.id) {
      warnings.push(`[UML] Create message should be the first message to participant: ${e.id}`);
    }
  }

  return warnings;
}

/**
 * 状态图语义验证
 */
function validateStateDiagram(diagram: Diagram): string[] {
  const warnings: string[] = [];
  const nodes = diagram.nodes;
  const edges = diagram.edges;

  // 规则1: 初始状态只能有一个
  const initialStates = nodes.filter(n => n.kind === 'start');
  if (initialStates.length > 1) {
    warnings.push(`[UML] State diagram should have only one initial state, found ${initialStates.length}`);
  }

  // 规则2: 初始状态不能有入边
  for (const initial of initialStates) {
    const incomingEdges = edges.filter(e => e.target === initial.id);
    if (incomingEdges.length > 0) {
      warnings.push(`[UML] Initial state cannot have incoming transitions: ${initial.id}`);
    }
  }

  // 规则3: 终止状态不能有出边
  const finalStates = nodes.filter(n => n.kind === 'end');
  for (const final of finalStates) {
    const outgoingEdges = edges.filter(e => e.source === final.id);
    if (outgoingEdges.length > 0) {
      warnings.push(`[UML] Final state cannot have outgoing transitions: ${final.id}`);
    }
  }

  // 规则4: 检查是否有不可达状态
  if (initialStates.length === 1) {
    const reachable = new Set<string>();
    const queue = [initialStates[0].id];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (reachable.has(current)) continue;

      reachable.add(current);
      const outgoing = edges.filter(e => e.source === current);
      queue.push(...outgoing.map(e => e.target));
    }

    for (const node of nodes) {
      if (node.kind !== 'start' && !reachable.has(node.id)) {
        warnings.push(`[UML] Unreachable state: ${node.id}`);
      }
    }
  }

  return warnings;
}

/**
 * 组件图语义验证
 */
function validateComponentDiagram(diagram: Diagram): string[] {
  const warnings: string[] = [];
  const edges = diagram.edges;

  // 规则1: 检测组件依赖环
  const dependencyGraph = new Map<string, string[]>();
  for (const e of edges.filter(x => x.type === 'dependency')) {
    if (!dependencyGraph.has(e.source)) {
      dependencyGraph.set(e.source, []);
    }
    dependencyGraph.get(e.source)!.push(e.target);
  }

  // DFS 检测环
  for (const [startNode, _] of dependencyGraph) {
    const visited = new Set<string>();
    const recStack = new Set<string>();

    if (hasCycle(startNode, dependencyGraph, visited, recStack)) {
      warnings.push(`[UML] Circular dependency detected involving: ${startNode}`);
    }
  }

  return warnings;
}

/**
 * 辅助函数：DFS 检测有向图中的环
 */
function hasCycle(
  node: string,
  graph: Map<string, string[]>,
  visited: Set<string>,
  recStack: Set<string>
): boolean {
  if (recStack.has(node)) return true;
  if (visited.has(node)) return false;

  visited.add(node);
  recStack.add(node);

  const neighbors = graph.get(node) ?? [];
  for (const neighbor of neighbors) {
    if (hasCycle(neighbor, graph, visited, recStack)) {
      return true;
    }
  }

  recStack.delete(node);
  return false;
}
