import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCostEstimateCsv,
  buildCostEstimateJson,
  buildDailyTokensCsv,
  buildDailyTokensJson,
  costEstimateRows,
  dailyTokenRows,
  projectId,
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
    { date: '2026-07-01', project_id: projectId('demo,one'), project_name: 'demo "one"', tokens: 100 },
    { date: '2026-07-01', project_id: projectId('demo-two'), project_name: 'demo-two', tokens: 200 },
    { date: '2026-07-02', project_id: projectId('demo,one'), project_name: 'demo "one"', tokens: 300 },
  ]);
});

test('CSV escapes commas and quotes and omits project_path', () => {
  const csv = buildDailyTokensCsv(summary);
  assert.match(csv, /^date,project_id,project_name,tokens\n/);
  // project_id is the opaque hash, not the raw key; the name still round-trips.
  assert.match(csv, new RegExp(`2026-07-01,${projectId('demo,one')},"demo ""one""",100`));
  assert.equal(csv.includes('/private/path'), false);
});

test('JSON export is schemaed (v2) and pathless', () => {
  const json = JSON.parse(buildDailyTokensJson(summary, new Date('2026-07-08T00:00:00Z')));
  assert.equal(json.schema_version, 2);
  assert.equal(json.generated_at, '2026-07-08T00:00:00.000Z');
  assert.equal(json.projects[0].daily_tokens['2026-07-02'], 300);
  assert.equal('project_path' in json.projects[0], false);
  // The raw key is never emitted — only the opaque id.
  assert.equal('project_key' in json.projects[0], false);
  assert.match(json.projects[0].project_id, /^p_[0-9a-f]{8}$/);
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
      project_id: projectId(''),
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
      project_id: projectId(''),
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
      project_id: projectId('demo,one'),
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
      project_id: projectId('unknown:manual-jsonl'),
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
  assert.match(csv, /^scope,project_id,project_name,model,pricing_status,/);
  assert.match(csv, /garden,,,"claude,model",priced,100,200,300,400,1000,1.25789,3,15/);
  assert.match(csv, new RegExp(`project,${projectId('demo,one')},"demo ""one""","claude,model",priced,10,20,30,40,100,0.5,3,15`));
  assert.equal(csv.includes('project_path'), false);
});

test('cost JSON export is schemaed (v2) and pathless', () => {
  const json = JSON.parse(buildCostEstimateJson(cost, summary, new Date('2026-07-08T00:00:00Z')));
  assert.equal(json.schema_version, 2);
  assert.equal(json.generated_at, '2026-07-08T00:00:00.000Z');
  assert.equal(json.kind, 'cost_estimate');
  assert.equal(json.total.by_model['claude,model'].cache_tokens, 400);
  assert.equal(json.total.unpriced_by_model['future-model'], 50);
  assert.equal(json.projects[0].display_name, 'demo "one"');
  assert.equal('project_path' in json.projects[0], false);
  assert.equal('project_key' in json.projects[0], false);
  assert.match(json.projects[0].project_id, /^p_[0-9a-f]{8}$/);
});

test('export never leaks a project_key that is an on-disk path', () => {
  // Core sets project_key = the local path when project_path is known
  // (event.project_key() → normalize_path(path)). The export must hash it, not
  // echo it, so a shared file never reveals /Users/... directory structure.
  const pathKey = '/Users/alice/Developer/secret-startup';
  const leaky = {
    total_tokens: 10,
    projects: [{
      project_key: pathKey,
      display_name: 'secret-startup',
      total_tokens: 10,
      daily_tokens: { '2026-07-01': 10 }
    }]
  };
  const leakyCost = {
    total: { total_usd: 0, by_model: {}, unpriced_tokens: 0, unpriced_by_model: {} },
    by_project: {
      [pathKey]: { total_usd: 0.1, by_model: {}, unpriced_tokens: 5, unpriced_by_model: { 'm': 5 } }
    }
  };
  const outputs = [
    buildDailyTokensCsv(leaky),
    buildDailyTokensJson(leaky),
    buildCostEstimateCsv(leakyCost, leaky),
    buildCostEstimateJson(leakyCost, leaky)
  ];
  for (const out of outputs) {
    assert.equal(out.includes(pathKey), false, 'raw path leaked');
    assert.equal(out.includes('/Users/alice'), false, 'path fragment leaked');
    assert.match(out, /p_[0-9a-f]{8}/, 'opaque id missing');
  }
  // Same key → same id across files, so rows still join.
  assert.equal(projectId(pathKey), projectId(pathKey));
});

test('CSV neutralizes spreadsheet formula injection', () => {
  const inject = {
    total_tokens: 7,
    projects: [{
      project_key: 'k',
      display_name: '=HYPERLINK("http://evil","x")',
      total_tokens: 7,
      daily_tokens: { '2026-07-01': 7 }
    }]
  };
  const csv = buildDailyTokensCsv(inject);
  // A cell starting with = is prefixed with ' so a spreadsheet treats it as
  // literal text rather than executing it as a formula.
  assert.match(csv, /"'=HYPERLINK/);
  assert.equal(csv.includes('\n=HYPERLINK'), false);
  assert.equal(csv.includes(',=HYPERLINK'), false);
});
