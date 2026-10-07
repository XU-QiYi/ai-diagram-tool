# 扩展架构与目录

## 扩展架构

图类型由 `src/diagram-types/registry.ts` 注册。每个类型提供别名、默认方向和示例工厂；新增类型不需要修改 CLI 或布局主流程，只需在 `DiagramType` 增加名称、实现解析器或模型工厂、注册 aliases，并补充专用渲染与验证语义。Sequence、State、Activity、Deployment、Mind Map、Timeline、Network Graph 不会被自动转换成 Flowchart，也不会在自然语言内容不足时偷偷套用示例模板；扩展工厂只用于内置示例和显式预设。

核心运行时代码不注入固定中文文本。节点标题、边标签和描述都来自 Diagram Model：中文请求可以产生中文业务标签，英文请求使用英文标签；通用模板默认使用英文。


## 目录与扩展点

- `src/model/`：与 Draw.io 无关的 Diagram Model、稳定 ID、模型读写和增量合并。
- `src/diagram-types/`：15 种可请求的图类型、UML 示例和架构预设。
- `src/layout/elk.ts`：ELK compound layout、端口、正交路由和最多 5 次质量迭代。
- `src/validate/`：UML 语义与几何质量检查。
- `src/render/`：可编辑 mxGraph XML 与 SVG 预览。
- `vendor/libavoid/`：替补连线器（drawio 编译的 libavoid，LGPL-2.1 + Apache-2.0），只在 ELK 漏画边时启用；出处、许可证与"为什么不当主连线器"的实测记录见该目录 `NOTES.md`。
- `src/pipeline/split.ts`：超过 40 节点的概览/子系统拆分。
