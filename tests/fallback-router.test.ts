import test from 'node:test';
import assert from 'node:assert/strict';
import { layoutDiagram } from '../src/layout/elk.js';
import { layeredArchitecture } from '../src/diagram-types/architecture.js';
import { systemArchitecture } from '../src/diagram-types/examples.js';

test('edges ELK leaves unrouted are filled by the vendored fallback and the gap is reported', async () => {
  const diagram = layeredArchitecture();
  diagram.layout = { algorithm: 'stress' };
  const result = await layoutDiagram(diagram, 2);

  const unrouted = result.edges.filter((e) => !e.sections?.length);
  assert.equal(unrouted.length, 0, 'the shipped figure must not contain a relationship with no drawn path');
  assert.ok(!result.issues?.some((i) => i.code === 'EDGE_UNROUTED'), 'EDGE_UNROUTED must clear once the fallback draws them');

  const note = result.issues?.find((i) => i.code === 'EDGE_ROUTED_BY_FALLBACK');
  assert.ok(note, 'the report must say these lines did not come from ELK');
  assert.equal(note!.severity, 'WARNING');
  assert.ok(result.edges.every((e) => e.sections!.every((s) => Number.isFinite(s.startPoint.x) && Number.isFinite(s.endPoint.y))));
});

test('the fallback stays out of the way when ELK routes everything', async () => {
  const result = await layoutDiagram(systemArchitecture());
  assert.ok(result.edges.every((e) => (e.sections?.length ?? 0) > 0), 'fixture should need no help');
  assert.ok(!result.issues?.some((i) => i.code === 'EDGE_ROUTED_BY_FALLBACK'), 'no help, no note');
  assert.equal(result.status, 'passed');
});
