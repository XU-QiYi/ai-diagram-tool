import type { LayoutResult, Point, ValidationIssue, ValidationReport } from '../model/types.js';
import { validateSemanticIssues } from './semantics.js';
import { validateUmlIssues } from './uml-rules.js';
import { measureNode } from '../utils/text.js';
import { applyProfile } from './policy.js';
export { validateSemantics, validateSemanticIssues } from './semantics.js';
export { validateUmlSemantics, validateUmlIssues } from './uml-rules.js';
export { validateRenderOutputs } from './render.js';
export { applyProfile, resolveProfile, DEFAULT_VALIDATION_PROFILE, AESTHETIC_LAYOUT_CODES, AUTHOR_JUDGEMENT_CODES } from './policy.js';
export type { ValidationSeverity, ValidationPhase, ValidationIssue, ValidationReport, ValidationProfile } from '../model/types.js';

function legacyIssueCode(message: string): string {
  return message.replace(/^\[UML\]\s*/i, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '').toUpperCase().slice(0, 80) || 'VALIDATION_ISSUE';
}

function overlap(a: any, b: any) { return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y; }
const GEOMETRY_EPSILON = 1e-9;
function pointInNode(p: Point, n: any) {
  return p.x >= n.x - GEOMETRY_EPSILON && p.x <= n.x + n.width + GEOMETRY_EPSILON && p.y >= n.y - GEOMETRY_EPSILON && p.y <= n.y + n.height + GEOMETRY_EPSILON;
}
function orient(a: Point, b: Point, c: Point) { return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x); }
function pointOnSegment(p: Point, a: Point, b: Point) {
  return Math.abs(orient(a, b, p)) <= GEOMETRY_EPSILON && p.x >= Math.min(a.x, b.x) - GEOMETRY_EPSILON && p.x <= Math.max(a.x, b.x) + GEOMETRY_EPSILON && p.y >= Math.min(a.y, b.y) - GEOMETRY_EPSILON && p.y <= Math.max(a.y, b.y) + GEOMETRY_EPSILON;
}
function segmentsCross(a: Point, b: Point, c: Point, d: Point) {
  const abC = orient(a, b, c), abD = orient(a, b, d), cdA = orient(c, d, a), cdB = orient(c, d, b);
  if (Math.abs(abC) <= GEOMETRY_EPSILON && pointOnSegment(c, a, b)) return true;
  if (Math.abs(abD) <= GEOMETRY_EPSILON && pointOnSegment(d, a, b)) return true;
  if (Math.abs(cdA) <= GEOMETRY_EPSILON && pointOnSegment(a, c, d)) return true;
  if (Math.abs(cdB) <= GEOMETRY_EPSILON && pointOnSegment(b, c, d)) return true;
  return ((abC > GEOMETRY_EPSILON && abD < -GEOMETRY_EPSILON) || (abC < -GEOMETRY_EPSILON && abD > GEOMETRY_EPSILON)) && ((cdA > GEOMETRY_EPSILON && cdB < -GEOMETRY_EPSILON) || (cdA < -GEOMETRY_EPSILON && cdB > GEOMETRY_EPSILON));
}
function segmentHitsRect(a: Point, b: Point, n: any) {
  if (pointInNode(a, n) || pointInNode(b, n)) return true;
  const r = [{x:n.x,y:n.y},{x:n.x+n.width,y:n.y},{x:n.x+n.width,y:n.y+n.height},{x:n.x,y:n.y+n.height}];
  return segmentsCross(a,b,r[0],r[1]) || segmentsCross(a,b,r[1],r[2]) || segmentsCross(a,b,r[2],r[3]) || segmentsCross(a,b,r[3],r[0]);
}
function rectOverlap(a: {x:number;y:number;width:number;height:number}, b: {x:number;y:number;width:number;height:number}) { return a.x < b.x+b.width && a.x+a.width > b.x && a.y < b.y+b.height && a.y+a.height > b.y; }
function polylineLength(points: Point[]) { let total=0; for(let i=0;i<points.length-1;i++) total += Math.abs(points[i+1].x-points[i].x)+Math.abs(points[i+1].y-points[i].y); return total; }

export function validateLayout(layout: LayoutResult): ValidationReport {
  const issues: ValidationIssue[] = [
    ...validateSemanticIssues(layout.diagram),
    ...validateUmlIssues(layout.diagram),
  ];
  const add = (severity: ValidationIssue['severity'], code: string, message: string, elementId?: string, path?: string) => {
    issues.push({ severity, code, message, elementId, path, phase: 'layout' });
  };
  const nodes = layout.nodes;
  const ids = new Set<string>();
  for (const [index, n] of nodes.entries()) {
    if (ids.has(n.id)) add('ERROR', 'DUPLICATE_NODE', `Duplicate node: ${n.id}`, n.id, `/nodes/${index}`);
    ids.add(n.id);
    const needed = measureNode({...n,width:undefined,height:undefined}, layout.diagram.type);
    if (n.width + 1 < needed.width || n.height + 1 < needed.height) add('ERROR', 'TEXT_OVERFLOW', `Text overflow: ${n.id}`, n.id, `/nodes/${index}`);
  }
  for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) if (overlap(nodes[i], nodes[j])) add('ERROR', 'NODE_OVERLAP', `Node overlap: ${nodes[i].id} / ${nodes[j].id}`, nodes[i].id, `/nodes/${i}`);
  const edgeIds = new Set<string>(); const edgeSignatures = new Set<string>(); const connected = new Set<string>();
  for (const [index, e] of layout.edges.entries()) {
    if (edgeIds.has(e.id)) add('ERROR', 'DUPLICATE_EDGE', `Duplicate edge: ${e.id}`, e.id, `/edges/${index}`);
    edgeIds.add(e.id); connected.add(e.source); connected.add(e.target);
    const signature = `${e.source}|${e.sourcePort??''}|${e.target}|${e.targetPort??''}|${e.type??''}|${e.label??''}`;
    if (edgeSignatures.has(signature)) add('WARNING', 'DUPLICATE_EDGE_RELATIONSHIP', `Duplicate edge relationship: ${e.source} → ${e.target}`, e.id, `/edges/${index}`);
    edgeSignatures.add(signature);
    if (!nodes.some(n => n.id === e.source) || !nodes.some(n => n.id === e.target)) add('ERROR', 'BROKEN_EDGE', `Broken edge: ${e.id}`, e.id, `/edges/${index}`);
    // A route with no bends is a straight line; no route at all is a relationship the
    // preview would silently omit. The two must never look the same to a caller.
    if (!e.sections || e.sections.length === 0) add('ERROR', 'EDGE_UNROUTED', `Edge was not routed: ${e.id}`, e.id, `/edges/${index}`);
    const points = (e.sections ?? []).flatMap(s => [s.startPoint, ...(s.bendPoints ?? []), s.endPoint]);
    for (let pointIndex = 0; pointIndex < points.length - 1; pointIndex++) for (const [nodeIndex, n] of nodes.entries()) if (n.id !== e.source && n.id !== e.target && segmentHitsRect(points[pointIndex], points[pointIndex + 1], n)) add('ERROR', 'EDGE_THROUGH_NODE', `Edge through node: ${e.id} → ${n.id}`, e.id, `/edges/${index}/sections/${pointIndex}`);
    if (polylineLength(points) > Math.max(layout.width, layout.height) * 0.8) add('WARNING', 'EXTREMELY_LONG_EDGE', `Extremely long edge: ${e.id}`, e.id, `/edges/${index}`);
    for (const [labelIndex, label] of (e.labels ?? []).entries()) for (const [nodeIndex, n] of nodes.entries()) if (n.id !== e.source && n.id !== e.target && rectOverlap(label,n)) add('ERROR', 'EDGE_LABEL_OVERLAP', `Edge label overlap: ${e.id} / ${n.id}`, e.id, `/edges/${index}/labels/${labelIndex}`);
  }
  for (let i=0;i<layout.edges.length;i++) for (let j=i+1;j<layout.edges.length;j++) {
    const a=layout.edges[i], b=layout.edges[j];
    if (a.source===b.source || a.source===b.target || a.target===b.source || a.target===b.target) continue;
    const ap=(a.sections??[]).flatMap(s=>[s.startPoint,...(s.bendPoints??[]),s.endPoint]); const bp=(b.sections??[]).flatMap(s=>[s.startPoint,...(s.bendPoints??[]),s.endPoint]);
    if (ap.some((p,k)=>k<ap.length-1 && bp.some((q,l)=>l<bp.length-1 && segmentsCross(p,ap[k+1],q,bp[l+1])))) add('ERROR', 'EDGE_CROSSING', `Edge crossing: ${a.id} / ${b.id}`, a.id, `/edges/${i}`);
  }
  const edgeLabels = layout.edges.flatMap(edge => (edge.labels ?? []).map(label => ({ ...label, edgeId: edge.id })));
  for (let i = 0; i < edgeLabels.length; i++) for (let j = i + 1; j < edgeLabels.length; j++) if (rectOverlap(edgeLabels[i], edgeLabels[j])) add('ERROR', 'EDGE_LABEL_OVERLAP', `Edge label overlap: ${edgeLabels[i].edgeId} / ${edgeLabels[j].edgeId}`, edgeLabels[i].edgeId);
  for (const [index, n] of nodes.entries()) if (nodes.length > 1 && !connected.has(n.id)) add('WARNING', 'ORPHAN_NODE', `Orphan node: ${n.id}`, n.id, `/nodes/${index}`);
  const containerMap = new Map(layout.containers.map(c => [c.id,c]));
  const parentOf=(id:string)=>containerMap.get(id)?.parentId??layout.containers.find(p=>p.containerIds?.includes(id))?.id;
  const ancestorOf=(ancestor:string,id:string)=>{const seen=new Set<string>();let p=parentOf(id);while(p&&!seen.has(p)){if(p===ancestor)return true;seen.add(p);p=parentOf(p);}return false;};
  for (const [containerIndex, c] of layout.containers.entries()) {
    const members=new Set([...c.nodeIds,...nodes.filter(n=>n.containerId===c.id).map(n=>n.id)]);
    for (const nodeId of members) {
      const n=nodes.find(x=>x.id===nodeId);
      if(!n) add('ERROR', 'BROKEN_CONTAINER_NODE', `Broken container node reference: ${c.id} → ${nodeId}`, nodeId, `/containers/${containerIndex}/nodeIds`);
      else if(!(n.x>=c.x && n.y>=c.y && n.x+n.width<=c.x+c.width+1 && n.y+n.height<=c.y+c.height+1)) add('ERROR', 'NODE_OUTSIDE_CONTAINER', `Node outside container: ${nodeId} / ${c.id}`, nodeId, `/containers/${containerIndex}`);
    }
    if(c.parentId && !containerMap.has(c.parentId)) add('ERROR', 'BROKEN_CONTAINER_HIERARCHY', `Broken container hierarchy: ${c.id} → ${c.parentId}`, c.id, `/containers/${containerIndex}/parentId`);
    const seen=new Set([c.id]);let p=parentOf(c.id);while(p){if(seen.has(p)){add('ERROR', 'CONTAINER_HIERARCHY_CYCLE', `Container hierarchy cycle: ${c.id}`, c.id, `/containers/${containerIndex}`);break;}seen.add(p);p=parentOf(p);}
  }
  for(let i=0;i<layout.containers.length;i++) for(let j=i+1;j<layout.containers.length;j++){const a=layout.containers[i],b=layout.containers[j]; const nested=ancestorOf(a.id,b.id)||ancestorOf(b.id,a.id); if(!nested&&rectOverlap(a,b)) add('ERROR', 'CONTAINER_OVERLAP', `Container overlap: ${a.id} / ${b.id}`, a.id, `/containers/${i}`);}
  for(const [nodeIndex, n] of nodes.entries()) for(const p of n.layoutPorts??[]) { const cx=p.x+p.width/2,cy=p.y+p.height/2,tolerance=Math.max(p.width,p.height)+2; const onBoundary=p.side==='NORTH'?Math.abs(cy-n.y)<=tolerance:p.side==='SOUTH'?Math.abs(cy-(n.y+n.height))<=tolerance:p.side==='WEST'?Math.abs(cx-n.x)<=tolerance:p.side==='EAST'?Math.abs(cx-(n.x+n.width))<=tolerance:Math.min(Math.abs(cx-n.x),Math.abs(cx-(n.x+n.width)),Math.abs(cy-n.y),Math.abs(cy-(n.y+n.height)))<=tolerance; if(!onBoundary) add('ERROR', 'PORT_OUTSIDE_NODE', `Port outside node: ${p.id}`, p.id, `/nodes/${nodeIndex}/layoutPorts`); }
  for(const [index, e] of layout.edges.entries()){ if(e.sourcePort && !nodes.some(n=>n.layoutPorts?.some(p=>p.id===e.sourcePort))) add('ERROR', 'BROKEN_SOURCE_PORT', `Broken source port: ${e.id}`, e.id, `/edges/${index}/sourcePort`); if(e.targetPort && !nodes.some(n=>n.layoutPorts?.some(p=>p.id===e.targetPort))) add('ERROR', 'BROKEN_TARGET_PORT', `Broken target port: ${e.id}`, e.id, `/edges/${index}/targetPort`); }
  const vertical = layout.diagram.direction === 'TOP_TO_BOTTOM' || layout.diagram.direction === 'BOTTOM_TO_TOP';
  for(const [index, group] of (layout.diagram.constraints?.sameLayer??[]).entries()){const present=nodes.filter(n=>group.includes(n.id)); if(present.length>1){const values=present.map(n=>vertical?n.y:n.x); if(Math.max(...values)-Math.min(...values)>5) add('WARNING', 'BROKEN_SAME_LAYER_CONSTRAINT', `Broken same-layer constraint: ${group.join(', ')}`, group[0], `/constraints/sameLayer/${index}`);}}
  const visualBounds=[...nodes,...layout.containers]; const maxX = Math.max(...visualBounds.map(n => n.x + n.width), 0), maxY = Math.max(...visualBounds.map(n => n.y + n.height), 0);
  if (layout.width + 1 < maxX || layout.height + 1 < maxY) add('ERROR', 'CANVAS_OVERFLOW', 'Canvas overflow');
  const nodeArea=nodes.reduce((s,n)=>s+n.width*n.height,0), canvasArea=Math.max(1,layout.width*layout.height), density=nodeArea/canvasArea;
  if(density>0.62) add('WARNING', 'EXCESSIVE_DENSITY', `Excessive density: ${density.toFixed(2)}`);
  if(nodes.length>4&&density<0.025) add('WARNING', 'EXCESSIVE_WHITESPACE', `Excessive whitespace: ${density.toFixed(3)}`);
  if (nodes.length > 40) add('WARNING', 'LARGE_DIAGRAM', 'Large diagram: consider splitting into subsystem diagrams');
  const uniqueIssues = applyProfile(
    issues.filter((issue, index, all) => all.findIndex(candidate => candidate.code === issue.code && candidate.message === issue.message && candidate.path === issue.path) === index),
    layout.diagram.layout?.profile,
  );
  return { valid: !uniqueIssues.some(issue => issue.severity === 'ERROR'), warnings: [...new Set(uniqueIssues.filter(issue => issue.severity !== 'INFO').map(issue => issue.message))], issues: uniqueIssues };
}
