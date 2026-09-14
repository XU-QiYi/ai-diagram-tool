# AI Diagram 工作流完善计划

## 当前状态评估

### ✅ 已实现且质量良好
- 核心架构（DSL → ELK → Draw.io/SVG）
- 基础图类型（14种）
- 自动布局与迭代优化
- 基础验证器（重叠、交叉、孤立节点）
- 稳定ID系统
- 增量编辑支持

### ⚠️ 基础可用但需增强
- UML类图（缺少静态/抽象样式）
- UML时序图（消息类型未区分）
- UML状态图（初始/终止符号）
- UML活动图（泳道渲染）
- UML用例图（Actor泛化）

### ❌ 功能缺失
- UML语义验证
- 高级UML特性（关联类、接口符号等）

---

## 完善计划

### 阶段一：UML语义验证（高优先级）🔴

#### 1.1 创建 UML 规则验证器
**文件**: `src/validate/uml-rules.ts`
- 用例图规则
  - include/extend 只能连接 usecase
  - actor 到 actor 应使用 generalization
- 类图规则
  - 继承环检测
  - 双向组合检测
  - 接口实现规则
- 时序图规则
  - 消息必须在参与者之间
  - 激活条引用的消息必须存在
- 状态图规则
  - 初始状态只能有一个
  - 终止状态没有出边

#### 1.2 集成到验证流程
**文件**: `src/validate/index.ts`
```typescript
import { validateUmlSemantics } from './uml-rules.js';

export function validateLayout(layout: LayoutResult): ValidationReport {
  const warnings: string[] = [
    ...validateSemantics(layout.diagram),
    ...validateUmlSemantics(layout.diagram), // 新增
    // ... 现有验证
  ];
  // ...
}
```

---

### 阶段二：用例图增强（高优先级）🔴

#### 2.1 Actor 泛化支持
**文件**: `src/model/types.ts`
- 已有 `RelationshipType` 包含所有类型，无需修改

**文件**: `src/render/drawio.ts`
```typescript
function edgeStyle(type?: RelationshipType, diagramType?: DiagramType) {
  const base = 'edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;strokeColor=#000000;fontColor=#000000;';
  
  if (type === 'inheritance') return base + 'endArrow=block;endFill=0;';
  
  // Actor泛化（用例图中的继承）
  if (type === 'generalization') return base + 'endArrow=block;endFill=0;';
  
  // ... 现有代码
}
```

**文件**: `src/diagram-types/examples.ts` - 更新用例图示例
```typescript
export function umlUseCase(): Diagram {
  return createDiagram({
    // ... 现有代码
    nodes: [
      { id: 'actor.user', label: 'User', kind: 'actor' },
      { id: 'actor.admin', label: 'Admin', kind: 'actor' },
      // ... 现有用例
    ],
    edges: [
      // 新增：管理员继承用户
      { 
        id: 'edge.admin-user', 
        source: 'actor.admin', 
        target: 'actor.user', 
        type: 'generalization' 
      },
      // ... 现有边
    ]
  });
}
```

#### 2.2 系统边界视觉增强
**文件**: `src/render/drawio.ts`
```typescript
// 在 renderDrawio 中为用例图容器添加特殊样式
for (const c of containers) {
  const b = bounds.get(c.id)!;
  const isSystemBoundary = layout.diagram.type === 'uml-usecase';
  const fill = c.style?.fill ?? (isSystemBoundary ? '#FFFFFF' : '#FFFFFF');
  const stroke = c.style?.stroke ?? (isSystemBoundary ? '#1E293B' : '#000000');
  const strokeWidth = isSystemBoundary ? 'strokeWidth=2;' : '';
  const text = c.style?.text ?? '#000000';
  
  cells.push(`<mxCell id="${esc(c.id)}" value="${labelHtml(c.label)}" style="swimlane;html=1;horizontal=1;startSize=30;fillColor=${fill};strokeColor=${stroke};${strokeWidth}fontColor=${text};fontStyle=1;fillOpacity=0.7;" vertex="1" parent="1"><mxGeometry x="${b.x - minX + pad}" y="${b.y - minY + pad}" width="${b.width}" height="${b.height}" as="geometry"/></mxCell>`);
}
```

---

### 阶段三：时序图消息类型（高优先级）🔴

#### 3.1 消息样式渲染
**文件**: `src/render/drawio.ts`
```typescript
function renderSequenceDrawio(layout: LayoutResult): string {
  // ... 现有代码
  
  layout.edges.forEach((e, i) => {
    const sx = (xs.get(e.source) ?? pad) + 90;
    const tx = (xs.get(e.target) ?? pad) + 90;
    const y = 170 + i * messageGap;
    const reverse = sx > tx;
    
    // 根据消息类型确定样式
    let style = 'edgeStyle=none;html=1;rounded=0;strokeColor=#334155;fontColor=#334155;';
    
    if (e.messageKind === 'return' || reverse) {
      style += 'dashed=1;endArrow=open;endFill=0;';
    } else if (e.messageKind === 'create') {
      style += 'dashed=1;endArrow=open;endFill=0;strokeColor=#059669;';
    } else if (e.messageKind === 'destroy') {
      style += 'endArrow=cross;strokeColor=#DC2626;strokeWidth=2;';
    } else if (e.isAsync) {
      style += 'endArrow=open;endFill=0;';
    } else {
      // 同步消息 - 实心箭头
      style += 'endArrow=block;endFill=1;';
    }
    
    cells.push(`<mxCell id="${esc(e.id)}" value="${labelHtml(e.label ?? '')}" style="${style}" edge="1" parent="1">...`);
  });
  
  // ... 现有代码
}
```

#### 3.2 更新时序图示例
**文件**: `src/diagram-types/extensions.ts`
```typescript
export function sequenceDiagram(): Diagram {
  return createDiagram({
    id: 'sequence',
    title: 'Sequence Diagram',
    type: 'sequence',
    nodes: [
      { id: 'participant.client', label: 'Client', kind: 'participant' },
      { id: 'participant.server', label: 'Server', kind: 'participant' },
      { id: 'participant.db', label: 'Database', kind: 'participant' }
    ],
    edges: [
      { 
        id: 'msg.1', 
        source: 'participant.client', 
        target: 'participant.server', 
        label: 'request()', 
        messageKind: 'call' 
      },
      { 
        id: 'msg.2', 
        source: 'participant.server', 
        target: 'participant.db', 
        label: 'query()', 
        messageKind: 'call' 
      },
      { 
        id: 'msg.3', 
        source: 'participant.db', 
        target: 'participant.server', 
        label: 'result', 
        messageKind: 'return' 
      },
      { 
        id: 'msg.4', 
        source: 'participant.server', 
        target: 'participant.client', 
        label: 'response', 
        messageKind: 'return' 
      }
    ],
    sequence: {
      activations: [
        { 
          id: 'activation.1', 
          participantId: 'participant.server', 
          startMessageId: 'msg.1', 
          endMessageId: 'msg.4' 
        }
      ]
    }
  });
}
```

---

### 阶段四：类图样式完善（中优先级）🟡

#### 4.1 静态成员和抽象方法样式
**文件**: `src/render/drawio.ts`
```typescript
function nodeLabel(n: LayoutNode, type: string) {
  if (type !== 'uml-class' || !n.classMeta) return labelHtml(n.label);
  
  const m = n.classMeta;
  
  // 属性渲染 - 添加静态下划线
  const attrs = (m.attributes ?? []).map(a => {
    const vis = a.visibility ?? '';
    const name = a.isStatic ? `&lt;u&gt;${esc(a.name)}&lt;/u&gt;` : esc(a.name);
    const type = a.type ? `: ${esc(a.type)}` : '';
    const mult = a.multiplicity ? ` [${esc(a.multiplicity)}]` : '';
    return `${vis}${name}${type}${mult}`;
  }).join('&lt;br&gt;');
  
  // 方法渲染 - 添加抽象斜体和静态下划线
  const ops = (m.operations ?? []).map(o => {
    const vis = o.visibility ?? '';
    const params = (o.parameters ?? []).map(p => `${esc(p.name)}: ${esc(p.type ?? '')}`).join(', ');
    let methodName = o.name;
    
    if (o.isStatic) {
      methodName = `&lt;u&gt;${methodName}&lt;/u&gt;`;
    }
    if (o.isAbstract) {
      methodName = `&lt;i&gt;${methodName}&lt;/i&gt;`;
    }
    
    return `${vis}${methodName}(${params}): ${esc(o.returnType ?? 'void')}`;
  }).join('&lt;br&gt;');
  
  // Stereotype 处理
  const stereotype = m.stereotype ? `&lt;&lt;${esc(m.stereotype)}&gt;&gt;&lt;br&gt;` : '';
  
  // 类名 - 如果是抽象类或接口则斜体
  const className = (m.stereotype === 'interface' || m.stereotype === 'abstract') 
    ? `&lt;i&gt;${esc(n.label)}&lt;/i&gt;`
    : esc(n.label);
  
  const typeParams = m.typeParameters?.length 
    ? `&lt;${esc(m.typeParameters.join(', '))}&gt;` 
    : '';
  
  return `${stereotype}${className}${typeParams}${attrs ? `&lt;br&gt;&lt;hr&gt;${attrs}` : ''}${ops ? `&lt;br&gt;&lt;hr&gt;${ops}` : ''}`;
}
```

#### 4.2 更新类图示例
**文件**: `src/diagram-types/examples.ts`
```typescript
export function umlClass(): Diagram {
  return createDiagram({
    id: 'uml-class',
    title: 'UML Class Diagram',
    type: 'uml-class',
    direction: 'TOP_TO_BOTTOM',
    nodes: [
      {
        id: 'class.shape',
        label: 'Shape',
        classMeta: {
          stereotype: 'abstract',
          operations: [
            { 
              name: 'getArea', 
              returnType: 'double', 
              visibility: '+',
              isAbstract: true 
            },
            {
              name: 'getShapeCount',
              returnType: 'int',
              visibility: '+',
              isStatic: true
            }
          ]
        }
      },
      {
        id: 'class.circle',
        label: 'Circle',
        classMeta: {
          attributes: [
            { name: 'radius', type: 'double', visibility: '-' },
            { name: 'PI', type: 'double', visibility: '+', isStatic: true }
          ],
          operations: [
            { name: 'getArea', returnType: 'double', visibility: '+' }
          ]
        }
      }
    ],
    edges: [
      { 
        id: 'edge.circle-shape', 
        source: 'class.circle', 
        target: 'class.shape', 
        type: 'inheritance' 
      }
    ]
  });
}
```

---

### 阶段五：状态图和活动图（中优先级）🟡

#### 5.1 状态图初始/终止符号
**文件**: `src/render/drawio.ts`
```typescript
function nodeStyle(n: LayoutNode, type: string) {
  const fill = n.style?.fill ?? (
    n.kind === 'start' ? '#1E293B' : 
    n.kind === 'end' ? '#1E293B' :
    n.kind === 'database' ? '#E8F1FF' : 
    n.kind === 'external' ? '#FFF4E5' : 
    '#F5F7FA'
  );
  
  const stroke = n.style?.stroke ?? (
    n.kind === 'database' ? '#3B82F6' : 
    n.kind === 'external' ? '#F59E0B' : 
    '#64748B'
  );
  
  let shape = n.style?.shape ?? '';
  
  if (!shape) {
    if (n.kind === 'start' && type === 'state') {
      // UML状态图初始状态：实心圆
      shape = 'ellipse;fillColor=#1E293B;strokeColor=#1E293B;';
      return `whiteSpace=wrap;html=1;${shape}`;
    } else if (n.kind === 'end' && type === 'state') {
      // UML状态图终止状态：双圆圈（用嵌套实现）
      shape = 'doubleEllipse;fillColor=#1E293B;strokeColor=#1E293B;';
      return `whiteSpace=wrap;html=1;${shape}`;
    } else if (n.kind === 'database') {
      shape = 'shape=cylinder';
    } else if (n.kind === 'actor') {
      shape = 'shape=umlActor';
    } else if (n.kind === 'usecase' || type === 'uml-usecase') {
      shape = 'ellipse';
    } else if (type === 'uml-class') {
      shape = 'shape=umlClass';
    } else if (type === 'uml-component') {
      shape = 'shape=component';
    } else if (n.kind === 'decision') {
      shape = 'rhombus';
    } else if (n.kind === 'start') {
      shape = 'ellipse';
    } else if (n.kind === 'end' && (type === 'state' || type === 'activity')) {
      shape = 'shape=doubleEllipse';
    } else if (n.kind === 'end') {
      shape = 'ellipse';
    } else if (n.kind === 'device' || type === 'deployment') {
      shape = 'shape=cube';
    } else if (n.kind === 'milestone') {
      shape = 'ellipse';
    } else {
      shape = 'rounded=1';
    }
  }
  
  const extra = type === 'uml-class' ? 'separator=1;fontStyle=0;' : 
                type === 'uml-usecase' ? 'fontStyle=0;' : 
                type === 'state' ? 'arcSize=20;' : 
                type === 'mindmap' && n.kind === 'root' ? 'fontStyle=1;strokeWidth=2;' : '';
  
  const text = n.style?.text ?? (
    n.kind === 'start' ? '#FFFFFF' : 
    n.kind === 'end' ? '#FFFFFF' :
    '#1E293B'
  );
  
  return `whiteSpace=wrap;html=1;${shape};${extra}fillColor=${fill};strokeColor=${stroke};fontColor=${text};spacing=8;`;
}
```

#### 5.2 活动图泳道渲染
**文件**: `src/render/drawio.ts` - 在 `renderDrawio` 中
```typescript
// 为活动图的泳道添加特殊处理
const containers = [
  ...(layout.diagram.containers ?? []),
  ...(layout.diagram.activity?.swimlanes ?? []).map(l => ({
    id: l.id,
    label: l.label,
    nodeIds: l.nodeIds,
    style: {
      fill: '#F8FAFC',
      stroke: '#64748B',
      text: '#1E293B'
    }
  })),
  ...(layout.diagram.state?.composites ?? []).map(c => ({
    id: c.id,
    label: c.label,
    nodeIds: c.nodeIds,
    style: {
      fill: '#F8FAFC',
      stroke: '#64748B',
      text: '#334155'
    }
  }))
];

// 泳道使用垂直布局
for (const c of containers) {
  const b = bounds.get(c.id)!;
  const isSwimlane = layout.diagram.activity?.swimlanes?.some(s => s.id === c.id);
  const horizontal = isSwimlane ? 0 : 1; // 0 = 垂直泳道
  const fill = c.style?.fill ?? '#FFFFFF';
  const stroke = c.style?.stroke ?? '#000000';
  const text = c.style?.text ?? '#000000';
  
  cells.push(`<mxCell id="${esc(c.id)}" value="${labelHtml(c.label)}" style="swimlane;html=1;horizontal=${horizontal};startSize=30;fillColor=${fill};strokeColor=${stroke};fontColor=${text};fontStyle=1;" vertex="1" parent="1"><mxGeometry x="${b.x - minX + pad}" y="${b.y - minY + pad}" width="${b.width}" height="${b.height}" as="geometry"/></mxCell>`);
}
```

---

### 阶段六：测试覆盖（所有阶段）✅

#### 6.1 创建测试文件
**文件**: `tests/uml-semantics.test.ts`
```typescript
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { createDiagram } from '../src/model/index.js';
import { validateUmlSemantics } from '../src/validate/uml-rules.js';

describe('UML Semantics Validation', () => {
  it('should detect include between non-usecases', () => {
    const diagram = createDiagram({
      id: 'test',
      title: 'Test',
      type: 'uml-usecase',
      nodes: [
        { id: 'actor.user', label: 'User', kind: 'actor' },
        { id: 'usecase.login', label: 'Login', kind: 'usecase' }
      ],
      edges: [
        { 
          id: 'edge.1', 
          source: 'actor.user', 
          target: 'usecase.login', 
          type: 'include' 
        }
      ]
    });
    
    const warnings = validateUmlSemantics(diagram);
    assert.ok(warnings.some(w => w.includes('include must connect usecases')));
  });
  
  it('should detect inheritance cycles in class diagrams', () => {
    const diagram = createDiagram({
      id: 'test',
      title: 'Test',
      type: 'uml-class',
      nodes: [
        { id: 'class.a', label: 'A' },
        { id: 'class.b', label: 'B' },
        { id: 'class.c', label: 'C' }
      ],
      edges: [
        { id: 'edge.1', source: 'class.a', target: 'class.b', type: 'inheritance' },
        { id: 'edge.2', source: 'class.b', target: 'class.c', type: 'inheritance' },
        { id: 'edge.3', source: 'class.c', target: 'class.a', type: 'inheritance' }
      ]
    });
    
    const warnings = validateUmlSemantics(diagram);
    assert.ok(warnings.some(w => w.includes('Inheritance cycle')));
  });
});
```

**文件**: `tests/sequence-messages.test.ts`
**文件**: `tests/actor-generalization.test.ts`
**文件**: `tests/class-static-abstract.test.ts`

---

## 实施顺序

### Sprint 1（第1-2周）
1. ✅ UML语义验证器 (`uml-rules.ts`)
2. ✅ Actor泛化支持（用例图）
3. ✅ 时序图消息类型渲染
4. ✅ 基础测试覆盖

### Sprint 2（第3-4周）
5. ✅ 类图样式完善（静态/抽象）
6. ✅ 状态图符号改进
7. ✅ 系统边界视觉增强
8. ✅ 扩展测试覆盖

### Sprint 3（第5-6周）
9. ✅ 活动图泳道渲染
10. ✅ 组合片段视觉改进
11. ✅ 完整回归测试
12. ✅ 文档更新

---

## 验收标准

### 功能验收
- [ ] 所有新增功能有对应测试用例
- [ ] 现有14种图类型无回归
- [ ] UML语义验证器覆盖5种UML图
- [ ] 生成的Draw.io文件可正常打开编辑

### 质量验收
- [ ] TypeScript编译无错误
- [ ] 测试覆盖率 > 80%
- [ ] 所有示例图可成功生成
- [ ] README文档已更新

### 性能验收
- [ ] 单个图生成时间 < 2秒（20节点）
- [ ] 布局迭代次数 ≤ 5次
- [ ] 内存占用无明显增长

---

## 风险与缓解

### 风险1：Draw.io XML复杂度
**影响**: 某些UML符号Draw.io可能不完全支持
**缓解**: 
- 使用Draw.io原生形状库
- 对不支持的符号使用组合图形
- 文档中说明限制

### 风险2：ELK布局限制
**影响**: 特殊布局（如泳道、时序图）可能不理想
**缓解**:
- 为特定图类型自定义布局参数
- 必要时实现后处理调整
- 允许用户手动调整

### 风险3：向后兼容性
**影响**: 新功能可能影响现有图
**缓解**:
- 完整回归测试
- 保持默认行为不变
- 新功能通过元数据可选启用

---

## 参考资源

- UML 2.5.1 规范: https://www.omg.org/spec/UML/
- Draw.io形状库: https://www.drawio.com/doc/faq/shape-complex-create-edit
- ELK文档: https://www.eclipse.org/elk/reference.html
