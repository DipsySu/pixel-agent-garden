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

export function suggestedExportName(kind, date = new Date()) {
  const ext = kind === 'json' ? 'json' : 'csv';
  const yyyy = String(date.getFullYear());
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `agent-garden-daily-tokens-${yyyy}${mm}${dd}.${ext}`;
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

function uint(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}
