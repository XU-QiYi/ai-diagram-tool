import type { AttributeKey, DiagramType, Node } from '../model/types.js';

/** The key-role marker shared by the measurer and both renderers, so a box can never be sized for text one of them does not draw. */
export function keyMarker(key?: AttributeKey): string {
  return key ? `\u00ab${key}\u00bb` : '';
}

function glyphUnits(text: string): number {
  return [...text].reduce((sum, char) => sum + (/[^\u0000-\u00ff]/.test(char) ? 1 : /[A-Z0-9]/.test(char) ? 0.66 : 0.56), 0);
}

export function nodeTextLines(node: Node, type: DiagramType): string[] {
  const lines = node.label.split(/\\n|\r?\n/);
  if ((type === 'state' || type === 'state-machine') && node.stateBehavior) {
    const behavior = node.stateBehavior;
    return [node.label, ...(behavior.entry ? [`entry / ${behavior.entry}`] : []), ...(behavior.do ? [`do / ${behavior.do}`] : []), ...(behavior.exit ? [`exit / ${behavior.exit}`] : [])];
  }
  if (type !== 'uml-class' || !node.classMeta) return lines;
  const meta = node.classMeta;
  const name = `${meta.stereotype ? `<<${meta.stereotype}>> ` : ''}${node.label}${meta.typeParameters?.length ? `<${meta.typeParameters.join(', ')}>` : ''}`;
  const attributes = (meta.attributes ?? []).map(a => `${keyMarker(a.key)}${a.visibility ?? ''}${a.name}${a.type ? `: ${a.type}` : ''}${a.multiplicity ? ` [${a.multiplicity}]` : ''}${a.defaultValue ? ` = ${a.defaultValue}` : ''}`);
  const operations = (meta.operations ?? []).map(o => `${o.visibility ?? ''}${o.name}(${(o.parameters ?? []).map(p => `${p.name}${p.type ? `: ${p.type}` : ''}`).join(', ')}): ${o.returnType ?? 'void'}`);
  return [name, ...attributes, ...operations];
}

export function measureNode(node: Node, type: DiagramType): { width: number; height: number } {
  if(type==='activity' && (node.kind==='fork'||node.kind==='join')) return {width:Math.max(node.width??0,160),height:Math.max(node.height??0,14)};
  if((type==='state'||type==='state-machine'||type==='activity') && (node.kind==='start'||node.kind==='end')) return {width:Math.max(node.width??0,34),height:Math.max(node.height??0,34)};
  if (type === 'chen-er') {
    const fontSize = node.style?.fontSize ?? 14;
    const lines = nodeTextLines(node, type);
    const longest = Math.max(...lines.map(glyphUnits), 4);
    const minWidth = node.style?.minWidth ?? (node.kind?.endsWith('entity') ? 130 : node.kind?.endsWith('relationship') ? 90 : 110);
    const padX = node.style?.paddingX ?? 28;
    const width = Math.max(node.width ?? 0, Math.ceil(Math.max(minWidth, Math.min(220, longest * fontSize + padX))));
    const lineHeight = node.style?.lineHeight ?? fontSize + 4;
    const minHeight = node.style?.minHeight ?? (node.kind?.endsWith('relationship') ? 58 : node.kind?.endsWith('attribute') ? 50 : 58);
    const height = Math.max(node.height ?? 0, minHeight, lines.length * lineHeight + 6);
    return { width, height };
  }
  const fontSize = node.style?.fontSize ?? 14;
  const lines = nodeTextLines(node, type);
  const longest = Math.max(...lines.map(glyphUnits), 8);
  const minWidth = node.style?.minWidth ?? (node.kind === 'actor' ? 120 : type === 'flowchart' ? 140 : type === 'uml-usecase' || node.kind === 'usecase' ? 190 : type === 'uml-class' ? 190 : 160);
  const horizontalPadding = node.style?.paddingX ?? (type === 'flowchart' ? 24 : type === 'uml-class' ? 40 : 32);
  const contentWidth = Math.ceil(Math.max(minWidth, Math.min(440, longest * fontSize + horizontalPadding)));
  const width = Math.max(node.width ?? 0, contentWidth);
  const sections = type === 'uml-class' && node.classMeta ? 2 + Number((node.classMeta.attributes?.length ?? 0) > 0) + Number((node.classMeta.operations?.length ?? 0) > 0) : 1;
  const minHeight = node.style?.minHeight ?? (type === 'uml-class' ? 96 : node.kind === 'actor' ? 118 : type === 'flowchart' ? 48 : 60);
  const linePadding = type === 'uml-class' ? 32 : type === 'flowchart' ? 12 : 20;
  const lineHeight = node.style?.lineHeight ?? fontSize + 6;
  const contentHeight = Math.ceil(Math.max(minHeight, lines.length * lineHeight + linePadding + (sections - 1) * 10));
  const height = Math.max(node.height ?? 0, contentHeight);
  return { width, height };
}

export function measureLabel(text: string, fontSize = 12): { width: number; height: number } {
  const lines = text.split(/\\n|\r?\n/);
  return { width: Math.ceil(Math.max(...lines.map(glyphUnits), 3) * fontSize + 12), height: Math.ceil(lines.length * (fontSize + 5)) };
}
