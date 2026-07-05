import { CONFIG } from '../scene-config.js';
import { fmtLocal, escapeHtml, pick, jitter } from '../render-helpers.js';
import { sparklineSVG, windowTotal } from '../render-insight.js';
import { t } from '../i18n.js';
import { isoToScreen, renderIsometricBase, wallSlotToScreen } from './isometric-base.js';

const W = 680;
const H = 440;
const dynamicSelector = '.pg6-iso-dynamic, .pg6-empty';
const ISO_ASSETS = {
  bamboo: { file: 'isometric_generated/bamboo_iso_01.png' },
  cherry: { file: 'isometric_generated/cherry_iso_01.png' },
  koiPond: { file: 'isometric_generated/koi_pond_iso_01.png' },
  pavilion: { file: 'isometric_generated/pavilion_iso_02.png' },
  stoneCat: { file: 'isometric_generated/stone_cat_iso_02.png' },
  stoneLantern: { file: 'isometric_generated/stone_lantern_iso_01.png' },
  willow: { file: 'isometric_generated/willow_iso_01.png' },
};

export function createIsometricRenderer(options) {
  let currentProjects = [];

  function renderBase(settings) {
    renderIsometricBase(options.scene, options.assetRoot, { settings });
  }

  function renderDynamic(groups, summary) {
    const projects = projectsForGarden(summary?.projects || []);
    const tiers = unlockTier(summary, projects);
    currentProjects = projects;
    clearDynamic(options.scene);
    updateHeaderMeta(options.scene, summary);
    updateDataFreshness(summary);
    updateDefaultInfo(summary, projects);
    addProjectVines(options.scene, options.spriteRoot, groups, projects);
    addCourtyardObjects(options.scene, options.spriteRoot, groups, tiers);
    if (!projects.length) renderEmptyState(options.scene);
  }

  function paint(groups, summary, settings) {
    renderBase(settings);
    renderDynamic(groups, summary);
  }

  function showScanning() {
    const el = document.getElementById('data-freshness');
    if (!el) return;
    el.textContent = t('fresh.scanning');
    el.classList.remove('is-stale', 'is-paused');
    el.classList.add('is-scanning');
    el.title = t('fresh.scanningTitle');
  }

  function showCached(summary) {
    updateDataFreshness(summary);
    const el = document.getElementById('data-freshness');
    if (!el) return;
    el.textContent = t('fresh.cached');
    el.classList.remove('is-scanning', 'is-stale');
    el.classList.add('is-paused');
    el.title = t('fresh.cachedTitle');
  }

  function selectProjectByKey(projectKey) {
    const index = currentProjects.findIndex((project) => project.project_key === projectKey);
    if (index < 0) return false;
    const vine = options.scene.querySelector('.roving-vine[data-project-index="' + index + '"]');
    setActiveProject(index);
    updateInfoFromProject(currentProjects[index]);
    positionInfoCardFromElement(options.scene, vine);
    if (vine) {
      options.scene.querySelectorAll('.roving-vine').forEach((item) => { item.tabIndex = -1; });
      vine.tabIndex = 0;
      vine.focus({ preventScroll: true });
    }
    return true;
  }

  function destroy() {
    clearDynamic(options.scene);
    currentProjects = [];
  }

  return {
    mode: 'isometric',
    renderBase,
    renderDynamic,
    paint,
    repaintData: renderDynamic,
    showScanning,
    showCached,
    selectProjectByKey,
    destroy,
  };
}

function addProjectVines(scene, spriteRoot, groups, projects) {
  const hanging = groups.hanging_vine || [];
  const vertical = groups.vertical_vine || [];
  const leaves = groups.leaf_cluster || [];
  const vines = hanging.length ? hanging : vertical;
  if (!vines.length || !projects.length) return;

  const maxTokens = Math.max(...projects.map((project) => project.total_tokens || 0), 1);
  const sortedTokens = projects
    .map((project) => project.total_tokens || 0)
    .filter(Boolean)
    .sort((a, b) => b - a);
  const slots = spreadSlots(projects.length, 0.04, 0.96);
  const densityScale = projects.length > 50 ? 0.46 : projects.length > 32 ? 0.54 : projects.length > 20 ? 0.64 : 0.76;
  const capLimit = projects.length > 32 ? 8 : projects.length > 20 ? 12 : projects.length;

  projects.forEach((project, projectIndex) => {
    const profile = tokenSizeProfile(project, maxTokens, sortedTokens);
    const top = wallSlotToScreen(slots[projectIndex]);
    const sprite = pick(vines, projectIndex + profile.level);
    const sideTilt = top.side === 'left' ? -3 : 3;
    const img = addSprite(scene, spriteRoot, sprite, {
      x: top.x + (jitter(projectIndex, 3) - 0.5) * 10,
      y: top.y + 2 + jitter(projectIndex, 5) * 8,
      width: Math.max(12, profile.width * densityScale),
      z: 380 - projectIndex,
      opacity: Math.min(0.78, profile.opacity + 0.06),
      anchor: 'top',
      className: 'project hanging pg6-iso-vine',
      project,
      projectIndex,
      title: project.display_name,
    });
    if (img) {
      img.style.setProperty('--iso-vine-tilt', sideTilt + 'deg');
      wireProjectInteractions(scene, img, project, projectIndex);
    }

    if (leaves.length && profile.level >= 4 && projectIndex < capLimit) {
      addSprite(scene, spriteRoot, pick(leaves, projectIndex), {
        x: top.x,
        y: top.y + 2,
        width: 18 + profile.level * 2,
        z: 400 - projectIndex,
        opacity: 0.82,
        anchor: 'bottom',
        className: 'vine-cornice pg6-iso-dynamic',
        hueShift: vineHueShift(project),
      });
    }
  });
}

function addCourtyardObjects(scene, spriteRoot, groups, tiers) {
  void groups;

  addFloorSprite(scene, spriteRoot, ISO_ASSETS.koiPond, 0.24, 0.72, 104, {
    className: 'object pg6-iso-generated pg6-iso-pond',
    zOffset: -8,
    shadow: false,
  });

  [
    [0.52, 0.93, 32],
    [0.60, 0.82, 29],
    [0.67, 0.72, 26],
    [0.73, 0.62, 23],
    [0.78, 0.54, 20],
  ].forEach(([u, v, w], index) => {
    addFloorSprite(scene, spriteRoot, { file: 'critters/stepping_stone.png' }, u, v, w, {
      className: 'object pg6-iso-stone',
      zOffset: -14 - index,
    });
  });

  addFloorSprite(scene, spriteRoot, ISO_ASSETS.cherry, 0.19, 0.47, tiers.cherry === 'petal' ? 82 : 72, {
    className: 'object decor-cherry pg6-iso-generated pg6-iso-tree',
    zOffset: 8,
    opacity: tiers.cherry === 'bud' ? 0.78 : 0.94,
  });

  addFloorSprite(scene, spriteRoot, ISO_ASSETS.willow, 0.55, 0.27, tiers.willow === 'mature' ? 116 : 90, {
    className: 'object decor-willow pg6-iso-generated pg6-iso-tree',
    zOffset: 18,
  });

  if (tiers.stone_cat !== 'hidden') {
    addFloorSprite(scene, spriteRoot, ISO_ASSETS.stoneCat, 0.41, 0.54, tiers.stone_cat === 'full' ? 62 : 50, {
      className: 'object cat-interactive pg6-iso-generated pg6-iso-statue',
      zOffset: 20,
    });
  }

  [
    [0.08, 0.50, 78, -8],
    [0.92, 0.43, 68, -6],
  ].forEach(([u, v, w, z]) => {
    addFloorSprite(scene, spriteRoot, ISO_ASSETS.bamboo, u, v, w, {
      className: 'object pg6-iso-generated pg6-iso-bamboo',
      zOffset: z,
      opacity: 0.82,
    });
  });

  const pavilionWidth = { small: 116, mid: 138, full: 158 }[tiers.pavilion] || 116;
  addFloorSprite(scene, spriteRoot, ISO_ASSETS.pavilion, 0.77, 0.48, pavilionWidth, {
    className: 'object pg6-iso-generated pg6-iso-pavilion',
    zOffset: 32,
  });

  const lit = tiers.lamp === 'lit' || scene.dataset.timeMode === 'night' || scene.dataset.timeMode === 'dusk';
  addFloorSprite(scene, spriteRoot, ISO_ASSETS.stoneLantern, 0.80, 0.61, lit ? 46 : 42, {
    className: 'object decor-lantern ' + (lit ? 'is-lit' : 'is-dim') + ' pg6-iso-generated pg6-iso-lantern',
    zOffset: 44,
  });
}

function addFloorSprite(scene, spriteRoot, sprite, u, v, width, options = {}) {
  const p = isoToScreen(u, v);
  const spriteWidth = Math.round(width * p.scale);
  if (options.shadow !== false) {
    addFloorShadow(scene, p, spriteWidth, options);
  }
  return addSprite(scene, spriteRoot, sprite, {
    x: p.x,
    y: p.y,
    width: spriteWidth,
    z: p.z + (options.zOffset || 0),
    opacity: options.opacity ?? 1,
    anchor: 'bottom',
    className: options.className || 'object',
    scaleY: options.scaleY,
  });
}

function addFloorShadow(scene, point, spriteWidth, options = {}) {
  const shadow = document.createElement('span');
  const width = Math.max(18, Math.round(spriteWidth * (options.shadowScale || 0.58)));
  shadow.className = 'pg6-iso-shadow pg6-iso-dynamic';
  shadow.style.left = (point.x / W * 100).toFixed(3) + '%';
  shadow.style.top = (point.y / H * 100).toFixed(3) + '%';
  shadow.style.width = (width / W * 100).toFixed(3) + '%';
  shadow.style.zIndex = String(point.z + (options.zOffset || 0) - 2);
  shadow.style.opacity = String(options.shadowOpacity ?? 0.28);
  scene.append(shadow);
  return shadow;
}

function addSprite(scene, spriteRoot, sprite, options) {
  if (!sprite || !sprite.file) return null;
  const img = document.createElement('img');
  img.className = 'pg6-sprite pg6-iso-dynamic' + (options.className ? ' ' + options.className : '');
  img.src = spriteRoot + sprite.file;
  img.alt = '';
  img.decoding = 'async';
  img.loading = 'eager';
  img.style.left = (options.x / W * 100).toFixed(3) + '%';
  img.style.top = (options.y / H * 100).toFixed(3) + '%';
  img.style.width = (options.width / W * 100).toFixed(3) + '%';
  img.style.zIndex = String(options.z || 10);
  img.style.opacity = String(options.opacity ?? 1);
  const anchor = options.anchor === 'top' ? 'translate(-50%, 0)' : 'translate(-50%, -100%)';
  const scaleY = options.scaleY ? ' scaleY(' + options.scaleY + ')' : '';
  img.style.setProperty('--sprite-transform', anchor + scaleY);
  if (options.hueShift) img.style.setProperty('--vine-hue-shift', options.hueShift);
  if (options.project) {
    img.classList.add('roving-vine');
    img.dataset.projectIndex = String(options.projectIndex ?? 0);
    img.dataset.projectKey = options.project.project_key || '';
    const hue = vineHueShift(options.project);
    if (hue) img.style.setProperty('--vine-hue-shift', hue);
  }
  if (options.title) img.title = options.title;
  scene.append(img);
  return img;
}

function wireProjectInteractions(scene, img, project, projectIndex) {
  img.tabIndex = scene.querySelector('.roving-vine:not([data-project-index="' + projectIndex + '"])') ? -1 : 0;
  img.addEventListener('mouseenter', () => {
    setActiveProject(projectIndex);
    updateInfoFromProject(project);
    positionInfoCardFromElement(scene, img);
  });
  img.addEventListener('mousemove', (event) => {
    positionInfoCardFromPointer(scene, event);
  });
  img.addEventListener('focus', () => {
    setActiveProject(projectIndex);
    updateInfoFromProject(project);
    positionInfoCardFromElement(scene, img);
  });
  img.addEventListener('mouseleave', () => {
    clearActiveProject();
    hideInfoCard();
  });
  img.addEventListener('blur', () => {
    clearActiveProject();
    hideInfoCard();
  });
  img.addEventListener('keydown', (event) => handleVineKey(scene, event));
}

function handleVineKey(scene, event) {
  const dir = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
  const jumpFirst = event.key === 'Home';
  const jumpLast = event.key === 'End';
  if (!dir && !jumpFirst && !jumpLast) return;
  event.preventDefault();
  const vines = Array.from(scene.querySelectorAll('.roving-vine'))
    .sort((a, b) => Number(a.dataset.projectIndex || 0) - Number(b.dataset.projectIndex || 0));
  if (!vines.length) return;
  const cur = vines.indexOf(event.currentTarget);
  const next = jumpFirst ? vines[0] : jumpLast ? vines[vines.length - 1] : vines[(cur + dir + vines.length) % vines.length];
  vines.forEach((vine) => { vine.tabIndex = -1; });
  next.tabIndex = 0;
  next.focus();
}

function updateInfoFromProject(project, options = {}) {
  const stage = Number(project.stage || 1);
  const total = project.total_tokens || 0;
  setText('garden-info-label', t('card.project.label'));
  setText('garden-info-name', project.display_name || t('card.project.defaultName'));
  setText('garden-info-total', t('card.total', { total: fmtLocal(total) }));
  setText('garden-info-stage', t('card.stage', { stage }));
  const fill = document.getElementById('garden-info-fill');
  if (fill) fill.style.width = Math.max(8, Math.min(100, stage / 6 * 100)) + '%';
  setInfoDetail(buildInfoDetail(project));
  setInfoSpark(project.daily_tokens);
  if (options.reveal !== false) showInfoCard();
}

function buildInfoDetail(project) {
  const rows = [];
  const today = windowTotal(project.daily_tokens, 1);
  if (today > 0) rows.push(metaRow(t('card.today'), fmtLocal(today)));
  const sessions = Number(project.sessions || 0);
  const tools = Number(project.tool_calls || 0);
  if (sessions > 0 || tools > 0) {
    const parts = [];
    if (sessions > 0) parts.push(t('card.sessionsShort', { count: sessions }));
    if (tools > 0) parts.push(t('card.toolsShort', { count: fmtLocal(tools) }));
    rows.push(metaRow(t('card.activity'), parts.join(' · ')));
  }
  const sources = sourceSummary(project.sources);
  if (sources) rows.push(metaRow(t('card.sources'), sources));
  return rows.join('');
}

function metaRow(label, value) {
  return (
    '<div class="pg6-info-meta">' +
    '<span class="pg6-info-meta-k">' + escapeHtml(label) + '</span>' +
    '<span class="pg6-info-meta-v">' + escapeHtml(value) + '</span>' +
    '</div>'
  );
}

function sourceSummary(sources) {
  if (!sources || typeof sources !== 'object') return '';
  const entries = Object.entries(sources).filter(([, count]) => Number(count || 0) > 0);
  if (entries.length < 2) return '';
  const pretty = { 'claude-code': 'Claude Code', 'claude-cowork': 'Cowork', codex: 'Codex', 'manual-jsonl': t('source.manual') };
  return entries
    .sort((a, b) => Number(b[1]) - Number(a[1]))
    .map(([name, count]) => (pretty[name] || name) + ' ' + fmtLocal(Number(count)))
    .join(' · ');
}

function positionInfoCardFromElement(scene, anchor) {
  const card = document.querySelector('.pg6-info');
  if (!card || !anchor) return;
  const sceneRect = scene.getBoundingClientRect();
  const a = anchor.getBoundingClientRect();
  const cardW = card.offsetWidth || 200;
  const cardH = card.offsetHeight || 100;
  const gap = 14;
  const pad = 10;
  const aCx = a.left + a.width / 2 - sceneRect.left;
  let x = aCx < sceneRect.width / 2
    ? (a.right - sceneRect.left) + gap
    : (a.left - sceneRect.left) - cardW - gap;
  x = Math.max(pad, Math.min(sceneRect.width - cardW - pad, x));
  const aTop = a.top - sceneRect.top;
  const aBottom = a.bottom - sceneRect.top;
  const y = Math.max(pad, Math.min(sceneRect.height - cardH - pad, (aTop + aBottom) / 2 - cardH / 2));
  card.style.setProperty('--info-x', x + 'px');
  card.style.setProperty('--info-y', y + 'px');
  card.style.setProperty('--info-bottom', 'auto');
}

function positionInfoCardFromPointer(scene, event) {
  const card = document.querySelector('.pg6-info');
  if (!card) return;
  const sceneRect = scene.getBoundingClientRect();
  const cardW = card.offsetWidth || 220;
  const cardH = card.offsetHeight || 112;
  const gap = 16;
  const pad = 12;
  let x = event.clientX - sceneRect.left + gap;
  let y = event.clientY - sceneRect.top + gap;
  if (x + cardW + pad > sceneRect.width) {
    x = event.clientX - sceneRect.left - cardW - gap;
  }
  if (y + cardH + pad > sceneRect.height) {
    y = event.clientY - sceneRect.top - cardH - gap;
  }
  x = Math.max(pad, Math.min(sceneRect.width - cardW - pad, x));
  y = Math.max(pad, Math.min(sceneRect.height - cardH - pad, y));
  card.style.setProperty('--info-x', x + 'px');
  card.style.setProperty('--info-y', y + 'px');
  card.style.setProperty('--info-bottom', 'auto');
}

function showInfoCard() {
  const card = document.querySelector('.pg6-info');
  if (card) card.classList.add('is-visible');
}

function hideInfoCard() {
  const card = document.querySelector('.pg6-info');
  if (card) card.classList.remove('is-visible');
}

function setActiveProject(index) {
  document.querySelectorAll('.roving-vine').forEach((el) => {
    el.classList.toggle('is-active', el.dataset.projectIndex === String(index));
  });
}

function clearActiveProject() {
  document.querySelectorAll('.roving-vine').forEach((el) => {
    el.classList.remove('is-active');
  });
}

function updateHeaderMeta(scene, summary) {
  const app = document.querySelector('.pg6-app');
  if (app) app.textContent = t('app.initial') + ' · 2.5D';
  const total = document.getElementById('meta-total');
  if (total) {
    const n = summary?.total_tokens || 0;
    total.textContent = n > 0
      ? new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(n)
      : '0';
  }
  setText('meta-season', scene.dataset.seasonLabel || t('season.spring'));
  setText('meta-season-sub', '2.5D');
  setText('meta-time', scene.dataset.timeLabel || t('time.day'));
  const now = new Date();
  setText('meta-time-sub', String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0'));
}

function updateDataFreshness(summary) {
  const el = document.getElementById('data-freshness');
  if (!el) return;
  const stamp = summary && summary.last_seen;
  if (!stamp) {
    el.textContent = '';
    el.classList.remove('is-scanning', 'is-stale', 'is-paused');
    el.removeAttribute('title');
    return;
  }
  const diff = Date.now() - new Date(stamp).getTime();
  const mins = Math.round(diff / 60_000);
  const hours = Math.round(diff / 3_600_000);
  const days = Math.round(diff / 86_400_000);
  let label;
  if (mins < 1) label = t('fresh.justNow');
  else if (mins < 60) label = t('fresh.minutesAgo', { count: mins });
  else if (hours < 24) label = t('fresh.hoursAgo', { count: hours });
  else if (days < 30) label = t('fresh.daysAgo', { count: days });
  else label = t('fresh.monthPlusAgo');
  el.textContent = t('fresh.updated', { when: label });
  el.classList.remove('is-scanning', 'is-paused');
  if (diff > 24 * 3_600_000) {
    el.classList.add('is-stale');
    el.title = t('fresh.staleTitle');
  } else {
    el.classList.remove('is-stale');
    el.removeAttribute('title');
  }
}

function updateDefaultInfo(summary, projects) {
  const project = projects[0];
  if (project) updateInfoFromProject(project, { reveal: false });
  void summary;
}

function renderEmptyState(scene) {
  const empty = document.createElement('div');
  empty.className = 'pg6-empty';
  empty.innerHTML =
    '<div class="pg6-empty-title">' + escapeHtml(t('empty.title')) + '</div>' +
    '<div class="pg6-empty-hint">' + escapeHtml(t('empty.hint')) + '</div>';
  scene.append(empty);
}

function clearDynamic(scene) {
  scene.querySelectorAll(dynamicSelector).forEach((el) => el.remove());
}

function projectsForGarden(projects) {
  return [...projects].sort((a, b) => (b.total_tokens || 0) - (a.total_tokens || 0));
}

function unlockTier(summary, projects) {
  const list = projects || [];
  const totalTokens = summary?.total_tokens || list.reduce((sum, project) => sum + (project.total_tokens || 0), 0);
  const maxProjectTokens = Math.max(...list.map((project) => project.total_tokens || 0), 0);
  const totalSessions = list.reduce((sum, project) => sum + (project.sessions || 0), 0);
  const maxStage = Math.max(...list.map((project) => project.stage || 1), 1);
  const recentActivity = list.reduce((sum, project) => sum + (project.recent_activity || 0), 0);
  const todayKey = new Date().toISOString().slice(0, 10);
  const todayActivity = list.reduce((sum, project) => sum + ((project.daily_activity || {})[todayKey] || 0), 0);
  const c = CONFIG;
  return {
    totalTokens,
    maxProjectTokens,
    totalSessions,
    recentActivity,
    todayActivity,
    pavilion: maxProjectTokens >= c.pavilion.full ? 'full' : maxProjectTokens >= c.pavilion.mid ? 'mid' : 'small',
    cherry: recentActivity >= c.cherry.petal ? 'petal' : recentActivity >= c.cherry.bloom ? 'bloom' : 'bud',
    willow: (totalTokens >= c.willow.mature_tokens || list.length >= c.willow.mature_projects) ? 'mature' : 'young',
    stone_cat: totalSessions >= c.stone_cat.full ? 'full' : totalSessions >= c.stone_cat.small ? 'small' : 'hidden',
    lamp: todayActivity > 0 ? 'lit' : 'unlit',
    stool: maxStage >= c.stool.min_stage ? 'visible' : 'hidden',
    cushion: maxStage >= c.cushion.min_stage ? 'visible' : 'hidden',
  };
}

function tokenSizeProfile(project, maxTokens, sortedTokens) {
  const tokens = project.total_tokens || 0;
  const hasCore = Number.isInteger(project.size_level) && project.size_level >= 1;
  const level = hasCore ? project.size_level : tokenSizeLevel(tokens, maxTokens);
  const strength = hasCore && Number.isFinite(project.size_strength)
    ? project.size_strength
    : tokenSizeStrength(tokens, maxTokens, sortedTokens);
  return {
    level,
    width: level >= 3 ? 30 + strength * 66 : 18 + strength * 30,
    opacity: level >= 3 ? 0.54 + strength * 0.30 : 0.48 + strength * 0.18,
  };
}

function tokenSizeLevel(tokens, maxTokens) {
  if (tokens <= 0) return 1;
  const minLog = 3;
  const maxLog = Math.max(minLog + 1, Math.log10(maxTokens + 1));
  const ratio = (Math.log10(tokens + 1) - minLog) / (maxLog - minLog);
  return Math.max(1, Math.min(5, Math.ceil(ratio * 5)));
}

function tokenSizeStrength(tokens, maxTokens, sortedTokens) {
  const rank = Math.max(0, sortedTokens.findIndex((value) => value === tokens));
  const count = Math.max(1, sortedTokens.length);
  const rankStrength = 1 - rank / Math.max(1, count - 1);
  const logStrength = tokens > 0 && maxTokens > 0
    ? Math.max(0, Math.min(1, (Math.log10(tokens + 1) - 4) / (Math.log10(maxTokens + 1) - 4)))
    : 0;
  return Math.max(0, Math.min(1, logStrength * 0.68 + rankStrength * 0.32));
}

function vineHueShift(project) {
  const sources = project && project.sources;
  if (!sources || typeof sources !== 'object') return null;
  const claude = sources['claude-code'] || sources['claude_code'] || 0;
  const codex = sources.codex || 0;
  const other = Object.entries(sources).reduce((sum, [name, count]) => {
    return (name === 'claude-code' || name === 'claude_code' || name === 'codex') ? sum : sum + (count || 0);
  }, 0);
  const total = claude + codex + other;
  if (total <= 0) return null;
  const deg = Math.round(-28 * (codex / total) + 14 * (other / total));
  return deg === 0 ? null : deg + 'deg';
}

function spreadSlots(count, min, max) {
  if (count <= 0) return [];
  if (count === 1) return [(min + max) / 2];
  const slots = [];
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    const wave = Math.sin(i * 1.7) * Math.min(0.026, 0.18 / count);
    slots.push(min + (max - min) * t + wave);
  }
  return slots;
}

function setInfoDetail(html) {
  const el = document.getElementById('garden-info-detail');
  if (el) el.innerHTML = html || '';
}

function setInfoSpark(dailyTokens) {
  const spark = document.getElementById('garden-info-spark');
  if (!spark) return;
  spark.innerHTML = dailyTokens ? sparklineSVG(dailyTokens, { days: 14, format: fmtLocal }) : '';
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}
