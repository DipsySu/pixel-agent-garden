import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCostEstimateCsv,
  buildCostEstimateJson,
  buildDailyTokensCsv,
  buildDailyTokensJson,
  costEstimateRows,
  dailyTokenRows,
  suggestedExportName
} from '../data-export.js';

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

const cost = {
  total: {
    total_usd: 1.25789,
    by_model: {
      'claude,model': {
        input_tokens: 100,
        output_tokens: 200,
        blended_tokens: 300,
        cache_tokens: 400,
        usd: 1.25789,
        input_per_mtok: 3,
        output_per_mtok: 15
      }
    },
    unpriced_tokens: 50,
    unpriced_by_model: { 'future-model': 50 }
  },
  by_project: {
    'demo,one': {
      total_usd: 0.5,
      by_model: {
        'claude,model': {
          input_tokens: 10,
          output_tokens: 20,
          blended_tokens: 30,
          cache_tokens: 40,
          usd: 0.5,
          input_per_mtok: 3,
          output_per_mtok: 15
        }
      },
      unpriced_tokens: 0,
      unpriced_by_model: {}
    },
    'unknown:manual-jsonl': {
      total_usd: 0,
      by_model: {},
      unpriced_tokens: 25,
      unpriced_by_model: { 'unknown-model': 25 }
    }
  }
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
  assert.equal(suggestedExportName('csv', date, 'cost-estimate'), 'agent-garden-cost-estimate-20260708.csv');
});

test('costEstimateRows includes garden and project rows with priced/unpriced status', () => {
  assert.deepEqual(costEstimateRows(cost, summary), [
    {
      scope: 'garden',
      project_key: '',
      project_name: '',
      model: 'claude,model',
      pricing_status: 'priced',
      input_tokens: 100,
      output_tokens: 200,
      blended_tokens: 300,
      cache_tokens: 400,
      total_tokens: 1000,
      usd: '1.25789',
      input_per_mtok: '3',
      output_per_mtok: '15'
    },
    {
      scope: 'garden',
      project_key: '',
      project_name: '',
      model: 'future-model',
      pricing_status: 'unpriced',
      input_tokens: 0,
      output_tokens: 0,
      blended_tokens: 0,
      cache_tokens: 0,
      total_tokens: 50,
      usd: '',
      input_per_mtok: '',
      output_per_mtok: ''
    },
    {
      scope: 'project',
      project_key: 'demo,one',
      project_name: 'demo "one"',
      model: 'claude,model',
      pricing_status: 'priced',
      input_tokens: 10,
      output_tokens: 20,
      blended_tokens: 30,
      cache_tokens: 40,
      total_tokens: 100,
      usd: '0.5',
      input_per_mtok: '3',
      output_per_mtok: '15'
    },
    {
      scope: 'project',
      project_key: 'unknown:manual-jsonl',
      project_name: 'unknown:manual-jsonl',
      model: 'unknown-model',
      pricing_status: 'unpriced',
      input_tokens: 0,
      output_tokens: 0,
      blended_tokens: 0,
      cache_tokens: 0,
      total_tokens: 25,
      usd: '',
      input_per_mtok: '',
      output_per_mtok: ''
    }
  ]);
});

test('cost CSV escapes model/project fields and includes no project_path field', () => {
  const csv = buildCostEstimateCsv(cost, summary);
  assert.match(csv, /^scope,project_key,project_name,model,pricing_status,/);
  assert.match(csv, /garden,,,"claude,model",priced,100,200,300,400,1000,1.25789,3,15/);
  assert.match(csv, /project,"demo,one","demo ""one""","claude,model",priced,10,20,30,40,100,0.5,3,15/);
  assert.equal(csv.includes('project_path'), false);
});

test('cost JSON export is schemaed and pathless', () => {
  const json = JSON.parse(buildCostEstimateJson(cost, summary, new Date('2026-07-08T00:00:00Z')));
  assert.equal(json.schema_version, 1);
  assert.equal(json.generated_at, '2026-07-08T00:00:00.000Z');
  assert.equal(json.kind, 'cost_estimate');
  assert.equal(json.total.by_model['claude,model'].cache_tokens, 400);
  assert.equal(json.total.unpriced_by_model['future-model'], 50);
  assert.equal(json.projects[0].display_name, 'demo "one"');
  assert.equal('project_path' in json.projects[0], false);
});
