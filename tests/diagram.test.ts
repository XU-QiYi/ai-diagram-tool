import test from 'node:test';
import assert from 'node:assert/strict';
import { createDiagram } from '../src/model/index.js';
import { layoutDiagram, shouldRelayout } from '../src/layout/elk.js';
import { validateLayout } from '../src/validate/index.js';
import { renderDrawio, honorShapeFragment } from '../src/render/drawio.js';
import { renderSvg } from '../src/render/svg.js';
import { umlClass, umlUseCase, chenErDiagram } from '../src/diagram-types/examples.js';
import { sequenceDiagram } from '../src/diagram-types/extensions.js';
import { stateDiagram, stateMachineDiagram, activityDiagram, deploymentDiagram, mindMap } from '../src/diagram-types/extensions.js';
import { LAYOUT_ALGORITHMS } from '../src/model/types.js';
import { inferDiagramType, diagramTypeRegistry, createDiagramFromRequest } from '../src/diagram-types/index.js';
import { layeredArchitecture, microservicesArchitecture } from '../src/diagram-types/architecture.js';
import { splitLargeDiagram } from '../src/pipeline/split.js';
import { applyDiagramPatch } from '../src/pipeline/update.js';
import { validateSemantics } from '../src/validate/semantics.js';
import { validateUmlSemantics } from '../src/validate/uml-rules.js';
import { validateRenderOutputs } from '../src/validate/render.js';

test('model rejects duplicate ids and preserves stable ids', () => {
  assert.throws(() => createDiagram({ id: 'x', title: 'x', type: 'flowchart', nodes: [{ id: 'n', label: 'a' }, { id: 'n', label: 'b' }], edges: [] }));
  const ids=umlClass().nodes.map(n=>n.id); assert.deepEqual(ids,umlClass().nodes.map(n=>n.id)); assert.ok(ids.every(id=>/^[a-z]+[.][a-z0-9.-]+$/.test(id)));
});

test('ELK layout produces non-overlapping nodes and routed edges', async () => {
  const result = await layoutDiagram(umlClass());
  assert.equal(result.nodes.length, 7); assert.equal(result.edges.length, 7);
  assert.ok(result.nodes.every(n => Number.isFinite(n.x) && Number.isFinite(n.y)));
  assert.ok(result.edges.some(e => (e.sections?.length ?? 0) > 0));
  const report = validateLayout(result); assert.ok(!report.warnings.some(w => w.startsWith('Node overlap')));
});

test('layout iteration history separates semantic failures from relayout triggers', async () => {
  const semanticOnly = createDiagram({
    id: 'semantic-only', title: 'Semantic only', type: 'activity',
    nodes: [{ id: 'start', label: 'Start', kind: 'start' }, { id: 'end', label: 'End', kind: 'end' }],
    edges: [{ id: 'flow', source: 'start', target: 'end', type: 'flow' }],
    activity: { objectFlows: ['edge.missing'] },
  });
  const result = await layoutDiagram(semanticOnly, 3);
  assert.equal(result.iterations, 1);
  assert.equal(result.iterationHistory?.length, 1);
  assert.equal(result.iterationHistory?.[0].issueCount, result.issues?.length);
  assert.equal(result.iterationHistory?.[0].errorCount, result.issues?.filter(issue => issue.severity === 'ERROR').length);
  assert.equal(result.status, 'failed_after_max_iterations');
  assert.ok(result.issues?.some(issue => issue.phase === 'semantic' && issue.code === 'ACTIVITY_OBJECT_FLOW_MISSING_EDGE'));
  assert.equal(shouldRelayout(result.issues ?? [], semanticOnly), false);
  assert.equal(shouldRelayout([{ severity: 'ERROR', code: 'NODE_OVERLAP', message: 'semantic overlap', phase: 'semantic' }], semanticOnly), false);
  assert.equal(shouldRelayout([{ severity: 'ERROR', code: 'NODE_OVERLAP', message: 'layout overlap', phase: 'layout' }], semanticOnly), true);
});

test('layout enforces one diagnostic iteration for a non-positive iteration limit', async () => {
  const diagram = createDiagram({
    id: 'iteration-limit', title: 'Iteration limit', type: 'flowchart',
    nodes: [{ id: 'node.a', label: 'A' }, { id: 'node.b', label: 'B' }],
    edges: [{ id: 'edge.a-b', source: 'node.a', target: 'node.b', type: 'flow' }],
  });
  const result = await layoutDiagram(diagram, 0);
  assert.equal(result.iterations, 1);
  assert.equal(result.iterationHistory?.length, 1);
});

test('notation findings block nothing under ai-led but stay WARNING under strict', async () => {
  const make = (profile: 'ai-led' | 'strict') => createDiagram({
    id: `warning-status-${profile}`, title: 'Warning status', type: 'timeline', layout: { profile },
    nodes: [{ id: 'node.one', label: 'One' }, { id: 'node.two', label: 'Two' }],
    edges: [{ id: 'edge.one-two', source: 'node.one', target: 'node.two', type: 'flow' }],
  });
  const aiLed = await layoutDiagram(make('ai-led'));
  assert.equal(aiLed.status, 'passed', 'a missing milestone is the author’s call, not a broken figure');
  assert.ok(aiLed.issues?.some(i => i.code === 'TIMELINE_MISSING_MILESTONE' && i.severity === 'INFO'), 'still reported');
  const strict = await layoutDiagram(make('strict'));
  assert.equal(strict.status, 'passed_with_warnings');
  assert.ok(strict.issues?.some(i => i.phase === 'semantic' && i.severity === 'WARNING'));
});

test('density profile keeps long flowcharts compact without overlap', async () => {
  const model = createDiagram({
    id: 'long-flow', title: 'Long Flow', type: 'flowchart', direction: 'TOP_TO_BOTTOM',
    nodes: Array.from({ length: 12 }, (_, index) => ({ id: `flow.${index}`, label: `Step ${index}`, kind: 'process' })),
    edges: Array.from({ length: 11 }, (_, index) => ({ id: `edge.${index}`, source: `flow.${index}`, target: `flow.${index + 1}`, type: 'flow' as const })),
  });
  const result = await layoutDiagram(model);
  assert.ok(result.height < 1200, `flowchart height was ${result.height}`);
  assert.ok(result.width > 180, `flowchart width was ${result.width}`);
  assert.ok(!result.warnings.some(warning => /Node overlap|Edge through node|Edge crossing/.test(warning)), result.warnings.join('; '));
});

test('unsupported ELK wrapping falls back safely instead of failing generation', async () => {
  const diagram = createDiagram({
    id: 'wrapping-fallback', title: 'Wrapping Fallback', type: 'flowchart', direction: 'TOP_TO_BOTTOM',
    layout: { wrapping: 'SINGLE_EDGE' },
    nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }],
    edges: [{ id: 'ab', source: 'a', target: 'b', type: 'flow' }, { id: 'bc', source: 'b', target: 'c', type: 'flow' }],
  });
  const result = await layoutDiagram(diagram);
  assert.ok(result.nodes.length === 3);
  assert.ok(result.warnings.every(warning => !warning.includes('failed')));
});

test('Draw.io XML contains editable mxGraph structures and UML styles', async () => {
  const result = await layoutDiagram(umlClass()); const xml = renderDrawio(result);
  assert.match(xml, /mxGraphModel/); assert.match(xml, /mxCell id="class\.shape"/); assert.match(xml, /endArrow=block/); assert.match(xml, /endFill=0/); assert.match(xml,/startArrow=diamond;startFill=1/); assert.match(xml,/startArrow=diamond;startFill=0/); assert.match(xml,/dashed=1;endArrow=open/); assert.match(xml,/endArrow=none/);
});

test('renderers are deterministic and escape XML-sensitive labels', async () => {
  const diagram = createDiagram({
    id: 'render-stability', title: 'A & <Diagram> "stable"', type: 'flowchart',
    nodes: [
      { id: 'node.source', label: 'A & <B> "C"' },
      { id: 'node.target', label: 'Target' },
    ],
    edges: [{ id: 'edge.source-target', source: 'node.source', target: 'node.target', label: 'x < y & z > 0', type: 'flow' }],
  });
  const layout = await layoutDiagram(diagram);
  const xml = renderDrawio(layout);
  const svg = renderSvg(layout);
  assert.equal(xml, renderDrawio(layout));
  assert.equal(svg, renderSvg(layout));
  assert.match(xml, /id="node\.source"/);
  // draw.io renders label values with html=1, so text that must display literally is
  // escaped twice in the XML attribute (&amp;lt; decodes to &lt; at the HTML pass);
  // the SVG escapes once because it is plain XML with no HTML re-parsing.
  assert.match(xml, /A &amp;amp; &amp;lt;B&amp;gt; &quot;C&quot;/);
  assert.match(xml, /x &amp;lt; y &amp;amp; z &amp;gt; 0/);
  assert.match(svg, /A &amp; &lt;B&gt; &quot;C&quot;/);
  assert.match(svg, /x &lt; y &amp; z &gt; 0/);
  assert.doesNotMatch(svg, /<text[^>]*>A & <B>/);
});

test('render output validator checks roots, balanced tags, and stable element IDs', async () => {
  const layout = await layoutDiagram(layeredArchitecture());
  const xml = renderDrawio(layout);
  const svg = renderSvg(layout);
  assert.deepEqual(validateRenderOutputs(layout, xml, svg), []);
  const broken = validateRenderOutputs(layout, '<mxfile><diagram></mxfile>', '<svg viewBox="0 0 10 10">');
  assert.ok(broken.some(issue => issue.code === 'DRAWIO_INVALID_XML'));
  assert.ok(broken.some(issue => issue.code === 'SVG_INVALID_XML'));
  assert.ok(broken.some(issue => issue.code === 'DRAWIO_MISSING_ELEMENT_ID'));
});

test('Use case diagram uses actors, ellipses, boundary and association semantics', async () => {
  const result = await layoutDiagram(umlUseCase()); const xml = renderDrawio(result);
  assert.match(xml, /umlActor/); assert.match(xml, /verticalLabelPosition=bottom/); assert.match(xml, /ellipse/); assert.match(xml, /boundary\.system/); assert.match(xml, /endArrow=none/); assert.match(xml, /dashed=1/); assert.match(xml, /&amp;lt;&amp;lt;include&amp;gt;&amp;gt;/); assert.match(xml, /&amp;lt;&amp;lt;extend&amp;gt;&amp;gt;/); assert.match(xml, /endArrow=block;endFill=0/);
});

test('Registry keeps diagram semantics extensible and does not collapse types to flowcharts', () => {
  assert.ok(diagramTypeRegistry.length >= 14);
  assert.equal(inferDiagramType('draw a Sequence Diagram'), 'sequence');
  assert.equal(inferDiagramType('画一个部署图'), 'deployment');
  assert.equal(inferDiagramType('画一个 Chen ER 图'), 'chen-er');
  assert.equal(inferDiagramType('画一个 ER 图'), 'er');
  assert.equal(inferDiagramType('画一个实体图'), 'chen-er');
  assert.equal(inferDiagramType('画一个 chne-er'), 'chen-er');
  assert.throws(() => createDiagramFromRequest('画一个 Chen ER 图'), /无法可靠解析自然语言请求/);
  assert.equal(inferDiagramType('画一个思维导图'), 'mindmap');
  assert.throws(
    () => createDiagramFromRequest('draw a State Diagram'),
    /无法可靠解析自然语言请求/,
  );
  const architecture = createDiagramFromRequest('System Architecture: User → API → Database');
  assert.deepEqual(architecture.nodes.map(n => n.label), ['User', 'API', 'Database']);
  assert.equal(architecture.edges.length, 2);
  const classes = createDiagramFromRequest('UML 类图：Student 继承 User');
  assert.equal(classes.edges[0].type, 'inheritance');
  const usecases = createDiagramFromRequest('画一个 UML 用例图：普通用户可以登录、浏览工具、提交租借申请');
  assert.equal(usecases.type, 'uml-usecase');
  assert.equal(usecases.nodes.filter(node => node.kind === 'actor').length, 1);
  assert.equal(usecases.nodes.filter(node => node.kind === 'usecase').length, 3);
  assert.equal(usecases.containers?.[0].label, 'System Boundary');
  const implemented = createDiagramFromRequest('UML 类图：Circle 实现 Drawable');
  assert.equal(implemented.nodes.find(node => node.label === 'Drawable')?.classMeta?.stereotype, 'interface');
});

test('natural-language parsing rejects unsupported or incomplete requests instead of substituting an unrelated template', () => {
  assert.throws(
    () => createDiagramFromRequest('这是一个完全不支持的描述'),
    /无法识别图表类型|无法可靠解析自然语言请求/,
  );
  assert.throws(
    () => createDiagramFromRequest('请画一个陈氏 ER 图：实体：用户、订单'),
    /无法可靠解析自然语言请求/,
  );
  assert.throws(
    () => createDiagramFromRequest('画一个时序图'),
    /无法可靠解析自然语言请求/,
  );
  assert.throws(
    () => createDiagramFromRequest('画一个流程图'),
    /无法可靠解析自然语言请求/,
  );
  assert.throws(
    () => createDiagramFromRequest('请生成到期提醒'),
    /无法识别图表类型|无法可靠解析自然语言请求/,
  );
  assert.throws(
    () => createDiagramFromRequest('请访问网站'),
    /无法识别图表类型|无法可靠解析自然语言请求/,
  );
  assert.throws(
    () => createDiagramFromRequest('从今天到明天'),
    /无法识别图表类型|无法可靠解析自然语言请求/,
  );
  assert.throws(
    () => createDiagramFromRequest('用户调用服务'),
    /无法识别图表类型|无法可靠解析自然语言请求/,
  );
  const explicitVerbalChain = createDiagramFromRequest('系统架构：用户调用服务访问数据库');
  assert.deepEqual(explicitVerbalChain.nodes.map(node => node.label), ['用户', '服务', '数据库']);
});

test('stable-id patch updates existing models without rebuilding unrelated elements', () => {
  const base = layeredArchitecture();
  const updated = applyDiagramPatch(base, {
    addNodes: [{ id: 'node.redis', label: 'Redis', kind: 'cache' }],
    addEdges: [{ id: 'edge.service-redis', source: 'node.service', target: 'node.redis', type: 'flow' }],
    updateNodes: [{ id: 'node.service', label: 'Catalog Service' }],
  });
  assert.equal(updated.nodes.find(node => node.id === 'node.service')?.label, 'Catalog Service');
  assert.ok(updated.nodes.some(node => node.id === 'node.redis'));
  assert.ok(updated.edges.some(edge => edge.id === 'edge.service-redis'));
  assert.equal(updated.nodes.find(node => node.id === 'node.gateway')?.id, 'node.gateway');
});

test('Sequence renderer emits participants, lifelines and ordered messages', async () => {
  const result = await layoutDiagram(sequenceDiagram()); const xml = renderDrawio(result);
  assert.match(xml, /participant\.client\.lifeline/); assert.match(xml, /message\.client-service/); assert.match(xml, /edgeStyle=none/); assert.match(xml, /1\. request\(\)/); assert.match(renderSvg(result), />1\. request\(\)</);
});

test('Advanced UML metadata is preserved and rendered', async () => {
  const seq = sequenceDiagram(); assert.equal(seq.sequence?.activations?.length, 1); assert.equal(seq.sequence?.fragments?.[0].operator, 'alt');
  const state = stateDiagram(); assert.equal(state.edges[1].guard, '[approved]'); assert.equal(state.edges[1].action, 'activate');
  const activity = activityDiagram(); assert.equal(activity.activity?.swimlanes?.length, 2); assert.equal(activity.edges[1].type, 'object-flow');
  const deployment = deploymentDiagram(); assert.equal(deployment.deployment?.artifacts?.[0].deployedOn, 'node.server');
  const layout = await layoutDiagram(state); const xml = renderDrawio(layout); assert.match(xml, /shape=doubleEllipse/); assert.match(xml, /approved/);
  const classXml = renderDrawio(await layoutDiagram(umlClass())); assert.match(classXml, /getArea/); assert.match(classXml, /border-top:1px/); assert.doesNotMatch(classXml, /separator=1/); assert.match(classXml, /&lt;u&gt;PI/);
  assert.match(classXml,/0\.\.\*/); assert.match(classXml,/TShape extends Shape/);
  const deploymentXml = renderDrawio(await layoutDiagram(deploymentDiagram())); assert.match(deploymentXml, /artifact\.web/); assert.match(deploymentXml, /shape=note/);
});

test('state machine is a first-class type with behaviors, guards and pseudo states', async () => {
  const diagram = stateMachineDiagram();
  assert.equal(diagram.type, 'state-machine');
  assert.equal(inferDiagramType('画一个订单状态机图'), 'state-machine');
  assert.equal(diagram.nodes.find(node => node.id === 'machine.processing')?.stateBehavior?.do, 'process()');
  const layout = await layoutDiagram(diagram);
  const xml = renderDrawio(layout);
  assert.match(xml, /entry \/ startTimer\(\)/);
  assert.match(xml, /retryCount/);
  assert.match(xml, /shape=doubleEllipse/);
  assert.ok(!layout.warnings.some(warning => warning.includes('needs an initial')));
});

test('ER renderer maps optionality, Crow foot cardinality and weak entities', async () => {
  const result=await layoutDiagram((await import('../src/diagram-types/examples.js')).erDiagram()); const xml=renderDrawio(result); const svg=renderSvg(result);
  assert.match(xml,/endArrow=ERzeroToMany/); assert.match(xml,/endArrow=ERoneToMany/); assert.match(xml,/double=1/); assert.match(xml,/strokeWidth=2/); assert.match(svg,/id="erZeroMany"/); assert.match(svg,/id="erOneMany"/);
});

test('Chen ER renderer emits entity, attribute and relationship notation', async () => {
  const diagram = chenErDiagram();
  assert.equal(diagram.type, 'chen-er');
  assert.equal(diagram.nodes.filter(n => n.kind === 'entity').length, 5);
  assert.equal(diagram.nodes.filter(n => n.kind === 'attribute').length, 19);
  assert.equal(diagram.nodes.filter(n => n.kind === 'relationship').length, 4);
  const result = await layoutDiagram(diagram);
  const xml = renderDrawio(result);
  const svg = renderSvg(result);
  assert.match(xml, /shape=rectangle;rounded=0/);
  assert.match(xml, /shape=rhombus/);
  assert.match(xml, /ellipse/);
  assert.match(xml, /endArrow=none/);
  assert.match(svg, /<polygon/);
  assert.match(svg, /<ellipse/);
  assert.ok(!validateLayout(result).warnings.some(w => /Node overlap|Edge through node/.test(w)), result.warnings.join('; '));
});

test('Chen ER natural-language parser extracts entities, attributes, keys, relationships and cardinalities', async () => {
  const diagram = createDiagramFromRequest('画一个 Chen ER 图。实体：学生、课程；学生属性：学号（主键）、姓名；课程属性：课程号（主键）、课程名；联系：学生通过‘选修’联系课程，基数 M:N');
  assert.equal(diagram.type, 'chen-er');
  assert.equal(diagram.title, '学生、课程 Chen ER 图');
  assert.match(diagram.metadata?.request ?? '', /学生属性/);
  assert.deepEqual(diagram.nodes.filter(node => node.kind === 'entity').map(node => node.label), ['学生', '课程']);
  assert.equal(diagram.nodes.filter(node => node.kind?.endsWith('attribute')).length, 4);
  assert.equal(diagram.nodes.filter(node => node.kind === 'key-attribute').length, 2);
  assert.equal(diagram.nodes.find(node => node.kind === 'relationship')?.label, '选修');
  const relationEdges = diagram.edges.filter(edge => edge.target.startsWith('relationship.'));
  assert.deepEqual(relationEdges.map(edge => edge.label), ['M', 'N']);
  assert.ok(!validateSemantics(diagram).some(warning => warning.includes('cardinality is unspecified')));
  const layout = await layoutDiagram(diagram);
  const xml = renderDrawio(layout);
  assert.match(xml, /&lt;u&gt;学号&lt;\/u&gt;/);
  assert.match(xml, /value="M"/);
  assert.ok(!layout.warnings.some(warning => /Node overlap|Edge through node|Edge crossing/.test(warning)), layout.warnings.join('; '));
});

test('Chen ER parser does not invent missing cardinalities', () => {
  const diagram = createDiagramFromRequest('画一个实体图。实体：学生、课程；学生属性：学号；联系：学生选修课程');
  const relationEdges = diagram.edges.filter(edge => edge.target.startsWith('relationship.'));
  assert.equal(relationEdges.length, 2);
  assert.ok(relationEdges.every(edge => edge.label === undefined));
  assert.ok(validateSemantics(diagram).some(warning => warning.includes('cardinality is unspecified')));
});

test('Chen ER parser preserves multivalued and derived attribute notation', async () => {
  const diagram = createDiagramFromRequest('画一个 Chen ER 图。实体：用户、标签；用户属性：手机号（多值）、年龄（派生）；标签属性：名称；联系：用户拥有标签，基数 1:N');
  assert.equal(diagram.nodes.find(node => node.label === '手机号')?.kind, 'multivalued-attribute');
  assert.equal(diagram.nodes.find(node => node.label === '年龄')?.kind, 'derived-attribute');
  const layout = await layoutDiagram(diagram);
  const xml = renderDrawio(layout);
  const svg = renderSvg(layout);
  assert.match(xml, /shape=doubleEllipse/);
  assert.match(xml, /ellipse;dashed=1/);
  assert.match(svg, /stroke-dasharray="6 4"/);
});

test('compound containers, nested directions and ports survive ELK and Draw.io', async () => {
  const diagram=layeredArchitecture(); const result=await layoutDiagram(diagram);
  assert.ok(result.containers.some(c=>c.id==='container.platform'&&c.depth===0));
  assert.ok(result.containers.some(c=>c.id==='container.backend'&&c.depth===1));
  for(const c of result.containers) for(const id of c.nodeIds){const n=result.nodes.find(x=>x.id===id)!;assert.ok(n.x>=c.x&&n.y>=c.y&&n.x+n.width<=c.x+c.width+1&&n.y+n.height<=c.y+c.height+1);}
  const gateway=result.nodes.find(n=>n.id==='node.gateway')!; assert.equal(gateway.layoutPorts?.length,2);
  assert.ok(gateway.layoutPorts?.every(p=>p.x<=gateway.x+gateway.width+1&&p.y<=gateway.y+gateway.height+1));
  const xml=renderDrawio(result); assert.match(xml,/id="node\.gateway\.in"/); assert.match(xml,/target="node\.gateway\.in"/); assert.match(xml,/id="legend"/);
  assert.ok(!result.warnings.some(w=>/Edge through node/.test(w)),result.warnings.join('; '));
});

test('architecture presets are semantically distinct and selectable from requests', () => {
  assert.equal(createDiagramFromRequest('画一个微服务系统架构图').metadata?.preset,undefined);
  assert.ok(createDiagramFromRequest('画一个微服务系统架构图').nodes.some(n=>n.kind==='queue'));
  assert.ok(microservicesArchitecture().containers?.some(c=>c.label==='Service Cluster'));
  assert.ok(createDiagramFromRequest('draw a cloud architecture').containers?.some(c=>c.label==='Cloud VPC'));
});

test('large diagrams split into overview and stable subsystem models unless forced', () => {
  const nodes=Array.from({length:45},(_,i)=>({id:`node.${i+1}`,label:`Service ${i+1}`,kind:'service'}));
  const diagram=createDiagram({id:'large',title:'Large Architecture',type:'system-architecture',nodes,edges:nodes.slice(1).map((n,i)=>({id:`edge.${i+1}`,source:nodes[i].id,target:n.id,type:'flow'})),containers:[{id:'container.a',label:'A',nodeIds:nodes.slice(0,23).map(n=>n.id)},{id:'container.b',label:'B',nodeIds:nodes.slice(23).map(n=>n.id)}]});
  const parts=splitLargeDiagram(diagram); assert.equal(parts[0].name,'main'); assert.equal(parts.length,3); assert.ok(parts.slice(1).flatMap(p=>p.diagram.nodes.map(n=>n.id)).includes('node.45'));
  assert.equal(splitLargeDiagram({...diagram,constraints:{forceSingle:true}}).length,1);
});

test('large diagram overviews declare their source type and skip specialized semantics', () => {
  const nodes = Array.from({ length: 45 }, (_, index) => ({
    id: `entity.${index + 1}`,
    label: `Entity ${index + 1}`,
    kind: 'entity',
  }));
  const diagram = createDiagram({
    id: 'large-chen-er',
    title: 'Large Chen ER',
    type: 'chen-er',
    nodes,
    edges: nodes.slice(1).map((node, index) => ({
      id: `edge.${index + 1}`,
      source: nodes[index].id,
      target: node.id,
      type: 'association' as const,
    })),
  });
  const overview = splitLargeDiagram(diagram)[0].diagram;
  assert.equal(overview.metadata?.overviewOf, 'chen-er');
  assert.deepEqual(validateSemantics(overview), []);
  assert.deepEqual(validateUmlSemantics(overview), []);
});

test('rendered SVG and Draw.io canvas include legend and deployment artifacts', async () => {
  const architecture=await layoutDiagram(layeredArchitecture()); const svg=renderSvg(architecture); const xml=renderDrawio(architecture);
  assert.match(svg,/viewBox="0 0 [0-9]+ [0-9]+"/); assert.match(xml,/pageWidth="[0-9]+"/); assert.match(xml,/legend\.item\.1/);
  const deployment=await layoutDiagram(deploymentDiagram()); const deploymentXml=renderDrawio(deployment); assert.match(deploymentXml,/artifact\.web/);
  const pageHeight=Number(deploymentXml.match(/pageHeight="([0-9]+)"/)?.[1]); const artifactY=Number(deploymentXml.match(/id="artifact\.web"[\s\S]*?<mxGeometry x="[^"]+" y="([^"]+)"/)?.[1]); assert.ok(pageHeight>artifactY+45);
});

// Composition levers: the algorithm is chosen per diagram, geometry stays with ELK.
const positioned = (r: Awaited<ReturnType<typeof layoutDiagram>>) => r.nodes.map(n => `${n.id}:${Math.round(n.x)},${Math.round(n.y)}`).sort().join('|');

test('layout.algorithm radial is opt-in and lays a hub-and-ring shape, edges still routed', async () => {
  const base = mindMap();
  const radial = await layoutDiagram({ ...base, layout: { ...(base.layout ?? {}), algorithm: 'radial' } }, 2);
  const fallback = await layoutDiagram(base, 2);
  assert.equal(radial.status, 'passed');
  assert.ok(radial.issues?.every(i => i.severity !== 'ERROR'), `radial must not ship errors: ${JSON.stringify(radial.issues)}`);
  assert.ok(radial.edges.every(e => (e.sections?.length ?? 0) > 0), 'radial must route every edge');
  const hub = radial.nodes.find(n => n.id === 'mind.root')!;
  const leaves = radial.nodes.filter(n => n.id !== 'mind.root');
  const minX = Math.min(...leaves.map(n => n.x)), maxX = Math.max(...leaves.map(n => n.x + n.width));
  const minY = Math.min(...leaves.map(n => n.y)), maxY = Math.max(...leaves.map(n => n.y + n.height));
  const cx = hub.x + hub.width / 2, cy = hub.y + hub.height / 2;
  assert.ok(cx > minX && cx < maxX && cy > minY && cy < maxY, 'hub must sit inside the ring of its leaves');
  assert.notEqual(positioned(radial), positioned(fallback), 'radial must differ from the type default');
});

test('containers follow the diagram algorithm; no nested engine is pinned', async () => {
  const base = layeredArchitecture();
  const asDefault = await layoutDiagram(base, 2);
  const asLayered = await layoutDiagram({ ...base, layout: { ...(base.layout ?? {}), algorithm: 'layered' } }, 2);
  assert.ok(asDefault.containers.length >= 2, 'fixture must be compound');
  assert.equal(positioned(asDefault), positioned(asLayered));
});

test('an algorithm outside LAYOUT_ALGORITHMS is refused, never silently laid out as layered', async () => {
  assert.deepEqual([...LAYOUT_ALGORITHMS].sort(), ['auto', 'layered', 'mrtree', 'radial', 'stress']);
  for (const algorithm of ['box', 'rectpacking', 'spoil']) {
    const diagram = { ...mindMap(), layout: { algorithm } } as any;
    await assert.rejects(() => layoutDiagram(diagram, 1), /Unsupported layout algorithm/);
  }
});

test('a legal bare shape name renders as that shape, not as a rectangle', async () => {
  const diagram = createDiagram({
    id: 'shape-honor', title: 'Shape honoring', type: 'system-architecture', direction: 'LEFT_TO_RIGHT',
    nodes: [
      { id: 'node.cyl', label: 'Store', style: { shape: 'cylinder' } },
      { id: 'node.actor', label: 'User', style: { shape: 'umlActor' } },
    ],
    edges: [{ id: 'edge.cyl-actor', source: 'node.cyl', target: 'node.actor' }],
  });
  const xml = renderDrawio(await layoutDiagram(diagram, 2));
  assert.match(xml, /id="node\.cyl"[^>]*shape=cylinder/);
  assert.match(xml, /id="node\.actor"[^>]*shape=umlActor/);
  assert.equal(honorShapeFragment('shape=cylinder'), 'shape=cylinder', 'prefixed form must pass through');
  assert.equal(honorShapeFragment('rounded=0'), 'rounded=0');
  assert.equal(honorShapeFragment(undefined), undefined);
});

test('the layout loop stops early when no preference it can turn affects the finding', async () => {
  const base = layeredArchitecture();
  const radial = { ...base, layout: { ...(base.layout ?? {}), algorithm: 'radial' as const } };
  const r = await layoutDiagram(radial);
  assert.equal(r.iterations, 1, 'spacing is inert under radial: five attempts would only inflate the canvas');
  assert.equal(r.iterations, r.iterationHistory?.length, 'iterations must report the attempts actually made');
  assert.equal(r.status, 'failed_composition_needed');
  const note = r.issues?.find(i => i.code === 'RELAYOUT_NOT_FIXABLE_BY_PREFERENCES');
  assert.ok(note, 'the author must be told the fix belongs to the composition');
  const advice = note!.message.slice(note!.message.indexOf('Change the structure instead:'));
  assert.match(advice, /cross-layer long edge|containers|constraints\.placement|split/);
  assert.doesNotMatch(advice, /constraints\.before|sameLayer|layout\.algorithm|direction/, 'the advice clause must not promise levers measured inert on this engine');
  assert.match(note!.message, /measured to leave it unchanged/, 'it must say what was ruled out');
  assert.ok(r.width < 1700, `canvas must not be inflated by a useless ladder (got ${Math.round(r.width)})`);
});

test('an explicit relayoutTriggers list keeps the full iteration budget even when the default ladder is out of knobs', async () => {
  const base = layeredArchitecture();
  const stress = { ...base, layout: { ...(base.layout ?? {}), algorithm: 'stress' as const, relayoutTriggers: ['EDGE_CROSSING'] } };
  const r = await layoutDiagram(stress);
  assert.ok(r.issues?.some(i => i.code === 'EDGE_CROSSING'), 'the fixture must still carry a finding the ladder cannot fix');
  assert.equal(r.iterations, 5, 'the author asked for another pass; honour it instead of stopping at one');
  assert.equal(r.iterations, r.iterationHistory?.length);
  assert.equal(r.status, 'failed_after_max_iterations');
  assert.ok(!r.issues?.some(i => i.code === 'RELAYOUT_NOT_FIXABLE_BY_PREFERENCES'));
});

test('constraints.placement pins a layer; the inert sameLayer/before knobs are rejected, not silently ignored', async () => {
  const chain = (constraints?: any) => createDiagram({
    id: 'constraint-probe', title: 'Constraint probe', type: 'system-architecture', direction: 'LEFT_TO_RIGHT',
    constraints,
    nodes: [{ id: 'node.a', label: 'A' }, { id: 'node.b', label: 'B' }, { id: 'node.c', label: 'C' }],
    edges: [{ id: 'e1', source: 'node.a', target: 'node.b' }, { id: 'e2', source: 'node.b', target: 'node.c' }],
  });
  const plain = await layoutDiagram(chain(), 1);
  const pinned = await layoutDiagram(chain({ placement: { 'node.c': 'FIRST' } }), 1);
  const plainC = plain.nodes.find(n => n.id === 'node.c')!;
  const pinnedC = pinned.nodes.find(n => n.id === 'node.c')!;
  assert.ok(pinnedC.x < plainC.x, `placement=FIRST must pull node.c back a layer (${plainC.x} -> ${pinnedC.x})`);

  // sameLayer mapped to layering.layerChoiceConstraint and before reordered what the engine
  // received; neither moved anything on elkjs 0.12.0, so both were deleted from the model
  // API. A legacy model must fail loudly instead of laying out as if the knob had been
  // honored - and the error must name the lever that does work.
  for (const legacy of [{ sameLayer: [['node.a', 'node.b']] }, { before: [['node.a', 'node.b']] }]) {
    assert.throws(() => chain(legacy), /was removed from the model API/, `${JSON.stringify(legacy)} must be rejected`);
    assert.throws(() => chain(legacy), /constraints\.placement/, 'the rejection must say what to use instead');
    assert.throws(() => chain(legacy), /measured inert/, 'the rejection must say why it was removed');
  }
});

test('spacing violations still get the ladder and converge clean', async () => {  const r = await layoutDiagram(chenErDiagram());
  assert.ok((r.iterationHistory?.length ?? 0) > 1, 'chen-er overlap must keep iterating');
  assert.equal(r.status, 'passed');
  assert.ok(!r.issues?.some(i => i.severity === 'ERROR'));
});

test('a node may point at itself, and both renderers really draw the loop', async () => {
  const diagram = createDiagram({
    id: 'self-loop', title: 'Self transition', type: 'state-machine', direction: 'LEFT_TO_RIGHT',
    nodes: [{ id: 'state.draft', label: '草稿', kind: 'state' }, { id: 'state.done', label: '完成', kind: 'state' }],
    edges: [
      { id: 'edge.draft-again', source: 'state.draft', target: 'state.draft', type: 'flow', label: '重新填写' },
      { id: 'edge.finish', source: 'state.draft', target: 'state.done', type: 'flow' },
    ],
  });
  const layout = await layoutDiagram(diagram, 2);
  assert.ok(!layout.issues?.some(i => i.code === 'SELF_RELATIONSHIP'), 'a self transition is legal structure, not something to judge away');
  assert.ok(!layout.issues?.some(i => i.code === 'EDGE_UNROUTED'), 'the loop must actually get a route');
  const self = layout.edges.find(e => e.id === 'edge.draft-again')!;
  assert.ok((self.sections?.[0]?.bendPoints?.length ?? 0) > 0, 'a loop needs waypoints, not a zero-length line');
  assert.match(renderDrawio(layout), /id="edge\.draft-again"[\s\S]{0,900}<Array as="points">/);
  assert.equal((renderSvg(layout).match(/stroke-width="1.5"/g) ?? []).length, 2, 'both edges must appear in the SVG');
});

test('style.dashed on a node reaches both renderers instead of being dropped', async () => {
  const diagram = createDiagram({
    id: 'dashed-node', title: 'Dashed node', type: 'system-architecture', direction: 'LEFT_TO_RIGHT',
    nodes: [{ id: 'node.solid', label: 'Solid' }, { id: 'node.dashed', label: 'Neighbour', style: { dashed: true } }],
    edges: [{ id: 'edge.solid-dashed', source: 'node.solid', target: 'node.dashed' }],
  });
  const layout = await layoutDiagram(diagram, 2);
  const xml = renderDrawio(layout);
  const svg = renderSvg(layout);
  assert.match(/id="node\.dashed"[^>]*/.exec(xml)![0], /dashed=1/);
  assert.doesNotMatch(/id="node\.solid"[^>]*/.exec(xml)![0], /dashed=1/);
  assert.equal((svg.match(/stroke-dasharray/g) ?? []).length, 1, 'exactly the dashed node outline carries the dash pattern in the SVG');
});

test('a straight route stays straight in the editable file; a routed one keeps its waypoints', async () => {
  const cellStyle = (xml: string, id: string) => {
    const start = xml.indexOf(`id="${id}"`);
    return start < 0 ? '' : xml.slice(start, xml.indexOf('</mxCell>', start));
  };
  const chen = await layoutDiagram(chenErDiagram(), 5);
  const straight = chen.edges.filter(e => e.sections?.length === 1 && !e.sections[0].bendPoints?.length);
  assert.ok(straight.length > 5, 'this fixture must contain straight links to test');
  for (const e of straight.slice(0, 5)) {
    const cell = cellStyle(renderDrawio(chen), e.id);
    assert.match(cell, /edgeStyle=none;/, `${e.id}: Draw.io would re-bend a straight line without this override`);
    assert.ok(!cell.includes('<Array as="points">'), `${e.id} must not carry waypoints it does not have`);
  }
  const uml = await layoutDiagram(umlClass(), 5);
  const bent = uml.edges.find(e => (e.sections?.[0]?.bendPoints?.length ?? 0) > 0)!;
  assert.ok(bent, 'this fixture must contain a routed edge to test');
  const bentCell = cellStyle(renderDrawio(uml), bent.id);
  assert.match(bentCell, /<Array as="points">/);
  assert.ok(!bentCell.includes('edgeStyle=none;'), 'a route with bends must keep orthogonal routing');
});

test('key roles render the same text in both outputs, and a bad role is refused', async () => {
  const model = (attributes: any[]) => ({
    id: 'keys', title: 'Key roles', type: 'uml-class' as const, direction: 'TOP_TO_BOTTOM' as const,
    nodes: [
      { id: 'class.tool', label: '工具', classMeta: { attributes } },
      { id: 'class.category', label: '分类', classMeta: { attributes: [{ name: 'category_id', type: 'BIGINT', key: 'PK' }] } },
    ],
    edges: [{ id: 'edge.tool-category', source: 'class.tool', target: 'class.category', type: 'association' as const }],
  });
  const fields = [
    { name: 'tool_id', type: 'BIGINT', key: 'PK' },
    { name: 'category_id', type: 'BIGINT', key: 'FK' },
    { name: 'name', type: 'VARCHAR(128)', key: 'UK' },
  ];
  const layout = await layoutDiagram(createDiagram(model(fields) as any), 2);
  assert.ok(!layout.issues?.some(i => i.code === 'TEXT_OVERFLOW'), 'the box must be sized for the marker it prints');
  const xml = renderDrawio(layout);
  const svg = renderSvg(layout);
  for (const marker of ['«PK»tool_id', '«FK»category_id', '«UK»name']) {
    assert.ok(xml.includes(marker), `drawio is missing ${marker}`);
    assert.ok(svg.includes(marker), `svg is missing ${marker} - the two renderers must not disagree`);
  }
  assert.throws(() => createDiagram(model([{ name: 'x', type: 'INT', key: 'BOGUS' }]) as any), /Invalid attribute key role/);
});

test('an unrouted edge is reported by the validator and still drawn by the preview', async () => {
  const laid = await layoutDiagram(layeredArchitecture(), 2);
  // Reached through the validator directly: inside layoutDiagram the vendored fallback
  // now fills these gaps, so this is the "even the fallback produced nothing" contract.
  const stripped = { ...laid, edges: laid.edges.map(e => ({ ...e, sections: undefined })) };
  const report = validateLayout(stripped);
  const unrouted = report.issues.filter(i => i.code === 'EDGE_UNROUTED');
  assert.equal(unrouted.length, laid.edges.length, 'every edge without a route must be named');
  assert.ok(unrouted.every(i => i.severity === 'ERROR'), 'unrouted is honesty, not taste — it must block');
  assert.equal(report.valid, false);

  const svg = renderSvg(stripped);
  assert.equal((svg.match(/stroke-width="1.5"/g) ?? []).length, laid.edges.length,
    'every edge must appear in the SVG even when the engine gave it no route');
});
