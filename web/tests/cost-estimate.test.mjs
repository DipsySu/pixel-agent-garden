import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateCost, formatUsd, modelTotalTokens, normalizeUsage } from '../cost-estimate.js';

const table = {
  schema_version: 1,
  prices: {
    split: { input_per_mtok: 3, output_per_mtok: 15 },
    total_only: { input_per_mtok: 1, output_per_mtok: 3 },
  },
};

test('estimateCost prices split tokens and total-only blended remainders', () => {
  const estimate = estimateCost({
    split: {
      input_tokens: 2_000_000,
      output_tokens: 1_000_000,
      cache_read_tokens: 10_000_000,
      total_tokens: 13_000_000,
    },
    total_only: {
      total_tokens: 4_000_000,
    },
  }, table);

  assert.equal(estimate.total_usd, 29);
  assert.equal(estimate.by_model.split.usd, 21);
  assert.equal(estimate.by_model.split.cache_tokens, 10_000_000);
  assert.equal(estimate.by_model.total_only.blended_tokens, 4_000_000);
  assert.equal(estimate.by_model.total_only.usd, 8);
});

test('estimateCost buckets unknown models as unpriced tokens', () => {
  const estimate = estimateCost({
    mystery: { input_tokens: 1_000, output_tokens: 2_000 },
  }, table);

  assert.equal(estimate.total_usd, 0);
  assert.equal(estimate.unpriced_tokens, 3_000);
  assert.deepEqual(estimate.by_model, {});
});

test('normalizeUsage derives total from split fields when total is absent', () => {
  const usage = normalizeUsage({
    input_tokens: 10,
    output_tokens: 20,
    cache_read_tokens: 30,
    cache_write_tokens: 40,
  });

  assert.equal(usage.total_tokens, 100);
  assert.equal(modelTotalTokens(usage), 100);
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
