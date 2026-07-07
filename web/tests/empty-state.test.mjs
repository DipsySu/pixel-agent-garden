// Contract guard for the P5-2 wood-sign trigger (see empty-state.js):
// the sign shows exactly when the summary carries zero projects, and a
// missing/failed summary MUST count as empty — a first run has no cache yet,
// and the sign IS the first-run experience. Also asserts the module can be
// imported without browser globals (the predicate must stay pure).
// Runs under plain `node --test` — no npm, no DOM.
import test from 'node:test';
import assert from 'node:assert/strict';
import { isEmptySummary } from '../empty-state.js';

test('no summary at all counts as empty (first run / failed load)', () => {
  assert.equal(isEmptySummary(null), true);
  assert.equal(isEmptySummary(undefined), true);
});

test('summary without a usable projects array counts as empty', () => {
  assert.equal(isEmptySummary({}), true);
  assert.equal(isEmptySummary({ projects: null }), true);
});

test('zero projects counts as empty', () => {
  assert.equal(isEmptySummary({ projects: [] }), true);
});

test('any project hides the sign', () => {
  assert.equal(isEmptySummary({ projects: [{ project_key: '/tmp/x' }] }), false);
});
