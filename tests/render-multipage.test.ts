import assert from 'node:assert/strict';
import test from 'node:test';
import { layoutDiagram } from '../src/layout/elk.js';
import { createDiagram } from '../src/model/index.js';
import { renderDrawio, renderDrawioMultiPage } from '../src/render/drawio.js';

async function page(id: string, title: string): Promise<string> {
  const diagram = createDiagram({
    id,
    title,
    type: 'flowchart',
    nodes: [
      { id: 'node.a', label: 'A' },
      { id: 'node.b', label: 'B' },
    ],
    edges: [{ id: 'edge.a-b', source: 'node.a', target: 'node.b', type: 'flow' }],
  });
  return renderDrawio(await layoutDiagram(diagram));
}

test('multi-page merge keeps each page as its own diagram with id and name, in order', async () => {
  const first = await page('mp.first', 'First Page');
  const second = await page('mp.second', 'Second Page');
  const merged = renderDrawioMultiPage([{ drawio: first }, { drawio: second }]);
  assert.equal(merged.match(/<diagram\b/g)?.length, 2);
  const firstAt = merged.indexOf('id="mp.first"');
  const secondAt = merged.indexOf('id="mp.second"');
  assert.ok(firstAt >= 0, 'first page id preserved');
  assert.ok(secondAt > firstAt, 'page order preserved');
  assert.ok(merged.includes('name="First Page"') && merged.includes('name="Second Page"'));
  assert.ok(merged.startsWith('<?xml'), 'still a standalone XML document');
  assert.ok(merged.trim().endsWith('</mxfile>'), 'single mxfile root');
});

test('multi-page merge refuses input that renderDrawio did not produce', () => {
  assert.throws(() => renderDrawioMultiPage([{ drawio: '<html>not a page</html>' }]), /no <diagram> element/);
});
