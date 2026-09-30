import assert from 'node:assert/strict';
import test from 'node:test';
import { createDiagramFromRequest } from '../src/diagram-types/index.js';
import { createDiagram } from '../src/model/index.js';
import { applyDiagramPatch } from '../src/pipeline/update.js';
import { validateLayout } from '../src/validate/index.js';

test('rejects unsupported diagram types at the model boundary', () => {
  assert.throws(
    () =>
      createDiagram({
        id: 'invalid-type',
        title: 'Invalid',
        type: 'not-a-type' as never,
        nodes: [],
        edges: [],
      }),
    /Unsupported diagram type: not-a-type/,
  );
});

test('rejects edges that reference missing nodes at the model boundary', () => {
  assert.throws(
    () =>
      createDiagram({
        id: 'broken-edge',
        title: 'Broken',
        type: 'flowchart',
        nodes: [{ id: 'node.start', label: 'Start' }],
        edges: [{ id: 'edge.missing', source: 'node.start', target: 'node.end' }],
      }),
    /Edge edge\.missing references missing node: node\.end/,
  );
});

test('rejects edge ports that belong to a different node', () => {
  assert.throws(
    () =>
      createDiagram({
        id: 'wrong-port-owner',
        title: 'Wrong port owner',
        type: 'flowchart',
        nodes: [
          { id: 'node.a', label: 'A', ports: [{ id: 'port.a.out', side: 'EAST' }] },
          { id: 'node.b', label: 'B', ports: [{ id: 'port.b.in', side: 'WEST' }] },
        ],
        edges: [
          {
            id: 'edge.a-b',
            source: 'node.a',
            target: 'node.b',
            sourcePort: 'port.b.in',
            targetPort: 'port.a.out',
          },
        ],
      }),
    /Edge edge\.a-b sourcePort port\.b\.in does not belong to node\.a/,
  );
});

test('rejects a container parent reference that does not exist', () => {
  assert.throws(
    () =>
      createDiagram({
        id: 'missing-parent',
        title: 'Missing parent',
        type: 'system-architecture',
        nodes: [],
        edges: [],
        containers: [
          {
            id: 'container.child',
            label: 'Child',
            parentId: 'container.missing',
            nodeIds: [],
          },
        ],
      }),
    /Container container\.child parentId references missing container: container\.missing/,
  );
});

test('rejects inconsistent parentId and containerIds declarations', () => {
  assert.throws(
    () =>
      createDiagram({
        id: 'container-mismatch',
        title: 'Container mismatch',
        type: 'system-architecture',
        nodes: [],
        edges: [],
        containers: [
          { id: 'container.parent', label: 'Parent', nodeIds: [], containerIds: [] },
          { id: 'container.child', label: 'Child', nodeIds: [], parentId: 'container.parent' },
        ],
      }),
    /Container container\.child parentId container\.parent is not listed in container\.parent\.containerIds/,
  );
});

test('rejects cycles in container hierarchy', () => {
  assert.throws(
    () =>
      createDiagram({
        id: 'container-cycle',
        title: 'Container cycle',
        type: 'system-architecture',
        nodes: [],
        edges: [],
        containers: [
          { id: 'container.a', label: 'A', nodeIds: [], parentId: 'container.b', containerIds: ['container.b'] },
          { id: 'container.b', label: 'B', nodeIds: [], parentId: 'container.a', containerIds: ['container.a'] },
        ],
      }),
    /Container hierarchy cycle: container\.a/,
  );
});

test('rejects nodes declared in more than one container', () => {
  assert.throws(
    () =>
      createDiagram({
        id: 'multiple-owners',
        title: 'Multiple owners',
        type: 'system-architecture',
        nodes: [{ id: 'node.shared', label: 'Shared' }],
        edges: [],
        containers: [
          { id: 'container.a', label: 'A', nodeIds: ['node.shared'] },
          { id: 'container.b', label: 'B', nodeIds: ['node.shared'] },
        ],
      }),
    /Node node\.shared belongs to multiple containers: container\.a, container\.b/,
  );
});

test('rejects duplicate stable IDs in swimlanes and composite states', () => {
  assert.throws(
    () =>
      createDiagram({
        id: 'duplicate-swimlane',
        title: 'Duplicate swimlane',
        type: 'activity',
        nodes: [{ id: 'node.a', label: 'A' }],
        edges: [],
        activity: { swimlanes: [{ id: 'node.a', label: 'Lane', nodeIds: ['node.a'] }] },
      }),
    /Duplicate stable id \(swimlane\): node\.a/,
  );
  assert.throws(
    () =>
      createDiagram({
        id: 'duplicate-composite',
        title: 'Duplicate composite',
        type: 'state',
        nodes: [{ id: 'node.a', label: 'A' }],
        edges: [],
        state: { composites: [{ id: 'node.a', label: 'Group', nodeIds: ['node.a'] }] },
      }),
    /Duplicate stable id \(composite\): node\.a/,
  );
});

test('classifies missing metadata references as validation errors', () => {
  const diagram = createDiagram({
    id: 'missing-metadata-reference',
    title: 'Missing metadata reference',
    type: 'activity',
    nodes: [],
    edges: [],
    activity: { objectFlows: ['edge.missing'] },
  });
  const report = validateLayout({
    diagram,
    nodes: [],
    containers: [],
    edges: [],
    width: 100,
    height: 100,
    warnings: [],
    iterations: 1,
  });
  assert.equal(report.valid, false);
  assert.ok(
    report.issues.some(
      (issue) =>
        issue.severity === 'ERROR' && issue.message === 'Activity object flow references missing edge: edge.missing',
    ),
  );
});

test('reports stable issue codes, phases, and paths without parsing warning text at the CLI boundary', () => {
  const diagram = createDiagram({
    id: 'issue-contract',
    title: 'Issue contract',
    type: 'activity',
    nodes: [],
    edges: [],
    activity: { objectFlows: ['edge.missing'] },
  });
  const report = validateLayout({
    diagram,
    nodes: [],
    containers: [],
    edges: [],
    width: 100,
    height: 100,
    warnings: [],
    iterations: 1,
  });
  const issue = report.issues.find((item) => item.message.includes('Activity object flow'));
  assert.deepEqual(issue, {
    severity: 'ERROR',
    code: 'ACTIVITY_OBJECT_FLOW_MISSING_EDGE',
    message: 'Activity object flow references missing edge: edge.missing',
    elementId: 'edge.missing',
    path: '/activity/objectFlows/0',
    phase: 'semantic',
  });
});

test('keeps stable paths for state, ER, and Chen ER metadata references', () => {
  const diagram = createDiagram({
    id: 'metadata-contract',
    title: 'Metadata contract',
    type: 'chen-er',
    nodes: [],
    edges: [],
    state: { composites: [{ id: 'composite.missing', label: 'Missing', nodeIds: ['state.missing'] }] },
    er: { entities: [{ nodeId: 'entity.missing' }] },
    chenEr: { entityIds: ['chen.entity.missing'] },
  });
  const report = validateLayout({
    diagram,
    nodes: [],
    containers: [],
    edges: [],
    width: 100,
    height: 100,
    warnings: [],
    iterations: 1,
  });
  assert.deepEqual(
    report.issues.find((issue) => issue.code === 'STATE_COMPOSITE_MISSING_NODE'),
    {
      severity: 'ERROR',
      code: 'STATE_COMPOSITE_MISSING_NODE',
      message: 'State composite composite.missing references missing node: state.missing',
      elementId: 'state.missing',
      path: '/state/composites/0/nodeIds/0',
      phase: 'semantic',
    },
  );
  assert.equal(report.issues.find((issue) => issue.code === 'ER_ENTITY_MISSING_NODE')?.path, '/er/entities/0/nodeId');
  assert.equal(
    report.issues.find((issue) => issue.code === 'CHEN_ER_ENTITY_MISSING_NODE')?.path,
    '/chenEr/entityIds/0',
  );
});

test('rejects unsafe style values at the model boundary', () => {
  assert.throws(
    () =>
      createDiagram({
        id: 'unsafe-style',
        title: 'Unsafe style',
        type: 'flowchart',
        nodes: [{ id: 'node.a', label: 'A', style: { fill: '#fff;stroke:#000' } }],
        edges: [],
      }),
    /Invalid style fill for node node\.a/,
  );
  assert.throws(
    () =>
      createDiagram({
        id: 'invalid-style-number',
        title: 'Invalid style number',
        type: 'flowchart',
        nodes: [{ id: 'node.a', label: 'A', style: { opacity: 2 } }],
        edges: [],
      }),
    /Invalid style opacity for node node\.a/,
  );
  assert.throws(
    () =>
      createDiagram({
        id: 'invalid-style-shape',
        title: 'Invalid style shape',
        type: 'flowchart',
        nodes: [{ id: 'node.a', label: 'A', style: { shape: 'shape=foreignObject' } }],
        edges: [],
      }),
    /Invalid style shape for node node\.a/,
  );
  assert.throws(
    () =>
      createDiagram({
        id: 'invalid-style-modifier',
        title: 'Invalid style modifier',
        type: 'flowchart',
        nodes: [{ id: 'node.a', label: 'A', style: { shape: 'shape=rectangle;unapprovedFlag=1' } }],
        edges: [],
      }),
    /Invalid style shape for node node\.a/,
  );
  assert.throws(
    () =>
      createDiagram({
        id: 'invalid-hex-color',
        title: 'Invalid hex color',
        type: 'flowchart',
        nodes: [{ id: 'node.a', label: 'A', style: { fill: '#12345' } }],
        edges: [],
      }),
    /Invalid style fill for node node\.a/,
  );
});

test('accepts existing Draw.io shape fragments and bounded style values', () => {
  const diagram = createDiagram({
    id: 'valid-style',
    title: 'Valid style',
    type: 'chen-er',
    nodes: [
      {
        id: 'node.a',
        label: 'A',
        style: {
          fill: '#FFFFFF',
          stroke: '#1F2937',
          text: '#111827',
          shape: 'shape=rectangle;rounded=0',
          opacity: 0.8,
          fontSize: 14,
          strokeWidth: 2,
          lineHeight: 20,
          paddingX: 28,
          minWidth: 110,
          minHeight: 58,
        },
      },
    ],
    edges: [],
  });
  assert.equal(diagram.nodes[0].style?.shape, 'shape=rectangle;rounded=0');
});

test('detects edge contact with an intermediate node boundary and collinear overlap', () => {
  const diagram = createDiagram({
    id: 'geometry-boundary',
    title: 'Geometry boundary',
    type: 'flowchart',
    nodes: [
      { id: 'node.source', label: 'Source', width: 140, height: 48 },
      { id: 'node.middle', label: 'Middle', width: 140, height: 48 },
      { id: 'node.target', label: 'Target', width: 140, height: 48 },
    ],
    edges: [
      { id: 'edge.touch', source: 'node.source', target: 'node.target' },
      { id: 'edge.collinear', source: 'node.source', target: 'node.target' },
    ],
  });
  const layout = validateLayout({
    diagram,
    nodes: [
      { ...diagram.nodes[0], x: 0, y: 0, width: 140, height: 48 },
      { ...diagram.nodes[1], x: 220, y: 0, width: 140, height: 48 },
      { ...diagram.nodes[2], x: 440, y: 0, width: 140, height: 48 },
    ],
    containers: [],
    edges: [
      {
        ...diagram.edges[0],
        sections: [{ startPoint: { x: 140, y: 24 }, endPoint: { x: 220, y: 24 } }],
      },
      {
        ...diagram.edges[1],
        sections: [{ startPoint: { x: 140, y: 0 }, endPoint: { x: 440, y: 0 } }],
      },
    ],
    width: 640,
    height: 120,
    warnings: [],
    iterations: 1,
  });
  assert.ok(layout.warnings.includes('Edge through node: edge.touch → node.middle'));
  assert.ok(layout.warnings.includes('Edge through node: edge.collinear → node.middle'));
});

test('detects collinear overlap between unrelated edge segments', () => {
  const diagram = createDiagram({
    id: 'geometry-crossing',
    title: 'Geometry crossing',
    type: 'flowchart',
    nodes: [
      { id: 'node.a', label: 'A', width: 40, height: 40 },
      { id: 'node.b', label: 'B', width: 40, height: 40 },
      { id: 'node.c', label: 'C', width: 40, height: 40 },
      { id: 'node.d', label: 'D', width: 40, height: 40 },
    ],
    edges: [
      { id: 'edge.one', source: 'node.a', target: 'node.b' },
      { id: 'edge.two', source: 'node.c', target: 'node.d' },
    ],
  });
  const layout = validateLayout({
    diagram,
    nodes: diagram.nodes.map((node, index) => ({
      ...node,
      x: index * 100,
      y: 100,
      width: 40,
      height: 40,
    })),
    containers: [],
    edges: [
      { ...diagram.edges[0], sections: [{ startPoint: { x: 40, y: 120 }, endPoint: { x: 240, y: 120 } }] },
      { ...diagram.edges[1], sections: [{ startPoint: { x: 140, y: 120 }, endPoint: { x: 340, y: 120 } }] },
    ],
    width: 420,
    height: 200,
    warnings: [],
    iterations: 1,
  });
  assert.ok(layout.warnings.includes('Edge crossing: edge.one / edge.two'));
});

test('returns structured validation issues while preserving warning strings', () => {
  const report = validateLayout({
    diagram: { id: 'layout', title: 'Layout', type: 'flowchart', nodes: [], edges: [] },
    nodes: [],
    containers: [],
    edges: [],
    width: 100,
    height: 100,
    warnings: [],
    iterations: 1,
  });
  assert.equal(report.valid, true);
  assert.deepEqual(report.issues, []);
  assert.deepEqual(report.warnings, []);
});

test('reuses stable nodes when a natural-language chain repeats a label', () => {
  const diagram = createDiagramFromRequest('画一个流程图：A -> B -> B');
  assert.deepEqual(
    diagram.nodes.map((node) => node.label),
    ['A', 'B'],
  );
  assert.equal(diagram.edges.length, 1);
  assert.equal(diagram.edges[0].source, 'node.a');
  assert.equal(diagram.edges[0].target, 'node.b');
});

test('cleans state and Chen ER metadata when patching out referenced nodes', () => {
  const base = createDiagram({
    id: 'metadata',
    title: 'Metadata',
    type: 'chen-er',
    nodes: [
      { id: 'entity.user', label: 'User', kind: 'entity' },
      { id: 'state.active', label: 'Active', kind: 'state' },
      { id: 'state.done', label: 'Done', kind: 'state' },
    ],
    edges: [],
    state: { composites: [{ id: 'composite.lifecycle', label: 'Lifecycle', nodeIds: ['state.active', 'state.done'] }] },
    chenEr: { entityIds: ['entity.user'], attributeIds: ['state.active'], relationshipIds: ['state.done'] },
  });
  const updated = applyDiagramPatch(base, { removeNodeIds: ['state.active'] });
  assert.deepEqual(updated.state?.composites?.[0].nodeIds, ['state.done']);
  assert.deepEqual(updated.chenEr?.attributeIds, []);
  assert.deepEqual(updated.chenEr?.relationshipIds, ['state.done']);
});
