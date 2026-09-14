import type { LayoutResult, Point } from '../model/types.js';
import { validateSemantics } from './semantics.js';
import { validateUmlSemantics } from './uml-rules.js';
import { measureNode } from '../utils/text.js';
export { validateSemantics } from './semantics.js';
export { validateUmlSemantics } from './uml-rules.js';

export interface ValidationReport { valid: boolean; warnings: string[]; }
function overlap(a: any, b: any) { return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y; }
function pointInNode(p: Point, n: any) { return p.x > n.x + 1 && p.x < n.x + n.width - 1 && p.y > n.y + 1 && p.y < n.y + n.height - 1; }
function orient(a: Point, b: Point, c: Point) { return (b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x); }
function segmentsCross(a: Point,b: Point,c: Point,d: Point) { return (orient(a,b,c)*orient(a,b,d)<0 && orient(c,d,a)*orient(c,d,b)<0); }
function segmentHitsRect(a: Point, b: Point, n: any) {
  if (pointInNode(a, n) || pointInNode(b, n)) return true;
  const r = [{x:n.x,y:n.y},{x:n.x+n.width,y:n.y},{x:n.x+n.width,y:n.y+n.height},{x:n.x,y:n.y+n.height}];
  return segmentsCross(a,b,r[0],r[1]) || segmentsCross(a,b,r[1],r[2]) || segmentsCross(a,b,r[2],r[3]) || segmentsCross(a,b,r[3],r[0]);
}
function rectOverlap(a: {x:number;y:number;width:number;height:number}, b: {x:number;y:number;width:number;height:number}) { return a.x < b.x+b.width && a.x+a.width > b.x && a.y < b.y+b.height && a.y+a.height > b.y; }
function polylineLength(points: Point[]) { let total=0; for(let i=0;i<points.length-1;i++) total += Math.abs(points[i+1].x-points[i].x)+Math.abs(points[i+1].y-points[i].y); return total; }
export function validateLayout(layout: LayoutResult): ValidationReport {
  const warnings: string[] = [
    ...validateSemantics(layout.diagram),
    ...validateUmlSemantics(layout.diagram)
  ];
  const nodes = layout.nodes;
  const ids = new Set<string>();
  for (const n of nodes) { if (ids.has(n.id)) warnings.push(`Duplicate node: ${n.id}`); ids.add(n.id); const needed=measureNode({...n,width:undefined,height:undefined},layout.diagram.type); if (n.width+1<needed.width || n.height+1<needed.height) warnings.push(`Text overflow: ${n.id}`); }
  for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) if (overlap(nodes[i], nodes[j])) warnings.push(`Node overlap: ${nodes[i].id} / ${nodes[j].id}`);
  const edgeIds = new Set<string>(); const edgeSignatures=new Set<string>(); const connected = new Set<string>();
  for (const e of layout.edges) {
    if (edgeIds.has(e.id)) warnings.push(`Duplicate edge: ${e.id}`); edgeIds.add(e.id); connected.add(e.source); connected.add(e.target);
    const signature=`${e.source}|${e.sourcePort??''}|${e.target}|${e.targetPort??''}|${e.type??''}|${e.label??''}`; if(edgeSignatures.has(signature))warnings.push(`Duplicate edge relationship: ${e.source} → ${e.target}`); edgeSignatures.add(signature);
    if (!nodes.some(n => n.id === e.source) || !nodes.some(n => n.id === e.target)) warnings.push(`Broken edge: ${e.id}`);
    const points = (e.sections ?? []).flatMap(s => [s.startPoint, ...(s.bendPoints ?? []), s.endPoint]);
    for (let i = 0; i < points.length - 1; i++) for (const n of nodes) if (n.id !== e.source && n.id !== e.target && segmentHitsRect(points[i], points[i + 1], n)) warnings.push(`Edge through node: ${e.id} → ${n.id}`);
    if (polylineLength(points) > Math.max(layout.width, layout.height) * 0.8) warnings.push(`Extremely long edge: ${e.id}`);
    for (const label of e.labels ?? []) for (const n of nodes) if (n.id !== e.source && n.id !== e.target && rectOverlap(label,n)) warnings.push(`Edge label overlap: ${e.id} / ${n.id}`);
  }
  for (let i=0;i<layout.edges.length;i++) for (let j=i+1;j<layout.edges.length;j++) {
    const a=layout.edges[i], b=layout.edges[j]; if (a.source===b.source || a.source===b.target || a.target===b.source || a.target===b.target) continue;
    const ap=(a.sections??[]).flatMap(s=>[s.startPoint,...(s.bendPoints??[]),s.endPoint]); const bp=(b.sections??[]).flatMap(s=>[s.startPoint,...(s.bendPoints??[]),s.endPoint]);
    if (ap.some((p,k)=>k<ap.length-1 && bp.some((q,l)=>l<bp.length-1 && segmentsCross(p,ap[k+1],q,bp[l+1])))) warnings.push(`Edge crossing: ${a.id} / ${b.id}`);
  }
  const edgeLabels = layout.edges.flatMap(edge => (edge.labels ?? []).map(label => ({ ...label, edgeId: edge.id })));
  for (let i = 0; i < edgeLabels.length; i++) for (let j = i + 1; j < edgeLabels.length; j++) if (rectOverlap(edgeLabels[i], edgeLabels[j])) warnings.push(`Edge label overlap: ${edgeLabels[i].edgeId} / ${edgeLabels[j].edgeId}`);
  for (const n of nodes) if (nodes.length > 1 && !connected.has(n.id)) warnings.push(`Orphan node: ${n.id}`);
  const containerMap = new Map(layout.containers.map(c => [c.id,c]));
  const parentOf=(id:string)=>containerMap.get(id)?.parentId??layout.containers.find(p=>p.containerIds?.includes(id))?.id;
  const ancestorOf=(ancestor:string,id:string)=>{const seen=new Set<string>();let p=parentOf(id);while(p&&!seen.has(p)){if(p===ancestor)return true;seen.add(p);p=parentOf(p);}return false;};
  for (const c of layout.containers) { const members=new Set([...c.nodeIds,...nodes.filter(n=>n.containerId===c.id).map(n=>n.id)]); for (const nodeId of members) { const n=nodes.find(x=>x.id===nodeId); if(!n)warnings.push(`Broken container node reference: ${c.id} → ${nodeId}`);else if(!(n.x>=c.x && n.y>=c.y && n.x+n.width<=c.x+c.width+1 && n.y+n.height<=c.y+c.height+1)) warnings.push(`Node outside container: ${nodeId} / ${c.id}`); } if(c.parentId && !containerMap.has(c.parentId)) warnings.push(`Broken container hierarchy: ${c.id} → ${c.parentId}`); const seen=new Set([c.id]);let p=parentOf(c.id);while(p){if(seen.has(p)){warnings.push(`Container hierarchy cycle: ${c.id}`);break;}seen.add(p);p=parentOf(p);} }
  for(let i=0;i<layout.containers.length;i++) for(let j=i+1;j<layout.containers.length;j++){const a=layout.containers[i],b=layout.containers[j]; const nested=ancestorOf(a.id,b.id)||ancestorOf(b.id,a.id); if(!nested&&rectOverlap(a,b)) warnings.push(`Container overlap: ${a.id} / ${b.id}`);}
  for(const n of nodes) for(const p of n.layoutPorts??[]) { const cx=p.x+p.width/2,cy=p.y+p.height/2,tolerance=Math.max(p.width,p.height)+2; const onBoundary=p.side==='NORTH'?Math.abs(cy-n.y)<=tolerance:p.side==='SOUTH'?Math.abs(cy-(n.y+n.height))<=tolerance:p.side==='WEST'?Math.abs(cx-n.x)<=tolerance:p.side==='EAST'?Math.abs(cx-(n.x+n.width))<=tolerance:Math.min(Math.abs(cx-n.x),Math.abs(cx-(n.x+n.width)),Math.abs(cy-n.y),Math.abs(cy-(n.y+n.height)))<=tolerance; if(!onBoundary) warnings.push(`Port outside node: ${p.id}`); }
  for(const e of layout.edges){ if(e.sourcePort && !nodes.some(n=>n.layoutPorts?.some(p=>p.id===e.sourcePort))) warnings.push(`Broken source port: ${e.id}`); if(e.targetPort && !nodes.some(n=>n.layoutPorts?.some(p=>p.id===e.targetPort))) warnings.push(`Broken target port: ${e.id}`); }
  const vertical = layout.diagram.direction === 'TOP_TO_BOTTOM' || layout.diagram.direction === 'BOTTOM_TO_TOP';
  for(const group of layout.diagram.constraints?.sameLayer??[]){const present=nodes.filter(n=>group.includes(n.id)); if(present.length>1){const values=present.map(n=>vertical?n.y:n.x); if(Math.max(...values)-Math.min(...values)>5) warnings.push(`Broken same-layer constraint: ${group.join(', ')}`);}}
  const visualBounds=[...nodes,...layout.containers]; const maxX = Math.max(...visualBounds.map(n => n.x + n.width), 0), maxY = Math.max(...visualBounds.map(n => n.y + n.height), 0);
  if (layout.width + 1 < maxX || layout.height + 1 < maxY) warnings.push('Canvas overflow');
  const nodeArea=nodes.reduce((s,n)=>s+n.width*n.height,0), canvasArea=Math.max(1,layout.width*layout.height), density=nodeArea/canvasArea; if(density>0.62) warnings.push(`Excessive density: ${density.toFixed(2)}`); if(nodes.length>4&&density<0.025) warnings.push(`Excessive whitespace: ${density.toFixed(3)}`);
  if (nodes.length > 40) warnings.push('Large diagram: consider splitting into subsystem diagrams');
  return { valid: warnings.length === 0, warnings: [...new Set(warnings)] };
}
