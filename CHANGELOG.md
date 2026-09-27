# Changelog

本项目遵守 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 风格，版本号遵循语义化版本。
本文件记录 `ai-diagram-tool` 的显著变更。

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
- **移除**：`src/ai/provider.ts` 的 OpenAI 兼容 HTTP 客户端与 `createOpenAiVisualReviewer`，以及配套的 `DIAGRAM_AI_API_KEY` / `DIAGRAM_AI_MODEL` / `DIAGRAM_AI_BASE_URL` 配置。`src/ai/provider.ts` 现为仅抛错的废弃提示桩，等确认无外部调用后删除。
- 已废弃 flag（`--visual-review`、`--visual-rounds`）不再被静默忽略，而是报错并给出迁移路径。
- Windows 下 draw.io 可执行文件探测不再只依赖 `ProgramFiles` 等环境变量（spawn 出的进程环境里可能没有它们），补充标准安装路径字面量。
- `rasterizeForReview` 的 draw.io CLI 参数修正为 `spawn`（原代码从 `node:child_process` 导入并不存在的 `spawnFile`，ESM 链接阶段即抛错，导致「审查真实 Draw.io 渲染」从未实际生效）。新增可选 1-based `page`，避免多页 `.drawio` 被静默只导出首页。
- README 的「AI 生成」一节改写为「语义由调用方提供」，并新增视觉复核门禁与 MCP 使用说明。

### 已知限制

- 语义质量取决于调用方模型：项目只保证「答案过闸门」，不保证图本身画得好；`reviewerProvedCompleteness` 恒为 `false`。
- 视觉审查需要有能力看图的调用方；`sharp` 光栅化会忽略 SVG `foreignObject`（当前渲染器使用 `<text>`，不受影响）。
- 分页参数已具备，但本项目的 `renderDrawio` 目前只输出单页，多页论文图的分页导出仍未接通（无页号元数据）。
- CI 环境通常没有 draw.io Desktop 与 sharp，视觉门禁相关用例应视为本地/带宿主验证，不作为 CI 断言。
