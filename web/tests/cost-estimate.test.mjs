import test from 'node:test';
import assert from 'node:assert/strict';
import { formatUsd, modelTotalTokens } from '../cost-estimate.js';

// The cost MATH now lives only in core (crate::prices) — the JS mirror
// (estimateCost / normalizeUsage) is gone. What stays here is presentation:
// the token-total reader and the USD formatter.

test('modelTotalTokens derives total from split fields when total is absent', () => {
  assert.equal(modelTotalTokens({
    input_tokens: 10,
    output_tokens: 20,
    cache_read_tokens: 30,
    cache_write_tokens: 40,
  }), 100);
});

test('modelTotalTokens prefers the reported total over the split sum', () => {
  assert.equal(modelTotalTokens({
    input_tokens: 10,
    output_tokens: 20,
    total_tokens: 999,
  }), 999);
});

test('modelTotalTokens treats missing or garbage usage as zero', () => {
  assert.equal(modelTotalTokens(undefined), 0);
  assert.equal(modelTotalTokens({}), 0);
  assert.equal(modelTotalTokens({ input_tokens: -5 }), 0);
});

test('formatUsd keeps small estimates readable', () => {
  assert.equal(formatUsd(0.125), '$0.13');
  assert.equal(formatUsd(120.25), '$120.3');
});

test('formatUsd pins en grouping so $1,235 never reads as one dollar', () => {
  // Regression: toLocaleString(undefined) followed the browser locale, and
  // de/nl/es grouping rendered "$1.235" (review finding).
  assert.equal(formatUsd(1235), '$1,235');
  assert.equal(formatUsd(1234567.4), '$1,234,567');
});
