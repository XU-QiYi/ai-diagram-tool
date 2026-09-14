export type DiagramType = 'system-architecture' | 'uml-class' | 'uml-component' | 'uml-usecase' | 'flowchart' | 'er' | 'chen-er' | 'sequence' | 'state' | 'state-machine' | 'activity' | 'deployment' | 'mindmap' | 'timeline' | 'network';
export type Direction = 'LEFT_TO_RIGHT' | 'RIGHT_TO_LEFT' | 'TOP_TO_BOTTOM' | 'BOTTOM_TO_TOP';
export type EdgeRouting = 'ORTHOGONAL' | 'POLYLINE' | 'SPLINES';
export type RelationshipType = 'association' | 'dependency' | 'inheritance' | 'realization' | 'aggregation' | 'composition' | 'include' | 'extend' | 'generalization' | 'flow' | 'object-flow' | 'communication-path' | 'foreign-key' | 'contains' | 'uses';
export type Visibility = '+' | '-' | '#' | '~';
export type MessageKind = 'call' | 'return' | 'create' | 'destroy' | 'signal';
export type LayoutDensity = 'compact' | 'balanced' | 'spacious';

export interface Style { fill?: string; stroke?: string; text?: string; shape?: string; dashed?: boolean; rounded?: boolean; opacity?: number; fontSize?: number; strokeWidth?: number; }
export interface Port { id: string; side?: 'NORTH' | 'SOUTH' | 'EAST' | 'WEST'; label?: string; kind?: 'input' | 'output' | 'provided' | 'required'; width?: number; height?: number; }
export interface ClassAttribute { name: string; type?: string; visibility?: Visibility; multiplicity?: string; defaultValue?: string; isStatic?: boolean; }
export interface ClassOperation { name: string; returnType?: string; visibility?: Visibility; parameters?: Array<{ name: string; type?: string; }>; isAbstract?: boolean; isStatic?: boolean; }
export interface ClassMeta { stereotype?: string; typeParameters?: string[]; attributes?: ClassAttribute[]; operations?: ClassOperation[]; }
export interface StateBehavior { entry?: string; do?: string; exit?: string; }
export interface Node { id: string; label: string; description?: string; kind?: string; containerId?: string; ports?: Port[]; style?: Style; width?: number; height?: number; classMeta?: ClassMeta; stateBehavior?: StateBehavior; }
export interface Container { id: string; label: string; description?: string; nodeIds: string[]; containerIds?: string[]; parentId?: string; direction?: Direction; padding?: number; spacing?: number; style?: Style; }
export interface Edge { id: string; source: string; target: string; sourcePort?: string; targetPort?: string; label?: string; type?: RelationshipType; style?: Style; sourceMultiplicity?: string; targetMultiplicity?: string; guard?: string; action?: string; messageKind?: MessageKind; isAsync?: boolean; }
export type LayerPlacement = 'FIRST' | 'LAST' | 'FIRST_SEPARATE' | 'LAST_SEPARATE';
export interface LayoutConstraints { placement?: Record<string, LayerPlacement>; sameLayer?: string[][]; before?: Array<[string, string]>; forceSingle?: boolean; }
export interface DiagramTheme { name?: 'professional' | 'monochrome' | 'blueprint'; showLegend?: boolean; }
export interface LayoutPreferences { density?: LayoutDensity; nodeSpacing?: number; layerSpacing?: number; containerPadding?: number; targetAspectRatio?: number; wrapping?: 'AUTO' | 'OFF' | 'SINGLE_EDGE' | 'MULTI_EDGE'; }
export interface ActivationBar { id: string; participantId: string; startMessageId: string; endMessageId?: string; label?: string; }
export interface CombinedFragment { id: string; operator: 'alt' | 'opt' | 'loop' | 'par' | 'break' | 'critical'; guard?: string; messageIds: string[]; }
export interface SequenceMeta { activations?: ActivationBar[]; fragments?: CombinedFragment[]; }
export interface Swimlane { id: string; label: string; nodeIds: string[]; }
export interface ActivityMeta { swimlanes?: Swimlane[]; objectFlows?: string[]; }
export interface CompositeState { id: string; label: string; nodeIds: string[]; direction?: Direction; }
export interface StateMeta { composites?: CompositeState[]; }
export interface Artifact { id: string; label: string; deployedOn: string; }
export interface DeploymentMeta { artifacts?: Artifact[]; }
export interface ErEntity { nodeId: string; identifying?: boolean; weak?: boolean; }
export interface ErMeta { entities?: ErEntity[]; }
export interface ChenErMeta { entityIds?: string[]; attributeIds?: string[]; relationshipIds?: string[]; }
export interface Diagram { id: string; title: string; type: DiagramType; direction?: Direction; routing?: EdgeRouting; layout?: LayoutPreferences; nodes: Node[]; edges: Edge[]; containers?: Container[]; constraints?: LayoutConstraints; theme?: DiagramTheme; metadata?: Record<string, string>; sequence?: SequenceMeta; activity?: ActivityMeta; state?: StateMeta; deployment?: DeploymentMeta; er?: ErMeta; chenEr?: ChenErMeta; }

export interface LayoutPort extends Port { nodeId: string; x: number; y: number; width: number; height: number; }
export interface LayoutNode extends Node { x: number; y: number; width: number; height: number; layoutPorts?: LayoutPort[]; }
export interface LayoutContainer extends Container { x: number; y: number; width: number; height: number; depth: number; }
export interface LayoutLabel { x: number; y: number; width: number; height: number; text: string; }
export interface LayoutEdge extends Edge { sections?: Array<{ startPoint: Point; endPoint: Point; bendPoints?: Point[] }>; labels?: LayoutLabel[]; }
export interface Point { x: number; y: number; }
export interface LayoutResult { diagram: Diagram; nodes: LayoutNode[]; containers: LayoutContainer[]; edges: LayoutEdge[]; width: number; height: number; warnings: string[]; iterations: number; }
