# 布局参数与扩展

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
- `constraints.placement` 支持 `FIRST`、`LAST`、`FIRST_SEPARATE`、`LAST_SEPARATE`，**实测生效**（底层 `layering.layerConstraint`）。最上/最下用 TOP_TO_BOTTOM 配合 FIRST/LAST，最左/最右用 LEFT_TO_RIGHT 配合 FIRST/LAST。
- `constraints.forceSingle=true` 让超过 40 节点的图仍然只出一张，不拆分子系统。

**`constraints.sameLayer` 和 `constraints.before` 已从模型 API 删除**（破坏性变更）。它们此前是「读起来像承诺的死配置」：`sameLayer` 映射到 `layering.layerChoiceConstraint`，`before` 改变送入引擎的子节点次序，而在 elkjs 0.12.0 上两者都**没有任何可观察效果**——连「x、y 本来就在同一层」这种最廉价的可满足用例都不动。现在带着这两个键的 `.model.json` 会在 `createDiagram` 直接抛错，错误信息说明为什么被删、以及该改用哪个杠杆，而不是安静地按作者没要求的方式布局。

想消交叉请改**结构**：去掉或改接跨层长边、用容器分组、用 `placement` 定层、或拆分。`direction` 翻转、`layout.algorithm` 切换、改节点次序都实测无效，工具的建议文案里也不会拿它们骗你（有测试钉住这一点）。

示例：

```json
{
  "direction": "LEFT_TO_RIGHT",
  "constraints": {
    "placement": { "node.user": "FIRST", "node.database": "LAST" }
  }
}
```

### 架构图样式和图例

`theme.name` 支持 `professional`、`monochrome`、`blueprint`。`theme.showLegend=true` 会在图右侧生成可继续编辑的 Draw.io 图例；图例和 Deployment artifact 都会被计入页面边界。专业主题只区分少量稳定角色色：Service、Gateway、Cache、Queue、Database、External System，避免随机彩虹色。


## 布局与扩展

`src/layout/elk.ts` 集中配置 ELK layered、方向、ORTHOGONAL 路由、节点/层间距，以及最多 5 次自动迭代（旋钮对某类问题无效时会提前停止并交回构图层，见「校验、布局和渲染命令」）。`src/validate/index.ts` 检查重叠、断边、孤立节点、边穿节点、画布溢出、重复 ID 与大图告警。新增图类型时：扩展 `DiagramType`，在 `src/diagram-types/` 添加构造器/语义规则，并在渲染器中补充必要样式。

布局算法是**按图选择**的构图杠杆，写在模型顶层 `layout.algorithm`，取值 `auto | layered | stress | mrtree | radial`（`LAYOUT_ALGORITHMS` 是唯一事实来源，CLI 与 MCP 共用）。留空 `auto` 即沿用图类型默认（mindmap→mrtree，network/chen-er→stress，其余→layered）；`mrtree` 适合树状分支，`stress` 适合力导向网络，`radial` 把 hub 放到中心做环形阅读。两个例外走**专用确定性布局**（AGENTS §6 预留）：`timeline` 在未显式指定算法时把里程碑排上一条共享轴线，`mindmap` 按子树高度把分支配平到根的两侧（ELK 的树布局只会往一边挂）；显式写了 `algorithm` 就仍用 ELK。已知边界：`radial` 与 Container 同时使用会让子节点落到框外（校验报 `NODE_OUTSIDE_CONTAINER`），在稠密图上还会让同环节点重叠，因此只作为显式选择、不进入任何默认路径。`box` / `rectpacking` 刻意不暴露——实测它们不为边生成任何路由段，交付出来是一堆没有连线路径的框。不在白名单内的算法名会直接抛错，不会被静默降级成 layered。

**直线不再被折成直角。** 一条边若在 ELK 里没有拐点，`.drawio` 会写 `edgeStyle=none`。不加这个覆盖，Draw.io 会拿端点自己重排成直角折线——于是同一个模型 `.drawio` 里是折线、`.svg` 里是直线，而校验器量的那条直线其实根本没被画出来。现在两个渲染口径一致：**校验的是什么线，看到的就是什么线**。带拐点的边仍保留 `<Array as="points">` 与正交路由。

若节点超过 40 个，CLI 会优先按照顶层 Container 自动生成 `main.drawio` 概览和各子系统 `.drawio`；没有 Container 时按稳定节点顺序拆成 `part-1`、`part-2`。每一份同时生成 `.model.json` 和 `.svg`，子图中的原节点/边 ID 不变。拆分时还会额外写一个 `<id>.multipage.drawio`：各部分按顺序合并为同一文件的多页，每页保留自己的 id、名称与画幅；审查位图时可用 `rasterizeForReview({ page })` 只导出某一页。用户明确要求单图时设置 `constraints.forceSingle=true`，仍会生成一张图并保留 Layout Warning。
