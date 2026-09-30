import type { Diagram, ValidationIssue } from '../model/types.js';

/**
 * 验证 UML 图的语义规则。
 *
 * 每条规则都有一个**稳定错误码**（`UmlFinding.code`）。码是手写的常量，不是从提示语里
 * 抠出来的：早先的实现用正则把英文 message 转成大写下划线串当 code，于是改一个措辞就会
 * 改掉调用方依赖的码，`docs/ERROR_CODES.md` 也无法稳定成文。message 仍面向人读，
 * code 面向机器匹配，两者各自演进。
 *
 * 这些发现在默认 `ai-led` 档下是 INFO（不阻断、不触发重排），在 `strict` 档下是 WARNING；
 * 档位切换见 `src/validate/policy.ts`。
 */

/** 一条 UML 语义发现：稳定码 + 人读消息 + 相关元素 ID。 */
export interface UmlFinding {
  code: UmlRuleCode;
  message: string;
  elementId?: string;
}

/**
 * 全部 UML 规则码。新增规则时必须在这里登记，并在 `docs/ERROR_CODES.md` 的码表里补一行
 * （`scripts/generate-error-codes.ts --check` 会在两边不一致时失败）。
 */
export const UML_RULE_CODES = [
  'UML_USECASE_INCLUDE_EXTEND_ENDPOINT',
  'UML_USECASE_ACTOR_ASSOCIATION',
  'UML_USECASE_USECASE_ASSOCIATION',
  'UML_USECASE_NOT_USED_BY_ACTOR',
  'UML_CLASS_INHERITANCE_CYCLE',
  'UML_CLASS_BIDIRECTIONAL_COMPOSITION',
  'UML_CLASS_BIDIRECTIONAL_AGGREGATION',
  'UML_CLASS_SELF_COMPOSITION',
  'UML_CLASS_REALIZATION_TARGET_NOT_INTERFACE',
  'UML_SEQUENCE_MESSAGE_MISSING_PARTICIPANT',
  'UML_SEQUENCE_ACTIVATION_MISSING_START_MESSAGE',
  'UML_SEQUENCE_ACTIVATION_MISSING_END_MESSAGE',
  'UML_SEQUENCE_ACTIVATION_MISSING_PARTICIPANT',
  'UML_SEQUENCE_FRAGMENT_MISSING_MESSAGE',
  'UML_SEQUENCE_CREATE_NOT_FIRST_MESSAGE',
  'UML_STATE_MULTIPLE_INITIAL',
  'UML_STATE_INITIAL_HAS_INCOMING',
  'UML_STATE_FINAL_HAS_OUTGOING',
  'UML_STATE_UNREACHABLE',
  'UML_COMPONENT_DEPENDENCY_CYCLE',
] as const;

export type UmlRuleCode = (typeof UML_RULE_CODES)[number];

const finding = (code: UmlRuleCode, message: string, elementId?: string): UmlFinding => ({
  code,
  message,
  elementId,
});

/** 按图类型收集全部 UML 语义发现。概览派生视图（`metadata.overviewOf`）不评判。 */
export function collectUmlFindings(diagram: Diagram): UmlFinding[] {
  if (diagram.metadata?.overviewOf === diagram.type) return [];

  switch (diagram.type) {
    case 'uml-usecase':
      return validateUseCaseDiagram(diagram);
    case 'uml-class':
      return validateClassDiagram(diagram);
    case 'sequence':
      return validateSequenceDiagram(diagram);
    case 'state':
    case 'state-machine':
      return validateStateDiagram(diagram);
    case 'uml-component':
      return validateComponentDiagram(diagram);
    default:
      return [];
  }
}

/** 兼容旧调用方：只要人读消息文本。 */
export function validateUmlSemantics(diagram: Diagram): string[] {
  return collectUmlFindings(diagram).map((f) => f.message);
}

/** 流水线使用的结构化形式：稳定码 + 明确 elementId，不再靠正则从消息里猜。 */
export function validateUmlIssues(diagram: Diagram): ValidationIssue[] {
  return collectUmlFindings(diagram).map((f) => ({
    severity: 'WARNING' as const,
    code: f.code,
    message: f.message,
    elementId: f.elementId,
    phase: 'semantic' as const,
  }));
}

/**
 * 用例图语义验证
 */
function validateUseCaseDiagram(diagram: Diagram): UmlFinding[] {
  const findings: UmlFinding[] = [];
  const nodes = diagram.nodes;
  const edges = diagram.edges;

  // 规则1: include/extend 只能在 usecase 之间
  for (const e of edges) {
    if (e.type === 'include' || e.type === 'extend') {
      const src = nodes.find((n) => n.id === e.source);
      const tgt = nodes.find((n) => n.id === e.target);

      if (src?.kind !== 'usecase' || tgt?.kind !== 'usecase') {
        findings.push(
          finding('UML_USECASE_INCLUDE_EXTEND_ENDPOINT', `[UML] ${e.type} must connect usecases only: ${e.id}`, e.id),
        );
      }
    }
  }

  // 规则2: actor 到 actor 应该使用 generalization 而不是 association
  for (const e of edges) {
    if (e.type === 'association') {
      const src = nodes.find((n) => n.id === e.source);
      const tgt = nodes.find((n) => n.id === e.target);

      if (src?.kind === 'actor' && tgt?.kind === 'actor') {
        findings.push(
          finding(
            'UML_USECASE_ACTOR_ASSOCIATION',
            `[UML] Actor-to-actor should use generalization, not association: ${e.id}`,
            e.id,
          ),
        );
      }
    }
  }

  // 规则3: usecase 不能直接关联 usecase（应该用 include/extend）
  for (const e of edges) {
    if (e.type === 'association') {
      const src = nodes.find((n) => n.id === e.source);
      const tgt = nodes.find((n) => n.id === e.target);

      if (src?.kind === 'usecase' && tgt?.kind === 'usecase') {
        findings.push(
          finding(
            'UML_USECASE_USECASE_ASSOCIATION',
            `[UML] Use-case to use-case should use <<include>> or <<extend>>: ${e.id}`,
            e.id,
          ),
        );
      }
    }
  }

  // 规则4: 每个用例应该至少被一个 actor 使用
  const usedUseCases = new Set<string>();
  for (const e of edges) {
    if (e.type === 'association') {
      const src = nodes.find((n) => n.id === e.source);
      const tgt = nodes.find((n) => n.id === e.target);

      if (src?.kind === 'actor' && tgt?.kind === 'usecase') {
        usedUseCases.add(e.target);
      }
    }
  }

  for (const n of nodes) {
    if (n.kind === 'usecase' && !usedUseCases.has(n.id)) {
      // 检查是否是被 include/extend 引用的用例（这是合法的）
      const isIncludedOrExtended = edges.some(
        (e) => (e.type === 'include' || e.type === 'extend') && (e.source === n.id || e.target === n.id),
      );

      if (!isIncludedOrExtended) {
        findings.push(
          finding('UML_USECASE_NOT_USED_BY_ACTOR', `[UML] Use-case not connected to any actor: ${n.id}`, n.id),
        );
      }
    }
  }

  return findings;
}

/**
 * 类图语义验证
 */
function validateClassDiagram(diagram: Diagram): UmlFinding[] {
  const findings: UmlFinding[] = [];
  const edges = diagram.edges;

  // 规则1: 检测继承环
  const inheritanceGraph = new Map<string, string[]>();
  for (const e of edges.filter((x) => x.type === 'inheritance')) {
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
      findings.push(
        finding('UML_CLASS_INHERITANCE_CYCLE', `[UML] Inheritance cycle detected involving: ${startNode}`, startNode),
      );
    }
  }

  // 规则2: 组合关系不能双向
  const compositions = edges.filter((e) => e.type === 'composition');
  for (let i = 0; i < compositions.length; i++) {
    for (let j = i + 1; j < compositions.length; j++) {
      const a = compositions[i];
      const b = compositions[j];

      if (a.source === b.target && a.target === b.source) {
        findings.push(
          finding(
            'UML_CLASS_BIDIRECTIONAL_COMPOSITION',
            `[UML] Bidirectional composition detected: ${a.id} / ${b.id}`,
            a.id,
          ),
        );
      }
    }
  }

  // 规则3: 聚合关系不能双向
  const aggregations = edges.filter((e) => e.type === 'aggregation');
  for (let i = 0; i < aggregations.length; i++) {
    for (let j = i + 1; j < aggregations.length; j++) {
      const a = aggregations[i];
      const b = aggregations[j];

      if (a.source === b.target && a.target === b.source) {
        findings.push(
          finding(
            'UML_CLASS_BIDIRECTIONAL_AGGREGATION',
            `[UML] Bidirectional aggregation detected: ${a.id} / ${b.id}`,
            a.id,
          ),
        );
      }
    }
  }

  // 规则4: 一个类不能组合/聚合自己
  for (const e of edges) {
    if ((e.type === 'composition' || e.type === 'aggregation') && e.source === e.target) {
      findings.push(
        finding('UML_CLASS_SELF_COMPOSITION', `[UML] Self-composition/aggregation detected: ${e.id}`, e.id),
      );
    }
  }

  // 规则5: 实现关系应该指向接口
  for (const e of edges.filter((x) => x.type === 'realization')) {
    const target = diagram.nodes.find((n) => n.id === e.target);
    if (target?.classMeta?.stereotype !== 'interface') {
      findings.push(
        finding(
          'UML_CLASS_REALIZATION_TARGET_NOT_INTERFACE',
          `[UML] Realization should target an interface: ${e.id}`,
          e.id,
        ),
      );
    }
  }

  return findings;
}

/**
 * 时序图语义验证
 */
function validateSequenceDiagram(diagram: Diagram): UmlFinding[] {
  const findings: UmlFinding[] = [];
  const nodes = diagram.nodes;
  const edges = diagram.edges;
  const sequence = diagram.sequence;

  // 规则1: 消息必须在参与者之间
  for (const e of edges) {
    const src = nodes.find((n) => n.id === e.source);
    const tgt = nodes.find((n) => n.id === e.target);

    if (!src || !tgt) {
      findings.push(
        finding(
          'UML_SEQUENCE_MESSAGE_MISSING_PARTICIPANT',
          `[UML] Message references non-existent participant: ${e.id}`,
          e.id,
        ),
      );
    }
  }

  // 规则2: 激活条引用的消息必须存在
  if (sequence?.activations) {
    for (const activation of sequence.activations) {
      const startMsg = edges.find((e) => e.id === activation.startMessageId);
      if (!startMsg) {
        findings.push(
          finding(
            'UML_SEQUENCE_ACTIVATION_MISSING_START_MESSAGE',
            `[UML] Activation references non-existent start message: ${activation.id}`,
            activation.id,
          ),
        );
      }

      if (activation.endMessageId) {
        const endMsg = edges.find((e) => e.id === activation.endMessageId);
        if (!endMsg) {
          findings.push(
            finding(
              'UML_SEQUENCE_ACTIVATION_MISSING_END_MESSAGE',
              `[UML] Activation references non-existent end message: ${activation.id}`,
              activation.id,
            ),
          );
        }
      }

      // 检查激活条所属的参与者是否存在
      const participant = nodes.find((n) => n.id === activation.participantId);
      if (!participant) {
        findings.push(
          finding(
            'UML_SEQUENCE_ACTIVATION_MISSING_PARTICIPANT',
            `[UML] Activation references non-existent participant: ${activation.id}`,
            activation.id,
          ),
        );
      }
    }
  }

  // 规则3: 组合片段引用的消息必须存在
  if (sequence?.fragments) {
    for (const fragment of sequence.fragments) {
      for (const msgId of fragment.messageIds) {
        const msg = edges.find((e) => e.id === msgId);
        if (!msg) {
          findings.push(
            finding(
              'UML_SEQUENCE_FRAGMENT_MISSING_MESSAGE',
              `[UML] Combined fragment references non-existent message: ${fragment.id} -> ${msgId}`,
              fragment.id,
            ),
          );
        }
      }
    }
  }

  // 规则4: 创建消息的目标必须是新参与者
  for (const e of edges.filter((x) => x.messageKind === 'create')) {
    const firstMsgToTarget = edges.find((msg) => msg.target === e.target);
    if (firstMsgToTarget && firstMsgToTarget.id !== e.id) {
      findings.push(
        finding(
          'UML_SEQUENCE_CREATE_NOT_FIRST_MESSAGE',
          `[UML] Create message should be the first message to participant: ${e.id}`,
          e.id,
        ),
      );
    }
  }

  return findings;
}

/**
 * 状态图语义验证
 */
function validateStateDiagram(diagram: Diagram): UmlFinding[] {
  const findings: UmlFinding[] = [];
  const nodes = diagram.nodes;
  const edges = diagram.edges;

  // 规则1: 初始状态只能有一个
  const initialStates = nodes.filter((n) => n.kind === 'start');
  if (initialStates.length > 1) {
    findings.push(
      finding(
        'UML_STATE_MULTIPLE_INITIAL',
        `[UML] State diagram should have only one initial state, found ${initialStates.length}`,
      ),
    );
  }

  // 规则2: 初始状态不能有入边
  for (const initial of initialStates) {
    const incomingEdges = edges.filter((e) => e.target === initial.id);
    if (incomingEdges.length > 0) {
      findings.push(
        finding(
          'UML_STATE_INITIAL_HAS_INCOMING',
          `[UML] Initial state cannot have incoming transitions: ${initial.id}`,
          initial.id,
        ),
      );
    }
  }

  // 规则3: 终止状态不能有出边
  const finalStates = nodes.filter((n) => n.kind === 'end');
  for (const final of finalStates) {
    const outgoingEdges = edges.filter((e) => e.source === final.id);
    if (outgoingEdges.length > 0) {
      findings.push(
        finding(
          'UML_STATE_FINAL_HAS_OUTGOING',
          `[UML] Final state cannot have outgoing transitions: ${final.id}`,
          final.id,
        ),
      );
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
      const outgoing = edges.filter((e) => e.source === current);
      queue.push(...outgoing.map((e) => e.target));
    }

    for (const node of nodes) {
      if (node.kind !== 'start' && !reachable.has(node.id)) {
        findings.push(finding('UML_STATE_UNREACHABLE', `[UML] Unreachable state: ${node.id}`, node.id));
      }
    }
  }

  return findings;
}

/**
 * 组件图语义验证
 */
function validateComponentDiagram(diagram: Diagram): UmlFinding[] {
  const findings: UmlFinding[] = [];
  const edges = diagram.edges;

  // 规则1: 检测组件依赖环
  const dependencyGraph = new Map<string, string[]>();
  for (const e of edges.filter((x) => x.type === 'dependency')) {
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
      findings.push(
        finding(
          'UML_COMPONENT_DEPENDENCY_CYCLE',
          `[UML] Circular dependency detected involving: ${startNode}`,
          startNode,
        ),
      );
    }
  }

  return findings;
}

/**
 * 辅助函数：DFS 检测有向图中的环
 */
function hasCycle(node: string, graph: Map<string, string[]>, visited: Set<string>, recStack: Set<string>): boolean {
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
