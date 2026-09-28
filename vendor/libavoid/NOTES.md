# Vendored: libavoid edge router

| 文件 | 来源 | 许可证 |
|---|---|---|
| `libavoid.min.js` | `jgraph/drawio` @ `dev`, `src/main/webapp/js/libavoid-js/libavoid.min.js`（由 `jgraph/drawio-libavoid` 从 Adaptagrams 的 C++ 编译出的纯 JS/wasm2js 构建） | **LGPL-2.1**（见本目录 `LICENSE`，上游署名文件） |
| `libavoid-routing.js` | 同上路径，drawio 手写（hand-authored）的路由核心 `globalThis.AvoidRouting` | **Apache-2.0**（drawio 仓库整体许可证） |
| `LICENSE` | `.../libavoid-js/LICENSE` | LGPL-2.1 原文，随包保留 |
| `README.md` | `.../libavoid-js/README.md` | 出处与构建说明，原文保留 |

下载时间：2026-09-28，`git clone` 未使用，按 raw 文件抓取；仓库许可证由 GitHub API 识别为 Apache-2.0。

## 为什么保留这些文件

LGPL-2.1 的义务主要在**分发**组合作品时触发。本项目当前不分发；即便如此仍保留上游 `LICENSE` 与本说明，做到可替换、可追溯。`libavoid-routing.js` 是 Apache-2.0，要求保留版权声明并注明修改——**若我们之后改动它，必须在本文件里记下落改动的地方和原因**。

## 它做什么、不做什么

`AvoidRouting.computeRoutes(Avoid, vertices, edges, opts)` 只算连线路径：输入是**已定好的方格盒子**（绝对坐标）与每条边的端点约束，输出只有每条边的内部拐点。上游注释写得很明确：**"libavoid never moves a vertex"**。因此它不会改变节点位置，也不能消除那些由"谁连谁"决定的拓扑交叉。

## 本项目怎么用（重要）

**只当替补，不当主力。** `src/layout/fallback-router.ts` 仅在 ELK 完全没有给出某条边路径时（实测 `layout.algorithm` 选 `stress` / `radial` 会漏）才调用它补那几条边，并且一定在质量报告里写 `EDGE_ROUTED_BY_FALLBACK`，绝不冒充 ELK 的成果。脚本按需惰性加载，正常图不会付出 559KB 的解析代价。

选这个方案前测过 10 张真实图（同样的方格、同样的端点，只换连线器）：**ELK 更好 1 张、libavoid 更好 0 张、持平 9 张**。那张 ELK 更好的图上，libavoid 把 1 处交叉变成 3 处。所以它没有资格接管全部连线；它唯一的实绩是把 ELK 漏掉的 2 条边画了出来。完整记录见 `docs/superpowers/specs/2026-09-26-ai-led-drawing-authority.md` §13。

**我们没有修改这两个上游文件**；若将来改动，须在此登记改动位置与原因（Apache-2.0 要求注明修改）。

