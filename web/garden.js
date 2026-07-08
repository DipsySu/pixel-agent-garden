import {
  isDemoMode,
  loadCostEstimate,
  loadRings,
  loadSettings,
  loadSummary,
  saveExportText,
  subscribeGardenScanning,
  subscribeGardenUpdates,
  subscribeGardenErrors,
  logGardenError,
  openInTerminal
} from './data-source.js';
import { mountEmptyState } from './empty-state.js';
import { isAgentNurseryEnabled, mountAgentNursery, nurseryQueryOverride } from './agent-nursery.js';
import { mountErrorToast } from './error-toast.js';
import { mountScanCurtain } from './scan-curtain.js';
import { runGrowthReveal } from './first-run.js';
import { mountDataDrawer } from './data-drawer.js';
import { mountSettingsPanel } from './settings-panel.js';
import { mountShareDrawer } from './share-drawer.js';
import { recordSeasonalOffer, shouldOfferSeasonalMoment } from './seasonal-card.js';
import { recordWeeklyOffer, shouldOfferWeeklyRecap } from './weekly-card.js';
import { recordYearOffer, shouldOfferYearReview } from './year-card.js';
import { mountReturnDiff } from './return-diff.js';
import { mountSceneBanner } from './scene-banner.js';
import { mountUnlockMoments, pulseMomentTarget } from './unlock-moments.js';
import { unlockTier } from './garden-tiers.js';
import { renderHeatmap } from './render-heatmap.js';
import { groupSprites } from './render-helpers.js';
import {
  createSceneRenderer,
  nextRendererMode,
  persistRendererMode,
  rendererModeFromLocation
} from './renderers/renderer-factory.js';
import { applyStaticTranslations, currentLocale, setLocale, t } from './i18n.js';

const scene = document.getElementById('pg6-scene');
const assetRoot = window.__TAURI__ ? './assets' : '../assets';
const spriteRoot = assetRoot + '/sprites/';
const manifestUrl = spriteRoot + 'ivy_courtyard_manifest.json';
const dataUrl = './data/garden-summary.json';

applyStaticTranslations();

// Locale toggle: the button shows the language you'd switch TO (zh UI → "EN",
// en UI → "中"). Persisting + reloading is the simplest correct way to re-render
// every already-built string (the scene SVG, panels, chips) in the new locale.
{
  const localeToggle = document.getElementById('locale-toggle');
  if (localeToggle) {
    localeToggle.textContent = currentLocale() === 'zh' ? 'EN' : '中';
    localeToggle.addEventListener('click', () => {
      setLocale(currentLocale() === 'zh' ? 'en' : 'zh');
      window.location.reload();
    });
  }
}

// Wire the toast layer + backend error stream before kicking off any IO,
// so an early failure (manifest fetch, settings invoke) still surfaces.
mountErrorToast();
subscribeGardenErrors();

// Armed BEFORE the summary promise: a cold multi-GB first scan can take tens
// of seconds, and the curtain is the only thing standing between the stranger
// install test and a black screen (I9). Warm paths never see it.
const scanCurtain = mountScanCurtain({ host: scene });

Promise.all([
  fetch(manifestUrl).then((response) => response.json()),
  loadSummary({ dataUrl }),
  loadSettings()
]).then(([manifest, summary, settings]) => {
  const groups = groupSprites(manifest.sprites || []);
  // Two summary frames on purpose (review finding): `latestSummary` is
  // whatever the watcher last delivered; `visibleSummary` is the frame the
  // user actually SEES. With auto_rescan off the two diverge — every paint
  // path below must use `visibleSummary`, otherwise a settings tweak or a
  // renderer switch would silently leak paused data onto the screen.
  // Re-enabling auto_rescan folds latest back into visible.
  let currentSettings = settings;
  let visibleSummary = summary;
  let latestSummary = summary;
  let rendererMode = rendererModeFromLocation();
  let renderer = createRenderer(rendererMode);
  renderer.paint(groups, visibleSummary, currentSettings);
  const agentNursery = mountAgentNursery({ host: scene });
  updateAgentNursery();
  scanCurtain.hide();
  // P5-2 wood sign — mounted on the scene host (renderer-agnostic) and
  // refreshed alongside every paint below, since base paints wipe the scene.
  const emptyState = mountEmptyState({ host: scene });
  emptyState.update(visibleSummary);
  applyDemoFreshness();
  const returnDiff = mountReturnDiff({
    hostFrame: document.querySelector('.pg6-frame'),
    initialSummary: visibleSummary
  });

  // Unlock moments (P1-2): celebrate tier changes against the last frame the
  // user actually SAW. Scene-overlay only — nothing is wired into the
  // renderers. The subscribe hook hands the module the initial summary (this
  // is the whole story in browser fallback mode, which never gets watcher
  // events) and registers for later frames; those are fed below inside the
  // same auto_rescan gate as the panels, because a paused garden keeps
  // showing the cached frame and must not celebrate tiers it isn't showing.
  // Demo mode shows a frozen canned garden: diffing it against the user's
  // REAL last-seen frame would both fire fake banners and overwrite the real
  // `pg6.seen.tiers` with demo tiers, poisoning the next live session
  // (review finding). No banner, no moments, no seen-frame writes.
  let sceneBanner = null;
  let onVisibleFrame = null;
  if (!isDemoMode()) {
    sceneBanner = mountSceneBanner({ host: scene });
    mountUnlockMoments({
      banner: sceneBanner,
      getTiers: (summary) => unlockTier(summary, summary?.projects || []),
      subscribe: (onSummary) => {
        onVisibleFrame = onSummary;
        if (visibleSummary) onSummary(visibleSummary);
      },
      onFocus: (moment) => pulseMomentTarget(scene, moment)
    });
  }

  // I9 growth reveal — staged AFTER the first paint so every bucket has real
  // elements. Resolves once (finished or skipped); the welcome banner rides
  // the same queue as unlock moments, and demo mode (sceneBanner = null)
  // simply shows the reveal without a banner.
  runGrowthReveal({ scene, summary: visibleSummary }).then(({ ran }) => {
    if (ran) sceneBanner?.push({ icon: '', text: t('firstrun.welcome') });
  });

  // Settings panel — drives both live-apply (scene re-paint) and persistence.
  // Footer is the host; the panel inserts itself after the footer in the same
  // parent (the frame), so it sits flush with footer content.
  const footer = document.querySelector('.pg6-footer');
  let dataDrawer = null;
  let shareDrawer = null;
  if (footer) {
    // Data drawer (PRD 2.0 §8.1): the single footer entry for the former
    // Insight + Dashboard panels, now the Projects / Overview tabs.
    dataDrawer = mountDataDrawer({
      hostFooter: footer,
      initialSummary: visibleSummary,
      onProjectSelect: (projectKey) => renderer.selectProjectByKey(projectKey),
      onOpenTerminal: (path) => openInTerminal(path),
      loadCostEstimate,
      loadRings,
      saveExportText,
      onError: logGardenError
    });
    mountRendererToggle({
      hostFooter: footer,
      initialMode: rendererMode,
      onChange: (nextMode) => {
        rendererMode = persistRendererMode(nextMode);
        renderer.destroy?.();
        renderer = createRenderer(rendererMode);
        renderer.paint(groups, visibleSummary, currentSettings);
        updateAgentNursery();
        dataDrawer?.update(visibleSummary);
        miniStrip?._redraw?.(visibleSummary);
        emptyState.update(visibleSummary);
        applyDemoFreshness();
      }
    });
    mountSettingsPanel({
      hostFooter: footer,
      initial: currentSettings,
      onChange: (next) => {
        // Turning auto_rescan back ON is the moment the pause ends: fold the
        // watcher's latest frame into the visible one BEFORE repainting, so
        // the user re-enters live data deliberately rather than a settings
        // tweak leaking it mid-pause.
        const resumed = !currentSettings.data.auto_rescan && next.data.auto_rescan;
        currentSettings = next;
        if (resumed) visibleSummary = latestSummary;
        renderer.paint(groups, visibleSummary, currentSettings);
        updateAgentNursery();
        dataDrawer?.update(visibleSummary);
        emptyState.update(visibleSummary);
        if (resumed) {
          miniStrip?._redraw?.(visibleSummary);
          onVisibleFrame?.(visibleSummary);
        }
        applyDemoFreshness();
      }
    });
    // Share drawer (PRD 2.0 §5.3 / §P3-1): the old Postcard button's slot,
    // now one entry for every share artifact (postcard + weekly recap).
    shareDrawer = mountShareDrawer({
      scene,
      assetRoot,
      getSummary: () => visibleSummary,
      onError: logGardenError
    });
  }

  // P3-1 Monday offer — trigger LOCAL, statistics window UTC (the 边界契约
  // in docs/22 §P3-1; the split lives in weekly-card.js). Ritual rules:
  // setting-gated, at most once per week (localStorage Monday key), silent
  // on zero-token weeks. Demo mode never offers — sceneBanner is null there,
  // which also keeps the canned garden from writing real offer flags.
  if (sceneBanner && shareDrawer && currentSettings.data.weekly_recap) {
    const offerKey = shouldOfferWeeklyRecap({
      summary: visibleSummary,
      storage: window.localStorage
    });
    if (offerKey) {
      sceneBanner.push({
        icon: '🖼',
        text: t('share.weekly.offer'),
        onActivate: () => shareDrawer?.open('weekly')
      });
      recordWeeklyOffer(offerKey, window.localStorage);
    }
  }

  // P3-2 seasonal moment — same interaction shape as the weekly ritual, but
  // season-scoped instead of week-scoped. Trigger is local calendar; stats are
  // still UTC day keys through seasonal-card.js. No setting yet: it is a quiet
  // one-shot banner per active season, and demo mode never reaches this block
  // because sceneBanner is null.
  if (sceneBanner && shareDrawer) {
    const seasonalOffer = shouldOfferSeasonalMoment({
      summary: visibleSummary,
      storage: window.localStorage
    });
    if (seasonalOffer) {
      sceneBanner.push({
        icon: '◈',
        text: t('share.seasonal.offer', { season: seasonalOffer.label }),
        onActivate: () => shareDrawer?.open('seasonal')
      });
      recordSeasonalOffer(seasonalOffer.key, window.localStorage);
    }
  }

  // P3-3 annual ritual — manual Year Review stays available all year, but the
  // first local week of December gets one banner if the year has any activity.
  if (sceneBanner && shareDrawer) {
    const yearOffer = shouldOfferYearReview({
      summary: visibleSummary,
      storage: window.localStorage
    });
    if (yearOffer) {
      sceneBanner.push({
        icon: '▦',
        text: t('share.year.offer', { year: yearOffer.range.year }),
        onActivate: () => shareDrawer?.open('year')
      });
      recordYearOffer(yearOffer.key, window.localStorage);
    }
  }

  // Mini heatmap strip — ambient ground-floor view of the year's activity.
  // Clicking anywhere on it opens the data drawer on the Overview tab (the
  // former Dashboard content).
  const miniStrip = document.getElementById('mini-heatmap-strip');
  if (miniStrip) {
    const drawMini = (summary) => {
      renderHeatmap(miniStrip, summary?.heatmap_year || [], {
        mode: 'mini',
        onClickAny: () => dataDrawer?.open('overview'),
      });
    };
    drawMini(visibleSummary);
    // Stash the drawer so the watcher path below can re-call it without
    // recapturing references.
    miniStrip._redraw = drawMini;
  }

  // Watcher updates: always subscribe (cheap), gate re-render on auto_rescan
  // so the user can toggle it from the panel without restart ceremony.
  subscribeGardenScanning(() => {
    renderer.showScanning();
  });
  subscribeGardenUpdates((summary) => {
    latestSummary = summary;
    // auto_rescan off = the user paused live updates. Keep EVERY view on the
    // VISIBLE frame — the scene, the mini-heatmap strip, AND both tabs of the
    // data drawer — not just the scene; only the latest-frame ledger
    // advances. returnDiff still records the real latest summary below so the
    // "while you were away" diff stays truthful regardless of the pause.
    if (currentSettings.data.auto_rescan) {
      visibleSummary = summary;
      dataDrawer?.update(visibleSummary);
      miniStrip?._redraw?.(visibleSummary);
      renderer.repaintData(groups, visibleSummary);
      updateAgentNursery();
      // Sign tracks the rendered frame: when paused (else branch) the scene
      // stays on the cached frame, so the sign must stay in step with it too.
      emptyState.update(visibleSummary);
      // After repaint on purpose: the isometric renderer rebuilds the scene's
      // children on paint, and a banner pushed first would be wiped mid-rise.
      onVisibleFrame?.(visibleSummary);
    } else {
      renderer.showCached(visibleSummary);
    }
    returnDiff?.record(latestSummary);
  });

  function createRenderer(mode) {
    return createSceneRenderer({
      mode,
      scene,
      assetRoot,
      spriteRoot,
      isFlowerbedEnabled: () => shouldRenderFlowerbed(currentSettings),
    });
  }

  function updateAgentNursery() {
    agentNursery.update(visibleSummary, {
      enabled: isAgentNurseryEnabled(currentSettings),
    });
  }
}).catch((err) => {
  // Bootstrap failed (manifest fetch error, etc.). Best-effort: still paint
  // the base scene with default settings so the page doesn't sit blank with
  // dash placeholders. Sprites won't render — but at least there's a sky.
  logGardenError('garden bootstrap failed', err);
  try {
    const fallback = createSceneRenderer({
      mode: 'classic',
      scene,
      assetRoot,
      spriteRoot,
      isFlowerbedEnabled: () => false,
    });
    fallback.renderBase(null);
  } catch (renderErr) {
    logGardenError('fallback base scene render failed', renderErr);
  }
});

// Demo mode (?demo=1): both renderers stamp the freshness pill from
// summary.last_seen on every paint, which would present the bundled sample as
// live (or stale) local data. Rather than teaching each renderer about demo
// mode, rewrite the pill right after the synchronous paint calls — watcher
// events are already muted in demo mode (data-source.js), so nothing
// overwrites this label afterwards.
function applyDemoFreshness() {
  if (!isDemoMode()) return;
  const el = document.getElementById('data-freshness');
  if (!el) return;
  el.textContent = t('fresh.demo');
  el.classList.remove('is-scanning', 'is-stale', 'is-paused');
  el.classList.add('is-demo');
  el.removeAttribute('title');
}

// Flowerbed / Agent nursery opt-in. Three ways to enable:
//   - persisted settings.appearance.flowerbed === 'enabled'
//   - URL `?flowerbed=enabled` override (lets reviewers preview without
//     touching their settings.toml)
//   - URL `?nursery=1`, which opens the P2 nursery overlay and should show the
//     matching flowerbed base unless `?flowerbed=disabled` explicitly wins
// Returns boolean. Lives at module scope so the renderer's flowerbed getter
// `isFlowerbedEnabled` getter always reads the live currentSettings.
function shouldRenderFlowerbed(settings) {
  const override = flowerbedQueryOverride();
  if (override !== null) return override;
  if (nurseryQueryOverride() === true) return true;
  return settings?.appearance?.flowerbed === 'enabled';
}

function flowerbedQueryOverride() {
  try {
    const value = (new URLSearchParams(window.location.search).get('flowerbed') || '').toLowerCase();
    if (!value) return null;
    if (['1', 'true', 'enabled', 'on'].includes(value)) return true;
    if (['0', 'false', 'disabled', 'off'].includes(value)) return false;
  } catch (_) {
    return null;
  }
  return null;
}

function mountRendererToggle({ hostFooter, initialMode, onChange }) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'pg6-footer-insight pg6-footer-renderer';
  let current = initialMode === 'isometric' ? 'isometric' : 'classic';
  sync();
  button.addEventListener('click', () => {
    current = nextRendererMode(current);
    sync();
    onChange(current);
  });
  hostFooter.appendChild(button);

  function sync() {
    const isIso = current === 'isometric';
    button.textContent = isIso ? 'Wall' : '2.5D';
    button.title = isIso ? 'Switch to classic wall renderer' : 'Switch to 2.5D courtyard renderer';
    button.setAttribute('aria-label', button.title);
    button.setAttribute('aria-pressed', String(isIso));
    button.classList.toggle('is-active', isIso);
  }
}
