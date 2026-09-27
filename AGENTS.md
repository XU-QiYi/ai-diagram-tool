# AGENTS.md

## 1. Project Goal

本项目用于构建一个 AI 驱动的专业 Diagram 生成流水线：

```
Natural Language
→ Codex / Agent
→ Diagram DSL
→ Semantic Validation
→ ELK.js Layout
→ Layout Validation
→ Auto Re-layout
→ Draw.io
→ SVG Preview
→ Git
```

核心目标：

- AI 负责理解需求和图表语义。
- Diagram DSL 负责描述图表结构。
- ELK.js 负责自动布局、节点位置和连线路由。
- Draw.io 负责生成可编辑的 `.drawio` 文件。
- SVG 负责预览和辅助验证。
- Validator 负责检查布局与结构问题。
- Git 负责版本管理。

**核心原则：LLM 负责语义，DSL 负责结构，ELK 负责布局，Renderer 负责格式，Validator 负责质量。**

------

## 2. Architecture Rules

必须遵循：

```
User Request
    ↓
Diagram DSL
    ↓
Semantic Validation
    ↓
ELK.js
    ↓
Layout Validation
    ↓
失败 → 调整布局 → ELK.js
    ↓
Draw.io Renderer
    ↓
.drawio + .svg
```

禁止：

```
LLM → 直接生成 Draw.io XML
LLM → 直接决定最终 x/y
LLM → 直接计算 edge routing
```

LLM 不负责最终几何布局。

------

## 3. Diagram DSL

Diagram DSL 是系统的核心中间表示。

必须支持：

- Diagram
- Node
- Edge
- Group / Container
- Style
- Metadata

推荐结构：

```
interface Diagram {
  id: string;
  type: DiagramType;
  direction?: LayoutDirection;
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  groups?: DiagramGroup[];
  metadata?: Record<string, unknown>;
}

interface DiagramNode {
  id: string;
  type: string;
  label: string;
  parentId?: string;
  properties?: Record<string, unknown>;
  style?: NodeStyle;
}

interface DiagramEdge {
  id: string;
  source: string;
  target: string;
  type?: string;
  label?: string;
  style?: EdgeStyle;
}
```

DSL 与 Draw.io 必须解耦。

`src/model` 不得依赖：

```
mxGraphModel
mxCell
mxGeometry
```

默认不要在 DSL 中由 LLM 指定：

```
x
y
```

------

## 4. Stable IDs

节点、边、容器必须拥有稳定 ID。

推荐：

```
node.user
node.api
node.database

edge.user-api
edge.api-database
```

修改已有图表时：

- 尽量保留已有 ID。
- 不因重新布局改变 ID。
- 不因修改文本改变 ID。
- 不随机重新生成整个图的 ID。

稳定 ID 是增量编辑和 Git diff 的基础。

------

## 5. Supported Diagram Types

至少支持：

1. System Architecture
2. UML Class Diagram
3. UML Component Diagram
4. Flowchart
5. ER Diagram

架构必须允许未来扩展：

- Sequence Diagram
- State Diagram
- Activity Diagram
- Deployment Diagram
- Mind Map
- Timeline
- Network Graph

不要把所有图表强制转换成 Flowchart。

------

## 6. Layout Strategy

根据图表类型选择合适的布局。

### System Architecture

```
ELK Layered
direction: RIGHT
```

### UML Class

```
ELK Layered
```

需要考虑 inheritance hierarchy。

### UML Component

```
ELK Layered
direction: RIGHT
```

### ER

```
ELK Layered
direction: RIGHT
```

### Flowchart

```
ELK Layered
direction: DOWN
```

Sequence Diagram、Mind Map、Timeline 等未来图类型应使用适合自身语义的专用布局，而不是强制使用 Layered。

------

## 7. ELK.js

使用：

```
@elkjs/elkjs
```

ELK 负责最终：

- x
- y
- width
- height
- edge routing
- hierarchy
- spacing

ELK 配置应集中管理。

不要在业务代码中散落大量手写坐标。

------

## 8. Layout Quality

布局优先保证：

1. 可读性
2. 层级清晰
3. 节点不重叠
4. 连线不穿节点
5. 尽量减少边交叉
6. 合理节点间距
7. 避免极端长边
8. 避免无意义的大面积空白
9. 避免节点过度拥挤
10. 保持语义关系清晰

不要单纯追求最小面积。

------

## 9. Containers

必须支持系统边界和嵌套容器。

例如：

```
Frontend
 ├── Web
 └── Mobile

Backend
 ├── API
 ├── Auth
 └── Order Service
```

Container 必须参与 ELK 布局，而不是仅作为视觉背景。

------

## 10. UML Semantics

UML 关系必须正确表达。

### Inheritance

```
solid line + hollow triangle
```

### Realization

```
dashed line + hollow triangle
```

### Dependency

```
dashed line + arrow
```

### Association

```
solid line
```

### Aggregation

```
solid line + hollow diamond
```

### Composition

```
solid line + filled diamond
```

不要使用普通箭头替代所有 UML relationship。

------

## 11. Draw.io Renderer

最终主输出必须是：

```
.drawio
```

必须能够直接使用 Draw.io / diagrams.net 打开和编辑。

Renderer 流程：

```
Diagram DSL
+
ELK Layout
↓
Draw.io Renderer
↓
mxGraphModel
↓
.drawio
```

Renderer 负责：

- node geometry
- edge geometry
- labels
- styles
- containers
- relationship markers
- parent hierarchy

LLM 不直接拼接复杂 Draw.io XML。

------

## 12. SVG Preview

同时生成：

```
.svg
```

SVG 用于：

- 快速预览
- 布局验证
- regression comparison
- CI artifact

`.drawio` 是主数据。

`.svg` 是预览数据。

------

## 13. Validation

必须实现 Semantic Validation 和 Layout Validation。

### Semantic Validation

检查：

- duplicate IDs
- broken references
- invalid node references
- invalid edge references
- missing required fields
- unsupported diagram types
- invalid relationship types

### Layout Validation

至少检查：

- node overlap
- edge crossing
- edge through node
- text overflow
- canvas overflow
- orphan nodes
- excessive whitespace
- excessive density
- excessively long edges

Validation Severity：

```
INFO
WARNING
ERROR
```

例如：

```
duplicate ID       → ERROR
broken reference   → ERROR
node overlap       → ERROR
edge through node  → ERROR

orphan node        → WARNING
long edge          → WARNING
large whitespace   → WARNING
```

------

## 14. Automatic Re-layout

布局必须支持迭代：

```
ELK
 ↓
Validate
 ↓
失败
 ↓
调整 Layout Options
 ↓
ELK
```

默认最多 5 次。

禁止无限循环。

每次记录：

- iteration
- validation result
- layout configuration
- remaining problems

达到最大次数仍失败时：

```
输出结果 + WARNING
```

不得通过降低 Validation 标准来伪造成功。

------

## 15. Incremental Editing

修改已有图表时：

```
Load existing DSL
↓
保留已有 IDs
↓
Add / Remove / Update
↓
ELK
↓
Validate
↓
Render
```

不要默认：

```
Delete everything
→ Rebuild everything
```

------

## 16. Complexity

当图表超过约 40 个节点时，评估是否需要拆分：

```
Main Architecture
+
Subsystem Diagrams
```

例如：

```
system.drawio
system-auth.drawio
system-order.drawio
system-database.drawio
```

但如果用户明确要求一个完整图，不要擅自拆分。

------

## 17. Style

默认风格：

- 简洁
- 专业
- 高可读性
- 少量颜色
- 清晰边框
- 合理字体大小

禁止：

- 彩虹配色
- 过度渐变
- 大量阴影
- 无意义装饰
- 每个节点随机颜色

颜色主要用于表达：

```
type
layer
state
importance
```

------

## 18. Project Structure

推荐：

```
project/
├── AGENTS.md
├── README.md
├── package.json
├── tsconfig.json
│
├── src/
│   ├── model/
│   ├── layout/
│   ├── render/
│   ├── validate/
│   ├── diagrams/
│   ├── pipeline/
│   └── utils/
│
├── diagrams/
│   ├── specs/
│   ├── output/
│   └── preview/
│
├── examples/
├── tests/
├── scripts/
└── assets/
```

实际目录可以调整，但必须保持：

```
Model
Layout
Render
Validate
Pipeline
```

职责分离。

------

## 19. CLI

提供 CLI，至少支持：

```
generate
layout
validate
render
```

例如：

```
npm run diagram -- generate examples/system.json
```

应能够生成：

```
.drawio
.svg
validation result
```

------

## 20. Testing

必须测试：

### Model

- valid diagram
- invalid diagram
- duplicate ID
- broken reference

### Layout

- simple graph
- layered graph
- container graph

### Validation

- overlap
- edge crossing
- edge-through-node
- orphan node
- overflow

### Renderer

- valid Draw.io XML
- stable IDs
- SVG generation

### Pipeline

```
DSL
→ ELK
→ Validate
→ Draw.io
→ SVG
```

必须实际运行测试，不允许只创建测试文件。

------

## 21. Examples

至少提供：

1. System Architecture
2. UML Class Diagram
3. UML Component Diagram
4. Flowchart
5. ER Diagram

每个 Example 至少有 DSL/spec，并能够实际生成：

```
.drawio
.svg
```

------

## 22. Dependencies

优先使用：

```
Node.js
TypeScript
@elkjs/elkjs
tsx
```

只增加必要依赖。

不要为了简单功能引入大型框架。

------

## 23. Security

用户输入必须经过 Schema Validation。

禁止直接把用户输入拼接成 shell command。

禁止执行未经验证的用户代码。

------

## 24. Error Handling

不要吞掉异常。

错误应说明：

- what failed
- where failed
- why failed
- possible solution

禁止空 catch：

```
catch (e) {}
```

------

## 25. Logging

Pipeline 应输出清晰日志，例如：

```
[MODEL] Diagram loaded
[MODEL] 18 nodes / 21 edges

[LAYOUT] Running ELK
[LAYOUT] Iteration 1

[VALIDATE] 1 error / 2 warnings

[LAYOUT] Re-running layout

[VALIDATE] Passed

[RENDER] Draw.io generated
[RENDER] SVG generated
```

------

## 26. Git

Git 应管理：

- source code
- DSL/spec
- configuration
- examples
- tests
- AGENTS.md
- README.md

不要提交：

```
node_modules/
temporary files
cache
logs
```

`.drawio` 和 `.svg` 是否提交由项目实际需求决定。

------

## 27. Agent Behavior

Codex Agent 执行任务时：

1. 先检查当前项目。
2. 先读取 `AGENTS.md`。
3. 优先复用已有代码。
4. 不随意覆盖用户代码。
5. 不重复创建已有功能。
6. 修改前理解依赖关系。
7. 每完成主要阶段进行验证。
8. 遇到错误先找根因。
9. 不通过降低测试标准解决问题。
10. 最终必须实际运行 build、test 和 example generation。

对于技术实现细节，Agent 可以自行决定，不需要频繁询问用户。

------

## 28. Definition of Done

项目完成至少应满足：

-  项目可以安装
-  TypeScript 可以编译
-  ELK.js 可以运行
-  Diagram DSL 可以解析
-  Semantic Validation 可以运行
-  Layout 可以运行
-  Layout Validation 可以运行
-  自动重排可以运行
-  Draw.io XML 可以生成
-  `.drawio` 可以打开
-  SVG 可以生成
-  CLI 可以运行
-  Examples 可以生成
-  Tests 可以运行
-  README 完整
-  没有核心功能 TODO

最终报告必须说明：

```
完成了什么
如何运行
测试结果
示例位置
已知限制
```

------

## 29. Golden Rule

始终遵循：

> **LLM 负责语义，DSL 负责结构，ELK 负责布局，Renderer 负责格式，Validator 负责质量，Git 负责历史。**