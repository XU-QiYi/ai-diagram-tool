import assert from 'node:assert/strict';
import test from 'node:test';
import { mindMap, timeline } from '../src/diagram-types/extensions.js';
import { layoutDiagram } from '../src/layout/elk.js';

test('timeline lays milestones on one shared axis in model order', async () => {
  const result = await layoutDiagram(timeline());
  assert.ok(result.nodes.length >= 3);
  const centers = result.nodes.map((n) => n.y + n.height / 2);
  assert.ok(
    centers.every((y) => Math.abs(y - centers[0]) < 0.5),
    'all milestones share one axis',
  );
  const xs = result.nodes.map((n) => n.x);
  assert.deepEqual(
    [...xs].sort((a, b) => a - b),
    xs,
    'declaration order is left-to-right',
  );
  for (const edge of result.edges) {
    const section = edge.sections?.[0];
    assert.ok(section, `edge ${edge.id} is routed`);
    assert.equal(section.startPoint.y, section.endPoint.y, 'axis segments are horizontal');
    assert.ok(!section.bendPoints?.length, 'axis segments are straight');
  }
  assert.ok(
    result.issues?.every((issue) => issue.severity !== 'ERROR'),
    'layout passes its own validation',
  );
});

test('mindmap radiates depth-1 subtrees to both sides of the root', async () => {
  const result = await layoutDiagram(mindMap());
  const root = result.nodes.find((n) => n.kind === 'root');
  assert.ok(root, 'mind map has a root');
  const branches = result.edges
    .filter((e) => e.source === root.id)
    .map((e) => result.nodes.find((n) => n.id === e.target))
    .filter((n): n is NonNullable<typeof n> => Boolean(n));
  assert.ok(branches.length >= 3);
  const rootCenter = root.x + root.width / 2;
  assert.ok(
    branches.some((b) => b.x + b.width / 2 < rootCenter),
    'at least one branch on the left',
  );
  assert.ok(
    branches.some((b) => b.x + b.width / 2 > rootCenter),
    'at least one branch on the right',
  );
  for (const edge of result.edges) {
    assert.ok(edge.sections?.[0], `edge ${edge.id} is routed`);
    assert.ok(!edge.sections![0].bendPoints?.length, 'mind map edges are straight segments');
  }
  assert.ok(
    result.issues?.every((issue) => issue.severity !== 'ERROR'),
    'layout passes its own validation',
  );
});

test('an explicitly requested algorithm still overrides the dedicated layouts', async () => {
  const forced = await layoutDiagram({ ...mindMap(), layout: { algorithm: 'mrtree' } });
  // mrtree hangs every child off one side; the dedicated layout would balance them.
  const root = forced.nodes.find((n) => n.kind === 'root');
  assert.ok(root);
  const branches = forced.edges
    .filter((e) => e.source === root.id)
    .map((e) => forced.nodes.find((n) => n.id === e.target))
    .filter((n): n is NonNullable<typeof n> => Boolean(n));
  const rootCenter = root.x + root.width / 2;
  assert.ok(
    branches.every((b) => b.x + b.width / 2 > rootCenter),
    'mrtree keeps all children on one side',
  );
});
