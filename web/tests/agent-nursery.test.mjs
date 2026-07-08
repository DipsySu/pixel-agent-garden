import test from 'node:test';
import assert from 'node:assert/strict';
import { agentPlotCard, agentPlotStatus, isAgentNurseryEnabled, nurseryRows } from '../agent-nursery.js';

test('isAgentNurseryEnabled follows settings with query override', () => {
  const enabled = { appearance: { flowerbed: 'enabled' } };
  const disabled = { appearance: { flowerbed: 'disabled' } };
  assert.equal(isAgentNurseryEnabled(enabled, ''), true);
  assert.equal(isAgentNurseryEnabled(disabled, ''), false);
  assert.equal(isAgentNurseryEnabled(disabled, '?nursery=1'), true);
  assert.equal(isAgentNurseryEnabled(disabled, '?nursery=enabled'), true);
  assert.equal(isAgentNurseryEnabled(enabled, '?nursery=0'), false);
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
  assert.equal(rows[0].status, 'lush');
  assert.equal(rows[1].id, 'codex');
  assert.equal(rows[1].share, 0.1);
  assert.equal(rows[1].status, 'growing');
  const manual = rows.find((row) => row.id === 'manual-jsonl');
  assert.equal(manual.fallow, true);
  assert.equal(manual.status, 'fallow');
});

test('nurseryRows falls back to legacy source event counts', () => {
  const rows = nurseryRows({ sources: { codex: 3, 'claude-code': 1 } });
  assert.equal(rows[0].id, 'codex');
  assert.equal(rows[0].share, 0.75);
});

test('agentPlotStatus follows lush/growing/fallow contract', () => {
  assert.equal(agentPlotStatus({ share: 0.7, lifetimeTokens: 10, recentTokens: 7, recentTotal: 10 }), 'lush');
  assert.equal(agentPlotStatus({ share: 0.2, lifetimeTokens: 10, recentTokens: 2, recentTotal: 10 }), 'growing');
  assert.equal(agentPlotStatus({ share: 0, lifetimeTokens: 10, recentTokens: 0, recentTotal: 10 }), 'fallow');
});

test('agentPlotCard fills the shared info-card fields', () => {
  const card = agentPlotCard({
    id: 'codex',
    label: 'Codex',
    recentTokens: 1234,
    lifetimeTokens: 9876,
    eventCount: 4,
    share: 0.625,
    status: 'lush',
    fallow: false
  });

  assert.equal(card.name, 'Codex');
  assert.equal(card.fillPercent, 62.5);
  assert.match(card.total, /1\.2k/);
  assert.match(card.detailHtml, /62\.5%/);
  assert.match(card.detailHtml, /9\.9k/);
});
