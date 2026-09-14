import { describe, it } from 'node:test';
import assert from 'node:assert';
import { createDiagram } from '../src/model/index.js';
import { validateUmlSemantics } from '../src/validate/uml-rules.js';

describe('UML Semantics Validation', () => {
  describe('Use Case Diagram', () => {
    it('should detect include between non-usecases', () => {
      const diagram = createDiagram({
        id: 'test',
        title: 'Test',
        type: 'uml-usecase',
        nodes: [
          { id: 'actor.user', label: 'User', kind: 'actor' },
          { id: 'usecase.login', label: 'Login', kind: 'usecase' }
        ],
        edges: [
          {
            id: 'edge.1',
            source: 'actor.user',
            target: 'usecase.login',
            type: 'include'
          }
        ]
      });

      const warnings = validateUmlSemantics(diagram);
      assert.ok(warnings.some(w => w.includes('include must connect usecases')));
    });

    it('should detect actor-to-actor association instead of generalization', () => {
      const diagram = createDiagram({
        id: 'test',
        title: 'Test',
        type: 'uml-usecase',
        nodes: [
          { id: 'actor.user', label: 'User', kind: 'actor' },
          { id: 'actor.admin', label: 'Admin', kind: 'actor' }
        ],
        edges: [
          {
            id: 'edge.1',
            source: 'actor.admin',
            target: 'actor.user',
            type: 'association'
          }
        ]
      });

      const warnings = validateUmlSemantics(diagram);
      assert.ok(warnings.some(w => w.includes('Actor-to-actor should use generalization')));
    });

    it('should accept valid use case with actor generalization', () => {
      const diagram = createDiagram({
        id: 'test',
        title: 'Test',
        type: 'uml-usecase',
        nodes: [
          { id: 'actor.user', label: 'User', kind: 'actor' },
          { id: 'actor.admin', label: 'Admin', kind: 'actor' },
          { id: 'usecase.login', label: 'Login', kind: 'usecase' }
        ],
        edges: [
          {
            id: 'edge.1',
            source: 'actor.user',
            target: 'usecase.login',
            type: 'association'
          },
          {
            id: 'edge.2',
            source: 'actor.admin',
            target: 'actor.user',
            type: 'generalization'
          }
        ]
      });

      const warnings = validateUmlSemantics(diagram);
      // 不应该有关于泛化的警告
      assert.ok(!warnings.some(w => w.includes('generalization')));
    });
  });

  describe('Class Diagram', () => {
    it('should detect inheritance cycles', () => {
      const diagram = createDiagram({
        id: 'test',
        title: 'Test',
        type: 'uml-class',
        nodes: [
          { id: 'class.a', label: 'A' },
          { id: 'class.b', label: 'B' },
          { id: 'class.c', label: 'C' }
        ],
        edges: [
          { id: 'edge.1', source: 'class.a', target: 'class.b', type: 'inheritance' },
          { id: 'edge.2', source: 'class.b', target: 'class.c', type: 'inheritance' },
          { id: 'edge.3', source: 'class.c', target: 'class.a', type: 'inheritance' }
        ]
      });

      const warnings = validateUmlSemantics(diagram);
      assert.ok(warnings.some(w => w.includes('Inheritance cycle')));
    });

    it('should detect bidirectional composition', () => {
      const diagram = createDiagram({
        id: 'test',
        title: 'Test',
        type: 'uml-class',
        nodes: [
          { id: 'class.a', label: 'A' },
          { id: 'class.b', label: 'B' }
        ],
        edges: [
          { id: 'edge.1', source: 'class.a', target: 'class.b', type: 'composition' },
          { id: 'edge.2', source: 'class.b', target: 'class.a', type: 'composition' }
        ]
      });

      const warnings = validateUmlSemantics(diagram);
      assert.ok(warnings.some(w => w.includes('Bidirectional composition')));
    });

    it('should detect self-composition', () => {
      const diagram = createDiagram({
        id: 'test',
        title: 'Test',
        type: 'uml-class',
        nodes: [
          { id: 'class.a', label: 'A' }
        ],
        edges: [
          { id: 'edge.1', source: 'class.a', target: 'class.a', type: 'composition' }
        ]
      });

      const warnings = validateUmlSemantics(diagram);
      assert.ok(warnings.some(w => w.includes('Self-composition')));
    });

    it('should warn when realization does not target an interface', () => {
      const diagram = createDiagram({
        id: 'test',
        title: 'Test',
        type: 'uml-class',
        nodes: [
          { id: 'class.impl', label: 'Implementation' },
          { id: 'class.concrete', label: 'ConcreteClass' }
        ],
        edges: [
          { id: 'edge.1', source: 'class.impl', target: 'class.concrete', type: 'realization' }
        ]
      });

      const warnings = validateUmlSemantics(diagram);
      assert.ok(warnings.some(w => w.includes('Realization should target an interface')));
    });
  });

  describe('Sequence Diagram', () => {
    it('should detect activation with non-existent message', () => {
      const diagram = createDiagram({
        id: 'test',
        title: 'Test',
        type: 'sequence',
        nodes: [
          { id: 'p1', label: 'Client', kind: 'participant' }
        ],
        edges: [],
        sequence: {
          activations: [
            {
              id: 'act1',
              participantId: 'p1',
              startMessageId: 'non-existent'
            }
          ]
        }
      });

      const warnings = validateUmlSemantics(diagram);
      assert.ok(warnings.some(w => w.includes('non-existent start message')));
    });

    it('should detect activation with non-existent participant', () => {
      const diagram = createDiagram({
        id: 'test',
        title: 'Test',
        type: 'sequence',
        nodes: [
          { id: 'p1', label: 'Client', kind: 'participant' }
        ],
        edges: [
          { id: 'msg1', source: 'p1', target: 'p1', label: 'call()' }
        ],
        sequence: {
          activations: [
            {
              id: 'act1',
              participantId: 'non-existent',
              startMessageId: 'msg1'
            }
          ]
        }
      });

      const warnings = validateUmlSemantics(diagram);
      assert.ok(warnings.some(w => w.includes('non-existent participant')));
    });
  });

  describe('State Diagram', () => {
    it('should detect multiple initial states', () => {
      const diagram = createDiagram({
        id: 'test',
        title: 'Test',
        type: 'state',
        nodes: [
          { id: 'state.init1', label: 'Initial 1', kind: 'start' },
          { id: 'state.init2', label: 'Initial 2', kind: 'start' },
          { id: 'state.active', label: 'Active', kind: 'state' }
        ],
        edges: []
      });

      const warnings = validateUmlSemantics(diagram);
      assert.ok(warnings.some(w => w.includes('only one initial state')));
    });

    it('should detect incoming transitions to initial state', () => {
      const diagram = createDiagram({
        id: 'test',
        title: 'Test',
        type: 'state',
        nodes: [
          { id: 'state.init', label: 'Initial', kind: 'start' },
          { id: 'state.active', label: 'Active', kind: 'state' }
        ],
        edges: [
          { id: 'edge.1', source: 'state.active', target: 'state.init', type: 'flow' }
        ]
      });

      const warnings = validateUmlSemantics(diagram);
      assert.ok(warnings.some(w => w.includes('Initial state cannot have incoming')));
    });

    it('should detect outgoing transitions from final state', () => {
      const diagram = createDiagram({
        id: 'test',
        title: 'Test',
        type: 'state',
        nodes: [
          { id: 'state.final', label: 'Final', kind: 'end' },
          { id: 'state.active', label: 'Active', kind: 'state' }
        ],
        edges: [
          { id: 'edge.1', source: 'state.final', target: 'state.active', type: 'flow' }
        ]
      });

      const warnings = validateUmlSemantics(diagram);
      assert.ok(warnings.some(w => w.includes('Final state cannot have outgoing')));
    });

    it('should detect unreachable states', () => {
      const diagram = createDiagram({
        id: 'test',
        title: 'Test',
        type: 'state',
        nodes: [
          { id: 'state.init', label: 'Initial', kind: 'start' },
          { id: 'state.active', label: 'Active', kind: 'state' },
          { id: 'state.orphan', label: 'Orphan', kind: 'state' }
        ],
        edges: [
          { id: 'edge.1', source: 'state.init', target: 'state.active', type: 'flow' }
        ]
      });

      const warnings = validateUmlSemantics(diagram);
      assert.ok(warnings.some(w => w.includes('Unreachable state')));
    });
  });

  describe('Component Diagram', () => {
    it('should detect circular dependencies', () => {
      const diagram = createDiagram({
        id: 'test',
        title: 'Test',
        type: 'uml-component',
        nodes: [
          { id: 'comp.a', label: 'Component A' },
          { id: 'comp.b', label: 'Component B' },
          { id: 'comp.c', label: 'Component C' }
        ],
        edges: [
          { id: 'edge.1', source: 'comp.a', target: 'comp.b', type: 'dependency' },
          { id: 'edge.2', source: 'comp.b', target: 'comp.c', type: 'dependency' },
          { id: 'edge.3', source: 'comp.c', target: 'comp.a', type: 'dependency' }
        ]
      });

      const warnings = validateUmlSemantics(diagram);
      assert.ok(warnings.some(w => w.includes('Circular dependency')));
    });
  });
});
