import test from 'node:test';
import assert from 'node:assert/strict';
import { fmtLocal } from '../render-helpers.js';

test('fmtLocal compacts billion-scale token totals', () => {
  assert.equal(fmtLocal(5_233_100_000), '5.2B');
  assert.equal(fmtLocal(466_000_000), '466.0M');
  assert.equal(fmtLocal(24_000), '24.0k');
});
