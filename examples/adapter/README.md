# examples/adapter — 一句话出图的 reference adapter

这两个文件演示**项目之外**的那一步怎么写：项目本身不发任何模型请求、不存任何 API key
（见根目录 README「语义由调用方提供」），所以「自然语言 → 任意模型 → 工具」缺的那一环
由调用方补上。这里给出一个零依赖的参考实现。

**它们不是流水线的一部分。** `src/` 永远不会调用 `adapter.mjs`，删掉这两个文件，
流水线照常工作。

## 三条命令跑通

```bash
npm run demo
```

等价于手工执行：

```bash
# 1. 工具索取语义（不发模型请求）
npm run generate -- generate --emit-plan output/demo/task.json --text "画一个 UML 用例图：普通用户可以登录、浏览工具、提交租借申请"

# 2. 你的模型作答（这里由 adapter 代劳）
node examples/adapter/adapter.mjs output/demo/task.json output/demo/answer.json

# 3. 工具过闸门、布局、落盘
npm run generate -- generate --plan output/demo/answer.json --text "…" --out output/demo
```

产物在 `output/demo/`：`.model.json`、`.drawio`、`.svg`、`.quality.json`。

## 双模

| 模式 | 触发条件 | 行为 |
|---|---|---|
| **真实模型** | 设了 `DIAGRAM_ADAPTER_API_KEY` | `POST {base}/chat/completions`（OpenAI 兼容），把任务的 `system` 与 `messages` 原样发过去 |
| **离线 mock** | 没设 key（默认） | 从任务的请求文本里**机械地**切出用例，不调任何网络。保证 CI 与无 key 用户也能跑通闭环 |

配置（环境变量）：

```bash
DIAGRAM_ADAPTER_API_KEY     # 设了就走真实模型
DIAGRAM_ADAPTER_BASE_URL    # 默认 https://api.openai.com/v1；换模型服务改这里
DIAGRAM_ADAPTER_MODEL       # 默认 gpt-4o-mini
```

## mock 的边界（重要）

mock **不是**一个能用的 planner。它只证明「任务的格式 + 答案的契约 + 闸门」这条链路
是通的，用例是从「可以…、…、…」这种句式里机械切出来的，没有理解。质量报告里那条
`uncertainties` 会如实写着这一点。

真实模型接上后，质量才会取决于你的模型——项目只保证「答案过闸门」，不保证图画得好。

## 闸门会拦什么

第 3 步的 `--plan` 会拒绝：

- 带 `x` / `y` / `width` / `height` / 边路由 / Draw.io XML 的答案（几何只归 ELK）
- 改写了稳定 ID 的答案
- 断引用、未知关系类型、结构不合法的模型

默认 `ai-led` 档下不拦：证据引文是否逐字存在、置信度是否到 0.7。要旧行为在答案里写
`"layout": { "profile": "strict" }`。

## 换成你自己的宿主

不需要用这个 adapter。任何能调模型的宿主都行——宿主 agent（如 MiMo Desktop / Claude
Code 的 MCP 配置，见 README「作为 MCP 服务被调用」）、CI 里的脚本、或你自己的任何语言
的代码。契约只有两个：

1. **任务**（`--emit-plan` 的输出）：`{ system, messages, audit, rules }`，`system` 就是
   `src/agent/prompts.ts` 里的 `PLAN_SYSTEM_PROMPT`，也是对外契约的一部分。
2. **答案**：`{ diagram, confidence, uncertainties }`，`diagram` 是 Diagram DSL 对象。
