import test from 'node:test';
import assert from 'node:assert/strict';
import { insightPanelHTML } from '../render-insight.js';

test('insight rows can include project-level cost labels', () => {
  const costs = new Map([
    ['demo-key', { label: '$1.23', unpricedTokens: 456 }]
  ]);
  const html = insightPanelHTML({
    total_tokens: 1000,
    daily_tokens: {},
    projects: [{
      project_key: 'demo-key',
      display_name: 'demo-project',
      total_tokens: 1000,
      daily_tokens: {}
    }]
  }, {
    projectCostByKey: costs,
    format: (value) => String(value)
  });

  assert.match(html, /demo-project/);
  assert.match(html, /Est\. \$1\.23 · 456 unpriced/);
});
