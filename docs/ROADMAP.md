# ROADMAP

本文件只回答两个问题：**现在到底做到哪了**，和**接下来做什么、为什么是这个顺序**。

事实源分工（见 `docs/archive/README.md`）：

- 怎么用 → 根目录 `README.md`
- 架构与不可违反的约束 → 根目录 `AGENTS.md`
- 发生过什么变更 → 根目录 `CHANGELOG.md`
- 错误码含义 → `docs/ERROR_CODES.md`
- 本文件 → 状态与优先级

历史阶段报告（含已废弃的「六阶段计划」）在 `docs/archive/`，**不作为事实源**。

---

## 当前基线（实测，非估算）

以下数字来自实际执行，不是文档抄写：

| 项 | 实测值 | 怎么复现 |
|---|---|---|
| TypeScript 编译 | 通过，0 error | `npm run build` |
| 测试 | 175 个测试 / 7 个 suite / 17 个文件，全过，0 失败 | `npm test` |
| 示例 | 19 个示例目录，每个含 `.model.json` + `.drawio` + `.svg` | `npm run examples` |
| 图类型 | 15 种（`src/diagram-types/registry.ts`） | 见 README「这些类型分别适合什么」 |
| MCP 工具 | 8 个（stdio JSON-RPC，零新增依赖）；`npm run mcp:http` 提供 Streamable HTTP 传输（MCP 2025-06-18，无会话，Origin/Host 校验） | `npm run mcp` / `npm run mcp:http` |
| 运行时依赖 | 3 个：`@elkjs/elkjs` 0.12.0、`mammoth` 1.12.3、`pdfjs-dist` 6.3.289 | `package.json` |
| 许可证 | 本项目 Apache-2.0；vendored libavoid 为 LGPL-2.1 / Apache-2.0 | `LICENSE`、`NOTICE` |

**没有**的东西（不要假设有）：性能基准脚本、UML 符合度评测。
覆盖率报告已有（`npm run coverage`，Node 内建，零新增依赖）。
历史文档里出现的「覆盖率 ~85%」「UML 符合度 79%」「单图 <100ms」都无出处，已随归档失效。

### 已经成立的核心能力

- **权威分层**：LLM/作者负责语义，Diagram Model 负责结构，ELK 负责全部几何，渲染器负责格式，
  验证器负责质量。调用方传入的任何坐标/尺寸/边路由/Draw.io XML 在布局前被拒收
  （`MODEL_GEOMETRY_FORBIDDEN` / `INPUT_GEOMETRY_FORBIDDEN`）。
- **模型能力外置**：项目不发任何模型请求、不存任何 API key。语义与视觉审查由调用方在环内提供
  （`--emit-plan` → 作答 → `--plan`；MCP `diagram_plan_request` → `diagram_plan_submit`）。
- **两档评判**：默认 `ai-led` 只拦「工具自己失职」的问题；`strict` 恢复对作者语义与证据的评判。
  档位随模型传递，CLI / MCP / plan 提交同一入口。
- **重排只拧真有用的旋钮**：加大间距实测能修的问题才继续迭代；`EDGE_CROSSING`、`EDGE_UNROUTED`、
  `NODE_OUTSIDE_CONTAINER` 实测拧不动，立即停并报 `RELAYOUT_NOT_FIXABLE_BY_PREFERENCES`
  交回构图层，不假装修好。
- **替补连线器**：`vendor/libavoid` 只补 ELK 漏画的边，并在质量报告里写明
  `EDGE_ROUTED_BY_FALLBACK`，不冒充 ELK 成果。
- **渲染诚实性**：写盘前检查 Draw.io XML / SVG 根结构、标签闭合、稳定 ID、`viewBox`；
  直线不再被 Draw.io 折成直角——**校验的是什么线，看到的就是什么线**。
- **视觉复核门禁**：位图优先走真实 draw.io Desktop，探测不到才退回 sharp 光栅化 SVG，
  结果里写明用了哪个后端；审查结论只能映射为 `LayoutPreferences`，坐标一律丢弃。
- **专用布局**：timeline（单轴里程碑）与 mindmap（双向发散）走确定性专用布局（AGENTS §6），
  显式指定 `layout.algorithm` 时仍可用 ELK。
- **布局引擎现状（2026-10-01 核实）**：elkjs 与 Eclipse ELK 同步发版（minor 版本号一致），
  0.12.0 发布于 2026-07——「上游停止维护」的说法已过时，本项目在用最新版。
  真正的风险是**升级会改变布局输出**：升级流程 = `npm run verify` + `npm run visual-gate`
  全绿、有意重建 golden 基线后才合入；对当前版本实测无效的旋钮（如 `sameLayer`/`before`）
  已从模型 API 删除，不随版本假设复活。
- **示例即门面**：19 个示例自带 `layout.profile: "strict"`，严格档逐例校验零 WARNING/ERROR，
  6 张 golden 基线由真实 renderer 生成并逐像素回归。

---

## 路线图

状态标记：`[ ]` 未开始 · `[~]` 进行中 · `[x]` 已完成并有验证证据。
每完成一项，必须同时更新本表、`CHANGELOG.md`，以及受影响的 `README.md` 段落。

### P0 — 让仓库可信、可协作

- [x] **文档治理**：5 份旧阶段报告移入 `docs/archive/` 并逐份标注 deprecated，
      写明各自哪些结论已失效；README / AGENTS / CHANGELOG 成为唯一事实源；
      修掉 CHANGELOG 里「`src/ai/provider.ts` 是废弃桩」这条自身已过期的记录（该文件已删除）。
      证据：`docs/archive/README.md` 的失效清单；git status 中 5 份报告均为 rename。
- [x] **LICENSE**：补 Apache-2.0 全文 + `NOTICE`（第三方归属：vendored libavoid 与三个运行时依赖，
      许可证字段从已安装包的 `package.json` 读出，不猜）。
      证据：根目录 `LICENSE`、`NOTICE`；`@elkjs/elkjs` 实为 `EPL-2.0 OR GPL-3.0-or-later` 双许可，已如实登记。
- [x] **CI**：GitHub Actions 一键跑 `lint + build + test + examples`，
      并把「示例产物与仓库内已提交版本一致」作为门禁，防止示例悄悄漂移。
      证据：`.github/workflows/ci.yml`（另有错误码同步检查与 visual golden 门禁，renderer 缺失时显式跳过）。
- [x] **lint / format**：接入 Biome（单个 devDependency 同时管 lint 与 format），
      全量格式化一次并纳入 CI。
      证据：`biome.json` + `npm run lint` / `npm run format:check`，CI 首个步骤即 lint。
- [x] **错误码集中文档**：`docs/ERROR_CODES.md` 由脚本从源码抽取码表生成，
      描述文字人工维护但**强制齐全**——源码里出现而文档缺失、或文档里有而源码已删，CI 直接失败。
      证据：`npm run error-codes -- --check`（当前 133 个码），CI 同步跑。

### P1 — 让核心卖点可见、可回归

- [x] **「一句话出图」reference adapter**：`examples/adapter/` 提供双模适配器
      （设了 `DIAGRAM_ADAPTER_API_KEY` 走 OpenAI 兼容 `/chat/completions`，没设走确定性 mock），
      `npm run demo` 三条命令跑通「自然语言 → 模型 → 工具」闭环。
      **约束**：适配器在核心之外，`src/` 永不发模型请求这条原则不变。
      验证：`tests/adapter.test.ts` 走真实 CLI 产出任务 → adapter（无 key 无网络）→ 真实闸门落盘，
      provenance 引文逐字核验；demo 全程无 shell（用户请求文本不做 shell 拼接，避开注入与 DEP0190）。
- [x] **视觉回归基线**：`scripts/visual-gate.ts` + `scripts/visual-diff.ts`（零依赖 PNG 解码器）+
      `tests/visual-baseline/` 的 6 张 golden PNG。基线由**真实 renderer**（draw.io Desktop）生成，
      每次检查用同一后端重渲染当前输出并**逐像素**比对（无采样——采样会漏掉落在奇数坐标上的真实改动）；
      尺寸不一致直接失败；renderer 不可用时**显式跳过并说明原因**，不静默通过。
      验证：篡改基线 → FAIL，恢复 → PASS；`tests/visual-diff.test.ts` 5 例手工构造全部 5 种 PNG 过滤类型。

### P2 — 打磨边界

- [x] **移除失效约束**：`constraints.sameLayer` 与 `constraints.before` 实测对布局无效
      （前者映射到的 `layering.layerChoiceConstraint` 在 elkjs 0.12.0 上无可观察差异，
      后者被交叉最小化覆盖），已从模型 API 删除，保留实测生效的 `constraints.placement`；
      带旧键的模型现在**抛错并给出迁移路径**，不再安静忽略。
      证据：19 个示例重生成后 `.drawio`/`.svg` 逐字节未变，只有 3 个 `.model.json` 少了死键。
- [x] **多页导出**：拆分场景（>40 节点）下 CLI 额外输出 `<id>.multipage.drawio`，
      各部分按顺序合并为同一文件的多页，每页保留自己的 id、名称与画幅；
      审查位图可用 `rasterizeForReview({ page })` 只导出某一页。
      证据：`tests/render-multipage.test.ts`（页序/id/名称保留、拒绝非 `renderDrawio` 产物）；
      CLI 冒烟：45 节点双容器模型拆成 main/a/b 三部分，`mp-smoke.multipage.drawio` 含 3 个按序 `<diagram>`。
- [x] **MCP HTTP 传输**：`npm run mcp:http` 在同一套 `tools.ts` / `guards.ts` 分发器上
      提供 Streamable HTTP 端点（`/mcp`，MCP 2025-06-18）。
      无会话：通知回 202、请求回单个 JSON、GET/DELETE 回 405、批处理回 400
      （该修订已移除批处理）；`MCP-Protocol-Version` 不支持时回 400。
      安全按规范三条全做：每个连接校验 `Origin`、默认只绑 `127.0.0.1`、另校验 `Host` 头
      （DNS 重绑定的第二道墙）；跨机器暴露必须显式设 `DIAGRAM_MCP_HTTP_HOST=0.0.0.0`
      并配 `DIAGRAM_MCP_HTTP_ORIGIN`。
      证据：`tests/mcp-http.test.ts` 16 例（握手、202/405/400/404/403/413、真实工具调用、
      几何走私拒收、来源与主机校验、超大请求体）。

---

## 明确不做（Non-goals）

这些不是「还没做」，是**决定不做**，写在这里免得反复被提议：

- **不在 `src/` 里调用任何模型、不持有任何 API key。** 语义由调用方提供是架构决定，
  不是待补的功能。reference adapter 只作为核心之外的示例存在。
- **不让 LLM 或审查者决定坐标。** 任何入口传进来的几何都在代码层丢弃并记 WARNING。
- **不为了「通过」而放宽校验。** 达到迭代/轮次上限仍有余留问题时，照常出图并报 WARNING，
  绝不降低标准伪造成功（`AGENTS.md` §14）。
- **不把 `box` / `rectpacking` 暴露成布局算法。** 实测它们不为边生成任何路由段，
  交付出来是一堆没有连线路径的框。
- **不承诺 `sameLayer` / `before` 能改变布局。** 见 P2——做不到的事从 API 里删掉，
  而不是留在文档里加免责声明。

---

## 验收标准（可执行，不靠自觉）

任何一项路线图条目要标 `[x]`，必须满足：

1. `npm run build` 0 error；
2. `npm test` 全过，且**新增行为有对应测试**（不允许只改代码不加测试）；
3. `npm run examples` 能跑完 19 个示例，产物通过渲染诚实性检查；
4. `npm run lint` 干净；
5. 受影响的用户可见行为已写进 `README.md`，变更已写进 `CHANGELOG.md`；
6. 破坏性变更必须在 `CHANGELOG.md` 显式标注，并给出迁移路径。

CI 会把 1–4 变成机器门禁；5–6 靠 review，但本文件的分工表是判断依据。

---

## 参考

- UML 2.5.1 规范：https://www.omg.org/spec/UML/
- ELK 选项参考：https://www.eclipse.org/elk/reference.html
- Draw.io 形状库：https://www.drawio.com/doc/faq/shape-complex-create-edit
- 本项目设计取舍的完整记录：`docs/superpowers/specs/`、`docs/superpowers/plans/`
- 实测验证产物（位图对照）：`docs/verification/`
