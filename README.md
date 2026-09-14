# AI → Diagram Model → ELK.js → Draw.io

一个不依赖在线 AI API 的 TypeScript 绘图内核：自然语言需求先映射到独立的 Diagram Model，再由 ELK.js 负责分层布局与正交路由，最后输出可编辑的 diagrams.net/Draw.io XML 和 SVG 预览。

## 安装与运行

```bash
npm install
npm run build
npm test
npm run examples
```

`npm run examples` 会生成 19 个示例目录，覆盖基础类型、扩展 UML 类型、状态机、Chen ER 和 4 个架构预设：`examples/01-system-architecture` 至 `19-chen-er`。每个目录包含 `.model.json`、`.drawio` 和 `.svg`。默认输出目录为 `output/`。

项目内置的业务图批量生成脚本使用：

```bash
npm run generate:toolshare
```

结果全部写入 `output/drawio-tool/`，不会散落到项目外部。

也可以直接传入简短需求生成一个最小图：

```bash
npm run generate -- "画一个电商系统架构图"
```

架构预设和已有模型重绘：

```bash
npm run generate -- --preset layered --title "毕业设计总体架构"
npm run generate -- --preset microservices
npm run generate -- --preset event-driven
npm run generate -- --preset cloud
npm run generate -- --input examples/01-system-architecture/system-architecture.model.json --out output/rebuilt
```

也可以用稳定 ID 对现有模型做增量更新。补丁只修改指定节点/边，未涉及的 ID 保持不变：

```bash
npm run generate -- --input examples/01-system-architecture/system-architecture.model.json --patch examples/patch-add-redis.json --out output/with-redis
```

补丁格式示例：

```json
{
  "addNodes": [{ "id": "node.redis", "label": "Redis", "kind": "cache" }],
  "addEdges": [{ "id": "edge.service-redis", "source": "node.service", "target": "node.redis", "type": "flow" }],
  "updateNodes": [{ "id": "node.service", "label": "Catalog Service" }]
}
```

可用操作包括 `addNodes`、`updateNodes`、`removeNodeIds`、`addEdges`、`updateEdges`、`removeEdgeIds`、`addContainers`、`updateContainers` 和 `removeContainerIds`。补丁在 Diagram Model 层应用，之后仍会完整执行 ELK 布局、几何验证、Draw.io 和 SVG 渲染。

所有运行时通用模板文字均为英文；只有用户输入、业务模型本身含中文时，节点和说明才会显示中文。

## 这些类型分别适合什么

- `system-architecture`：展示用户、前端、网关、服务、缓存、数据库、第三方系统之间的部署/调用关系。
- `uml-class`：展示类、属性、方法和继承、聚合、组合、依赖等静态结构。
- `uml-component`：展示组件、接口、依赖和系统边界，适合模块级设计。
- `uml-usecase`：展示 Actor、椭圆用例、系统边界，以及 association/include/extend 关系；不能用系统架构图代替。
- `flowchart`：展示业务步骤、判断分支、状态流转和处理流程。
- `er`：展示数据表、主外键和实体关系。
- `chen-er`：使用 Chen（陈氏）记法展示实体、属性、联系和 `1/N/M` 基数。
- `sequence`：时序消息和参与者。
- `state`：状态和状态转换。
- `state-machine`：UML 状态机，支持初始/终止伪状态、entry/do/exit 行为、guard/action 迁移和复合状态。
- `activity`：活动节点、分支和处理流。
- `deployment`：设备、节点和部署制品。
- `mindmap`：中心主题、分支和层级。
- `timeline`：时间点、阶段和里程碑。
- `network`：网络节点、链路和拓扑。

`src/diagram-types/registry.ts` 中的 `inferDiagramType` 会根据中文/英文关键词自动判断类型。UML 类图支持 association、dependency、inheritance、realization、aggregation、composition 等关系，并映射到对应的 Draw.io 箭头/虚线/菱形语义。系统架构请求还会进一步识别 layered、microservices、event-driven 和 cloud 模式，不会退化成流程图。

### 如何让它画其他图

自然语言入口可以直接描述图类型和元素，例如：

```bash
npm run generate -- "画一个 UML 用例图：普通用户可以登录、浏览工具、提交租借申请"
npm run generate -- "画一个 UML 类图：User 继承 Account，Order 组合 OrderItem"
npm run generate -- "画一个组件图：Web、API Gateway、Catalog Service、MySQL"
npm run generate -- "画一个流程图：提交订单后判断库存，库存不足则结束"
npm run generate -- "画一个 ER 图：User、Tool、Order，User 和 Order 一对多"
npm run generate -- "画一个 Chen ER 图：账户、订单和下单联系，包含属性和 1/N 基数"
npm run generate -- "画一个 Sequence Diagram：Client 调用 Service 再访问 Database"
npm run generate -- "画一个 State Diagram：Pending 经过 approve 变成 Active"
npm run generate -- "画一个状态机图：订单从待审核进入租借中，超时后进入已逾期"
npm run generate -- "画一个 Deployment Diagram：Client、Application Server、Database Server"
```

### Chen ER 自然语言格式

`chen-er` 提供可预测的半结构化中文解析。建议使用“实体 / 某实体属性 / 联系”三个部分：

```bash
npm run generate -- "画一个 Chen ER 图。实体：学生、课程；学生属性：学号（主键）、姓名；课程属性：课程号（主键）、课程名；联系：学生通过‘选修’联系课程，基数 M:N"
```

解析器会自动建立矩形实体、椭圆属性、菱形联系、无箭头关联线和 `1/M/N` 基数，并生成稳定 ID。属性可用 `（主键）`、`（多值）`、`（派生）` 标注；主键在 Draw.io/SVG 中以下划线显示，多值属性使用双椭圆，派生属性使用虚线椭圆。如果联系未写基数，工具保留联系但输出 `cardinality is unspecified` 警告，不会自行猜测。

复杂业务建议把每组定义用换行或中文分号隔开。无法可靠理解的自由文本会回退到内置 Chen ER 示例，避免生成错误业务语义。

复杂图或后续修改建议直接编辑/生成 `.model.json`：模型只描述节点、关系、容器和语义，不写最终坐标；随后统一经过 `layoutDiagram`、`validateLayout` 和两个渲染器输出。使用 `--input` 可以直接重绘修改后的模型。

## 扩展架构

图类型由 `src/diagram-types/registry.ts` 注册。每个类型提供别名、默认方向和模型工厂；新增类型不需要修改 CLI 或布局主流程，只需在 `DiagramType` 增加名称、实现模型工厂、注册 aliases，并补充专用渲染与验证语义。Sequence、State、Activity、Deployment、Mind Map、Timeline、Network Graph 不会被自动转换成 Flowchart；当前扩展工厂提供的是可运行最小模板，可继续替换成专用布局和 Draw.io 形状。

核心运行时代码不注入固定中文文本。节点标题、边标签和描述都来自 Diagram Model：中文请求可以产生中文业务标签，英文请求使用英文标签；通用模板默认使用英文。

## 高级 UML 支持

中间模型已为高级 UML 语义提供专用字段，避免把它们降级成普通边标签：

- Sequence：`sequence.activations`、`sequence.fragments`，支持 activation bar、`alt/opt/loop/par` 片段、guard 和 return message。
- Sequence 消息按从上到下的出现顺序自动显示 `1.`、`2.`、`3.` 序号，增删消息后自动重新编号。
- Activity：`activity.swimlanes`、`activity.objectFlows`，支持泳道和对象流关系。
- State：`state.composites`，边支持 `guard` 与 `action`，并区分初始/终止状态。
- Deployment：`deployment.artifacts`，节点支持 device/server/database，边支持 communication path。
- UML Class：`classMeta` 支持 stereotype、泛化参数、属性、方法、可见性、类型、参数、静态/抽象标志；边支持 source/target multiplicity。
- ER：`er.entities` 支持 weak entity、identifying relationship；foreign-key 边支持 `1`、`0..*`、`1..*` 等基数。
- Chen ER：`chenEr.entityIds`、`chenEr.attributeIds`、`chenEr.relationshipIds` 分别标记实体、属性和联系节点；节点使用矩形、椭圆和菱形，连接使用无箭头 association 边。

这些字段会进入 Draw.io 主文件；布局仍由 ELK 计算，验证器会检查引用完整性和图类型约束。对于正式论文，建议先在 `.model.json` 中明确语义，再生成 `.drawio`，不要直接手改 XML。

## 专业绘图约束

生成前先确定 Diagram Type，再建立该类型允许的节点和关系；布局坐标永远由 ELK 计算。渲染器不会把不同语义的关系偷偷改成普通箭头：例如类图继承使用空心三角、组合使用实心菱形、用例关联使用无箭头实线、依赖/包含使用虚线开放箭头。布局后会检查重叠、穿线、交叉、孤立节点、边界溢出和类型语义；有问题时自动增加间距并重新布局，仍有问题会输出 Layout Warning。

### Container、Port 与局部布局

- Container 是 ELK compound node，参与布局计算，不是渲染阶段后补的背景框。
- Container 支持 `parentId` / `containerIds` 嵌套，并可分别设置 `direction`、`padding`、`spacing`。
- Node 的 Port 会以 `FIXED_SIDE` 送入 ELK；Edge 使用 `sourcePort` / `targetPort` 精确连接节点边缘。
- 长文本、类属性和方法会按字符宽度测量；显式尺寸过小也会自动扩张，默认不会压缩进固定画布。
- 布局默认使用 `balanced` 密度；流程图和状态机图采用更紧凑的专用 profile，让主路径占据画布中心，同时保留节点边缘和标签的安全间距。可通过 `layout.density`、`layout.nodeSpacing`、`layout.layerSpacing`、`layout.targetAspectRatio` 和 `layout.wrapping` 覆盖。

例如需要更紧凑的业务流程，可在 `.model.json` 中加入：

```json
{
  "layout": {
    "density": "compact",
    "nodeSpacing": 30,
    "layerSpacing": 28,
    "targetAspectRatio": 1.05,
    "wrapping": "OFF"
  }
}
```

这些参数只影响 ELK 布局，不会把坐标写回模型；`wrapping` 在 ELK 不适用时会自动安全回退为非包装布局，并保留 Layout Warning。
- `constraints.placement` 支持 `FIRST`、`LAST`、`FIRST_SEPARATE`、`LAST_SEPARATE`；`sameLayer` 保持同层，`before` 保持稳定模型次序。最上/最下使用 TOP_TO_BOTTOM 方向配合 FIRST/LAST，最左/最右使用 LEFT_TO_RIGHT 配合 FIRST/LAST。

示例：

```json
{
  "direction": "LEFT_TO_RIGHT",
  "constraints": {
    "placement": { "node.user": "FIRST", "node.database": "LAST" },
    "sameLayer": [["node.cache", "node.database"]],
    "before": [["node.gateway", "node.service"]]
  }
}
```

### 架构图样式和图例

`theme.name` 支持 `professional`、`monochrome`、`blueprint`。`theme.showLegend=true` 会在图右侧生成可继续编辑的 Draw.io 图例；图例和 Deployment artifact 都会被计入页面边界。专业主题只区分少量稳定角色色：Service、Gateway、Cache、Queue、Database、External System，避免随机彩虹色。

## UML 质量保证

本项目已实现完整的 UML 语义验证和视觉规范，确保生成的图表符合 UML 2.5 标准：

### 自动验证
- ✅ **语义规则检查**：18+ 条 UML 规则（继承环、双向组合、孤立节点等）
- ✅ **布局质量检查**：节点重叠、边交叉、边穿节点检测
- ✅ **引用完整性**：激活条、组合片段、容器引用验证

### 视觉符号
- ✅ **类图**：静态成员下划线、抽象方法斜体、接口/抽象类名斜体
- ✅ **时序图**：5 种消息类型（同步、异步、返回、创建、销毁）视觉区分
- ✅ **状态图**：初始状态⚫、终止状态⊙符号
- ✅ **用例图**：Actor 泛化支持（空心三角箭头）

详细文档见 `docs/` 目录：
- `docs/ROADMAP.md` - 完整改进路线图
- `docs/PROGRESS_REPORT.md` - 当前进度和改进效果
- `docs/PHASE2_IMPROVEMENTS.md` - 最新改进详情

## 修改现有图

`.model.json` 是稳定 ID 的中间模型；读取它后修改 `nodes`、`edges` 或 `containers`，再调用 `layoutDiagram`、`renderDrawio` 和 `renderSvg` 即可增量更新。例如增加 Redis 只需加入 `node.redis` 与 `edge.service-redis`，原有 ID 和结构保持不变。对现有模型的精确修改也可以使用上面的 JSON patch 入口，避免重新生成导致原有节点 ID、Git diff 和人工编辑内容失去稳定性。

## 布局与扩展

`src/layout/elk.ts` 集中配置 ELK layered、方向、ORTHOGONAL 路由、节点/层间距和最多 5 次自动迭代。`src/validate/index.ts` 检查重叠、断边、孤立节点、边穿节点、画布溢出、重复 ID 与大图告警。新增图类型时：扩展 `DiagramType`，在 `src/diagram-types/` 添加构造器/语义规则，并在渲染器中补充必要样式。

若节点超过 40 个，CLI 会优先按照顶层 Container 自动生成 `main.drawio` 概览和各子系统 `.drawio`；没有 Container 时按稳定节点顺序拆成 `part-1`、`part-2`。每一份同时生成 `.model.json` 和 `.svg`，子图中的原节点/边 ID 不变。用户明确要求单图时设置 `constraints.forceSingle=true`，仍会生成一张图并保留 Layout Warning。

## 目录与扩展点

- `src/model/`：与 Draw.io 无关的 Diagram Model、稳定 ID、模型读写和增量合并。
- `src/diagram-types/`：15 种可请求的图类型、UML 示例和架构预设。
- `src/layout/elk.ts`：ELK compound layout、端口、正交路由和最多 5 次质量迭代。
- `src/validate/`：UML 语义与几何质量检查。
- `src/render/`：可编辑 mxGraph XML 与 SVG 预览。
- `src/pipeline/split.ts`：超过 40 节点的概览/子系统拆分。

增加 UML Sequence Diagram 的新特性时，模型字段在 `src/model/types.ts`，时序专用 Draw.io/SVG 渲染在 `src/render/drawio.ts` 与 `src/render/svg.ts` 的 `renderSequence*`，规则放入 `src/validate/uml-rules.ts`，示例放入 `src/diagram-types/extensions.ts`。新增全新图类型则还要在 `DiagramType` 和 `src/diagram-types/registry.ts` 注册。
