# 提案：把绘图权威交还 AI（几何从「禁止」改为「可读数的建议」）

状态：**主体提案，未实施**（§2/§3 的几何闸门降级需技术负责人确认，因为它要改 `AGENTS.md` §2/§3/§29）。
例外：§9 记录的「不动禁令的小切口」已于 2026-09-26 实施并验证。
日期：2026-09-26

## 1. 动机

现行规则把 ELK 定为唯一几何权威，代价是所有同类图剪影趋同、AI 无法做构图设计。根因**分三层**，不是一处（这一点原稿写偏了，见下）：

- **默认层**：`src/layout/elk.ts:93-99` 的 `algorithmFor()` 是三元链（不是 `switch`）：mindmap→mrtree，network/chen-er→stress，**其余一律 layered**。但它第 99 行（现 94 行）已经允许 `layout.algorithm` 覆盖，`LayoutPreferences` 也早就暴露了这个字段——所以"选不到别的算法"是**不成立**的。
- **闸门层**：真把作者挡住的是质量闸门。实测同一张架构图显式选 `stress` / `mrtree` / `radial`，都会因 `EDGE_LABEL_OVERLAP`、`NODE_OVERLAP`、`CANVAS_OVERFLOW` 这类**审美级 ERROR** 落到 `failed_after_max_iterations`（5 次重排只加间距，换不了构图）。也就是说：算法可选，但选了就被判不合格——趋同是闸门造成的，不是 switch 造成的。
- **几何层**：`src/mcp/guards.ts:69 assertNoGeometry` 与 `src/ai/pipeline.ts:80-90` 禁止 x/y，这才是"AI 无法做构图设计"的准确原因，也是 §2 的靶心。

旁证：

- `src/diagram-types/registry.ts:18-32` 的 `defaultDirection` 按类型写死；`elk.ts` 的 `defaultAspectRatio`、`layoutProfile` 也按类型分支。这些只是默认值，图级字段可覆盖。
- `examples/` 21 个目录里对应 19 个现行样例（`cli.ts:20 exampleNames`），其中**只有 `19-chen-er` 写了 `layout`**——原稿说"21 个样例 20 个没写"数字不准，实况更极端：几乎没有任何样例示范过版式选择。因此 examples 不能当版式知识来源，只能作记法参照（§4）。
- 同一张「1 hub + 3 leaves」图分别交给 layered / stress / mrtree / radial，实测（elkjs 0.12.0）得到 350×320、373×302、380×320、390×339 四种剪影，radial 的 hub 落在 (166,150) 中心。多样性一直可用。
- 原稿把 `elk.ts:193` 容器内写死 `"elk.algorithm": "layered"` 当作多样性锁的一部分：**实测它是死配置**。根节点设 `INCLUDE_CHILDREN` 后，容器子图由图级算法负责；把该行删除，19 个现行样例 + `layeredArchitecture` 共 20 张图的节点/容器/边坐标指纹**逐字节一致**（双源码树 A/B）。


## 2. 权力结构变化（三处否决 → 建议）

| 位置 | 现状（否决权） | 提案（建议权） |
|---|---|---|
| `src/mcp/guards.ts: assertNoGeometry` | 带坐标的 `model`/`patch` 直接 `INPUT_GEOMETRY_FORBIDDEN` | `mode: 'strict' \| 'authored'`；authored 下收下几何并回 `geometrySupplied=true` |
| `src/ai/pipeline.ts:80-90 MODEL_GEOMETRY_FORBIDDEN` | plan 提交带坐标 → 拒 | 降为 WARNING，写入质量报告供模型下一轮自评 |
| `src/cli.ts / pipeline` 退出码 | 布局审美类 ERROR → 非零、影响「交付可用性」 | 仅「结构正确性」（边引用、容器归属、形状语法）保留硬失败；几何拥挤/交叉/文字超出改为告警 + 读数 |

硬失败必须保留的少数几项（否则等于自废）：`BROKEN_EDGE`、`BROKEN_CONTAINER_*`、`PORT_OUTSIDE_NODE`、形状名不支持被 Draw.io 静默降级、`INVALID_RELATIONSHIP_TYPE`。**几何精度类不再阻断，但仍然计算并报数**：`NODE_OVERLAP`、`EDGE_CROSSING`、`EDGE_THROUGH_NODE`、`TEXT_OVERFLOW`、`EDGE_LABEL_OVERLAP`、`CANVAS_OVERFLOW`。

**实施前必须先解决的口径冲突**：两条入口对"什么算几何"不一致。`src/mcp/guards.ts:44-45` 明确把 `width` / `height` 当作允许的 size hint（`ALLOWED_SIZE_HINTS`，配套注释指向 `utils/text.ts`），而 `src/ai/pipeline.ts:80` 的黑名单里同时列着 `'width', 'height'`，会把带尺寸提示的 plan 判成 `MODEL_GEOMETRY_FORBIDDEN`。authored 模式一旦收下几何，这两个白名单不统一就会出现「MCP 能过、plan 提交不能过」的分裂行为。落地顺序：先定一份共享的几何字段清单，再谈降级。

另有一条实测缺口：`src/validate/index.ts` 目前**不检查"边没有路由段"**。`layout.algorithm` 选到 `box` / `rectpacking`（不产出 `sections`）或在稠密图上选 `radial` 时，边会以"无路径"状态通过校验（chen-er + radial 实测 21 条边全部无 `sections`，仍只报重叠类问题）。authored 模式收下作者几何后，这个缺口的后果会放大，应与 §2 同期补一条 `EDGE_UNROUTED` 读数。


## 3. 新增「创作面」入口

AI 可直接交出一份带几何的对象清单；也可选择调用 `layoutDiagram()` 让 ELK 排自己不熟悉的那一层。两条腿在同一次提交里共存。

- CLI：`generate --mode authored --plan answer.json`（answer 允许携带 x/y/width/height）与 `--mode strict`（现行为，默认）。
- MCP：`diagram_plan_submit` 增加 `mode`；新增 `diagram_audit_read` —— 输入 `.drawio`/`.model.json`，返回 `validateLayout` 的结构化读数 + `svgToPng` 位图路径，供模型自评后自修。不阻断。
- 双轨默认：论文正文图 `strict`，答辩/示意图/封面大图 `authored`；严格度由调用方按图指定，不由代码替作者预设。

## 4. examples 的定位改写（去掉「版式暗示」）

现有 examples 会被误读成「照着这个长相换内容」。改为**记法词表**：每种图型只声明形状语法与关系语法，例如 chen-er 实体=矩形、属性=椭圆、联系=菱形、基数标注在边上且关联线无箭头；UML 继承=空心三角实线、组合=实心菱形、依赖=虚线开放箭头；用例=椭圆 + Actor + 系统边界；时序=参与者竖线 + activation bar + alt/opt/loop 片段。

版式相关的一切（行列数、方向、宽高比、分组、间距）**不进词表**，由 AI 依据具体内容的结构度量自行设计。结构度量建议随 `diagram_plan_request` 一起返回（深度、同层最大宽度、最大入度节点、环路数、平均标签字宽），作为 AI 决策的输入而不是结论。

## 5. `AGENTS.md` 具体改写

- §2：删除「禁止 LLM 直接生成 Draw.io XML / 直接决定 x/y」，改为「模型可为 authored 图提交几何；几何质量由 validator 以告警形式回报，结构正确性仍为硬门槛」。
- §3：把「默认不要在 DSL 中由 LLM 指定 x/y」改为「strict 模式不指定；authored 模式由模型指定，且必须能被 validator 复核」。
- §29 Golden Rule：改为「语义与构图归 AI；结构合法性归校验；确定性布局是 AI 可调用的一项工具，不是唯一合法的布局者」。
- §17 Style、§13 Severity 表需同步（哪些 code 从 ERROR 降为 WARNING）。

## 6. 风险（如实）

- 闸门降级后，重叠、连线穿框、标签压字可能进入交付物，责任回到作者（人或模型）而非被代码拦截。缓解：`--emit-review` 的真实 Draw.io 位图 + `drawio_live_audit_figure` 读数让模型自我收敛。
- 「论文正文图」若选到 authored 且模型判断失误，风险直接反映在成品论文上——故正文图默认仍 strict。
- 保留 strict 全套路径与测试，改动可整体回退。

## 7. 验收（若批准实施）

1. `npm test` 全绿；新增用例覆盖：authored 收下几何并给出读数、strict 仍拒收、降级项不再阻断退出码而计数项仍在报告中出现。
2. 同一份文档内容分别产出一张 strict 架构图和一张 authored 架构图，两者 `.quality.json` 都列出读数，且剪影可见差异。
3. `npm run examples` 不受影响（19+ 目录照常产出）。

## 8. 外部实证：scientific-illustrator v1.5.4（源码已本地核查）

仓库 `https://github.com/icebird1998/scientific-illustrator`，本地 `F:\tool_sharing\vendor\scientific-illustrator`。核查文件：`plugins/scientific-illustrator/scripts/live-server.mjs`（119KB / 2229 行）、`server.mjs`、`skills/recreate-scientific-figure-in-drawio/SKILL.md`。2026-09-26 在本机复核过下列 0 命中断言（`elk` `dagre` `graphlib` `forceAtlas` `autoLayout` `arrange` `overlap` 全文命中数均为 0）。

已证实（正控制：`shape` 在该文件命中 46 次，故 grep 有效）：

- **零自动布局**：`elk` / `dagre` / `graphlib` / `forceAtlas` / `autoLayout` / `arrange` 均 0 命中；文件里唯一的 `layout(` 是 `updateTableLayout`（手工设定表格行列宽高）。全部 26 个 `drawio_live_*` 工具的几何都由模型给出。
- **写时不拦**：`overlap` 在整个 live server 中 **0 命中**——放置对象时不做重叠检查，几何自由提交。
- **交时有门**：`drawio_live_audit_figure` 用固定词汇表给出确定性读数，`passed = hardFailures.length === 0 && !findingsTruncated`（live-server.mjs:1952/1962），即审计分级并阻断交付。
- 审计词汇（13 项）：`arrowhead-intrusion`、`connector-crossing`、`connector-path-through-object`、`text-overflow`、`outside-page`、`repeated-series-misalignment`、`repeated-series-unequal-spacing`，以及位图诚实性 6 项 `raster-not-atomic`、`raster-not-tight`、`raster-contains-reconstructable-content`、`raster-missing-reason`、`raster-missing-decomposition-note`、`large-raster-surface`、`possible-composite-raster`。
- **不可协商项落在渲染保真**：未知形状名或不可渲染的 style 直接抛错，注释明确写着"refused draw.io's silent rectangle fallback"（live-server.mjs:1087、1120），要求改用注册的形状、用可编辑图元重建，或只插入最小不可分裂位图。

对我们的启示（据此修正第 2/3 节的取舍）：

1. 「写时自由、交时有门」是可行的工程折中，不需要在放置时刻设置否决权。本提案的 authored 模式采用同一时序。
2. 硬门禁应集中在**渲染保真与结构诚实**（线穿对象、字超出、页外、形状被静默降级、位图冒充可编辑内容），审美类（重叠、密度）保持为**告警读数**。这与我此前"保留 `PORT_OUTSIDE_NODE`/形状不支持为硬失败"的判断一致，且它连 node-node overlap 都不作为硬失败，说明我原先的硬集可以进一步放宽。
3. 我们反向的优势：`src/validate/index.ts` 已有 `NODE_OVERLAP`、`EDGE_THROUGH_NODE`、`EDGE_CROSSING`、`EXCESSIVE_DENSITY/WHITESPACE`、容器层级与引用完整性检查，读数覆盖面比它的 13 项更全；authored 模式应保留这些读数（作为告警），并同时补上它独有而我们缺失的两类——**位图诚实性**（禁止把可还原内容贴图化）与**渲染器静默降级**（形状名必须来自 capabilities，否则报错）。
4. 它的 `raster-*` 纪律值得直接搬进模型层：任何以 image 形式进入 `.drawio` 的对象必须声明 `reason`、`tight crop`、`decomposition note`、`contains_reconstructable_content=false`，否则 authored 模式下也不给落盘（这项保持硬失败）。

结论：第 2 节表格中「几何精度类不再阻断」保持；新增两项硬失败（渲染器静默降级、位图诚实性），并据此把第 6 节风险收窄为"审美风险回到作者，结构性与渲染诚实性仍被代码保护"。

### 8.1 drawio 侧实证（2026-09-26 补，读的是真源码）

仓库 `https://github.com/jgraph/drawio`（分支 `dev`）。已读到可读源码：`src/main/webapp/js/libavoid-js/libavoid-routing.js`（25KB，手写、无依赖）与同目录 `README.md`。**未读到**的部分要如实说明：ELK 胶水层只有打包产物 `src/main/webapp/js/elk/drawio-elk.min.js`（918KB），编辑器侧 `js/diagramly/LibavoidRouting.js` 抓取超时，所以"drawio 把哪些布局以什么名字暴露给用户"这一条我没有源码依据，不写进结论。

`README.md` 给出的定位是一句硬事实：**"libavoid never moves a vertex — it only computes edge paths that route around the vertices as obstacles"**，服务对象是菜单项 Arrange > Layout > **Orthogonal Routing** 与 `orthogonalEdge` childLayout。也就是说在 drawio 的世界观里，"重算连线"是一个**在既有几何上由用户主动触发的操作**，不是一个自动布局阶段。这正是 §3 想要的第二条腿，而且它的许可证是 **LGPL-2.1**（`LICENSE` 为上游署名文件），将来若真要引入边路由引擎，这是要先记账的约束。

它还有两条工程纪律值得照抄：其一，构建期**编译为无异常**（`-DNDEBUG`，把 VPSC 的 throw/catch 改写成显式控制流），理由写在 README 里——"a C++ throw would abort the module and kill routing for the session"；其二，给 `printErr` 装过滤器，把 libavoid 不可行动的 `skipping checkpoint` 降级为 `console.debug`。**不可行动的信号不该和真问题混在同一个流里**——这条直接对应我们 validator 的 INFO/WARNING/ERROR 分级，以及 §9 记下的 `EDGE_UNROUTED` 缺口。


从 `libavoid-routing.js` 能直接搬进本提案的四条：

1. **节点几何是路由器的输入，不是它的输出。** `computeRoutes(Avoid, vertices, edges, opts)` 收绝对坐标的障碍矩形数组 + 每条边的端点约束，**只回** `{edgeId: [内部拐点]}`。这就是 §3「两条腿共存」的成熟形态：作者交盒子，确定性引擎交连线。我们目前 `sections` 全部来自 ELK，没有"只重算边、保留作者节点框"这条路——authored 模式真正缺的是这个入口，而不是把 ELK 关掉。
2. **退化情形必须有定义。** 它的契约写明：拐点做共线过滤；直线边映射为 `[]`；`"an edge with no route entry is never written"`；自环直接跳过、保留调用方自己的 waypoints。对照我们 §2 末尾记的缺口——`EDGE_UNROUTED` 之所以量不出来，正是因为 `sections: []` 和"引擎压根没给"在我们的模型里是同一个值。补这条读数时应当照抄这个区分：**无拐点 ≠ 无路由**。
3. **容器不是障碍。** `filterEnclosing` 用纯几何包含判断把"完整包住某个端点的形状"从障碍集合里剔除，注释说得很直白：那是端点所在的 container/pool，不是要绕开的东西；把它注册进障碍会让可见性网络没有走廊，路由退化。这条同时解释了我们实测到的现象（`radial` + Container → `NODE_OUTSIDE_CONTAINER`），并且给出 `src/validate/index.ts` 未来做"边穿对象"判定时的正确口径：穿容器不算穿障碍。
4. **质量回路应该是"只修被违反的那一条"。** jetty stub 采用**惰性施加**：先不带硬约束解一遍，只有自然路由不满足最小引出长度的边才被加上检查点再解一次——"在已经满足的地方保留均匀分布的自然路由"。我们的自动重排（`elk.ts` 迭代）现在是全局单调加间距，5 次之后既没换来构图、也没定位到具体违规元素。authored 模式若保留重排，应改成这种"定点施修"形状，否则 §2 的"告警 + 读数"没有配套的收敛手段。

第 4 条也反过来支持 §2 的判断：审美类问题不该驱动同一个单调旋钮，因为那个旋钮修不了构图。

**但第 1 条的实现路径要按实测收窄**：ELK 侧本应有现成答案——`org.eclipse.elk.interactive` 布局器的语义正是"节点位置已定，只算边"。本机 elkjs 0.12.0 实测：该字符串在 bundle 里命中 2 次，但作为 `elk.algorithm` 使用会抛 `Layout algorithm 'interactive' not found for Root Node`，即**这份 JS 移植没有注册这个布局器**。所以 authored 模式下"作者只交盒子、引擎只补边"这条路，靠现有依赖走不通，要么引 libavoid（LGPL-2.1，572KB 纯 JS，drawio 用它且明确"never moves a vertex"），要么自写路由器。§3 里两条腿共存的说法仍然成立（图级重排那条腿是好的），但**不要假设"只重算边"是免费的**。



## 9. 已实施：不碰禁令的小切口（2026-09-26）

这一批改动**不修改 `AGENTS.md` 任何禁令**，几何权威仍在 ELK；它只是把"构图可选"这件事做实，并让代码不再撒谎。

| 改动 | 位置 | 依据 |
|---|---|---|
| `layout.algorithm` 增加 `radial` | `src/model/types.ts` `LayoutAlgorithm` / `LAYOUT_ALGORITHMS` | 实测 elkjs 0.12.0 短名可用，边有路由，mindmap 上 0 ERROR，hub 居中（`docs/verification/layout-algorithm-radial/*.png` 真实 Draw.io 位图对照） |
| **不**暴露 `box` / `rectpacking` | 同上（注释记录原因） | 实测二者不为任何边生成 `sections`，交付出的是没有连线路径的框 |
| 删除容器内 `"elk.algorithm": "layered"` | `src/layout/elk.ts` `makeContainer` | `INCLUDE_CHILDREN` 下为死配置；双源码树 A/B，20 张图坐标指纹逐字节一致 |
| 非白名单算法名抛错 | `src/layout/elk.ts` `algorithmFor` | 原先未知名会把 ELK 的 `UnsupportedConfigurationException` 原样抛出；现在错误里直接给出可用清单。`box` 等历史可用值改为显式拒绝（行为收紧，属有意） |
| 能力可见化 | `src/mcp/tools.ts`（`layout.algorithm` enum）、`src/agent/prompts.ts`（plan 提示词一句） | 见 §8 启示：把可选杠杆写进契约，而不是让模型猜 |
| 回归用例 | `tests/diagram.test.ts` | radial 构图与默认不同且边全路由；容器跟随图级算法；白名单外算法抛错 |

`npm test` 通过，`npm run build` 干净，`npm run examples` 19 个样例照常产出且坐标未变。

已知限制（写进 README「布局与扩展」）：`radial` + Container 会让子节点落到框外并报 `NODE_OUTSIDE_CONTAINER`（ERROR）；`radial` 在稠密图（chen-er 28 节点）上会让同环节点重叠。因此 `radial` 只作为显式选择，不进任何默认路径。

## 10. 已实施第二轮：把"评判作者"的职责撤给 AI（2026-09-26）

技术负责人定调：结构与记法由 AI 主导，工具的核心职责是**不让线穿模、不打结**。据此落地 `ai-led`（默认）/ `strict` 双档，见 `src/validate/policy.ts` 与 README「谁来评判」。**几何权威没有变动**，所以 AGENTS.md §2/§3/§29 依旧成立——这一轮撤掉的是"工具替作者判断画得对不对题"，不是"谁算坐标"。

- 降为 INFO（仍报数、不阻断、不再触发重排）：按图类型的记法 WARNING、UML 记法审判、密度/留白/超长边/孤立节点/重复关系/同层约束/标签压字，以及 provenance 缺失、引文对不上、置信度低、模型自报 blocking。
- 两档都阻断：断引用、重复 ID、悬空端口、容器归属、未知形状名、**边未被路由**、文字超出、画布溢出，以及穿模/交叉/节点重叠本身。
- `shouldRelayout` 忽略 INFO：旧回路会为一场修不了的标签压字烧满 5 次迭代，现在不会。

**更正我上一轮的一个说法。** 我当时报告"三种 shape 写法全被静默吞成矩形"，实测只对了一种：`nonsenseXYZ` 和 `shape=alsoNonsense;foo=bar` 会被 `src/model/index.ts:66` 的 `ALLOWED_SHAPES` 拒绝（那个探针绕过了 `createDiagram`，所以没看到拒绝）。真正漏网的是**裸写合法名**——白名单接受 `cylinder` / `umlActor`（`bareMatch`），而渲染器只认带前缀的形式，于是合法值画成了矩形。`honorShapeFragment()` 已修，前后对照位图在 `docs/verification/renderer-shape-degradation/`（裸写 cylinder 与 `shape=cylinder` 曾渲染成两种不同图形，这是同一份模型的两个真相）。

`EDGE_UNROUTED` 也已落地（ERROR，两档都阻断），并修掉 `svg.ts` 的 `if (!s) return ""`——无路由的边以前在预览里**整条消失**，而 `.drawio` 会交给 Draw.io 自动补一条，两个渲染器对同一条边给出不同真相。实测 `layeredArchitecture` 选 `stress` 触发 2 条（`edge.user-web`、`edge.service-external`），默认路径 24 张图 0 条。

仍未做：① 惰性施修（把重排从"全局加间距"改成 code→旋钮，见 §8.1 第 4 条）；② SVG 侧的 `cylinder` / `umlActor` 等形状支持仍不完整（只有 chen-er 分支做了子串匹配），两个渲染器的形状表现还不一致；③ `SELF_RELATIONSHIP` 默认 ERROR 会挡住状态机自环这类合法结构，属"评判作者"的残留，待议。

测试 130/130，`npm run build` 干净，`npm run examples` 正常。本轮与 §9 都在独立仓库 `dcff177` 之后提交。

本轮之后仓库状态：`examples/` 已清成与 `exampleNames` 一致的 19 个目录；本目录已独立成库（基线 `dcff177`），§26「Git 负责历史」的前提从此成立。

## 11. 已实施第三轮：重排回路只拧真有影响的旋钮（2026-09-26）

原计划是"把 `elk.layered.*` 子策略暴露成构图旋钮 + code→旋钮映射"。**前半句被实测否决**：在 elkjs 0.12.0 上，`crossingMinimization.strategy` 取 `LAYER_SWEEP` / `NO_INIT` / `GREEDY_SWITCH` / `ICPIP`、`nodePlacement.strategy` 取 `SIMPLE` / `NETWORK_SIMPLEX`，甚至填一个瞎写的值和一个不存在的选择器键，**输出逐字节相同**。已经写进 `LayoutPreferences` 的三个字段当场撤回——那正是本轮早些时候从 `elk.ts:193` 删掉的那类死配置，不能再造一遍。

> **§12 更正本段**：这里"输出逐字节相同"只对 `crossingMinimization.strategy` 成立。§12 的矩阵显示 `nodePlacement.strategy` 与 `layering.layerConstraint` **确实生效**，当时的测试图对这些选项不敏感，我把"我的图没变"读成了"选项是死的"。撤回三个字段这个决定仍然正确（`crossingMinimization.strategy` 与 `layerChoiceConstraint` 确实无效果），但理由要按 §12 重述。

间距旋钮的效能实测（spacing ×1 / ×1.5 / ×2.5 / ×4，各跑一次布局）：

| fixture | 违规 | 加大间距 |
|---|---|---|
| 真实 11 节点模型（layered） | `EDGE_CROSSING` | ❌ 恒为 1 条，画幅 1839×511 → 3243×871 |
| architecture + `radial` | `NODE_OVERLAP` / `EDGE_UNROUTED` / `NODE_OUTSIDE_CONTAINER` / `CANVAS_OVERFLOW` | ❌ 画幅完全不变（参数不进该算法） |
| chen-er（`stress`） | `EDGE_THROUGH_NODE` | ⚠️ 有效但**非单调**：×1 有错 → ×1.5 干净 → ×2.5 又错 → ×4 干净 |
| architecture + `stress` | `EDGE_UNROUTED` | ❌ 恒为 2 条 |

据此落地（`src/layout/elk.ts`）：`SPACING_FIXABLE` = 节点重叠 / 过度密集 / 画布溢出 / 边穿节点；`SPACING_INERT_ALGORITHMS` = radial、mrtree；其余情况**第一次布局后就停**，报 `RELAYOUT_NOT_FIXABLE_BY_PREFERENCES`（WARNING）并给出可动的构图杠杆，`status` 新增 `failed_composition_needed`。作者显式写 `layout.relayoutTriggers` 时按作者要求跑满预算，不被这套判断拦下。同时改为**返回得分最高的那次布局**（错误数优先、其次更小画幅），因为 stress 非单调；并修正 `iterations` 语义为"实际尝试次数"（返回较早那次时不再谎报轮数）。顺带纠正 `validate/visual.ts` 里 "monotonic … strongest effect on stress-style algorithms" 的断言——实测 stress 恰恰不单调。

效果：那份真实模型从 5 次迭代 / 2115×581 变成 1 次 / 1839×511；交叉仍在（校验器没误报，实图确有一处线交叉），但现在**如实说明"这归构图管"**并指出杠杆。19 个 examples 画幅**零变化**，`npm test` 133/133。

遗留的命名不准（既有行为，本轮未扩大改动）：`EDGE_UNROUTED` 不在重排触发集里，走的是"无触发即停"老分支，于是只跑 1 次也会报 `failed_after_max_iterations`。要修得再动一次 status 语义，等下次一并处理。

## 12. 杠杆矩阵：哪些约束是真的，哪些是文档谎言（2026-09-26）

为了回答"交叉到底能不能修"，把每个作者侧杠杆单独测了一遍（同一份真实 11 节点模型 + 若干可控小图）。结论比 §11 的说法更细，也**更正了 §11 的一处过度概括**：

| 杠杆 | 底层选项 | 实测 |
|---|---|---|
| `constraints.placement` | `elk.layered.layering.layerConstraint` | ✅ **生效**：三节点链上 `c=FIRST` 把 c 从 x=516 拉回 x=40；`a=LAST` 同理。`org.eclipse.elk.` 前缀同样生效 |
| `nodePlacement.strategy` | `elk.layered.nodePlacement.strategy` | ✅ **生效**：`SIMPLE` 与 `NETWORK_SIMPLEX` 在同一图上给出不同 y 排布 |
| `direction` / 间距 / `aspectRatio` | `elk.direction` 等 | ✅ 生效（但消不掉目标交叉） |
| `constraints.sameLayer` | `elk.layered.layering.layerChoiceConstraint` | ❌ **无效果**，连"x、y 本来就在同一层"这种最廉价的可满足用例都不动。validator 会用 `BROKEN_SAME_LAYER_CONSTRAINT` 报告它没成立 |
| `constraints.before` | 送入引擎的子节点次序 | ⚠️ 接线正确（`createDiagram` 保留、`orderedIds` 生效），但该构建的交叉最小化自行决定层内排位：**改次序不改变最终布局** |
| 顺序优先 | `elk.layered.crossingMinimization.semiInteractive` | ❌ 无效果。§11 之前我一度认为它生效——那是把"换输入顺序后布局跟着换名"误读成选项起作用；用 K2,2 对照，开与关输出一致 |
| 交叉策略选择器 | `elk.layered.crossingMinimization.strategy` | ❌ 任意值（含瞎写值）输出相同 |

**净结论：这个引擎构建不提供任何"作者侧消交叉"杠杆。** 目标交叉在 `direction` 翻转、四种顺序改法、容器增删、`mrtree`/`radial`/`stress` 切换下全部保持 1 条不变（`mrtree` 反而新增两条错误）。所以交叉只能靠**改结构**：去掉或改接跨层长边、容器分组、`placement` 定层、或拆分。`RELAYOUT_NOT_FIXABLE_BY_PREFERENCES` 的提示文案已按这张表重写——**不再推荐任何实测无效的杠杆**，并有测试钉住这一点（`doesNotMatch(/constraints\.before|sameLayer|layout\.algorithm|direction/)`）。

同时撤回本轮一度加进 `LayoutPreferences` 的 `honorNodeOrder`：它在管线里没有任何可观察效果，属于"读起来像承诺的死配置"。README 的 `constraints` 三条也已改成逐条真话（placement 生效 / sameLayer 仅记录并被检测 / before 不改变布局）。

回归：`npm run build` 干净，`npm test` 134/134（新增 placement 生效与 sameLayer 被检测两例，以及"建议文案不得承诺无效杠杆"的断言），19 个 examples 画幅**零变化**。
