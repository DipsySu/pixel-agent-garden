import test from 'node:test';
import assert from 'node:assert/strict';
import { isAgentNurseryEnabled, nurseryRows } from '../agent-nursery.js';

test('isAgentNurseryEnabled is opt-in by query flag only', () => {
  assert.equal(isAgentNurseryEnabled('?nursery=1'), true);
  assert.equal(isAgentNurseryEnabled('?nursery=enabled'), true);
  assert.equal(isAgentNurseryEnabled('?nursery=0'), false);
  assert.equal(isAgentNurseryEnabled(''), false);
});

test('nurseryRows prefers recent source token share and marks inactive lifetime sources fallow', () => {
  const rows = nurseryRows({
    sources: { 'claude-code': 10, codex: 8, 'manual-jsonl': 1 },
    source_tokens: {
      'claude-code': { total_tokens: 1_000 },
      codex: { total_tokens: 4_000 },
      'manual-jsonl': { total_tokens: 50 }
    },
    source_recent_tokens: {
      'claude-code': 900,
      codex: 100
    }
  });

  assert.equal(rows[0].id, 'claude-code');
  assert.equal(rows[0].share, 0.9);
  assert.equal(rows[1].id, 'codex');
  assert.equal(rows[1].share, 0.1);
  const manual = rows.find((row) => row.id === 'manual-jsonl');
  assert.equal(manual.fallow, true);
});

test('nurseryRows falls back to legacy source event counts', () => {
  const rows = nurseryRows({ sources: { codex: 3, 'claude-code': 1 } });
  assert.equal(rows[0].id, 'codex');
  assert.equal(rows[0].share, 0.75);
});
