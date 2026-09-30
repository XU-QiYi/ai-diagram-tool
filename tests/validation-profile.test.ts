import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareInput } from '../src/ai/input.js';
import { inspectPlan } from '../src/ai/pipeline.js';
import type { ValidationIssue } from '../src/model/types.js';
import { applyProfile } from '../src/validate/policy.js';

const request = '画一个架构图：用户调用服务';

/** A plan that is legitimate but untraceable: no provenance, low confidence, blocking doubt. */
const submission = (profile?: 'ai-led' | 'strict') => ({
  confidence: 0.4,
  uncertainties: [{ description: '不确定是否还有第三方', blocking: true }],
  diagram: {
    id: 'profile-probe',
    title: 'Profile Probe',
    type: 'system-architecture',
    ...(profile ? { layout: { profile } } : {}),
    nodes: [
      { id: 'node.user', label: '用户' },
      { id: 'node.service', label: '服务' },
    ],
    edges: [{ id: 'edge.user-service', source: 'node.user', target: 'node.service' }],
  },
});

test('ai-led reports evidence and confidence gaps without rejecting the plan; strict still rejects', async () => {
  const input = await prepareInput({ text: request });

  const led = inspectPlan(submission(), input);
  assert.ok(led.plan, 'the default profile must accept a structure with no provenance');
  const reported = led.issues.filter((i) => i.code === 'MISSING_EVIDENCE');
  assert.ok(reported.length > 0, 'the gap is still reported');
  assert.ok(
    reported.every((i) => i.severity === 'INFO'),
    JSON.stringify(reported),
  );
  assert.ok(led.issues.some((i) => i.code === 'LOW_CONFIDENCE' && i.severity === 'INFO'));
  assert.ok(led.issues.some((i) => i.code === 'BLOCKING_UNCERTAINTY' && i.severity === 'INFO'));
  assert.ok(
    !led.issues.some((i) => i.severity === 'ERROR'),
    `ai-led kept a blocking gate: ${JSON.stringify(led.issues)}`,
  );

  const strict = inspectPlan(submission('strict'), input);
  assert.ok(strict.issues.some((i) => i.code === 'MISSING_EVIDENCE' && i.severity === 'ERROR'));
  assert.ok(strict.issues.some((i) => i.code === 'LOW_CONFIDENCE' && i.severity === 'ERROR'));
});

test('structural integrity and the geometry ban stay blocking under both profiles', async () => {
  const input = await prepareInput({ text: request });
  const broken = (profile?: 'ai-led' | 'strict') => {
    const body = submission(profile);
    body.diagram.edges = [{ id: 'edge.ghost', source: 'node.user', target: 'node.nobody' } as never];
    return body;
  };
  const smuggled = (profile?: 'ai-led' | 'strict') => {
    const body = submission(profile);
    (body.diagram.nodes[0] as Record<string, unknown>).x = 120;
    return body;
  };
  for (const profile of [undefined, 'strict'] as const) {
    const ref = inspectPlan(broken(profile), input);
    // The model layer rejects a dangling edge before semantic rules run, so the exact
    // code differs by layer; what must not change is that it blocks in both profiles.
    assert.ok(
      ref.issues.some((i) => i.severity === 'ERROR' && /missing node/i.test(i.message)),
      `broken ref must block under ${profile ?? 'default'}: ${JSON.stringify(ref.issues)}`,
    );
    assert.ok(!ref.plan, 'a plan with a dangling reference must not produce a diagram');
    const geo = inspectPlan(smuggled(profile), input);
    assert.ok(
      geo.issues.some((i) => i.code === 'MODEL_GEOMETRY_FORBIDDEN' && i.severity === 'ERROR'),
      `coordinates must block under ${profile ?? 'default'}`,
    );
  }
});

test('applyProfile downgrades taste, never truth', () => {
  const issue = (
    severity: ValidationIssue['severity'],
    code: string,
    phase: ValidationIssue['phase'],
  ): ValidationIssue => ({ severity, code, message: code, phase });
  const mixed = [
    issue('WARNING', 'TIMELINE_MISSING_MILESTONE', 'semantic'),
    issue('ERROR', 'EDGE_LABEL_OVERLAP', 'layout'),
    issue('WARNING', 'EXCESSIVE_DENSITY', 'layout'),
    issue('ERROR', 'EDGE_THROUGH_NODE', 'layout'),
    issue('ERROR', 'EDGE_CROSSING', 'layout'),
    issue('ERROR', 'NODE_OVERLAP', 'layout'),
    issue('ERROR', 'TEXT_OVERFLOW', 'layout'),
    issue('ERROR', 'DUPLICATE_NODE', 'layout'),
  ];
  const led = applyProfile(mixed, 'ai-led');
  const stillBlocking = led
    .filter((i) => i.severity === 'ERROR')
    .map((i) => i.code)
    .sort();
  assert.deepEqual(stillBlocking, [
    'DUPLICATE_NODE',
    'EDGE_CROSSING',
    'EDGE_THROUGH_NODE',
    'NODE_OVERLAP',
    'TEXT_OVERFLOW',
  ]);
  assert.deepEqual(applyProfile(mixed, 'strict'), mixed, 'strict must not rewrite anything');
});
