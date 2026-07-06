// Token data → unlock tiers. Pure: (summary, projects) + CONFIG thresholds +
// "today" → a tier label for each courtyard object (pavilion size, cherry
// bloom, willow maturity, stone-cat, lamp lit, trinkets unlocked, etc.).
//
// Extracted to its own module so BOTH the flat renderer (render-garden.js) and
// the isometric one (render-iso.js) read the SAME thresholds — bump a value in
// scene-config once and both views follow, instead of drifting apart. No DOM /
// view / projection assumptions live here; it's a function of the data alone.
import { CONFIG } from './scene-config.js';

export function unlockTier(summary, projects) {
  const list = projects || [];
  const totalTokens = summary?.total_tokens || list.reduce((sum, project) => sum + (project.total_tokens || 0), 0);
  const maxProjectTokens = Math.max(...list.map((project) => project.total_tokens || 0), 0);
  const totalSessions = list.reduce((sum, project) => sum + (project.sessions || 0), 0);
  const maxStage = Math.max(...list.map((project) => project.stage || 1), 1);
  const recentActivity = list.reduce((sum, project) => sum + (project.recent_activity || 0), 0);
  const now = new Date();
  const todayKey = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0')
  ].join('-');
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
