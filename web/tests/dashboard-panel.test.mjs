import test from 'node:test';
import assert from 'node:assert/strict';
import { mountDashboardContent } from '../dashboard-panel.js';

test('overview uses the same billion-scale formatting as the garden', () => {
  const kpis = { innerHTML: '' };
  const host = {
    innerHTML: '',
    addEventListener() {},
    querySelector(selector) { return selector === '[data-slot="kpis"]' ? kpis : null; },
  };
  const dashboard = mountDashboardContent({
    host,
    initialSummary: {
      total_tokens: 5_233_100_000,
      heatmap_year: [{ date: '2026-06-18', value: 2_400_000_000 }],
    },
  });
  assert.match(kpis.innerHTML, />5\.2B</);
  assert.match(kpis.innerHTML, />2\.4B</);
  assert.doesNotMatch(kpis.innerHTML, /5233\.1M|2400\.0M/);

  dashboard.update(null);
  assert.match(kpis.innerHTML, />0</);
  assert.doesNotMatch(kpis.innerHTML, /5\.2B/);
});
