# Changelog

本项目遵守 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 风格，版本号遵循语义化版本。
本文件记录 `ai-diagram-tool` 的显著变更。

## [未发布] — 2026-10-01

SVG 预览形状保真补齐、README 三分钟上手、布局引擎现状核实。

### 新增

- **SVG 预览补齐 `cylinder` / `component` / `cube`**（`src/render/svg.ts`）：此前 README 明说这三种形状在 SVG 里画成矩形——现在圆柱（直壁+顶部椭圆）、UML 组件（左缘双卡榫，单路径无缝）、部署立方体（正面+顶/右侧三面）都与 `.drawio` 画同样的形状，SVG 预览与正式产物的形状集合一致；四张样图（组件图/ER/网络/部署）经 sharp 光栅化逐张目验。README 的「SVG 只是近似预览」段落同步改写，只保留文字落位的像素级差异说明。
- **README「三分钟上手」**：README 顶部新增四条命令的最短路径（install/build → test → examples → `--preset` 一条命令出图），原「安装与运行」一节并入，新手不用再在 32KB 里自己找路。

### 修正

- **「布局引擎上游停止维护」的说法经核实过时**：elkjs 与 Eclipse ELK 同步发版（minor 版本号一致），0.12.0 发布于 2026-07-17，0.10/0.11 均为近两年发布——项目已在最新版。ROADMAP 的风险表述改为真正的风险「升级会改变布局输出」，并写明升级流程：`npm run verify` + `npm run visual-gate` 全绿、有意重建 golden 基线后才合入。

### 工程收敛（问题清单逐项清零）

- **全仓格式化应用，CI 换 `biome ci`**：`format:check` 此前 36 个文件不过；应用格式（62 文件，无行为变化，175 测试照过）后 CI 的 lint 步骤按其注释承诺切换为 `biome ci`，格式从此有机器门禁。顺带修掉 `biome.json` 的 `rules.recommended` 废弃键（→ `preset: "recommended"`）与 `tests/visual-diff.test.ts` 的死变量 `stride`，lint 现在 0 警告 0 建议。
- **`verify-examples.ts` 误报修复**：`examples/adapter/` 是手写的 reference adapter，不在 `npm run examples` 的产物里，逐字节比对把这三个文件误报为「缺文件」——CI 一旦真正运行就会挂。已按脚本自带的 `HAND_WRITTEN` 允许清单（要求逐条写明理由）登记。
- **补两个真空白测试**（`tests/presets-and-split.test.ts`）：五个架构预设（含新事件驱动拓扑）在 strict 档下布局零 ERROR；>40 节点双容器模型的拆分产生 overview + 每容器一份、稳定 ID 不重复、多页文件按序合并。此前 `--preset` 与按容器拆分这两条用户可见路径没有测试执行过。
- **CI 增加 Windows job**：draw.io Desktop 路径探测、盘根 EPERM 守卫等平台相关代码此前只在 ubuntu runner 上跑；Windows job 跑 lint+build+test（示例逐字节比对与视觉门禁依赖换行符与真实 renderer，仍归 ubuntu）。视觉后端测试自带 skip 守卫，无 draw.io 的 runner 会优雅跳过。
- **依赖审计 0 漏洞**（`npm audit --registry=https://registry.npmjs.org`，运行时与开发依赖各查一遍；默认镜像源不提供 audit 端点）；`npm run generate:toolshare` / `generate:architecture-report` / `npm run demo`（离线 mock）冒烟全部通过。
- **adapter 的 API key 路径补上测试**（此前只有离线 mock 路径有覆盖）：本地起一个假 OpenAI 兼容端点，验证 Bearer key、模型名、system 提示词都真实送达、```` ```json ```` 围栏被剥离、答案通过真实 plan 闸门出图；端点回 500 时 adapter 大声报错退出、不写答案文件、不悄悄退回 mock。测试自身也修掉一个死锁：假服务器跑在测试进程里，`spawnSync` 会冻结事件循环让服务器无法应答（undici 头部超时 300 秒才破裂）——改用异步 `spawn` 后整套 5 秒跑完。dist 构建的 MCP HTTP 端点另做了握手冒烟。
- **CI 首跑暴露的两个平台问题已修**（首次推送到 GitHub 触发真实 Actions）：
  1. **Windows job 的 `biome ci` 失败**——Windows checkout 把 LF 物化成 CRLF，而 biome 强制工作副本 LF。加 `.gitattributes`（`* text=auto eol=lf` + `*.png binary` 保护 golden 基线）。
  2. **ubuntu job 三个测试失败**——`agent-intake` 的 review 打包测试与 `mcp-e2e` 的两个视觉往返测试**无条件依赖光栅化后端**，本机有 sharp/draw.io 所以全绿，CI 两者皆无直接抛错。加「无后端则响亮跳过」守卫（与 `visual-gate.test.ts` 同一模式，跳过理由写明原因）；后端契约测试本来就在 `visual-gate.test.ts` 里覆盖。
- **修复：拆分大图时时序激活条会带着悬空引用落入部件**（覆盖率排查 `split.ts` 时发现）。`subset()` 此前只按参与者过滤 `sequence.activations`——拆分 >40 节点的时序图时跨部件消息被丢弃，但参与者留在部件里的激活条仍指向已删除的消息边，语义校验对部件直接报 ERROR；fragments 与 `activity.objectFlows` 的过滤一直是对的，唯独 activations 漏了。现在激活条按「部件内仍存在的边」过滤 `startMessageId`/`endMessageId`，fragments 改用同一个边集合。红绿测试钉住：45 参与者时序图拆分后，各部件零悬空引用、跨边界 fragment 正确消失、消息列表收窄到本部件。

## [未发布] — 2026-09-30

P1 收尾与 P2 第一批：让「一句话出图」可演示、视觉质量可回归，并接通多页导出。

### 新增

- **「一句话出图」reference adapter**（`examples/adapter/`）：双模适配器——设了 `DIAGRAM_ADAPTER_API_KEY` 走 OpenAI 兼容 `/chat/completions`（`DIAGRAM_ADAPTER_BASE_URL` / `DIAGRAM_ADAPTER_MODEL` 可换服务与模型），没设走确定性离线 mock；`npm run demo` 三条命令跑通「自然语言 → 模型 → 工具」闭环。适配器在核心之外，`src/` 永不发模型请求的原则不变。验证：`tests/adapter.test.ts` 走真实 CLI 产出任务 → adapter（无 key 无网络）→ 真实闸门落盘，provenance 引文逐字核验；demo 全程无 shell 拼接（用户请求文本不进 shell，避开注入与 DEP0190）。
- **视觉回归基线（golden-image）**：`scripts/visual-gate.ts` + `scripts/visual-diff.ts`（零依赖 PNG 解码器，按扫描线解 IDAT，扛得住 draw.io 的良性重编码，不是字节比对）+ `tests/visual-baseline/` 的 6 张 golden PNG（由真实 draw.io Desktop 渲染）。每次检查用同一后端重渲染当前输出并**逐像素**比对（无采样——采样会漏掉落在奇数坐标上的真实改动）；尺寸不一致直接失败；renderer 不可用时**显式跳过并说明原因**，不静默通过。CI 会尝试 `apt-get install draw.io`，装不上则出 warning 跳过——「跳过」不冒充「通过」。验证：篡改基线 → FAIL、恢复 → PASS；`tests/visual-diff.test.ts` 手工构造全部 5 种 PNG 过滤类型。
- **多页 `.drawio` 导出**：拆分场景（>40 节点）下 CLI 额外写 `<id>.multipage.drawio`（`renderDrawioMultiPage`），把各部分按顺序合并为同一文件的多页，每页保留自己的 id、名称与画幅；`rasterizeForReview({ page })` 由此可只导出某一页——论文套图一次导出、按页审查。合并器只接受 `renderDrawio` 的产物，其他 XML 直接抛错：绕过单页渲染诚实性检查的捷径不存在。验证：`tests/render-multipage.test.ts`（页序/id/名称保留、拒绝非页面输入）；CLI 冒烟：45 节点双容器模型拆成 main/a/b，`mp-smoke.multipage.drawio` 含 3 个按序 `<diagram>`。
- **timeline / mindmap 专用布局**（`src/layout/timeline.ts`、`src/layout/mindmap.ts`）：两者走 AGENTS §6 预留的专用确定性布局——timeline 把里程碑按声明顺序排在一条共享轴线上（milestone 画菱形、渲染器补轴线，连线即轴段），mindmap 按子树高度把一级分支配平到根的两侧（此前 ELK mrtree 只会往一边挂，画出来是右侧组织树而不是思维导图）。显式指定 `layout.algorithm` 时仍用 ELK，专用布局同样过 `validateLayout` 并按 profile 出报告。
- **19 个示例自带 `layout.profile: "strict"`**：示例是质量门面，现在每个 `.model.json` 都带最严档——记法与观感问题保持 WARNING 并参与自动重排；重新生成后严格档逐例校验零 WARNING/ERROR。活动图补上 `[invalid]` 分支与 Rejected 终点、状态图把初始/终止伪状态收进复合状态、思维导图示例加二级分支。
- **MCP Streamable HTTP 传输**（`src/mcp/http.ts`，`npm run mcp:http`）：路线图最后一项。同一套 `tools.ts`/`guards.ts` 分发器开一个 `/mcp` HTTP 端点（MCP 2025-06-18），远程 agent / Web 宿主可以像 stdio 一样调用。无会话：通知与响应帧回 202，请求回单个 JSON，GET/DELETE 回 405（无服务端推送、无可终止会话），批处理回 400（该修订已移除），`MCP-Protocol-Version` 不支持回 400，请求体上限 10 MB（超限 413 且排空后再应答，客户端能收到状态码）。安全按规范三条全做：每个连接校验 `Origin`（防 DNS 重绑定）、默认只绑 127.0.0.1、另校验 `Host` 头作为第二道墙；工具调用与 stdio 一样串行执行。验证：`tests/mcp-http.test.ts` 16 例 + 真实进程冒烟（initialize 握手、通知 202）。
- **`npm run coverage`**：Node 内建 `--experimental-test-coverage`，零新增依赖拿到逐文件覆盖率报告。
- **事件驱动示例重写为真正的发布/订阅拓扑**：此前它就是微服务预设改了一个节点名，两张示例图几乎一样。现在是独立预设——命令服务写事件库并发布 `OrderCreated`，Message Broker 扇出到 Notification/Shipping/Analytics 三个订阅者，无同步下游调用链；`--preset event-driven` 同步生效。

### 修复

- **draw.io 标签被 HTML 二次解码吞掉**：draw.io 以 `html=1` 渲染标签值，XML 解码后的字符串会再按 HTML 解析一次；`<<component>>`、`<<include>>` 这类文本解码后成为真标签被吞（构造型显示成 `<>`、include/extend 标签消失、`List<Layer>` 丢尖括号）。用户文本现在双重转义（`escText`），结构性标记（`<u>`、`<div>`、`<br>`）保持单转义。用例图的 `<<include>>`/`<<extend>>`、类图构造型与泛型、组件图构造型全部恢复显示。
- **零拐点边不再画成斜线**：`edgeStyle=none` 下 Draw.io 用浮动端点自己取边界点，两个节点不对齐时，ELK 算出的水平/垂直直线段被画成斜线（活动图 fork/reserve、状态机 Failed↔Processing 可见）。现在每条边都把 ELK 给出的起止点钉成 `exitX/exitY/entryX/entryY`，**校验器量的、SVG 画的、.drawio 里看到的是同一条线**。
- **ER 弱实体双框真的画出来了**：此前写的 `double=1` 不是 draw.io 样式键，弱实体一直是单框矩形；现在渲染外扩 5px 的第二个边框（SVG 同步）。
- 活动图 Fork/Join 黑条上的标签改白字（此前深底深字不可读）；部署制品画进宿主节点右下角（此前悬在节点下方甚至容器外），部署节点标签置顶、`measureNode` 保证宿主 ≥72px 高避免互相遮挡；图例的 Actor 行改为等比例火柴人（此前压扁成椭圆块）；时序图组合片段标签内缩不再压虚线框；所有边标签加白底（`labelBackgroundColor`），压线也可读。

### 变更

- `buildReviewTask` / `rasterizeForReview` 支持注入 `env`（缺省继承 `process.env`）：光栅后端探测（`DRAWIO_PATH`、`PATH`、`ProgramFiles`）不再强依赖进程环境，测试可自带环境；MCP `diagram_review_request` 透传宿主环境。
- 接入 Biome 后清理的死代码与风格统一：`generate-toolshare.ts` 未用的 `db`/`dbStyle`、`generate-concept-diagrams.ts` 未用的解构变量、`chen-er.ts` 与 `utils/text.ts` 的正则/码点写法、`guards.ts` / `drawio.ts` / `split.ts` 的 for-of 风格。无行为变化。

### 校验基线

- `npm run verify` 全绿：lint + build + 175 个测试（17 个文件）+ 133 个错误码文档同步。
- 视觉 golden 基线 6 张按新渲染重建后 6/6 PASS（`npm run visual-gate`）。

## [未发布] — 2026-09-29

文档治理与工程基建：把「哪份文档说了算」定死，并让 README 里的承诺变成机器门禁。

### 新增

- **`LICENSE`（Apache-2.0）与 `NOTICE`**：项目首次有了许可证。`NOTICE` 逐条登记第三方归属——vendored `libavoid.min.js`（LGPL-2.1，未修改）、`libavoid-routing.js`（Apache-2.0，未修改），以及三个运行时依赖；依赖的许可证字段是从已安装包的 `package.json` 读出来的，不是凭印象写的（`@elkjs/elkjs` 实为 `EPL-2.0 OR GPL-3.0-or-later` 双许可）。`package.json` 同步加 `license` 字段。
- **`docs/archive/`**：5 份早期阶段报告（`COMPLETION_REPORT` / `IMPROVEMENTS` / `PHASE2_IMPROVEMENTS` / `PROGRESS_REPORT` / `SUMMARY`）整体归档，每份文首加 DEPRECATED 横幅，并由 `docs/archive/README.md` 逐条列出它们**今天已失效**的结论。
- **`docs/ERROR_CODES.md` 与 `scripts/generate-error-codes.ts`**：错误码集中文档，码表由脚本从源码抽取，描述人工维护但强制齐全——源码有码而文档缺描述、或文档有码而源码已删，`--check` 直接失败。

### 变更

- **`docs/ROADMAP.md` 整体重写**：原「六阶段计划 / 整体进度 33%」已废弃——项目后来真正的走向（`src/agent/`、`src/mcp/`、`src/validate/visual.ts`、`src/layout/fallback-router.ts`、`src/render/png.ts`）在那张表里一格都对应不上。新文件只写**实测基线**（可复现命令 + 实测值）与按 P0/P1/P2 排序的路线图，并新增「明确不做」清单。
- **README「UML 质量保证」一节重写**：去掉「已实现完整的 UML 语义验证，确保符合 UML 2.5 标准」这类无法验证的断言和 ✅ 清单，改为指明两处检查各自覆盖什么、码在哪查、默认档下是什么严重度。同时修掉一处事实错误：原文写「5 种消息类型（同步、异步、返回、创建、销毁）」，实际 `MessageKind` 是 `call`/`return`/`create`/`destroy`/`signal`，同步与异步由**另一个字段** `isAsync` 决定。
- **`src/validate/uml-rules.ts` 的 20 条规则改用稳定错误码**：此前 `validateUmlIssues()` 用正则把英文 message 转成大写下划线串当 `code`（`.slice(0, 80)`），改一个措辞就会改掉调用方依赖的码，错误码文档也无法稳定成文。现在码是 `UML_RULE_CODES` 里的手写常量，`elementId` 由规则直接给出而不再从消息里猜。**message 文本逐字未变**，因此按文本断言的既有测试不受影响。
- 删除 `src/validate/index.ts` 中已无引用的 `legacyIssueCode()`（与上面同一套正则派生逻辑的死代码）。

### 移除（破坏性）

- **`constraints.sameLayer` 与 `constraints.before` 从模型 API 删除。** 两者在 elkjs 0.12.0 上实测无任何可观察效果：`sameLayer` 映射到的 `layering.layerChoiceConstraint` 连「x、y 本来就在同一层」这种最廉价的可满足用例都不动，`before` 改的是送入引擎的子节点次序，而该构建的交叉最小化自行决定层内排位。此前的处置是「保留字段 + 文档写清不生效 + 事后用 `BROKEN_SAME_LAYER_CONSTRAINT` 报告」，但那仍然是读起来像承诺的死配置。
  - **迁移**：删掉这两个键即可。要定层用 `constraints.placement`（`FIRST` / `LAST` / `FIRST_SEPARATE` / `LAST_SEPARATE`，实测生效）；要消交叉改**结构**（去掉或改接跨层长边、容器分组、拆分）。
  - 带着旧键的 `.model.json` 现在会在 `createDiagram` **抛错**而不是被安静忽略，错误信息说明为什么被删、该改用什么——避免旧模型布局出作者没要求的样子却毫无提示。
  - 一并删除：`BROKEN_SAME_LAYER_CONSTRAINT` 错误码、`AESTHETIC_LAYOUT_CODES` 中的对应条目、`src/layout/elk.ts` 的 `orderedIds()`（`before` 的唯一消费者）。子节点次序改为直接按声明顺序，行为对不含 `before` 的模型完全一致。
  - **验证**：19 个示例重新生成后，全部 `.drawio` 与 `.svg` **逐字节未变**，只有 3 个 `.model.json` 少了那两个键（`01-system-architecture`、`16-cloud-architecture` 带 `before`；`17-production-deployment` 带 `sameLayer`）。这是「它们从未影响布局」的直接证据，不是推断。`npm test` 140/140。

### 归档文档中被确认失效的主要结论

留此备查，避免有人再从旧报告里捡回去：

- `npm run generate "<一句自然语言>"` 能直接出图 —— 5 份文档都这么写，全都跑不通（见 2026-09-26 的破坏性变更）。
- 「21 个测试 / 6 个 suite / 7 → 21 (+200%)」—— 实测（2026-09-30）15 个文件、156 个测试、7 个 suite。
- 「UML 检查产生 WARNING 并阻断」—— 默认 `ai-led` 档下是 INFO。
- 「UML 符合度 79%（加权平均）」「代码覆盖率 ~85%」「单图 <100ms」—— 项目里不存在符合度评测、覆盖率工具和基准脚本，这些数字没有出处。
- 「零破坏性变更、完全向后兼容」—— 与本文件 2026-09-26 的记录直接矛盾。
- 「终止态画的是单圈而非标准双圈」—— 这条**当时诚实、现已过期**：`src/render/drawio.ts` 现在对 `state`/`state-machine`/`activity` 的 `end` 节点输出 `shape=doubleEllipse`。

## [未发布] — 2026-09-26

本次把「模型能力」整体移出项目：项目不再发起任何模型请求，也不再持有任何 API key；语义与视觉审查由调用方（宿主 agent 或其模型）在环内提供，而所有校验闸门保持不变。

### 新增

- **模型侧外置接口** `src/agent/prompts.ts`、`src/agent/intake.ts`：调用方索取「规划任务」与「审查任务」，回答后回灌。项目的 `PLAN_SYSTEM_PROMPT` / `AUDIT_SYSTEM_PROMPT` 成为对外契约的一部分。
- **CLI 文件流转**：`generate --emit-plan <task.json>` 取任务、`--plan <answer.json>` 回灌答案、`--audit` 附独立复审、`--review-findings` 应用审查结论（`src/cli.ts`）。
- **MCP 工具扩到 8 个**（`src/mcp/server.ts`、`src/mcp/tools.ts`）：`diagram_generate`、`diagram_validate`、`diagram_render`、`diagram_patch`、`diagram_plan_request`、`diagram_plan_submit`、`diagram_review_request`、`diagram_review_submit`。零新增依赖（手写 stdio JSON-RPC）。`npm run mcp` 启动。
- **答案与内联模型受同一几何闸门约束**：`src/mcp/guards.ts` 的 `assertNoGeometry()` 与 `src/ai/pipeline.ts` 的 `MODEL_GEOMETRY_FORBIDDEN` 共用同一份禁用清单；带 `x`/`y`/`sections`/`bendPoints`/`mxGeometry`/`mxCell` 的请求在布局前即被拒收，且不落盘。
- **视觉复核门禁** `src/validate/visual.ts` + 审查用位图光栅化 `src/render/png.ts`：draw.io Desktop CLI 优先（真实渲染器）、sharp 光栅化 SVG 兜底。审查结果只能映射到 `LayoutPreferences`（`density`、`nodeSpacing`、`layerSpacing`、`containerPadding`、`targetAspectRatio`、`wrapping`、`edgeLabelFontSize`、`edgeLength`）并重跑 `layoutDiagram()`，审查模型给出的任何坐标、尺寸、边路由在代码层被丢弃并记 WARNING。达到轮次上限仍有余留问题时状态为 `visual_failed_after_max_rounds`，照常出图并报 WARNING，不放宽校验。
- 视觉审查支持状态信道：`createScriptedReviewer()` 允许宿主一次注入多轮 findings 驱动连续审查；`runVisualGate()` 的注入点不变。
- 请求级错误统一为 `{ error: { code, message, hint } }`（`src/mcp/guards.ts` 的 `ToolError`），与「校验未通过」的 `isError` 应答通道分离。
- 工作区根约束：路径不得越过服务根（`PATH_OUTSIDE_WORKSPACE`）；`DIAGRAM_MCP_ROOT` 指向驱动器根目录（盘根）时启动即拒绝（Windows 上 `C:\output\…` 会以 `EPERM` 失败）。
- 测试：`tests/agent-intake.test.ts`、`tests/mcp-server.test.ts`、`tests/mcp-e2e.test.ts`（含逐示例的 draw.io 渲染兼容性冒烟）、`tests/visual-gate.test.ts`、`tests/cli.test.ts` 等。

### 变更

- **破坏性**：`npm run generate -- "<自然语言>"` 不再一条命令出图；无 `--offline`/`--preset`/`--input`/`--examples` 时要求 `--emit-plan` → `--plan`（或 MCP 的 `diagram_plan_request` → `diagram_plan_submit`）。
- **移除**：`src/ai/provider.ts` 的 OpenAI 兼容 HTTP 客户端与 `createOpenAiVisualReviewer`，以及配套的 `DIAGRAM_AI_API_KEY` / `DIAGRAM_AI_MODEL` / `DIAGRAM_AI_BASE_URL` 配置。该文件曾短暂保留为仅抛错的废弃提示桩，现已**整个删除**（2026-09-29 复核确认无外部调用）。
- 已废弃 flag（`--visual-review`、`--visual-rounds`）不再被静默忽略，而是报错并给出迁移路径。
- Windows 下 draw.io 可执行文件探测不再只依赖 `ProgramFiles` 等环境变量（spawn 出的进程环境里可能没有它们），补充标准安装路径字面量。
- `rasterizeForReview` 的 draw.io CLI 参数修正为 `spawn`（原代码从 `node:child_process` 导入并不存在的 `spawnFile`，ESM 链接阶段即抛错，导致「审查真实 Draw.io 渲染」从未实际生效）。新增可选 1-based `page`，避免多页 `.drawio` 被静默只导出首页。
- README 的「AI 生成」一节改写为「语义由调用方提供」，并新增视觉复核门禁与 MCP 使用说明。

### 已知限制

- 语义质量取决于调用方模型：项目只保证「答案过闸门」，不保证图本身画得好；`reviewerProvedCompleteness` 恒为 `false`。
- 视觉审查需要有能力看图的调用方；`sharp` 光栅化会忽略 SVG `foreignObject`（当前渲染器使用 `<text>`，不受影响）。
- 分页参数已具备，但本项目的 `renderDrawio` 目前只输出单页，多页论文图的分页导出仍未接通（无页号元数据）。（2026-09-30 已接通，见上方条目。）
- CI 环境通常没有 draw.io Desktop 与 sharp，视觉门禁相关用例应视为本地/带宿主验证，不作为 CI 断言。（2026-09-30 部分推翻：CI 现在会尝试安装 draw.io Desktop 跑 golden 门禁，装不上则显式跳过；sharp 仍不在 CI。）
