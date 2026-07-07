// Token data → unlock tiers. Pure: (summary, projects) + CONFIG thresholds +
// "today" → a tier label for each courtyard object (pavilion size, cherry
// bloom, willow maturity, stone-cat, lamp lit, trinkets unlocked, etc.).
//
// Extracted to its own module so BOTH the flat renderer (render-garden.js) and
// the isometric one (renderers/isometric-renderer.js) read the SAME thresholds —
// bump a value in scene-config once and both views follow, instead of drifting
// apart. No DOM / view / projection assumptions live here; it's a function of
// the data alone.
import { CONFIG } from './scene-config.js';

// `now` is injectable (house test style: parameterize time, never mock Date).
export function unlockTier(summary, projects, now = new Date()) {
  const coreTiers = normalizeCoreTiers(summary?.tiers);
  if (coreTiers) return coreTiers;

  const list = projects || [];
  const totalTokens = summary?.total_tokens || list.reduce((sum, project) => sum + (project.total_tokens || 0), 0);
  const maxProjectTokens = Math.max(...list.map((project) => project.total_tokens || 0), 0);
  const totalSessions = list.reduce((sum, project) => sum + (project.sessions || 0), 0);
  const maxStage = Math.max(...list.map((project) => project.stage || 1), 1);
  const recentActivity = list.reduce((sum, project) => sum + (project.recent_activity || 0), 0);
  // UTC on purpose: daily_activity keys come from core's aggregate.rs, which
  // formats DateTime<Utc> as %Y-%m-%d. A local-date key here returns 0 for
  // "today" between local midnight and UTC midnight (e.g. 00:00-08:00 in
  // UTC+8), wrongly unlighting the lamp.
  const todayKey = now.toISOString().slice(0, 10);
  const todayActivity = list.reduce((sum, project) => {
    const daily = project.daily_activity || {};
    return sum + (daily[todayKey] || 0);
  }, 0);

  const trinkets = CONFIG.pavilionTrinkets
    .filter((t) => totalTokens >= t.threshold)
    .map((t) => t.id);

  const c = CONFIG;
  return {
    totalTokens,
    maxProjectTokens,
    totalSessions,
    recentActivity,
    todayActivity,
    pavilion:
      maxProjectTokens >= c.pavilion.full ? 'full'
      : maxProjectTokens >= c.pavilion.mid ? 'mid'
      : 'small',
    cherry:
      recentActivity >= c.cherry.petal ? 'petal'
      : recentActivity >= c.cherry.bloom ? 'bloom'
      : 'bud',
    willow:
      (totalTokens >= c.willow.mature_tokens || list.length >= c.willow.mature_projects)
        ? 'mature' : 'young',
    stone_cat:
      totalSessions >= c.stone_cat.full ? 'full'
      : totalSessions >= c.stone_cat.small ? 'small'
      : 'hidden',
    lamp: todayActivity > 0 ? 'lit' : 'unlit',
    stool: maxStage >= c.stool.min_stage ? 'visible' : 'hidden',
    cushion: maxStage >= c.cushion.min_stage ? 'visible' : 'hidden',
    pavilionTrinkets: trinkets
  };
}

function normalizeCoreTiers(tiers) {
  if (!tiers || typeof tiers !== 'object') return null;
  return {
    totalTokens: numberValue(tiers.total_tokens, tiers.totalTokens),
    maxProjectTokens: numberValue(tiers.max_project_tokens, tiers.maxProjectTokens),
    totalSessions: numberValue(tiers.total_sessions, tiers.totalSessions),
    recentActivity: numberValue(tiers.recent_activity, tiers.recentActivity),
    todayActivity: numberValue(tiers.today_activity, tiers.todayActivity),
    pavilion: stringValue(tiers.pavilion, 'small'),
    cherry: stringValue(tiers.cherry, 'bud'),
    willow: stringValue(tiers.willow, 'young'),
    stone_cat: stringValue(tiers.stone_cat, tiers.stoneCat, 'hidden'),
    lamp: stringValue(tiers.lamp, 'unlit'),
    stool: stringValue(tiers.stool, 'hidden'),
    cushion: stringValue(tiers.cushion, 'hidden'),
    pavilionTrinkets: Array.isArray(tiers.pavilion_trinkets)
      ? tiers.pavilion_trinkets.slice()
      : Array.isArray(tiers.pavilionTrinkets)
        ? tiers.pavilionTrinkets.slice()
        : []
  };
}

function numberValue(...values) {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return 0;
}

function stringValue(...values) {
  const fallback = values[values.length - 1];
  for (const value of values.slice(0, -1)) {
    if (typeof value === 'string' && value) return value;
  }
  return fallback;
}
