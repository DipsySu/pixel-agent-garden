// Data export helpers (PRD 2.0 §P4-3). Pure summary -> text formatters:
// no DOM, no Tauri, no filesystem. Export intentionally omits project_path by
// default because paths can reveal private directory structure; the project_key
// is enough to join rows inside the user's own local copy.

export function buildDailyTokensCsv(summary) {
  const rows = dailyTokenRows(summary);
  const lines = [['date', 'project_key', 'project_name', 'tokens'].map(csvCell).join(',')];
  for (const row of rows) {
    lines.push([
      row.date,
      row.project_key,
      row.project_name,
      String(row.tokens)
    ].map(csvCell).join(','));
  }
  return lines.join('\n') + '\n';
}

export function buildDailyTokensJson(summary, generatedAt = new Date()) {
  const projects = (summary?.projects || []).map((project) => ({
    project_key: String(project.project_key || ''),
    display_name: String(project.display_name || project.project_key || 'unknown'),
    total_tokens: uint(project.total_tokens),
    daily_tokens: cleanDailyTokens(project.daily_tokens || {})
  }));
  return JSON.stringify({
    schema_version: 1,
    generated_at: generatedAt.toISOString(),
    kind: 'daily_project_tokens',
    total_tokens: uint(summary?.total_tokens),
    projects
  }, null, 2) + '\n';
}

export function buildCostEstimateCsv(cost, summary) {
  const rows = costEstimateRows(cost, summary);
  const lines = [[
    'scope',
    'project_key',
    'project_name',
    'model',
    'pricing_status',
    'input_tokens',
    'output_tokens',
    'blended_tokens',
    'cache_tokens',
    'total_tokens',
    'usd',
    'input_per_mtok',
    'output_per_mtok'
  ].map(csvCell).join(',')];
  for (const row of rows) {
    lines.push([
      row.scope,
      row.project_key,
      row.project_name,
      row.model,
      row.pricing_status,
      String(row.input_tokens),
      String(row.output_tokens),
      String(row.blended_tokens),
      String(row.cache_tokens),
      String(row.total_tokens),
      row.usd,
      row.input_per_mtok,
      row.output_per_mtok
    ].map(csvCell).join(','));
  }
  return lines.join('\n') + '\n';
}

export function buildCostEstimateJson(cost, summary, generatedAt = new Date()) {
  const projectNames = projectNameMap(summary);
  const projects = Object.entries(cost?.by_project || {})
    .map(([projectKey, estimate]) => ({
      project_key: String(projectKey || ''),
      display_name: projectNames.get(String(projectKey || '')) || displayNameFromKey(projectKey),
      estimate: cleanEstimate(estimate)
    }))
    .sort((a, b) =>
      Number(b.estimate.total_usd || 0) - Number(a.estimate.total_usd || 0) ||
      Number(b.estimate.unpriced_tokens || 0) - Number(a.estimate.unpriced_tokens || 0) ||
      a.display_name.localeCompare(b.display_name) ||
      a.project_key.localeCompare(b.project_key)
    );
  return JSON.stringify({
    schema_version: 1,
    generated_at: generatedAt.toISOString(),
    kind: 'cost_estimate',
    total: cleanEstimate(cost?.total),
    projects
  }, null, 2) + '\n';
}

export function dailyTokenRows(summary) {
  const rows = [];
  for (const project of summary?.projects || []) {
    const daily = project?.daily_tokens || {};
    for (const [date, tokens] of Object.entries(daily)) {
      const value = uint(tokens);
      if (value <= 0) continue;
      rows.push({
        date,
        project_key: String(project.project_key || ''),
        project_name: String(project.display_name || project.project_key || 'unknown'),
        tokens: value
      });
    }
  }
  rows.sort((a, b) =>
    a.date.localeCompare(b.date) ||
    a.project_name.localeCompare(b.project_name) ||
    a.project_key.localeCompare(b.project_key)
  );
  return rows;
}

export function costEstimateRows(cost, summary) {
  const rows = [];
  rows.push(...estimateRows({
    scope: 'garden',
    projectKey: '',
    projectName: '',
    estimate: cost?.total
  }));

  const projectNames = projectNameMap(summary);
  const projects = Object.entries(cost?.by_project || {})
    .map(([projectKey, estimate]) => ({
      projectKey: String(projectKey || ''),
      projectName: projectNames.get(String(projectKey || '')) || displayNameFromKey(projectKey),
      estimate
    }))
    .sort((a, b) =>
      estimateUsd(b.estimate) - estimateUsd(a.estimate) ||
      estimateUnpriced(b.estimate) - estimateUnpriced(a.estimate) ||
      a.projectName.localeCompare(b.projectName) ||
      a.projectKey.localeCompare(b.projectKey)
    );
  for (const project of projects) {
    rows.push(...estimateRows({
      scope: 'project',
      projectKey: project.projectKey,
      projectName: project.projectName,
      estimate: project.estimate
    }));
  }
  return rows;
}

export function suggestedExportName(kind, date = new Date(), dataset = 'daily-tokens') {
  const ext = kind === 'json' ? 'json' : 'csv';
  const yyyy = String(date.getFullYear());
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `agent-garden-${dataset}-${yyyy}${mm}${dd}.${ext}`;
}

function estimateRows({ scope, projectKey, projectName, estimate }) {
  const priced = Object.entries(estimate?.by_model || {})
    .map(([model, cost]) => pricedCostRow({ scope, projectKey, projectName, model, cost }))
    .filter((row) => row.total_tokens > 0 || Number(row.usd || 0) > 0)
    .sort((a, b) =>
      Number(b.usd || 0) - Number(a.usd || 0) ||
      b.total_tokens - a.total_tokens ||
      a.model.localeCompare(b.model)
    );
  const unpriced = Object.entries(estimate?.unpriced_by_model || {})
    .map(([model, tokens]) => unpricedCostRow({ scope, projectKey, projectName, model, tokens }))
    .filter((row) => row.total_tokens > 0)
    .sort((a, b) => b.total_tokens - a.total_tokens || a.model.localeCompare(b.model));
  return priced.concat(unpriced);
}

function pricedCostRow({ scope, projectKey, projectName, model, cost }) {
  const input = uint(cost?.input_tokens);
  const output = uint(cost?.output_tokens);
  const blended = uint(cost?.blended_tokens);
  const cache = uint(cost?.cache_tokens);
  return {
    scope,
    project_key: String(projectKey || ''),
    project_name: String(projectName || ''),
    model: String(model || ''),
    pricing_status: 'priced',
    input_tokens: input,
    output_tokens: output,
    blended_tokens: blended,
    cache_tokens: cache,
    total_tokens: input + output + blended + cache,
    usd: decimal(cost?.usd),
    input_per_mtok: decimal(cost?.input_per_mtok),
    output_per_mtok: decimal(cost?.output_per_mtok)
  };
}

function unpricedCostRow({ scope, projectKey, projectName, model, tokens }) {
  return {
    scope,
    project_key: String(projectKey || ''),
    project_name: String(projectName || ''),
    model: String(model || ''),
    pricing_status: 'unpriced',
    input_tokens: 0,
    output_tokens: 0,
    blended_tokens: 0,
    cache_tokens: 0,
    total_tokens: uint(tokens),
    usd: '',
    input_per_mtok: '',
    output_per_mtok: ''
  };
}

function cleanEstimate(estimate) {
  const byModel = {};
  for (const [model, cost] of Object.entries(estimate?.by_model || {})) {
    byModel[String(model || '')] = {
      input_tokens: uint(cost?.input_tokens),
      output_tokens: uint(cost?.output_tokens),
      blended_tokens: uint(cost?.blended_tokens),
      cache_tokens: uint(cost?.cache_tokens),
      usd: number(cost?.usd),
      input_per_mtok: number(cost?.input_per_mtok),
      output_per_mtok: number(cost?.output_per_mtok)
    };
  }
  const unpricedByModel = {};
  for (const [model, tokens] of Object.entries(estimate?.unpriced_by_model || {})) {
    const value = uint(tokens);
    if (value > 0) unpricedByModel[String(model || '')] = value;
  }
  return {
    total_usd: number(estimate?.total_usd),
    by_model: byModel,
    unpriced_tokens: uint(estimate?.unpriced_tokens),
    unpriced_by_model: unpricedByModel
  };
}

function projectNameMap(summary) {
  const out = new Map();
  for (const project of summary?.projects || []) {
    const key = String(project?.project_key || '');
    if (!key) continue;
    out.set(key, String(project?.display_name || project?.project_key || 'unknown'));
  }
  return out;
}

function displayNameFromKey(projectKey) {
  const key = String(projectKey || '');
  if (!key) return 'unknown';
  const parts = key.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || key;
}

function estimateUsd(estimate) {
  return number(estimate?.total_usd);
}

function estimateUnpriced(estimate) {
  return uint(estimate?.unpriced_tokens);
}

function cleanDailyTokens(daily) {
  const out = {};
  for (const [date, tokens] of Object.entries(daily || {})) {
    const value = uint(tokens);
    if (value > 0) out[date] = value;
  }
  return out;
}

function csvCell(value) {
  const s = String(value == null ? '' : value);
  if (!/[",\n\r]/.test(s)) return s;
  return '"' + s.replace(/"/g, '""') + '"';
}

function decimal(value) {
  const n = number(value);
  if (n === 0) return '0';
  return String(Math.round(n * 1_000_000) / 1_000_000);
}

function number(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function uint(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}
