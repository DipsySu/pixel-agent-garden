import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDailyTokensCsv, buildDailyTokensJson, dailyTokenRows, suggestedExportName } from '../data-export.js';

const summary = {
  total_tokens: 600,
  projects: [
    {
      project_key: 'demo,one',
      display_name: 'demo "one"',
      project_path: '/private/path/not/exported',
      total_tokens: 400,
      daily_tokens: { '2026-07-02': 300, '2026-07-01': 100 }
    },
    {
      project_key: 'demo-two',
      display_name: 'demo-two',
      total_tokens: 200,
      daily_tokens: { '2026-07-01': 200, '2026-07-03': 0 }
    }
  ]
};

test('dailyTokenRows sorts by date then project and drops zero days', () => {
  assert.deepEqual(dailyTokenRows(summary), [
    { date: '2026-07-01', project_key: 'demo,one', project_name: 'demo "one"', tokens: 100 },
    { date: '2026-07-01', project_key: 'demo-two', project_name: 'demo-two', tokens: 200 },
    { date: '2026-07-02', project_key: 'demo,one', project_name: 'demo "one"', tokens: 300 },
  ]);
});

test('CSV escapes commas and quotes and omits project_path', () => {
  const csv = buildDailyTokensCsv(summary);
  assert.match(csv, /^date,project_key,project_name,tokens\n/);
  assert.match(csv, /2026-07-01,"demo,one","demo ""one""",100/);
  assert.equal(csv.includes('/private/path'), false);
});

test('JSON export is schemaed and pathless', () => {
  const json = JSON.parse(buildDailyTokensJson(summary, new Date('2026-07-08T00:00:00Z')));
  assert.equal(json.schema_version, 1);
  assert.equal(json.generated_at, '2026-07-08T00:00:00.000Z');
  assert.equal(json.projects[0].daily_tokens['2026-07-02'], 300);
  assert.equal('project_path' in json.projects[0], false);
});

test('suggestedExportName is deterministic by kind and local date', () => {
  const date = new Date(2026, 6, 8, 12, 0, 0);
  assert.equal(suggestedExportName('csv', date), 'agent-garden-daily-tokens-20260708.csv');
  assert.equal(suggestedExportName('json', date), 'agent-garden-daily-tokens-20260708.json');
});
