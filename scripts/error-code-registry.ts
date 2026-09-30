/**
 * Curated metadata for every error / issue code the tool can emit.
 *
 * This file is the human half of `docs/ERROR_CODES.md`. The other half — which codes
 * exist, and what severity they carry under each validation profile — is derived from
 * source by `scripts/generate-error-codes.ts`, so the code list can never drift away
 * from the code that emits it.
 *
 * Rules (enforced by `npm run error-codes -- --check` in CI):
 *   - every code literal found in `src/` must have an entry here, or be listed in
 *     NON_CODE_LITERALS with a reason;
 *   - every entry here must still appear in `src/` (no ghost documentation);
 *   - `summary` and `fix` must be non-empty prose, not a restatement of the code name;
 *   - where the emission site is mechanically readable, `severity` and `phase` here must
 *     match what the source actually emits.
 */

/** What kind of thing a code reports. Drives the section it lands in. */
export type CodeCategory =
  | 'semantic' // the figure's meaning: type-specific notation and reference integrity
  | 'uml' // UML notation rules
  | 'layout' // geometry measured after ELK ran
  | 'engine' // what the layout engine itself did or refused to do
  | 'render' // renderer output integrity (.drawio / .svg)
  | 'plan' // the plan-answer gate (evidence, confidence, stable IDs, geometry ban)
  | 'visual' // the visual review gate (bitmap review -> LayoutPreferences)
  | 'request'; // MCP/CLI request-level refusal, not a validation finding

export interface ErrorCodeEntry {
  category: CodeCategory;
  /** What happened, in one sentence, for a person who has never read the source. */
  summary: string;
  /** What to do about it. Must name a concrete lever, not "fix the diagram". */
  fix: string;
  /**
   * Severity as emitted, i.e. what you see under `layout.profile: "strict"`.
   * The `ai-led` column is computed from `src/validate/policy.ts`, never curated here.
   * Request-level codes and visual hint codes carry no fixed severity.
   */
  severity?: 'ERROR' | 'WARNING' | 'INFO';
  /** Pipeline phase recorded on the issue. Request-level codes have none. */
  phase?: 'semantic' | 'layout' | 'render';
  /**
   * Set when the emitting path pushes the issue *after* `applyProfile` ran, so the profile
   * never sees it and the severity is the same in both profiles. This is deliberate for
   * SEMANTIC_AUDIT_SKIPPED (a statement about review coverage, not a judgement of the
   * figure — see the comment in src/validate/policy.ts) and is pinned by
   * tests/agent-intake.test.ts. Without this flag the generator would compute a downgrade
   * that does not actually happen at runtime.
   */
  notProfiled?: true;
}

/**
 * UPPER_SNAKE string literals in `src/` that are NOT error codes. Each needs a reason:
 * an unexplained allowlist entry is how a real code gets silently skipped later.
 */
export const NON_CODE_LITERALS: Readonly<Record<string, string>> = {
  TOP_TO_BOTTOM: 'Direction 枚举值',
  BOTTOM_TO_TOP: 'Direction 枚举值',
  LEFT_TO_RIGHT: 'Direction 枚举值',
  RIGHT_TO_LEFT: 'Direction 枚举值',
  FIRST_SEPARATE: 'LayerPlacement 枚举值',
  LAST_SEPARATE: 'LayerPlacement 枚举值',
  SINGLE_EDGE: 'LayoutPreferences.wrapping 枚举值',
  MULTI_EDGE: 'LayoutPreferences.wrapping 枚举值',
  DRAWIO_PATH: '环境变量名（指定 draw.io 可执行文件）',
  FIXED_SIDE: 'ELK elk.portConstraints 选项值',
  INCLUDE_CHILDREN: 'ELK elk.hierarchyHandling 选项值',
  NODES_AND_EDGES: 'ELK elk.layered.considerModelOrder.strategy 选项值',
  NETWORK_SIMPLEX: 'ELK elk.layered.nodePlacement.strategy 选项值',
  BRANDES_KOEPF: 'ELK 节点放置策略选项值',
  LAYER_SWEEP: 'ELK 交叉最小化策略选项值',
};

export const ERROR_CODE_REGISTRY: Readonly<Record<string, ErrorCodeEntry>> = {
  // ---------------------------------------------------------------- 语义层（按图类型）

  ACTIVITY_MISSING_INITIAL: {
    category: 'semantic',
    severity: 'WARNING',
    phase: 'semantic',
    summary: '活动图里没有任何 `kind: "start"` 节点，读者看不出流程从哪开始。',
    fix: '加一个 `kind: "start"` 节点并连出第一条对象流/控制流；确实没有起点（例如片段摘录）就忽略这条 INFO。',
  },
  ACTIVITY_MISSING_FINAL: {
    category: 'semantic',
    severity: 'WARNING',
    phase: 'semantic',
    summary: '活动图里没有任何 `kind: "end"` 节点，流程没有可见的终止。',
    fix: '加一个 `kind: "end"` 节点；多出口流程可以有多个终止节点。',
  },
  ACTIVITY_SWIMLANE_MISSING_NODE: {
    category: 'semantic',
    severity: 'ERROR',
    phase: 'semantic',
    summary: '`activity.swimlanes[].nodeIds` 指向一个不存在的节点——泳道会画出一个空框或漏掉成员。',
    fix: '把该 ID 改成真实节点 ID，或从 `nodeIds` 里删掉它。引用完整性属于工具的核心承诺，两个档位下都阻断。',
  },
  ACTIVITY_OBJECT_FLOW_MISSING_EDGE: {
    category: 'semantic',
    severity: 'ERROR',
    phase: 'semantic',
    summary: '`activity.objectFlows` 列出的边 ID 在 `edges` 里不存在，对象流画不出来。',
    fix: '补上对应的边，或从 `objectFlows` 里删掉这个 ID。',
  },
  CHEN_ER_MISSING_ENTITY: {
    category: 'semantic',
    severity: 'WARNING',
    phase: 'semantic',
    summary: '`chenEr.entityIds` 指向的节点不存在，或整张 Chen ER 图没有任何实体。',
    fix: '核对 `chenEr.entityIds` 与 `nodes[].id`；Chen 记法要求实体用矩形，确认节点 `kind` 是 `entity` 或 `weak-entity`。',
  },
  CHEN_ER_MISSING_ATTRIBUTE: {
    category: 'semantic',
    severity: 'WARNING',
    phase: 'semantic',
    summary: '`chenEr.attributeIds` 指向的节点不存在，或图里没有任何属性椭圆。',
    fix: '核对 `chenEr.attributeIds`；属性节点 `kind` 应为 `attribute` / `key-attribute` / `multivalued-attribute` / `derived-attribute`。',
  },
  CHEN_ER_MISSING_RELATIONSHIP: {
    category: 'semantic',
    severity: 'WARNING',
    phase: 'semantic',
    summary: '`chenEr.relationshipIds` 指向的节点不存在，或图里没有任何联系菱形。',
    fix: '核对 `chenEr.relationshipIds`；联系节点 `kind` 应为 `relationship` 或 `identifying-relationship`。',
  },
  CHEN_ER_INVALID_RELATIONSHIP: {
    category: 'semantic',
    severity: 'WARNING',
    phase: 'semantic',
    summary: "Chen ER 图里出现了该记法不用的关系类型（Chen 记法用无箭头 association + 基数标签，不用 crow's foot）。",
    fix: "把边的 `type` 改成 `association`，基数写在 `label`（`1` / `N` / `M` / `M:N`）；要 crow's foot 记法请改用 `er` 图类型。",
  },
  CHEN_RELATIONSHIP_MISSING_CARDINALITY: {
    category: 'semantic',
    severity: 'WARNING',
    phase: 'semantic',
    summary: '联系没有标基数。工具**不会替你猜** 1:N 还是 M:N，所以只报不补。',
    fix: '在联系边的 `label` 上写明基数。`--chain` 的 Chen ER 三段式里写「基数 M:N」即可。',
  },
  CHEN_RELATIONSHIP_TOO_FEW_ENDPOINTS: {
    category: 'semantic',
    severity: 'ERROR',
    phase: 'semantic',
    summary: '一个联系（菱形）连接的两端不足两个，画出来是悬空的菱形。',
    fix: '给这条联系补齐两端实体，或删掉它。二元联系是 Chen 记法的基本单位。',
  },
  DEPLOYMENT_MISSING_DEVICE: {
    category: 'semantic',
    severity: 'WARNING',
    phase: 'semantic',
    summary: '部署图里没有任何 `kind` 为 device/server/database 的节点，只剩制品框。',
    fix: '补上承载节点（`kind: "device"` / `"server"` / `"database"`），再用 `deployment.artifacts[].deployedOn` 把制品挂上去。',
  },
  DEPLOYMENT_MISSING_TARGET: {
    category: 'semantic',
    severity: 'ERROR',
    phase: 'semantic',
    summary: '`deployment.artifacts[].deployedOn` 指向不存在的节点，制品无处安放。',
    fix: '把 `deployedOn` 改成真实节点 ID，或删掉这个制品。',
  },
  ER_ENTITY_MISSING_NODE: {
    category: 'semantic',
    severity: 'ERROR',
    phase: 'semantic',
    summary: '`er.entities` 列出的实体 ID 在 `nodes` 里不存在。',
    fix: '补上该节点，或从 `er.entities` 里删掉它。',
  },
  ER_INVALID_RELATIONSHIP: {
    category: 'semantic',
    severity: 'WARNING',
    phase: 'semantic',
    summary: 'ER 图里出现了不适合该记法的关系类型（ER 用 foreign-key / association 加基数，不用 UML 的继承菱形）。',
    fix: '把边 `type` 改成 `foreign-key` 或 `association`，基数写在 `sourceMultiplicity` / `targetMultiplicity`（如 `1`、`0..*`、`1..*`）。',
  },
  MINDMAP_MISSING_ROOT: {
    category: 'semantic',
    severity: 'WARNING',
    phase: 'semantic',
    summary: '思维导图没有 `kind: "root"` 的中心主题，分支无从挂靠。',
    fix: '给中心节点加 `kind: "root"`。`mrtree` 布局算法也需要一个明确的树根才有意义。',
  },
  RELATIONSHIP_MISSING_NODE: {
    category: 'semantic',
    severity: 'ERROR',
    phase: 'semantic',
    summary: '边的 `source` 或 `target` 指向不存在的节点——这条关系画不出来。',
    fix: '改成真实节点 ID，或删掉这条边。注意 `createDiagram` 也会拦这类断引用；这条是模型绕过构造器直接进管线时的兜底。',
  },
  SEQUENCE_MISSING_PARTICIPANT: {
    category: 'semantic',
    severity: 'WARNING',
    phase: 'semantic',
    summary: '时序图没有 `kind: "participant"` 节点， lifeline 无从画起。',
    fix: '把消息两端的节点 `kind` 设为 `participant`。',
  },
  SEQUENCE_EMPTY_FRAGMENT: {
    category: 'semantic',
    severity: 'WARNING',
    phase: 'semantic',
    summary: '`sequence.fragments` 里有个组合片段（alt/opt/loop/par…）的 `messageIds` 是空的，会画出一个空框。',
    fix: '给该片段填上它覆盖的消息 ID，或删掉这个片段。',
  },
  STATE_MISSING_INITIAL: {
    category: 'semantic',
    severity: 'WARNING',
    phase: 'semantic',
    summary: '状态机没有 `kind: "start"` 的初始伪状态。',
    fix: '加一个 `kind: "start"` 节点。UML 2.5 的 14.2.3.4 要求状态机有唯一初始伪状态，渲染成实心圆。',
  },
  STATE_MISSING_FINAL: {
    category: 'semantic',
    severity: 'WARNING',
    phase: 'semantic',
    summary: '状态机没有 `kind: "end"` 的终止伪状态。',
    fix: '加一个 `kind: "end"` 节点（渲染成双圈）。长驻进程类状态机确实可以没有终止态，那就忽略这条 INFO。',
  },
  STATE_INVALID_TRANSITION: {
    category: 'semantic',
    severity: 'WARNING',
    phase: 'semantic',
    summary:
      '状态迁移的关系类型不是状态图该用的那种（状态图用带 guard/action 的 transition，不用 UML 类图的继承/聚合）。',
    fix: '把边 `type` 留空或设为 `flow`，条件写在 `guard`、动作写在 `action`。',
  },
  STATE_COMPOSITE_MISSING_NODE: {
    category: 'semantic',
    severity: 'ERROR',
    phase: 'semantic',
    summary: '`state.composites[].nodeIds` 指向不存在的节点，复合状态框会缺成员。',
    fix: '核对成员 ID；复合状态的成员必须同时是 `nodes` 里的真实节点。',
  },
  TIMELINE_MISSING_MILESTONE: {
    category: 'semantic',
    severity: 'WARNING',
    phase: 'semantic',
    summary: '时间线图没有任何 `kind: "milestone"` 节点，只剩时间点。',
    fix: '给关键节点加 `kind: "milestone"`；时间线的可读性主要靠里程碑锚点。',
  },
  USECASE_MISSING_ACTOR: {
    category: 'semantic',
    severity: 'WARNING',
    phase: 'semantic',
    summary: '用例图里没有任何 `kind: "actor"` 节点——没有参与者就不成其为用例图。',
    fix: '补上 Actor 节点并用 `type: "association"` 连到用例。**不要**用系统架构图代替用例图。',
  },
  USECASE_MISSING_USECASE: {
    category: 'semantic',
    severity: 'WARNING',
    phase: 'semantic',
    summary: '用例图里没有任何 `kind: "usecase"` 节点。',
    fix: '补上用例节点（渲染成椭圆）。',
  },
  USECASE_INVALID_FLOW: {
    category: 'semantic',
    severity: 'WARNING',
    phase: 'semantic',
    summary: '用例图里出现了 `flow` 这类流程边——用例图表达的是「谁能用什么」，不是「先后顺序」。',
    fix: '把边 `type` 改成 `association`（Actor↔用例）、`include` / `extend`（用例↔用例）或 `generalization`（Actor↔Actor）。要表达顺序请改用 `flowchart` 或 `activity`。',
  },

  // ---------------------------------------------------------------- UML 记法

  UML_USECASE_INCLUDE_EXTEND_ENDPOINT: {
    category: 'uml',
    severity: 'WARNING',
    phase: 'semantic',
    summary: '`include` / `extend` 边的两端不都是用例——这两个关系只定义在用例之间。',
    fix: '把端点换成 `kind: "usecase"` 的节点；Actor 与用例之间用 `association`。',
  },
  UML_USECASE_ACTOR_ASSOCIATION: {
    category: 'uml',
    severity: 'WARNING',
    phase: 'semantic',
    summary: '两个 Actor 之间用了 `association`。Actor 之间的泛化（如 Admin 是 User 的一种）应该用 `generalization`。',
    fix: '把这条边的 `type` 改成 `generalization`（渲染成空心三角箭头）。',
  },
  UML_USECASE_USECASE_ASSOCIATION: {
    category: 'uml',
    severity: 'WARNING',
    phase: 'semantic',
    summary: '两个用例之间用了 `association`。用例之间的复用关系应该用 `include`（必然包含）或 `extend`（可选扩展）。',
    fix: '把 `type` 改成 `include` 或 `extend`，方向按 UML 语义：`A include B` 表示 A 必然执行 B。',
  },
  UML_USECASE_NOT_USED_BY_ACTOR: {
    category: 'uml',
    severity: 'WARNING',
    phase: 'semantic',
    summary: '某个用例既没有任何 Actor 关联，也没有被别的用例 include/extend——它在系统里无法被触发。',
    fix: '给它连一个 Actor，或让它成为某个用例的 include/extend 目标；确实是废用例就删掉。',
  },
  UML_CLASS_INHERITANCE_CYCLE: {
    category: 'uml',
    severity: 'WARNING',
    phase: 'semantic',
    summary: '继承关系成环（A 继承 B、B 又继承 A）。这样的类层次无法实例化，布局也分不出层次。',
    fix: '断开环上的一条 `inheritance` 边。通常是把「共享实现」误当成了「是一种」，考虑改用 `association` 或抽出共同父类。',
  },
  UML_CLASS_BIDIRECTIONAL_COMPOSITION: {
    category: 'uml',
    severity: 'WARNING',
    phase: 'semantic',
    summary: '两个类互相组合对方。组合是强所有权且生命周期绑定，双向意味着两者都不能独立存在——逻辑上矛盾。',
    fix: '只保留一个方向的 `composition`；如果两边确实互相持有引用，那通常是 `aggregation` 或 `association`。',
  },
  UML_CLASS_BIDIRECTIONAL_AGGREGATION: {
    category: 'uml',
    severity: 'WARNING',
    phase: 'semantic',
    summary: '两个类互相聚合对方，整体/部分关系分不出来。',
    fix: '确定谁是整体、谁是部分，只保留那一条 `aggregation`；对等引用改用 `association`。',
  },
  UML_CLASS_SELF_COMPOSITION: {
    category: 'uml',
    severity: 'WARNING',
    phase: 'semantic',
    summary: '一个类组合或聚合它自己（边的 source 与 target 相同）。',
    fix: '自引用通常是「树形结构」，用 `association` 并在 `sourceMultiplicity` / `targetMultiplicity` 上写 `1` / `0..*`；组合自己意味着自己的生命周期依赖自己。',
  },
  UML_CLASS_REALIZATION_TARGET_NOT_INTERFACE: {
    category: 'uml',
    severity: 'WARNING',
    phase: 'semantic',
    summary:
      '`realization`（虚线空心三角）指向的目标类 `classMeta.stereotype` 不是 `interface`。实现关系应当指向接口。',
    fix: '给目标节点加 `classMeta: { stereotype: "interface" }`；如果目标其实是普通父类，这条边应该是 `inheritance`（实线空心三角）。',
  },
  UML_SEQUENCE_MESSAGE_MISSING_PARTICIPANT: {
    category: 'uml',
    severity: 'WARNING',
    phase: 'semantic',
    summary: '某条消息的 `source` 或 `target` 不是图里的参与者，消息画不到任何 lifeline 上。',
    fix: '核对消息端点 ID 与 `nodes[].id`。',
  },
  UML_SEQUENCE_ACTIVATION_MISSING_START_MESSAGE: {
    category: 'uml',
    severity: 'WARNING',
    phase: 'semantic',
    summary: '激活条的 `startMessageId` 指向不存在的消息，激活条没有起点。',
    fix: '改成真实消息 ID，或删掉这个激活条。消息序号会按出现顺序自动重编，不要用序号当 ID。',
  },
  UML_SEQUENCE_ACTIVATION_MISSING_END_MESSAGE: {
    category: 'uml',
    severity: 'WARNING',
    phase: 'semantic',
    summary: '激活条的 `endMessageId` 指向不存在的消息，激活条没有终点。',
    fix: '改成真实消息 ID；`endMessageId` 可省略，省略时激活条画到该参与者最后一条消息。',
  },
  UML_SEQUENCE_ACTIVATION_MISSING_PARTICIPANT: {
    category: 'uml',
    severity: 'WARNING',
    phase: 'semantic',
    summary: '激活条的 `participantId` 指向不存在的参与者。',
    fix: '改成真实参与者 ID。',
  },
  UML_SEQUENCE_FRAGMENT_MISSING_MESSAGE: {
    category: 'uml',
    severity: 'WARNING',
    phase: 'semantic',
    summary: '组合片段（alt/opt/loop/par/break/critical）的 `messageIds` 里有不存在的消息，片段框会画错范围。',
    fix: '核对 `messageIds`；片段应当覆盖连续的一段消息。',
  },
  UML_SEQUENCE_CREATE_NOT_FIRST_MESSAGE: {
    category: 'uml',
    severity: 'WARNING',
    phase: 'semantic',
    summary: '`messageKind: "create"` 的消息不是发给该参与者的第一条消息——但 create 意味着对象在此刻才被创建。',
    fix: '把真正的创建消息标成 `create`，后续消息用 `call`；如果对象本来就存在，这条不该是 `create`。',
  },
  UML_STATE_MULTIPLE_INITIAL: {
    category: 'uml',
    severity: 'WARNING',
    phase: 'semantic',
    summary: '图里有多于一个 `kind: "start"` 的初始伪状态。UML 规定一个状态机只有一个初始态。',
    fix: '只保留一个 `start`；多个入口通常意味着这其实是两个状态机，或者那些节点是普通状态而非初始伪状态。',
  },
  UML_STATE_INITIAL_HAS_INCOMING: {
    category: 'uml',
    severity: 'WARNING',
    phase: 'semantic',
    summary: '初始伪状态有入边。初始态只出不进。',
    fix: '删掉指向 `start` 节点的边；「回到初始状态」应当指向一个普通状态或用 `final` 表示结束。',
  },
  UML_STATE_FINAL_HAS_OUTGOING: {
    category: 'uml',
    severity: 'WARNING',
    phase: 'semantic',
    summary: '终止伪状态有出边。终止态只进不出。',
    fix: '删掉从 `end` 节点出发的边；如果流程确实会继续，那个节点不是终止态。',
  },
  UML_STATE_UNREACHABLE: {
    category: 'uml',
    severity: 'WARNING',
    phase: 'semantic',
    summary: '从唯一的初始态出发走不到这个状态——它是死代码，永远不会进入。',
    fix: '补上进入它的迁移，或删掉该状态。注意这条只在恰好有一个初始态时才检查。',
  },
  UML_COMPONENT_DEPENDENCY_CYCLE: {
    category: 'uml',
    severity: 'WARNING',
    phase: 'semantic',
    summary: '组件依赖成环。环形依赖让组件无法独立编译、测试或部署。',
    fix: '断开环上的一条 `dependency`：通常是抽出一个双方都依赖的接口组件，或把职责搬回正确的一侧。',
  },
  UML_CLASS_INVALID_EDGE_TYPE: {
    category: 'uml',
    severity: 'WARNING',
    phase: 'semantic',
    summary: '类图里出现了 `flow` 或 `foreign-key` 边。类图表达静态结构，不表达流程，也不用数据库记法。',
    fix: '改成 UML 关系：`association` / `dependency` / `inheritance` / `realization` / `aggregation` / `composition`。要表达流程用 `flowchart`，要表达表关系用 `er`。',
  },
  UML_CLASS_MISSING_GENERALIZATION: {
    category: 'uml',
    severity: 'WARNING',
    phase: 'semantic',
    summary: '类图里一条泛化/实现关系都没有，全是平铺的类。',
    fix: '如果确实没有继承层次，这条可以忽略；如果有，补上 `inheritance`（实线空心三角）或 `realization`（虚线空心三角）。',
  },
  UML_COMPONENT_INVALID_RELATIONSHIP: {
    category: 'uml',
    severity: 'WARNING',
    phase: 'semantic',
    summary: '组件图里出现了不适合该图的关系类型（组件图用 dependency、association 与接口提供/需求，不用继承菱形）。',
    fix: '把边 `type` 改成 `dependency` 或 `association`；接口关系用组件的提供/需求接口表达。',
  },

  // ---------------------------------------------------------------- 布局层（几何测量）

  NODE_OVERLAP: {
    category: 'layout',
    severity: 'ERROR',
    phase: 'layout',
    summary: '两个节点的矩形相交。这是工具最核心的承诺之一，**两个档位下都阻断**。',
    fix: '通常自动重排能修（本码在 `SPACING_FIXABLE` 里，回路会加大 `nodeSpacing` / `layerSpacing`）。修不动时说明是节点尺寸被显式写死了——检查 `nodes[].width/height` 是否小于文字实际需要的尺寸。',
  },
  EDGE_THROUGH_NODE: {
    category: 'layout',
    severity: 'ERROR',
    phase: 'layout',
    summary: '某条边的路径穿过一个与它无关的节点。端点接触和共线重叠也算穿越。',
    fix: '自动重排会试着加大间距（本码在 `SPACING_FIXABLE` 里）。若仍失败，改结构：把长边改接、用容器把相关节点分组，或拆分大图。',
  },
  EDGE_CROSSING: {
    category: 'layout',
    severity: 'ERROR',
    phase: 'layout',
    summary: '两条无公共端点的边互相交叉。',
    fix: '**加大间距实测修不了这条**（真实 11 节点模型上 x1→x4 交叉数恒为 1，画幅却从 1839×511 撑到 3243×871），所以回路会立刻停下并报 `RELAYOUT_NOT_FIXABLE_BY_PREFERENCES`。只能改结构：去掉或改接跨层长边、容器分组、`constraints.placement` 定层、或拆分。',
  },
  EDGE_UNROUTED: {
    category: 'layout',
    severity: 'ERROR',
    phase: 'layout',
    summary: '某条边完全没有路径。注意区分：没有拐点 = 直线（合法），没有任何 section = 没画出来（本码）。',
    fix: '先确认不是 `layout.algorithm` 选了 `stress` / `radial`——那两个算法下 ELK 偶尔漏画边，此时应由 `vendor/libavoid` 替补连线器补上并报 `EDGE_ROUTED_BY_FALLBACK`。连替补都补不出来才报本码，那就改结构或换回 `layered`。',
  },
  TEXT_OVERFLOW: {
    category: 'layout',
    severity: 'ERROR',
    phase: 'layout',
    summary: '节点盒子装不下它的文字（按字符宽度实测，含 `«PK»` 这类记号）。',
    fix: '默认不会发生——尺寸过小时会自动扩张。出现本码说明显式写了过小的 `width`/`height`：删掉它让工具测量，或把值放大到报告里给出的 needed 尺寸以上。',
  },
  CANVAS_OVERFLOW: {
    category: 'layout',
    severity: 'ERROR',
    phase: 'layout',
    summary: '有元素落在声明的画布尺寸之外（`layout.width/height` 小于实际内容边界）。',
    fix: '自动重排会加大间距修它（本码在 `SPACING_FIXABLE` 里）。若仍失败，检查是不是显式写死了画布尺寸或 `svgPad` / `rootPadding` 为负。',
  },
  NODE_OUTSIDE_CONTAINER: {
    category: 'layout',
    severity: 'ERROR',
    phase: 'layout',
    summary:
      '节点落在它所属容器的框外。容器是参与布局的 ELK compound node，不是渲染阶段后补的背景框，所以这条意味着布局真的错了。',
    fix: '已知触发条件：`layout.algorithm: "radial"` 与 Container 同时使用。改回 `layered`（或 `auto`），`radial` 只作为不含容器的图的显式选择。',
  },
  PORT_OUTSIDE_NODE: {
    category: 'layout',
    severity: 'ERROR',
    phase: 'layout',
    summary: '端口中心不在它所属节点的边界上（容差为端口自身尺寸 + 2）。',
    fix: '检查 `nodes[].ports[].side` 是否与端口坐标一致；端口以 `FIXED_SIDE` 送入 ELK，side 写错会把端口钉到错误的边上。',
  },
  BROKEN_EDGE: {
    category: 'layout',
    severity: 'ERROR',
    phase: 'layout',
    summary: '布局后的边引用了一个布局结果里不存在的节点。',
    fix: '通常是模型里 `source`/`target` 拼错，或该节点在拆分/补丁过程中被删掉了。核对 `edges[].source` 与 `edges[].target`。',
  },
  BROKEN_SOURCE_PORT: {
    category: 'layout',
    severity: 'ERROR',
    phase: 'layout',
    summary: '边的 `sourcePort` 指向一个不属于源节点的端口 ID。',
    fix: '端口必须定义在**这条边的源节点**上；把 `sourcePort` 改成该节点 `ports[].id` 里的值，或删掉它让工具自动选边。',
  },
  BROKEN_TARGET_PORT: {
    category: 'layout',
    severity: 'ERROR',
    phase: 'layout',
    summary: '边的 `targetPort` 指向一个不属于目标节点的端口 ID。',
    fix: '同上，端口必须定义在这条边的目标节点上。',
  },
  BROKEN_CONTAINER_NODE: {
    category: 'layout',
    severity: 'ERROR',
    phase: 'layout',
    summary: '`containers[].nodeIds` 里有一个不存在的节点 ID。',
    fix: '核对容器成员 ID；节点也可以通过 `nodes[].containerId` 归属容器，两处不一致时以先出现的为准。',
  },
  BROKEN_CONTAINER_HIERARCHY: {
    category: 'layout',
    severity: 'ERROR',
    phase: 'layout',
    summary: '容器的 `parentId` 指向一个不存在的容器。',
    fix: '补上父容器，或删掉 `parentId`。嵌套容器也可以用 `containerIds` 声明，但两侧必须一致（见 `CONTAINER_HIERARCHY_CYCLE`）。',
  },
  CONTAINER_HIERARCHY_CYCLE: {
    category: 'layout',
    severity: 'ERROR',
    phase: 'layout',
    summary: '容器嵌套成环（A 的父级链上又出现 A）。ELK 无法为环形层级计算布局。',
    fix: '断开环上的一条 `parentId` / `containerIds` 关系。',
  },
  CONTAINER_OVERLAP: {
    category: 'layout',
    severity: 'ERROR',
    phase: 'layout',
    summary: '两个**没有嵌套关系**的容器矩形相交。父子容器相交是正常的，兄弟容器相交不是。',
    fix: '通常是某个容器漏写了 `parentId`，导致本该嵌套的容器被当成兄弟。补上嵌套关系，或调整容器成员划分。',
  },
  DUPLICATE_NODE: {
    category: 'layout',
    severity: 'ERROR',
    phase: 'layout',
    summary: '布局结果里出现了重复的节点 ID。稳定 ID 是增量编辑与 Git diff 的基础，重复即失效。',
    fix: '`createDiagram` 本应拦下这条；出现它说明模型绕过了构造器（例如直接改了 `.model.json`）。去掉重复 ID。',
  },
  DUPLICATE_EDGE: {
    category: 'layout',
    severity: 'ERROR',
    phase: 'layout',
    summary: '布局结果里出现了重复的边 ID。',
    fix: '同上，去掉重复 ID。注意「同一对节点之间有两条边」是合法的（见 `DUPLICATE_EDGE_RELATIONSHIP`），重复的是 **ID**。',
  },
  DUPLICATE_EDGE_RELATIONSHIP: {
    category: 'layout',
    severity: 'WARNING',
    phase: 'layout',
    summary: '两条边的 source、端口、target、类型和标签**全部相同**——画出来会完全重叠，其中一条等于看不见。',
    fix: '删掉冗余的那条，或给它们不同的 `label` / 端口 / 类型。默认档下降为 INFO（重复关系是品味问题，不是画错了）。',
  },
  ORPHAN_NODE: {
    category: 'layout',
    severity: 'WARNING',
    phase: 'layout',
    summary: '这个节点没有任何边相连（图里多于一个节点时才检查）。',
    fix: '给它连上关系，或删掉它。孤立节点在架构图里有时是有意的（例如「待接入」），默认档下降为 INFO。',
  },
  EXCESSIVE_DENSITY: {
    category: 'layout',
    severity: 'WARNING',
    phase: 'layout',
    summary: '节点总面积占画布面积超过 0.62，图看起来挤成一团。',
    fix: '自动重排会加大间距（本码在 `SPACING_FIXABLE` 里）。也可以显式写 `layout.density: "spacious"` 或调大 `nodeSpacing`。默认档下降为 INFO。',
  },
  EXCESSIVE_WHITESPACE: {
    category: 'layout',
    severity: 'WARNING',
    phase: 'layout',
    summary: '节点多于 4 个但总面积占画布不到 0.025——画布上有大片空白，通常是被一条超长边撑开的。',
    fix: '默认档下降为 INFO，且**不在** `SPACING_FIXABLE` 里（缩小间距实测修不了它，只会让别处重叠）。真正的原因是结构：找那条跨层长边并改接它。',
  },
  EXTREMELY_LONG_EDGE: {
    category: 'layout',
    severity: 'WARNING',
    phase: 'layout',
    summary: '某条边的折线总长超过画布长边的 80%。',
    fix: '默认档下降为 INFO。这几乎总是「跨层长边」的信号——把它改接到中间层、用容器分组，或拆分大图。拧间距没用。',
  },
  LARGE_DIAGRAM: {
    category: 'layout',
    severity: 'WARNING',
    phase: 'layout',
    summary: '节点超过 40 个。这只是提示，不是错误。',
    fix: 'CLI 默认会按顶层 Container 自动拆成 `main.drawio` 概览 + 各子系统图（没有 Container 时按稳定节点顺序拆 `part-1`、`part-2`）。确实要一张图就设 `constraints.forceSingle: true`，警告会保留。',
  },
  EDGE_LABEL_OVERLAP: {
    category: 'layout',
    severity: 'ERROR',
    phase: 'layout',
    summary: '边标签压在了某个节点上，或两个边标签互相重叠。',
    fix: '调小 `layout.edgeLabelFontSize`，或缩短标签文字。注意本码虽以 ERROR 发射，但在 `AESTHETIC_LAYOUT_CODES` 里——**默认 `ai-led` 档下降为 INFO**，因为「文字压在一起」是观感判断，不是图在说谎。',
  },

  // ---------------------------------------------------------------- 引擎层

  RELAYOUT_NOT_FIXABLE_BY_PREFERENCES: {
    category: 'engine',
    severity: 'WARNING',
    phase: 'layout',
    summary:
      '重排回路发现剩下的问题**没有任何偏好旋钮能修**，于是立刻停下，把问题交回构图层。`status` 同时变为 `failed_composition_needed`。',
    fix: '按提示改**结构**，别再调参数：去掉或改接跨层长边、用容器分组、`constraints.placement` 定层、或拆分。提示文案里不会出现 `direction`、节点次序、`layout.algorithm` 这些实测无效的杠杆（有测试钉住这一点）。作者显式写 `layout.relayoutTriggers` 时按作者要求跑满预算，不被这套判断拦下。',
  },
  EDGE_ROUTED_BY_FALLBACK: {
    category: 'engine',
    severity: 'WARNING',
    phase: 'layout',
    summary:
      '这几条边不是 ELK 画的：ELK 完全没给它们路径，由 `vendor/libavoid` 的替补连线器补画。消息里列出具体是哪几条。',
    fix: '不需要修——这是**诚实性标注**，不是缺陷。它存在的意义是让你知道哪些边不是 ELK 的成果。想彻底避免就把 `layout.algorithm` 从 `stress` / `radial` 换回 `layered`（漏画只在这两个算法下实测出现）。',
  },
  ELK_WRAPPING_FALLBACK: {
    category: 'engine',
    severity: 'WARNING',
    phase: 'layout',
    summary: '请求的 `layout.wrapping` 在当前算法/方向组合下 ELK 不适用，已安全回退为非包装布局。',
    fix: '要么接受回退（图仍然是对的，只是不折行），要么去掉 `layout.wrapping`，要么换成支持包装的算法（`layered`）。',
  },

  // ---------------------------------------------------------------- 渲染层

  DRAWIO_INVALID_XML: {
    category: 'render',
    severity: 'ERROR',
    phase: 'render',
    summary:
      '生成的 `.drawio` 不是标签闭合的合法 XML（`mxfile` 结构不平衡）。写盘前检查，因此严格渲染命令返回非零退出码。',
    fix: '这是渲染器缺陷，不是模型问题——请报 issue 并附上 `.model.json`。临时绕过：用 `render` 之外的路径检查模型，或降低标签里的特殊字符（`<`、`&`）。',
  },
  DRAWIO_MISSING_GRAPH_MODEL: {
    category: 'render',
    severity: 'ERROR',
    phase: 'render',
    summary: '`.drawio` 里没有 `mxGraphModel` 根元素，Draw.io 打不开。',
    fix: '同上，属于渲染器缺陷，请报 issue 并附 `.model.json`。',
  },
  DRAWIO_MISSING_ELEMENT_ID: {
    category: 'render',
    severity: 'ERROR',
    phase: 'render',
    summary: '`.drawio` 里有 `mxCell` 缺少 `id` 属性——增量编辑与稳定 ID 承诺都会失效。',
    fix: '同上，属于渲染器缺陷。稳定 ID 是 Git diff 与 `--patch` 的基础，这条不允许放行。',
  },
  SVG_INVALID_XML: {
    category: 'render',
    severity: 'ERROR',
    phase: 'render',
    summary: '生成的 `.svg` 不是标签闭合的合法 XML。',
    fix: '属于渲染器缺陷，请报 issue。注意 SVG 只是近似预览，`.drawio` 才是真相；但 SVG 坏了同样阻断，因为它要当 CI 产物和回归基线用。',
  },
  SVG_MISSING_VIEWBOX: {
    category: 'render',
    severity: 'ERROR',
    phase: 'render',
    summary: '`.svg` 缺少 `viewBox`，缩放与位图光栅化都会得到错误尺寸。',
    fix: '属于渲染器缺陷，请报 issue。',
  },
  ELK_LAYOUT_ISSUES: {
    category: 'render',
    severity: 'WARNING',
    phase: 'render',
    summary: '视觉复核时发现底层 ELK 布局自己就撞到了重排上限——也就是说位图里的问题不是审查者看错，是布局确实没收敛。',
    fix: '先解决布局本身（见 `RELAYOUT_NOT_FIXABLE_BY_PREFERENCES` 的处置），再重跑视觉复核；否则每一轮审查都会重复报同一批问题。',
  },

  // ---------------------------------------------------------------- 计划闸门（调用方答案）

  AI_SEMANTIC_REJECTED: {
    category: 'plan',
    summary:
      '`SemanticPlanningError` 的固定码：提交的答案有 `ERROR` 级发现，整份计划被拒，**不落盘**。异常的 `issues` 字段里带着具体是哪些码。',
    fix: '看 `issues` 里的具体码逐条修，改完重新提交。CLI 下这些码会打印到 stderr；MCP 下在 `isError` 应答里。',
  },
  INVALID_AI_RESPONSE: {
    category: 'plan',
    severity: 'ERROR',
    phase: 'semantic',
    summary: '提交的答案不是 `{ diagram, confidence, uncertainties }` 形状的对象，或者过完全部闸门后仍然没有可用的图。',
    fix: '按 `--emit-plan` / `diagram_plan_request` 返回的 `answerContract` 作答，不要自己发明字段名。',
  },
  INVALID_DIAGRAM_SCHEMA: {
    category: 'plan',
    severity: 'ERROR',
    phase: 'semantic',
    summary:
      '答案里的 `diagram` 缺必填字段或字段类型不对：`title` 不是非空字符串、`nodes`/`edges`/`containers` 不是数组、或某个元素不是带 `id` 的对象。',
    fix: '对照 `answerContract` 补齐字段。message 里会写明具体是哪一项不合格。',
  },
  INVALID_DIAGRAM_ID: {
    category: 'plan',
    severity: 'ERROR',
    phase: 'semantic',
    summary: '`diagram.id` 不是安全的文件名片段——它会被直接用作输出目录与文件名。',
    fix: '只用 ASCII 字母、数字、`-`、`_`、`.`，不要带路径分隔符或空格。',
  },
  INVALID_DIAGRAM_STRUCTURE: {
    category: 'plan',
    severity: 'ERROR',
    phase: 'semantic',
    summary:
      '`createDiagram` 拒绝了这份结构：重复 ID、断引用、端口不属于该节点、容器层级不一致、节点多重归属、样式值越界等。message 就是构造器给出的原因。',
    fix: '按 message 修。这类问题**不会**因为换档位而放过——结构不合法的模型根本没法布局。',
  },
  INVALID_RELATIONSHIP_TYPE: {
    category: 'plan',
    severity: 'ERROR',
    phase: 'semantic',
    summary: '边的 `type` 不在 `RELATIONSHIP_TYPES` 白名单里。渲染器不会把未知类型悄悄画成普通箭头，所以直接拒收。',
    fix: '改用白名单里的类型（`association` / `dependency` / `inheritance` / `realization` / `aggregation` / `composition` / `include` / `extend` / `generalization` / `flow` / `foreign-key` 等）。',
  },
  INSUFFICIENT_STRUCTURE: {
    category: 'plan',
    severity: 'ERROR',
    phase: 'semantic',
    summary: '答案里少于 2 个节点或少于 1 条边——这不是一张图，工具不会拿内置示例来凑。',
    fix: '补上真实的节点与关系。如果源材料确实只够画这么多，那就说明材料不足，而不是让工具编。',
  },
  MODEL_GEOMETRY_FORBIDDEN: {
    category: 'plan',
    severity: 'ERROR',
    phase: 'semantic',
    summary:
      '答案里带了坐标或渲染器标记（`x`、`y`、`mxGraphModel`、`mxCell` 等）。**几何的唯一权威是 ELK**，调用方不得指定。',
    fix: '删掉所有坐标字段。想影响布局只能用 `layout` 偏好（`algorithm`、`density`、`nodeSpacing`、`layerSpacing`、`containerPadding`、`targetAspectRatio`、`wrapping`）和顶层 `direction`。见 `AGENTS.md` §2、§3、§29。',
  },
  UNSTABLE_ID: {
    category: 'plan',
    severity: 'ERROR',
    phase: 'semantic',
    summary:
      '重新提交的答案把某个已有节点/边的稳定 ID 改掉了。稳定 ID 是增量编辑与 Git diff 的基础，改写等于让下游全部失配。',
    fix: '保留原 ID。要改名只改 `label`；要替换元素用 `--patch` 的 `removeNodeIds` + `addNodes` 显式表达。',
  },
  MISSING_EVIDENCE: {
    category: 'plan',
    severity: 'ERROR',
    phase: 'semantic',
    summary:
      '某个元素没有 `provenance`（来源证据）。默认 `ai-led` 档下降为 INFO：工具不评判作者有没有依据，只评判画得诚不诚实。',
    fix: '`strict` 档下必须给每个元素补 `provenance.evidence`，`quote` 要能在源材料里**逐字**找到。`ai-led` 档下可以忽略。',
  },
  UNSUPPORTED_EVIDENCE: {
    category: 'plan',
    severity: 'ERROR',
    phase: 'semantic',
    summary: '`provenance.evidence[].quote` 在源材料里找不到逐字匹配——引文对不上原文。默认档下降为 INFO。',
    fix: '`strict` 档下把 `quote` 改成源材料里的原话（工具做的是子串精确匹配，会忽略首尾空白）。转述、翻译、加省略号都会失配。',
  },
  INVALID_EVIDENCE_SOURCE: {
    category: 'plan',
    severity: 'ERROR',
    phase: 'semantic',
    summary: '`evidence[].source` 不是本次任务里真实存在的来源标识。默认档下降为 INFO。',
    fix: '用 `--emit-plan` / `diagram_plan_request` 返回的 `sources[].id` 原值，不要自己编。',
  },
  LOW_ELEMENT_CONFIDENCE: {
    category: 'plan',
    severity: 'ERROR',
    phase: 'semantic',
    summary: '某个元素自报的 `confidence` 低于 0.7 或不是合法数值。默认档下降为 INFO。',
    fix: '`strict` 档下要么把该元素改到你有把握为止，要么删掉它并在 `uncertainties` 里说明。不要为了让闸门通过而虚报置信度——那正是 `ai-led` 档不拦它的原因：拦了只会教会调用方撒谎。',
  },
  LOW_CONFIDENCE: {
    category: 'plan',
    severity: 'ERROR',
    phase: 'semantic',
    summary: '答案整体的 `confidence` 低于 0.7 或不是合法数值。默认档下降为 INFO。',
    fix: '同上。整体置信度低通常意味着源材料不足，考虑补充材料或缩小图的范围。',
  },
  BLOCKING_UNCERTAINTY: {
    category: 'plan',
    severity: 'ERROR',
    phase: 'semantic',
    summary:
      '答案的 `uncertainties` 里有一条标了 `blocking: true`——调用方自己说这个不确定点足以挡住交付。默认档下降为 INFO。',
    fix: '`strict` 档下必须先解决那个不确定点再提交。`ai-led` 档下它会被如实记进质量报告，由宿主决定要不要继续。',
  },
  INVALID_UNCERTAINTIES: {
    category: 'plan',
    severity: 'ERROR',
    phase: 'semantic',
    summary: '`uncertainties` 不是 `{description, blocking}` 形状的数组。',
    fix: '按 `answerContract` 的结构提交；没有不确定点就交空数组，不要省略字段。',
  },
  INVALID_SEMANTIC_AUDIT: {
    category: 'plan',
    severity: 'ERROR',
    phase: 'semantic',
    summary: '`--audit` 提交的独立复审不合格：缺必填字段、`omissions` 里有非法项、或某条 omission 没有来源证据。',
    fix: '复审文件要与答案同一套契约。不提供复审是允许的（会记 `SEMANTIC_AUDIT_SKIPPED`），但提供了就必须合法。',
  },
  MISSING_REQUIREMENT: {
    category: 'plan',
    severity: 'ERROR',
    phase: 'semantic',
    summary: '独立复审指出源材料里有一条要求，答案没有覆盖，并给出了理由。',
    fix: '把漏掉的元素补进答案再提交。注意质量报告的 `reviewerProvedCompleteness` 恒为 `false`——复审说「没漏」不等于真没漏。',
  },
  UNSUPPORTED_ELEMENT: {
    category: 'plan',
    severity: 'ERROR',
    phase: 'semantic',
    summary: '独立复审指出答案里有个元素在源材料中找不到依据。',
    fix: '删掉该元素，或补上能逐字核验的 `provenance.evidence`。',
  },
  SEMANTIC_AUDIT_SKIPPED: {
    category: 'plan',
    severity: 'WARNING',
    phase: 'semantic',
    notProfiled: true,
    summary:
      '没有提交独立复审（`--audit` / `diagram_plan_submit` 的 `audit`），因此这份计划**未经独立审查**；`auditConfidence` 记为 0。',
    fix: '要消除它就提交一份复审。它**不会**被当成「已通过审查」，也**不会**因为默认档而降为 INFO——它陈述的是审查覆盖率这个事实，不是对图的评判（`src/validate/policy.ts` 里专门说明了这一点，`tests/agent-intake.test.ts` 钉住了这个行为）。',
  },

  // ---------------------------------------------------------------- 视觉复核闸门

  VISUAL_CROWDED: {
    category: 'visual',
    phase: 'render',
    summary:
      '审查者报告画面拥挤/元素贴在一起/间距不足。映射为 `nodeSpacing`、`layerSpacing` **单调递增**（步长 max(8或10, 12%)，每轮上限 +20%）。',
    fix: '这是兜底的拥挤规则，排在具体规则之后匹配。它由审查者的自然语言触发，不需要你手写这个码。',
  },
  VISUAL_SPACING_LOOSE: {
    category: 'visual',
    phase: 'render',
    summary:
      '审查者报告太散/大片空白。映射为 `nodeSpacing`、`layerSpacing` **单调递减**（每轮上限 −15%），与 `VISUAL_CROWDED` 方向相反。',
    fix: '同一轮里若同时出现拥挤和松散信号，该字段会被跳过（防振荡），并由 `VISUAL_CORRECTION_CONFLICT` 记录。',
  },
  VISUAL_LABEL_TRUNCATED: {
    category: 'visual',
    phase: 'render',
    summary: '审查者报告文字被截断/看不全。**没有任何间距字段能修它**——根因是标签文字或形状语义，因此不自动纠正。',
    fix: '会记 `VISUAL_SEMANTIC_REQUIRED`，说明需要语义层修改：缩短 `label`，或去掉写死的 `width`/`height` 让工具按文字测量。',
  },
  VISUAL_LABEL_ILLEGIBLE: {
    category: 'visual',
    phase: 'render',
    summary: '审查者报告字太小看不清。映射为 `edgeLabelFontSize` **单调递增**（上限 16）。',
    fix: '注意节点字号固定为 12，所以「节点文字看不清」匹配不到任何数值规则，会转成语义发现。',
  },
  VISUAL_EDGE_LABEL_PRESSURE: {
    category: 'visual',
    phase: 'render',
    summary: '审查者报告边标签压线。映射为 `edgeLabelFontSize` **单调递减**（下限 6）。',
    fix: '与 `VISUAL_LABEL_ILLEGIBLE` 方向相反，同轮冲突时该字段被跳过。',
  },
  VISUAL_LABEL_ON_NODE: {
    category: 'visual',
    phase: 'render',
    summary: '审查者报告标签或图例盖住了节点。映射为 `nodeSpacing`、`containerPadding` **单调递增**。',
    fix: '若根因是图例位置，考虑关掉 `theme.showLegend` 或改图例文字。',
  },
  VISUAL_CONTAINER_TIGHT: {
    category: 'visual',
    phase: 'render',
    summary: '审查者报告元素贴着容器/泳道边框。映射为 `containerPadding` **单调递增**（上限 120）。',
    fix: '也可以在模型里给该容器单独写 `padding`，比全局调更精准。',
  },
  VISUAL_ASPECT_SKEW: {
    category: 'visual',
    phase: 'render',
    summary: '审查者报告整体比例失衡（太高/太扁/太窄/太宽）。映射为 `targetAspectRatio` **朝 1.0 步进**，每轮有界。',
    fix: '比例失衡常常是结构问题（一条超长边把画布撑开），调比例只是掩盖；先看有没有 `EXTREMELY_LONG_EDGE`。',
  },
  VISUAL_EDGE_ROUTE_LONG: {
    category: 'visual',
    phase: 'render',
    summary:
      '审查者报告边绕远/回边过长。映射为 `edgeLength` 递增，但**效果不单调**：Chen ER stress 布局上实测 x1 报错、x1.5 干净、x2.5 又报错、x4 干净。',
    fix: '不要指望反复加大它。`radial` 下这些选项根本到不了引擎，调了等于没调。真正可靠的办法是改结构。',
  },
  VISUAL_OBSERVATION: {
    category: 'visual',
    phase: 'render',
    summary:
      '审查者写了一段观察，但匹配不到任何数值规则时的兜底码（由观察文字的前几个词生成 `VISUAL_<词>`，一个词都提不出来时用本码）。',
    fix: '它只被记录，不产生任何布局改动。要让它变成可执行的纠正，请在 findings 里用能匹配规则表的说法描述问题。',
  },
  VISUAL_COORDINATE_REJECTED: {
    category: 'visual',
    severity: 'WARNING',
    phase: 'render',
    summary:
      '审查者在 findings 里夹带了坐标类字段（`x`、`y`、`width`、`position`、`route`、`bendPoints`、`mxGeometry` 等）。**已在代码层丢弃**，本码如实记录丢弃了什么。',
    fix: '审查者只能提布局偏好。可用字段仅 `density`、`nodeSpacing`、`layerSpacing`、`containerPadding`、`targetAspectRatio`、`wrapping`、`edgeLabelFontSize`、`edgeLength`。坐标的唯一权威是 ELK。',
  },
  VISUAL_PREFERENCE_REJECTED: {
    category: 'visual',
    severity: 'INFO',
    phase: 'render',
    summary: '审查者提的某个偏好值超出允许范围或类型不对，已被丢弃（不影响其余合法的偏好）。',
    fix: '按 `answerContract` 里的取值范围填。被丢弃的字段不会生效，也不会被假装生效。',
  },
  VISUAL_UNKNOWN_ELEMENT_ID: {
    category: 'visual',
    severity: 'WARNING',
    phase: 'render',
    summary: 'finding 引用的 `elementId` 不在本次审查包给出的 ID 白名单里，已降级为 `general`（不针对具体元素）。',
    fix: '只用 `diagram_review_request` / `--emit-review` 返回的 `elementIds` 里的值。',
  },
  VISUAL_INVALID_FINDING: {
    category: 'visual',
    severity: 'WARNING',
    phase: 'render',
    summary: '单条 finding 结构不合法（缺 `code`/`observation`、`severity` 非法等），该条被丢弃。',
    fix: '按契约的 `{code, elementId, severity, observation, hint}` 结构提交。',
  },
  VISUAL_INVALID_FINDINGS: {
    category: 'visual',
    severity: 'WARNING',
    phase: 'render',
    summary: '整个 `findings` 载荷不是合法结构（不是对象、或 `findings` 不是数组），本轮审查结论全部作废。',
    fix: '重新按契约提交。作废不会导致「假装通过」——余留问题仍然在报告里。',
  },
  VISUAL_CORRECTION_APPLIED: {
    category: 'visual',
    severity: 'INFO',
    phase: 'render',
    summary: '审查结论已成功映射为 `LayoutPreferences` 并重跑了 ELK。message 里写明改了哪些字段、改到多少。',
    fix: '无需处理，这是审计轨迹。',
  },
  VISUAL_PARTIALLY_CORRECTED: {
    category: 'visual',
    severity: 'INFO',
    phase: 'render',
    summary: '一部分 finding 能映射为布局偏好并已应用，另一部分不能（已分别记为 `VISUAL_SEMANTIC_REQUIRED` 等）。',
    fix: '看同轮的其他码处理不能自动修的那部分。',
  },
  VISUAL_CORRECTION_CONFLICT: {
    category: 'visual',
    severity: 'INFO',
    phase: 'render',
    summary: '同一轮里出现了方向相反的诉求（例如既说太挤又说太散），涉及的那个字段本轮**跳过不改**，以防来回振荡。',
    fix: '下一轮把诉求收敛到一个方向，或直接改结构。',
  },
  VISUAL_SUPERSEDED: {
    category: 'visual',
    severity: 'INFO',
    phase: 'render',
    summary: '上一轮的纠正已被本轮重排覆盖，旧发现不再描述当前位图。',
    fix: '无需处理。看最新一轮的位图与发现。',
  },
  VISUAL_SEMANTIC_REQUIRED: {
    category: 'visual',
    severity: 'WARNING',
    phase: 'render',
    summary:
      '这个问题**没有任何布局偏好能修**，需要改语义层（改文字、改形状、改结构）。工具明确说「修不了」，不伪造已修复。',
    fix: '回到 `.model.json` 改结构或标签，再重新走一遍布局与审查。',
  },
  VISUAL_REVIEWER_FOUND_NOTHING: {
    category: 'visual',
    severity: 'INFO',
    phase: 'render',
    summary: '审查者报告「没发现问题」。结果的 `disclaimer` 里会写明：**这不等于没问题**，与证据审计的语义一致。',
    fix: '无需处理，但不要把这条当成质量证明。`reviewerProvedCompleteness` 恒为 `false`。',
  },

  // ---------------------------------------------------------------- 请求级拒绝

  INPUT_GEOMETRY_FORBIDDEN: {
    category: 'request',
    summary:
      'MCP 调用方在 `model` 或 `patch` 里传了坐标/尺寸/边路由/Draw.io 标记（`x`、`y`、`sections`、`bendPoints`、`waypoints`、`geometry`、`mxCell`、`mxGeometry`、`mxGraphModel` 等）。布局前即拒收。',
    fix: '删掉这些字段。`width`/`height` 作为**尺寸提示**是允许的（`utils/text.ts` 会用它），其余几何一律由 ELK 计算。错误信息里会逐条列出被拒的路径。',
  },
  PATH_OUTSIDE_WORKSPACE: {
    category: 'request',
    summary: '请求里的路径越过了服务根目录（`DIAGRAM_MCP_ROOT`，默认为启动时的工作目录）。',
    fix: '用相对于服务根的相对路径，或把 `DIAGRAM_MCP_ROOT` 设到真正的工作区。注意它指向**盘根**时服务会拒绝启动（Windows 上 `C:\\output\\…` 会以 `EPERM` 失败）。',
  },
  AGENT_PLAN_REQUIRED: {
    category: 'request',
    summary:
      '`diagram_generate` 收到了自然语言/文档/图片，但没有 `chain: true`。这个工具**不发模型请求**，所以它无法自己「理解」这段话。',
    fix: '改走 `diagram_plan_request` → 你自己的模型作答 → `diagram_plan_submit`；或者输入固定格式的箭头链并显式设 `chain: true`（`类型：A -> B -> C`）。',
  },
  MISSING_SOURCE: {
    category: 'request',
    summary: '`diagram_plan_request` 一个输入源都没给：`text`、`document`、`image`、`template` 全缺。',
    fix: '至少给一个。工具不会凭空造图。',
  },
  MISSING_ANSWER: {
    category: 'request',
    summary: '`diagram_plan_submit` 没有 `answer` 字段。',
    fix: '先调 `diagram_plan_request` 拿任务，用你的模型作答，再把 `{ diagram, confidence, uncertainties }` 作为 `answer` 提交。',
  },
  MISSING_FINDINGS: {
    category: 'request',
    summary: '`diagram_review_submit` 没有 `findings` 字段。',
    fix: '先调 `diagram_review_request` 拿位图与 ID 白名单，看过图再提交 findings。',
  },
  INVALID_MODEL: {
    category: 'request',
    severity: 'ERROR',
    phase: 'semantic',
    summary:
      '`diagram_render` / `diagram_validate` 拿到的 `model` 或 `modelPath` 解析不出合法 Diagram（JSON 坏了、缺字段、或类型不对）。这是本节里唯一以结构化 issue 形式返回的码，因此带严重度与 phase。',
    fix: 'message 里是具体原因。先用 `diagram_validate` 单独校验模型，再渲染。',
  },
  DIAGRAM_REQUEST_UNPARSED: {
    category: 'request',
    summary:
      '`--chain` 的固定格式解析器读不懂这段输入。它只吃 `类型：A -> B -> C` 箭头链与 Chen-ER 三段式，**不是自然语言理解**。',
    fix: '要么改成箭头链格式，要么走计划闸门（`--emit-plan` → 你的模型 → `--plan`）。工具刻意不猜：静默套用内置示例会把无关模板当成你的业务语义。',
  },
  CLI_ERROR: {
    category: 'request',
    summary: 'CLI 兜底码：抛出的异常自身没带 `code` 字段时用它。真实原因在 message 里。',
    fix: '看 message。如果 message 也不足以定位，请带上完整命令行与输入文件报 issue。',
  },
  MCP_TOOL_ERROR: {
    category: 'request',
    summary: 'MCP 兜底码：工具抛出的异常自身没带 `code` 字段时用它，以 `isError` 应答返回，连接不中断。',
    fix: '看 message。协议级错误（未知工具名等）走 JSON-RPC 的 `-32602`，不是本码。',
  },
};
