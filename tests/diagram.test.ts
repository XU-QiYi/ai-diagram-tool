import test from 'node:test';
import assert from 'node:assert/strict';
import { createDiagram } from '../src/model/index.js';
import { layoutDiagram } from '../src/layout/elk.js';
import { validateLayout } from '../src/validate/index.js';
import { renderDrawio } from '../src/render/drawio.js';
import { renderSvg } from '../src/render/svg.js';
import { umlClass, umlUseCase, chenErDiagram } from '../src/diagram-types/examples.js';
import { sequenceDiagram } from '../src/diagram-types/extensions.js';
import { stateDiagram, stateMachineDiagram, activityDiagram, deploymentDiagram } from '../src/diagram-types/extensions.js';
import { inferDiagramType, diagramTypeRegistry, createDiagramFromRequest } from '../src/diagram-types/index.js';
import { layeredArchitecture, microservicesArchitecture } from '../src/diagram-types/architecture.js';
import { splitLargeDiagram } from '../src/pipeline/split.js';
import { applyDiagramPatch } from '../src/pipeline/update.js';
import { validateSemantics } from '../src/validate/semantics.js';

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

test('Use case diagram uses actors, ellipses, boundary and association semantics', async () => {
  const result = await layoutDiagram(umlUseCase()); const xml = renderDrawio(result);
  assert.match(xml, /umlActor/); assert.match(xml, /verticalLabelPosition=bottom/); assert.match(xml, /ellipse/); assert.match(xml, /boundary\.system/); assert.match(xml, /endArrow=none/); assert.match(xml, /dashed=1/); assert.match(xml, /&lt;&lt;include&gt;&gt;/); assert.match(xml, /&lt;&lt;extend&gt;&gt;/); assert.match(xml, /endArrow=block;endFill=0/);
});

test('Registry keeps diagram semantics extensible and does not collapse types to flowcharts', () => {
  assert.ok(diagramTypeRegistry.length >= 14);
  assert.equal(inferDiagramType('draw a Sequence Diagram'), 'sequence');
  assert.equal(inferDiagramType('画一个部署图'), 'deployment');
  assert.equal(inferDiagramType('画一个 Chen ER 图'), 'chen-er');
  assert.equal(inferDiagramType('画一个 ER 图'), 'er');
  assert.equal(inferDiagramType('画一个实体图'), 'chen-er');
  assert.equal(inferDiagramType('画一个 chne-er'), 'chen-er');
  assert.equal(createDiagramFromRequest('画一个 Chen ER 图').type, 'chen-er');
  assert.equal(inferDiagramType('画一个思维导图'), 'mindmap');
  assert.equal(createDiagramFromRequest('draw a State Diagram').type, 'state');
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

test('rendered SVG and Draw.io canvas include legend and deployment artifacts', async () => {
  const architecture=await layoutDiagram(layeredArchitecture()); const svg=renderSvg(architecture); const xml=renderDrawio(architecture);
  assert.match(svg,/viewBox="0 0 [0-9]+ [0-9]+"/); assert.match(xml,/pageWidth="[0-9]+"/); assert.match(xml,/legend\.item\.1/);
  const deployment=await layoutDiagram(deploymentDiagram()); const deploymentXml=renderDrawio(deployment); assert.match(deploymentXml,/artifact\.web/);
  const pageHeight=Number(deploymentXml.match(/pageHeight="([0-9]+)"/)?.[1]); const artifactY=Number(deploymentXml.match(/id="artifact\.web"[\s\S]*?<mxGeometry x="[^"]+" y="([^"]+)"/)?.[1]); assert.ok(pageHeight>artifactY+45);
});
