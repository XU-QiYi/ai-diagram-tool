import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cloudArchitecture,
  deploymentArchitecturePreset,
  eventDrivenArchitecture,
  layeredArchitecture,
  microservicesArchitecture,
} from '../src/diagram-types/architecture.js';
import { layoutDiagram } from '../src/layout/elk.js';
import { createDiagram } from '../src/model/index.js';
import type { Diagram } from '../src/model/types.js';
import { splitLargeDiagram } from '../src/pipeline/split.js';
import { renderDrawio, renderDrawioMultiPage } from '../src/render/drawio.js';

test('every bundled architecture preset lays out clean under strict validation', async () => {
  const presets = [
    ['layered', layeredArchitecture()],
    ['microservices', microservicesArchitecture()],
    ['event-driven', eventDrivenArchitecture()],
    ['cloud', cloudArchitecture()],
    ['deployment', deploymentArchitecturePreset()],
  ] as const;
  for (const [name, diagram] of presets) {
    const result = await layoutDiagram({ ...diagram, layout: { profile: 'strict' } });
    const errors = (result.issues ?? []).filter((issue) => issue.severity === 'ERROR');
    assert.deepEqual(errors, [], `${name} preset must lay out without errors: ${errors.map((e) => e.code).join(',')}`);
    assert.notEqual(
      result.status,
      'failed_after_max_iterations',
      `${name} preset must not exhaust the relayout budget`,
    );
    assert.notEqual(result.status, 'failed_composition_needed', `${name} preset must not need structural fixes`);
  }
});

test('splitting a two-container diagram yields overview, per-container parts and a multi-page file', async () => {
  const nodes: Diagram['nodes'] = [];
  const edges: Diagram['edges'] = [];
  const groupA: string[] = [];
  const groupB: string[] = [];
  for (let i = 1; i <= 23; i++) {
    nodes.push({ id: `node.a${i}`, label: `Service A${i}` });
    groupA.push(`node.a${i}`);
    if (i > 1) edges.push({ id: `edge.a${i - 1}-${i}`, source: `node.a${i - 1}`, target: `node.a${i}`, type: 'flow' });
  }
  for (let i = 1; i <= 22; i++) {
    nodes.push({ id: `node.b${i}`, label: `Service B${i}` });
    groupB.push(`node.b${i}`);
    if (i > 1) edges.push({ id: `edge.b${i - 1}-${i}`, source: `node.b${i - 1}`, target: `node.b${i}`, type: 'flow' });
  }
  edges.push({ id: 'edge.a23-b1', source: 'node.a23', target: 'node.b1', type: 'flow' });
  const diagram = createDiagram({
    id: 'split-smoke',
    title: 'Split Smoke',
    type: 'flowchart',
    nodes,
    edges,
    containers: [
      { id: 'container.a', label: 'Group A', nodeIds: groupA },
      { id: 'container.b', label: 'Group B', nodeIds: groupB },
    ],
  });

  const parts = splitLargeDiagram(diagram);
  assert.equal(parts[0].name, 'main');
  assert.equal(parts.length, 3, 'overview plus one part per container');
  const partIds = parts.slice(1).flatMap((p) => p.diagram.nodes.map((n) => n.id));
  assert.ok(partIds.includes('node.a1') && partIds.includes('node.b22'), 'original stable IDs survive the split');
  assert.equal(new Set(partIds).size, partIds.length, 'no node is duplicated across parts');

  // Each part lays out and the multi-page file carries every part in order.
  const pages = [];
  for (const part of parts) {
    const layout = await layoutDiagram(part.diagram);
    pages.push({ drawio: renderDrawio(layout), id: part.diagram.id, name: part.name });
  }
  const merged = renderDrawioMultiPage(pages);
  assert.equal(merged.match(/<diagram\b/g)?.length, 3);
  assert.ok(
    merged.indexOf('id="split-smoke-main"') < merged.indexOf('id="split-smoke-a"'),
    'overview page comes first',
  );
});
