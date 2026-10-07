# MCP 服务：stdio 与 Streamable HTTP

> 用法入口与工具总览在 README「作为 MCP 服务被调用」一节之前的表格里；本文件是接入与约束的完整版。


`npm run mcp` 启动一个 stdio MCP 服务（零新增依赖），`npm run mcp:http` 用同一个分发器开 Streamable HTTP 端点——让任何支持 MCP 的 agent 宿主把本流水线当工具调用，而不是自己去拼 Draw.io XML。八个工具按方向分两类——**送出去的只有结构和任务，收回来的必须过闸门**：

| 工具 | 作用 |
|---|---|
| `diagram_plan_request` | 把文本/文档/图片打包成规划任务交给调用方的模型（本项目不发请求） |
| `diagram_plan_submit` | 回灌答案：逐个过证据、稳定 ID、UML 语义、坐标拒收，然后 ELK 布局落盘 |
| `diagram_review_request` | 渲染位图并返回可引用 ID 白名单 + 几何事实 + 答案契约 |
| `diagram_review_submit` | 回灌审查结论：只映射为 `LayoutPreferences` 并重跑 ELK，坐标一律丢弃 |
| `diagram_generate` | 仅箭头链解析（必须 `chain: true`），不调用任何模型 |
| `diagram_validate` | 布局 + 语义/几何校验，只返回报告，不写文件 |
| `diagram_render` | 布局 + 校验 + 写 `.model.json` / `.drawio` / `.svg` |
| `diagram_patch` | 按稳定 ID 增量修改已有模型后重跑全流程 |

调用方**不能**传入坐标：任何带 `x`、`y`、`sections`、`bendPoints`、`waypoints`、`geometry`、`mxCell`、`mxGeometry` 的 `model` 或 `patch` 会被 `INPUT_GEOMETRY_FORBIDDEN` 拒收，错误信息会说明坐标只能由 ELK 计算。路径参数被限制在服务根目录内（`DIAGRAM_MCP_ROOT`，默认启动时工作目录），越界返回 `PATH_OUTSIDE_WORKSPACE`。想要自然语言/文档/图片而又不提交计划答案时，`diagram_generate` 返回 `AGENT_PLAN_REQUIRED`，提示改走 `diagram_plan_request` → 自己的模型 → `diagram_plan_submit`，或显式设 `chain: true`。

### 接入任意 MCP 宿主（stdio）

先 `npm run build`，然后把编译产物注册成 stdio 服务——Claude Desktop、MiMo Desktop、Cursor 等任何支持 MCP 的宿主都吃这一种配置（改完需重启宿主并新建会话）：

```jsonc
{
  "mcpServers": {
    "ai-diagram-tool": {
      "command": "node",
      "args": ["<本仓库路径>/dist/src/mcp/server.js"],
      "env": { "DIAGRAM_MCP_ROOT": "<本仓库路径>" }
    }
  }
}
```

`DIAGRAM_MCP_ROOT` 指向项目目录，服务的读写都被限制在里面。开发时想跳过构建，也可以用 `node --import tsx src/mcp/server.ts`；注意 `--import tsx` 按**进程工作目录**解析 `tsx` 包，宿主必须把工作目录设成本项目根目录，否则起不来。两种方式都已在 Node v24 下实测握手成功（`initialize` 返回 `serverInfo.name = diagram-mcp`）。

### 或者走 HTTP：`npm run mcp:http`

同一套工具分发器开一个 **Streamable HTTP** 端点（MCP 2025-06-18）：`http://127.0.0.1:3000/mcp`，远程 agent、Web 宿主、跨机器进程都能调用。无会话模式：每次 POST 携带一条 JSON-RPC 消息——通知回 202、请求回单个 JSON；不提供服务端推送（GET 回 405）、无可终止会话（DELETE 回 405）；批处理在 2025-06-18 已被移除，POST 数组回 400；`MCP-Protocol-Version` 头不支持时回 400；请求体上限 10 MB。

安全按规范三条全做：每个连接校验 `Origin` 头（防 DNS 重绑定）、默认只绑 `127.0.0.1`、另校验 `Host` 头。环境变量：`DIAGRAM_MCP_HTTP_PORT`（默认 3000）、`DIAGRAM_MCP_HTTP_HOST`（默认 127.0.0.1）、`DIAGRAM_MCP_HTTP_ORIGIN`（逗号分隔的额外信任来源）。要暴露给其他机器，把 `DIAGRAM_MCP_HTTP_HOST=0.0.0.0` 的同时**必须**设置 `DIAGRAM_MCP_HTTP_ORIGIN`——只放行你信任的来源；两者都没配就想上公网，服务行为不会帮你兜底。
