# 高级 UML 与 ER 模型字段

# 高级 UML 支持

中间模型已为高级 UML 语义提供专用字段，避免把它们降级成普通边标签：

- Sequence：`sequence.activations`、`sequence.fragments`，支持 activation bar、`alt/opt/loop/par` 片段、guard 和 return message。
- Sequence 消息按从上到下的出现顺序自动显示 `1.`、`2.`、`3.` 序号，增删消息后自动重新编号。
- Activity：`activity.swimlanes`、`activity.objectFlows`，支持泳道和对象流关系。
- State：`state.composites`，边支持 `guard` 与 `action`，并区分初始/终止状态。
- Deployment：`deployment.artifacts`，节点支持 device/server/database，边支持 communication path。

### 数据库字段的主外键记号

`classMeta.attributes[].key` 支持 `PK` / `FK` / `UK`，渲染成 `«PK»user_id: BIGINT`。三条约束：

- 标记文字由**同一个函数**产出（`utils/text.ts` 的 `keyMarker`），宽度测量与两个渲染器共用它，所以盒子不会按没有标记的尺寸算、再让标记溢出；
- `.drawio` 与 `.svg` 输出**逐字相同**的标记文本；
- 填了 `PK/FK/UK` 之外的值会在 `createDiagram` 直接抛错，不会安静地画出 `«BOGUS»`。

节点上的 `style.dashed` 现在两个渲染器都兑现（`.drawio` 加 `dashed=1`，SVG 给轮廓加 `stroke-dasharray`，文字保持实线）——此前它被两边同时忽略，写了等于没写。

### 一整套 ER 图（总图 + 每表一张子图）

`npx tsx scripts/generate-er-suite.ts [输出目录]` 会生成概念总图、表关系总图、以及每张表一张陈氏局部图（焦点表实线、相邻表虚线、属性椭圆带主键下划线）。每张图**先布局先校验再落盘**，任何一张不干净都会在输出里报出错误数，而不是悄悄交出去。
- UML Class：`classMeta` 支持 stereotype、泛化参数、属性、方法、可见性、类型、参数、静态/抽象标志；边支持 source/target multiplicity。
- ER：`er.entities` 支持 weak entity、identifying relationship；foreign-key 边支持 `1`、`0..*`、`1..*` 等基数。
- Chen ER：`chenEr.entityIds`、`chenEr.attributeIds`、`chenEr.relationshipIds` 分别标记实体、属性和联系节点；节点使用矩形、椭圆和菱形，连接使用无箭头 association 边。

这些字段会进入 Draw.io 主文件；布局仍由 ELK 计算，验证器会检查引用完整性和图类型约束。对于正式论文，建议先在 `.model.json` 中明确语义，再生成 `.drawio`，不要直接手改 XML。
