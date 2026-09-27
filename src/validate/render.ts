import type { LayoutResult, ValidationIssue } from '../model/types.js';

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function isBalancedMarkup(markup: string, expectedRoot: string): boolean {
  const tokens = markup.match(/<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<![^>]*>|<\/?[A-Za-z][^>]*>/g) ?? [];
  const stack: string[] = [];
  let root: string | undefined;
  for (const token of tokens) {
    if (token.startsWith('<!--') || token.startsWith('<?') || token.startsWith('<!')) continue;
    if (token.startsWith('</')) {
      const name = token.match(/^<\/([A-Za-z][\w:.-]*)/)?.[1];
      if (!name || stack.pop() !== name) return false;
      continue;
    }
    const name = token.match(/^<([A-Za-z][\w:.-]*)/)?.[1];
    if (!name) return false;
    if (!root) root = name;
    if (!token.trimEnd().endsWith('/>')) stack.push(name);
  }
  return root === expectedRoot && stack.length === 0;
}

function issue(code: string, message: string, elementId?: string): ValidationIssue {
  return { severity: 'ERROR', code, message, elementId, phase: 'render' };
}

/** Validate renderer output without adding a heavyweight XML dependency. */
export function validateRenderOutputs(layout: LayoutResult, drawio: string, svg: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isBalancedMarkup(drawio, 'mxfile')) issues.push(issue('DRAWIO_INVALID_XML', 'Draw.io output is not balanced XML'));
  if (!drawio.includes('<mxGraphModel ') || !drawio.includes('<root>')) issues.push(issue('DRAWIO_MISSING_GRAPH_MODEL', 'Draw.io output is missing mxGraphModel/root structure'));
  for (const element of [...layout.nodes, ...layout.edges]) {
    const escapedId = escapeAttribute(element.id);
    if (!drawio.includes(`id="${escapedId}"`)) issues.push(issue('DRAWIO_MISSING_ELEMENT_ID', `Draw.io output is missing stable element ID: ${element.id}`, element.id));
  }
  if (!isBalancedMarkup(svg, 'svg')) issues.push(issue('SVG_INVALID_XML', 'SVG output is not balanced XML'));
  if (!/<svg\b[^>]*\bviewBox="[^"]+"/.test(svg)) issues.push(issue('SVG_MISSING_VIEWBOX', 'SVG output is missing a viewBox'));
  return issues;
}
