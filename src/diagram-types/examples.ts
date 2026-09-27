import { createDiagram } from '../model/index.js';
import type { Diagram } from '../model/types.js';
import { sequenceDiagram, stateDiagram, stateMachineDiagram, activityDiagram, deploymentDiagram, mindMap, timeline, networkGraph } from './extensions.js';
import { layeredArchitecture, microservicesArchitecture, eventDrivenArchitecture, cloudArchitecture, deploymentArchitecturePreset } from './architecture.js';

export function systemArchitecture(): Diagram { const diagram=layeredArchitecture('E-commerce System Architecture'); return { ...diagram, id:'system-architecture' }; }

export function umlClass(): Diagram { return createDiagram({ id: 'uml-class', title: 'UML Class Diagram', type: 'uml-class', direction: 'TOP_TO_BOTTOM', nodes: [
  { id: 'class.shape', label: 'Shape', classMeta: { stereotype: 'abstract', operations: [{ name: 'getArea', returnType: 'double', visibility: '+', isAbstract: true }, { name: 'getPerimeter', returnType: 'double', visibility: '+', isAbstract: true }, { name: 'getShapeCount', returnType: 'int', visibility: '+', isStatic: true }] } },
  { id: 'class.circle', label: 'Circle', classMeta: { attributes: [{ name: 'radius', type: 'double', visibility: '-' }, { name: 'PI', type: 'double', visibility: '+', isStatic: true, defaultValue: '3.14159' }], operations: [{ name: 'getArea', returnType: 'double', visibility: '+' }, { name: 'getPerimeter', returnType: 'double', visibility: '+' }] } },
  { id: 'class.rectangle', label: 'Rectangle', classMeta: { attributes: [{ name: 'width', type: 'double', visibility: '-' }, { name: 'height', type: 'double', visibility: '-' }], operations: [{ name: 'getArea', returnType: 'double', visibility: '+' }, { name: 'getPerimeter', returnType: 'double', visibility: '+' }] } },
  { id: 'class.drawable', label: 'Drawable', classMeta: { stereotype: 'interface', operations: [{ name: 'draw', returnType: 'void', visibility: '+' }] } },
  { id: 'class.drawing', label: 'Drawing', classMeta: { typeParameters: ['TShape extends Shape'], attributes: [{name:'layers',type:'List<Layer>',visibility:'-',multiplicity:'1..*'}], operations:[{name:'render',returnType:'void',visibility:'+'}] } },
  { id: 'class.layer', label: 'Layer', classMeta: { attributes:[{name:'name',type:'String',visibility:'-'}],operations:[{name:'add',returnType:'void',visibility:'+',parameters:[{name:'shape',type:'Shape'}]}] } },
  { id: 'class.style', label: 'Style', classMeta: { attributes:[{name:'color',type:'Color',visibility:'-'},{name:'lineWidth',type:'double',visibility:'-',defaultValue:'1.0'}] } }
], edges: [
  { id: 'edge.circle-shape', source: 'class.circle', target: 'class.shape', type: 'inheritance' }, { id: 'edge.rectangle-shape', source: 'class.rectangle', target: 'class.shape', type: 'inheritance' }, { id: 'edge.circle-drawable', source: 'class.circle', target: 'class.drawable', type: 'realization' },
  { id:'edge.drawing-layer',source:'class.drawing',target:'class.layer',type:'composition',sourceMultiplicity:'1',targetMultiplicity:'1..*' },
  { id:'edge.layer-shape',source:'class.layer',target:'class.shape',type:'aggregation',sourceMultiplicity:'1',targetMultiplicity:'0..*' },
  { id:'edge.shape-style',source:'class.shape',target:'class.style',type:'association',sourceMultiplicity:'0..*',targetMultiplicity:'1' },
  { id:'edge.drawing-drawable',source:'class.drawing',target:'class.drawable',type:'dependency' }
] }); }

export function umlComponent(): Diagram { return createDiagram({ id: 'uml-component', title: 'UML Component Diagram', type: 'uml-component', direction: 'LEFT_TO_RIGHT', nodes: [
  { id: 'comp.web', label: '<<component>>\nWeb UI', kind: 'component', ports:[{id:'port.web.required-api',side:'EAST',kind:'required'}] }, { id: 'comp.api', label: '<<component>>\nAPI Gateway', kind: 'component', ports:[{id:'port.api.provided',side:'WEST',kind:'provided'},{id:'port.api.required-catalog',side:'EAST',kind:'required'}] }, { id: 'comp.catalog', label: '<<component>>\nCatalog Service', kind: 'component', ports:[{id:'port.catalog.provided',side:'WEST',kind:'provided'}] }, { id: 'comp.db', label: '<<database>>\nCatalog DB', kind: 'database' }
], edges: [{ id: 'edge.web-api', source: 'comp.web', sourcePort:'port.web.required-api', target: 'comp.api', targetPort:'port.api.provided', type: 'dependency' }, { id: 'edge.api-catalog', source: 'comp.api', sourcePort:'port.api.required-catalog', target: 'comp.catalog', targetPort:'port.catalog.provided', type: 'realization' }, { id: 'edge.catalog-db', source: 'comp.catalog', target: 'comp.db', type: 'dependency' }] }); }

export function flowchart(): Diagram { return createDiagram({ id: 'flowchart', title: 'Order Processing Flow', type: 'flowchart', direction: 'TOP_TO_BOTTOM', nodes: [
  { id: 'flow.start', label: 'Start', kind: 'start' }, { id: 'flow.validate', label: 'Validate Order', kind: 'process' }, { id: 'flow.decision', label: 'Stock available?', kind: 'decision' }, { id: 'flow.ship', label: 'Create Shipment', kind: 'process' }, { id: 'flow.end', label: 'End', kind: 'end' }
], edges: [{ id: 'edge.start-validate', source: 'flow.start', target: 'flow.validate', type: 'flow' }, { id: 'edge.validate-decision', source: 'flow.validate', target: 'flow.decision', type: 'flow' }, { id: 'edge.decision-ship', source: 'flow.decision', target: 'flow.ship', label: 'yes', type: 'flow' }, { id: 'edge.ship-end', source: 'flow.ship', target: 'flow.end', type: 'flow' }, { id: 'edge.decision-end', source: 'flow.decision', target: 'flow.end', label: 'no', type: 'flow' }] }); }

export function erDiagram(): Diagram { return createDiagram({ id: 'er', title: 'ER Diagram', type: 'er', direction: 'LEFT_TO_RIGHT', nodes: [
  { id: 'table.user', label: 'users\\nPK id\\nemail' , kind: 'database' }, { id: 'table.order', label: 'orders\\nPK id\\nFK user_id', kind: 'database' }, { id: 'table.item', label: 'order_items\\nPK id\\nFK order_id', kind: 'database' }
], edges: [{ id: 'edge.user-order', source: 'table.user', target: 'table.order', label: '1 : N', type: 'foreign-key', sourceMultiplicity: '1', targetMultiplicity: '0..*' }, { id: 'edge.order-item', source: 'table.order', target: 'table.item', label: '1 : N', type: 'foreign-key', sourceMultiplicity: '1', targetMultiplicity: '1..*' }] , er: { entities: [{ nodeId: 'table.user' }, { nodeId: 'table.order', identifying: true }, { nodeId: 'table.item', weak: true }] } }); }

/** Chen notation: entities are rectangles, attributes are ellipses, and relationships are diamonds. */
export function chenErDiagram(): Diagram {
  const entityStyle = { fill: '#FFFFFF', stroke: '#1F2937', text: '#111827', shape: 'shape=rectangle;rounded=0' };
  const attributeStyle = { fill: '#FFFFFF', stroke: '#1F2937', text: '#111827', shape: 'shape=ellipse' };
  const relationshipStyle = { fill: '#FFFFFF', stroke: '#1F2937', text: '#111827', shape: 'shape=rhombus' };
  return createDiagram({
    id: 'chen-er', title: 'Chen ER Diagram', type: 'chen-er', direction: 'LEFT_TO_RIGHT',
    layout: { density: 'compact', nodeSpacing: 28, layerSpacing: 36, targetAspectRatio: 1.25 },
    nodes: [
      { id: 'entity.scenic-spot', label: '景点', kind: 'entity', style: entityStyle, width: 150, height: 64 },
      { id: 'entity.account', label: '账户', kind: 'entity', style: entityStyle, width: 150, height: 64 },
      { id: 'entity.order', label: '订单', kind: 'entity', style: entityStyle, width: 150, height: 64 },
      { id: 'entity.room', label: '住房', kind: 'entity', style: entityStyle, width: 150, height: 64 },
      { id: 'entity.ride', label: '网约车', kind: 'entity', style: entityStyle, width: 150, height: 64 },
      { id: 'attribute.spot-name', label: '景点名称', kind: 'attribute', style: attributeStyle },
      { id: 'attribute.spot-rate', label: '好评率', kind: 'attribute', style: attributeStyle },
      { id: 'attribute.spot-like', label: '点赞率', kind: 'attribute', style: attributeStyle },
      { id: 'attribute.spot-address', label: '景点地址', kind: 'attribute', style: attributeStyle },
      { id: 'attribute.spot-info', label: '景点信息', kind: 'attribute', style: attributeStyle },
      { id: 'attribute.account-id', label: '账号 id', kind: 'attribute', style: attributeStyle },
      { id: 'attribute.account-name', label: '姓名', kind: 'attribute', style: attributeStyle },
      { id: 'attribute.account-password', label: '密码', kind: 'attribute', style: attributeStyle },
      { id: 'attribute.account-gender', label: '性别', kind: 'attribute', style: attributeStyle },
      { id: 'attribute.account-interest', label: '兴趣爱好', kind: 'attribute', style: attributeStyle },
      { id: 'attribute.account-job', label: '职业', kind: 'attribute', style: attributeStyle },
      { id: 'attribute.order-id', label: '订单号', kind: 'attribute', style: attributeStyle },
      { id: 'attribute.order-amount', label: '订单金额', kind: 'attribute', style: attributeStyle },
      { id: 'attribute.order-info', label: '订单信息', kind: 'attribute', style: attributeStyle },
      { id: 'attribute.room-location', label: '住房位置', kind: 'attribute', style: attributeStyle },
      { id: 'attribute.room-info', label: '住房信息', kind: 'attribute', style: attributeStyle },
      { id: 'attribute.room-subscription', label: '订房号', kind: 'attribute', style: attributeStyle },
      { id: 'attribute.ride-id', label: '网约车牌', kind: 'attribute', style: attributeStyle },
      { id: 'attribute.ride-time', label: '预约时间', kind: 'attribute', style: attributeStyle },
      { id: 'relationship.choose', label: '选择', kind: 'relationship', style: relationshipStyle, width: 110, height: 64 },
      { id: 'relationship.place-order', label: '下单', kind: 'relationship', style: relationshipStyle, width: 110, height: 64 },
      { id: 'relationship.subscribe', label: '订阅', kind: 'relationship', style: relationshipStyle, width: 110, height: 64 },
      { id: 'relationship.book-ride', label: '预约', kind: 'relationship', style: relationshipStyle, width: 110, height: 64 },
    ],
    edges: [
      { id: 'chen.spot-name', source: 'entity.scenic-spot', target: 'attribute.spot-name', type: 'association' },
      { id: 'chen.spot-rate', source: 'entity.scenic-spot', target: 'attribute.spot-rate', type: 'association' },
      { id: 'chen.spot-like', source: 'entity.scenic-spot', target: 'attribute.spot-like', type: 'association' },
      { id: 'chen.spot-address', source: 'entity.scenic-spot', target: 'attribute.spot-address', type: 'association' },
      { id: 'chen.spot-info', source: 'entity.scenic-spot', target: 'attribute.spot-info', type: 'association' },
      { id: 'chen.account-id', source: 'entity.account', target: 'attribute.account-id', type: 'association' },
      { id: 'chen.account-name', source: 'entity.account', target: 'attribute.account-name', type: 'association' },
      { id: 'chen.account-password', source: 'entity.account', target: 'attribute.account-password', type: 'association' },
      { id: 'chen.account-gender', source: 'entity.account', target: 'attribute.account-gender', type: 'association' },
      { id: 'chen.account-interest', source: 'entity.account', target: 'attribute.account-interest', type: 'association' },
      { id: 'chen.account-job', source: 'entity.account', target: 'attribute.account-job', type: 'association' },
      { id: 'chen.order-id', source: 'entity.order', target: 'attribute.order-id', type: 'association' },
      { id: 'chen.order-amount', source: 'entity.order', target: 'attribute.order-amount', type: 'association' },
      { id: 'chen.order-info', source: 'entity.order', target: 'attribute.order-info', type: 'association' },
      { id: 'chen.room-location', source: 'entity.room', target: 'attribute.room-location', type: 'association' },
      { id: 'chen.room-info', source: 'entity.room', target: 'attribute.room-info', type: 'association' },
      { id: 'chen.room-subscription', source: 'entity.room', target: 'attribute.room-subscription', type: 'association' },
      { id: 'chen.ride-id', source: 'entity.ride', target: 'attribute.ride-id', type: 'association' },
      { id: 'chen.ride-time', source: 'entity.ride', target: 'attribute.ride-time', type: 'association' },
      { id: 'chen.account-choose', source: 'entity.account', target: 'relationship.choose', label: 'M', type: 'association' },
      { id: 'chen.spot-choose', source: 'entity.scenic-spot', target: 'relationship.choose', label: 'N', type: 'association' },
      { id: 'chen.account-order', source: 'entity.account', target: 'relationship.place-order', label: '1', type: 'association' },
      { id: 'chen.order-place-order', source: 'entity.order', target: 'relationship.place-order', label: 'N', type: 'association' },
      { id: 'chen.account-subscribe', source: 'entity.account', target: 'relationship.subscribe', label: 'N', type: 'association' },
      { id: 'chen.room-subscribe', source: 'entity.room', target: 'relationship.subscribe', label: '1', type: 'association' },
      { id: 'chen.account-book-ride', source: 'entity.account', target: 'relationship.book-ride', label: 'N', type: 'association' },
      { id: 'chen.ride-book-ride', source: 'entity.ride', target: 'relationship.book-ride', label: 'M', type: 'association' },
    ],
    chenEr: {
      entityIds: ['entity.scenic-spot', 'entity.account', 'entity.order', 'entity.room', 'entity.ride'],
      attributeIds: ['attribute.spot-name', 'attribute.spot-rate', 'attribute.spot-like', 'attribute.spot-address', 'attribute.spot-info', 'attribute.account-id', 'attribute.account-name', 'attribute.account-password', 'attribute.account-gender', 'attribute.account-interest', 'attribute.account-job', 'attribute.order-id', 'attribute.order-amount', 'attribute.order-info', 'attribute.room-location', 'attribute.room-info', 'attribute.room-subscription', 'attribute.ride-id', 'attribute.ride-time'],
      relationshipIds: ['relationship.choose', 'relationship.place-order', 'relationship.subscribe', 'relationship.book-ride'],
    },
  });
}

export function umlUseCase(): Diagram { return createDiagram({ id: 'uml-usecase', title: 'UML Use Case Diagram', type: 'uml-usecase', direction: 'LEFT_TO_RIGHT', nodes: [
  { id: 'actor.admin', label: 'Admin', kind: 'actor', width: 130, height: 100 },
  { id: 'actor.user', label: 'User', kind: 'actor', width: 130, height: 100 },
  { id: 'usecase.manage', label: 'Manage System', kind: 'usecase', width: 200, height: 70 },
  { id: 'usecase.browse', label: 'Browse Tools', kind: 'usecase', width: 200, height: 70 },
  { id: 'usecase.rent', label: 'Rent Tool', kind: 'usecase', width: 200, height: 70 },
  { id: 'usecase.reset-password', label: 'Reset Password', kind: 'usecase', width: 200, height: 70 },
  { id: 'usecase.login', label: 'Authenticate', kind: 'usecase', width: 200, height: 70 }
], edges: [
  { id: 'edge.user-browse', source: 'actor.user', target: 'usecase.browse', type: 'association' },
  { id: 'edge.user-rent', source: 'actor.user', target: 'usecase.rent', type: 'association' },
  { id: 'edge.admin-manage', source: 'actor.admin', target: 'usecase.manage', type: 'association' },
  { id: 'edge.admin-user', source: 'actor.admin', target: 'actor.user', type: 'generalization' },
  { id: 'edge.rent-login', source: 'usecase.rent', target: 'usecase.login', type: 'include' },
  { id: 'edge.reset-login', source: 'usecase.reset-password', target: 'usecase.login', type: 'extend' }
], containers: [{ id: 'boundary.system', label: 'Tool Sharing System', nodeIds: ['usecase.browse', 'usecase.rent', 'usecase.login', 'usecase.manage', 'usecase.reset-password'] }] }); }

export const exampleDiagrams = [systemArchitecture, umlClass, umlComponent, umlUseCase, flowchart, erDiagram, sequenceDiagram, stateDiagram, activityDiagram, deploymentDiagram, mindMap, timeline, networkGraph, microservicesArchitecture, eventDrivenArchitecture, cloudArchitecture, deploymentArchitecturePreset, stateMachineDiagram, chenErDiagram];
