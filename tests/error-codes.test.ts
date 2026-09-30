import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AESTHETIC_LAYOUT_CODES, AUTHOR_JUDGEMENT_CODES } from '../src/validate/policy.js';
import { DEFAULT_RELAYOUT_CODES, SPACING_FIXABLE } from '../src/layout/elk.js';
import { UML_RULE_CODES } from '../src/validate/uml-rules.js';
import { ERROR_CODE_REGISTRY, NON_CODE_LITERALS } from '../scripts/error-code-registry.js';
import { scanSourceCodes, parityProblems, renderDoc, buildRows, DOC_PATH } from '../scripts/generate-error-codes.js';

// The doc is generated, so what needs testing is the generator's own contract: that it
// cannot silently skip a code, that the committed file is the one it would write, and that
// the severity sets it reads from are themselves free of typos.

test('every code in src/ is registered or explicitly allowed, and no registry entry is a ghost', () => {
  const problems = parityProblems(scanSourceCodes());
  assert.deepEqual(problems, [], problems.join('\n'));
});

test('docs/ERROR_CODES.md is exactly what the generator would write (not stale)', () => {
  const found = scanSourceCodes();
  const expected = renderDoc(buildRows(found), found);
  const committed = readFileSync(DOC_PATH, 'utf-8');
  assert.equal(committed, expected, 'run `npm run error-codes` and commit the result');
});

test('the generated doc has no placeholder or empty cells', () => {
  const doc = readFileSync(DOC_PATH, 'utf-8');
  assert.doesNotMatch(doc, /TODO|TBD|FIXME|lorem|xxxx|\{\{|\$VAR\$/i, 'leftover placeholder in generated doc');
  for (const line of doc.split('\n')) {
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1).map((cell) => cell.trim());
    assert.ok(!cells.some((cell) => cell === ''), `empty table cell in: ${line.slice(0, 120)}`);
  }
});

test('every UML rule code is documented', () => {
  const missing = UML_RULE_CODES.filter((code) => !ERROR_CODE_REGISTRY[code]);
  assert.deepEqual(missing, [], 'UML_RULE_CODES entries missing from the registry');
  assert.equal(UML_RULE_CODES.length, 20, 'the doc claims 20 rules from uml-rules.ts');
});

test('the severity sets the generator reads contain only real, documented codes', () => {
  // A typo in one of these sets fails silently at runtime: the downgrade or the re-layout
  // trigger simply never fires. Cross-checking them against the scanned source makes the
  // typo a build failure instead.
  const found = scanSourceCodes();
  const sets: Array<[string, Iterable<string>]> = [
    ['AESTHETIC_LAYOUT_CODES', AESTHETIC_LAYOUT_CODES],
    ['AUTHOR_JUDGEMENT_CODES', AUTHOR_JUDGEMENT_CODES],
    ['DEFAULT_RELAYOUT_CODES', DEFAULT_RELAYOUT_CODES],
    ['SPACING_FIXABLE', SPACING_FIXABLE],
  ];
  for (const [name, set] of sets) {
    for (const code of set) {
      assert.ok(found.has(code), `${name} references ${code}, which no longer appears in src/`);
      assert.ok(ERROR_CODE_REGISTRY[code], `${name} references ${code}, which is not documented`);
    }
  }
  // SPACING_FIXABLE must be a subset of DEFAULT_RELAYOUT_CODES: a code the loop would turn
  // spacing knobs for, but never considers worth re-laying out, could never be reached.
  for (const code of SPACING_FIXABLE) {
    assert.ok(DEFAULT_RELAYOUT_CODES.has(code), `${code} is spacing-fixable but never triggers a re-layout`);
  }
});

test('NON_CODE_LITERALS entries are real literals and none of them is actually a code', () => {
  const found = scanSourceCodes();
  for (const literal of Object.keys(NON_CODE_LITERALS)) {
    assert.ok(found.has(literal), `${literal} is allowed but no longer appears in src/ - drop the entry`);
    assert.ok(!ERROR_CODE_REGISTRY[literal], `${literal} is both allowed and registered`);
    assert.ok(NON_CODE_LITERALS[literal].trim().length > 3, `${literal} needs a real reason, not a stub`);
  }
});

test('codes that bypass applyProfile are declared, so the ai-led column cannot lie', () => {
  // SEMANTIC_AUDIT_SKIPPED is pushed after applyProfile ran, so it keeps WARNING in both
  // profiles. Without `notProfiled` the generator would compute a downgrade that never
  // happens at runtime. tests/agent-intake.test.ts pins the runtime side.
  const exempt = Object.entries(ERROR_CODE_REGISTRY).filter(([, entry]) => entry.notProfiled);
  assert.deepEqual(exempt.map(([code]) => code), ['SEMANTIC_AUDIT_SKIPPED']);
  const row = buildRows(scanSourceCodes()).find((r) => r.code === 'SEMANTIC_AUDIT_SKIPPED')!;
  assert.equal(row.aiLedSeverity, 'WARNING');
  assert.equal(row.strictSeverity, 'WARNING');
});
