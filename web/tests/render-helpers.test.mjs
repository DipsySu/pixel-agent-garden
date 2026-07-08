import test from 'node:test';
import assert from 'node:assert/strict';
import { fmtLocal } from '../render-helpers.js';

test('fmtLocal compacts billion-scale token totals', () => {
  assert.equal(fmtLocal(5_233_100_000), '5.2B');
  assert.equal(fmtLocal(466_000_000), '466.0M');
  assert.equal(fmtLocal(24_000), '24.0k');
});

test('fmtLocal rolls a rounds-to-1000 value into the next unit', () => {
  // Regression: (value/scale).toFixed(1) used to print '1000.0M' / '1000.0k'
  // just under the next threshold.
  assert.equal(fmtLocal(999_950_000), '1.0B');
  assert.equal(fmtLocal(999_999_999), '1.0B');
  assert.equal(fmtLocal(999_949_999), '999.9M');
  assert.equal(fmtLocal(999_950), '1.0M');
  assert.equal(fmtLocal(999_949), '999.9k');
});
