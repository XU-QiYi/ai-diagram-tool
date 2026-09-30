# docs/archive/ — 历史阶段报告（已归档，勿作为事实源）

这里的 5 份文档是项目早期（2026-09-09 前后）UML 语义/视觉增强两个阶段的**完工报告**，
不是当前文档。它们被保留只为记录「当时做了什么、当时怎么想」，其中大量数字、命令和
结论**今天已经不成立**。

**当前唯一事实源**：根目录 `README.md`（怎么用）、`AGENTS.md`（架构宪法）、
`CHANGELOG.md`（发生过什么变更）。测试与示例的实际状态以 `npm test`、`npm run examples`
的输出为准，不以本目录任何文字为准。

## 归档清单

| 文件 | 是什么 | 今天还剩多少价值 |
|---|---|---|
| `IMPROVEMENTS.md` | 阶段一详情：UML 语义验证器、Actor 泛化、时序图消息样式 | 中。`RelationshipType` 联合类型清单与「消息类型 → Draw.io 样式」对照表仍与 `src/model/types.ts`、`src/render/drawio.ts` 一致，可当记法参考 |
| `PHASE2_IMPROVEMENTS.md` | 阶段二详情：类图静态/抽象样式、状态图初始/终止符号 | **最高**。UML 2.5 条款引用（9.2.3 静态下划线/抽象斜体、14.2.3.4 初始与终止伪状态）和「终止态画的是单圈而非标准双圈」这条诚实说明，仍是 `src/render/drawio.ts` 的真实设计依据 |
| `COMPLETION_REPORT.md` | 阶段一完工总结 | 低。仅规则清单（5 个图族、DFS/BFS 环检测与可达性）大致仍对应 `src/validate/uml-rules.ts` |
| `PROGRESS_REPORT.md` | 六阶段进度追踪表 | 低。文首那段「本表为历史记录」的免责声明本身值得当模板；2026-09-25 的几条工程笔记（结构化 issue、`DIAGRAM_REQUEST_UNPARSED`、ERROR 时非零退出）仍准确 |
| `SUMMARY.md` | 阶段一+二合并的对外宣传式总结 | 低。分层图（model → validate → layout → render）仍与 `src/` 一致，但 `README.md` 讲得更好 |

## 会误导人的地方（读之前必看）

以下几条在多份文档里反复出现，且**全部已失效**：

1. **`npm run generate "<一句自然语言>"` 能直接出图** —— 5 份文档都这么写，全都跑不通。
   项目已不再调用任何模型（见 `CHANGELOG.md`）：自然语言入口现在是
   `--emit-plan` → 你的模型作答 → `--plan`，或 MCP 的 `diagram_plan_request` →
   `diagram_plan_submit`；只有固定格式的 `--chain "A -> B -> C"` 不需要模型。
2. **「21 个测试 / 6 个 suite / 7 → 21 (+200%)」** —— 实际是 11 个测试文件、140 个测试、7 个 suite。
3. **「UML 检查产生 WARNING」** —— 默认档已切到 `ai-led`：所有 `phase === 'semantic'` 的
   WARNING 被降为 INFO，既不阻断交付也不触发重排（`src/validate/policy.ts`、`AGENTS.md` §13 补注）。
   要旧行为需在模型里写 `"layout": { "profile": "strict" }`。
4. **凭空造出来的指标** —— 「UML 符合度 79%（加权平均）」「代码覆盖率 ~85%」「编译 ~2s、
   单图 <100ms」：项目里**没有任何**符合度评测、覆盖率工具或基准测试脚本，这些数字没有出处。
5. **「14 种图类型 / 43 个示例文件」** —— 实际 15 种图类型、19 个示例目录。
6. **「零破坏性变更、完全向后兼容」** —— 与 `CHANGELOG.md` 记录的破坏性变更直接矛盾。
7. **失效的路径引用** —— 根目录 `ROADMAP.md`/`IMPROVEMENTS.md`、`docs/PHASE2_IMPROVEMENTS.md`、
   `docs/PROGRESS_REPORT.md`、`docs/SUMMARY.md`（均已移入本目录），以及从未存在过的
   `examples/usecase-toolshare/`、`docs/API.md`、`docs/CONTRIBUTING.md`、`docs/UML_STANDARDS.md`。
8. **「六阶段路线图」** —— 已废弃。项目后来真正的走向（`src/agent/`、`src/mcp/`、
   `src/validate/visual.ts`、`src/layout/fallback-router.ts`、`src/render/png.ts`）
   在那张表里一格都对应不上。当前路线图见 `docs/ROADMAP.md`。

## 维护约定

- 不要再往这里加新文档，也不要按这里的内容改代码。
- 新的阶段性说明写进 `CHANGELOG.md`；设计与取舍写进 `docs/superpowers/specs/`；
  用法写进 `README.md`。
- 本目录内容**不做后续修正**：发现新的失效条目，在上面的清单里补一句即可，不去改原文，
  以免让「历史快照」变成「半新半旧」。
