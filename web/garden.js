import {
  isDemoMode,
  loadSettings,
  loadSummary,
  subscribeGardenScanning,
  subscribeGardenUpdates,
  subscribeGardenErrors,
  logGardenError,
  openInTerminal
} from './data-source.js';
import { mountEmptyState } from './empty-state.js';
import { mountErrorToast } from './error-toast.js';
import { mountInsightPanel } from './insight-panel.js';
import { mountSettingsPanel } from './settings-panel.js';
import { mountPostcardExport } from './postcard.js';
import { mountReturnDiff } from './return-diff.js';
import { mountDashboardPanel } from './dashboard-panel.js';
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

Promise.all([
  fetch(manifestUrl).then((response) => response.json()),
  loadSummary({ dataUrl }),
  loadSettings()
]).then(([manifest, summary, settings]) => {
  const groups = groupSprites(manifest.sprites || []);
  // Hold the latest summary + settings so the watcher-driven re-render and the
  // settings panel both pick up whichever changed last.
  let currentSettings = settings;
  let lastSummary = summary;
  let rendererMode = rendererModeFromLocation();
  let renderer = createRenderer(rendererMode);
  renderer.paint(groups, lastSummary, currentSettings);
  // P5-2 wood sign — mounted on the scene host (renderer-agnostic) and
  // refreshed alongside every paint below, since base paints wipe the scene.
  const emptyState = mountEmptyState({ host: scene });
  emptyState.update(lastSummary);
  applyDemoFreshness();
  const returnDiff = mountReturnDiff({
    hostFrame: document.querySelector('.pg6-frame'),
    initialSummary: lastSummary
  });

  // Unlock moments (P1-2): celebrate tier changes against the last frame the
  // user actually SAW. Scene-overlay only — nothing is wired into the
  // renderers. The subscribe hook hands the module the initial summary (this
  // is the whole story in browser fallback mode, which never gets watcher
  // events) and registers for later frames; those are fed below inside the
  // same auto_rescan gate as the panels, because a paused garden keeps
  // showing the cached frame and must not celebrate tiers it isn't showing.
  const sceneBanner = mountSceneBanner({ host: scene });
  let onVisibleFrame = null;
  mountUnlockMoments({
    banner: sceneBanner,
    getTiers: (summary) => unlockTier(summary, summary?.projects || []),
    subscribe: (onSummary) => {
      onVisibleFrame = onSummary;
      if (lastSummary) onSummary(lastSummary);
    },
    onFocus: (moment) => pulseMomentTarget(scene, moment)
  });

  // Settings panel — drives both live-apply (scene re-paint) and persistence.
  // Footer is the host; the panel inserts itself after the footer in the same
  // parent (the frame), so it sits flush with footer content.
  const footer = document.querySelector('.pg6-footer');
  let insightPanel = null;
  let dashboardPanel = null;
  if (footer) {
    insightPanel = mountInsightPanel({
      hostFooter: footer,
      initialSummary: lastSummary,
      onProjectSelect: (projectKey) => renderer.selectProjectByKey(projectKey),
      onOpenTerminal: (path) => openInTerminal(path)
    });
    dashboardPanel = mountDashboardPanel({
      hostFooter: footer,
      initialSummary: lastSummary
    });
    mountRendererToggle({
      hostFooter: footer,
      initialMode: rendererMode,
      onChange: (nextMode) => {
        rendererMode = persistRendererMode(nextMode);
        renderer.destroy?.();
        renderer = createRenderer(rendererMode);
        renderer.paint(groups, lastSummary, currentSettings);
        insightPanel?.update(lastSummary);
        dashboardPanel?.update(lastSummary);
        miniStrip?._redraw?.(lastSummary);
        emptyState.update(lastSummary);
        applyDemoFreshness();
      }
    });
    mountSettingsPanel({
      hostFooter: footer,
      initial: currentSettings,
      onChange: (next) => {
        currentSettings = next;
        renderer.paint(groups, lastSummary, currentSettings);
        insightPanel?.update(lastSummary);
        dashboardPanel?.update(lastSummary);
        emptyState.update(lastSummary);
        applyDemoFreshness();
      }
    });
    mountPostcardExport({
      scene,
      assetRoot,
      getSummary: () => lastSummary,
      onError: logGardenError
    });
  }

  // Mini heatmap strip — ambient ground-floor view of the year's activity.
  // Clicking anywhere on it opens the full Dashboard panel.
  const miniStrip = document.getElementById('mini-heatmap-strip');
  if (miniStrip) {
    const drawMini = (summary) => {
      renderHeatmap(miniStrip, summary?.heatmap_year || [], {
        mode: 'mini',
        onClickAny: () => dashboardPanel?.open(),
      });
    };
    drawMini(lastSummary);
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
    lastSummary = summary;
    // auto_rescan off = the user paused live updates. Keep EVERY view on the
    // cached frame — the scene, the mini-heatmap strip, the dashboard, AND the
    // insight panel — not just the scene. Updating the year-views while the
    // garden stays cached made the two diverge (heatmap showed today, flowers
    // showed yesterday). returnDiff still records the real latest summary below
    // so the "while you were away" diff stays truthful regardless of the pause.
    if (currentSettings.data.auto_rescan) {
      insightPanel?.update(lastSummary);
      dashboardPanel?.update(lastSummary);
      miniStrip?._redraw?.(lastSummary);
      renderer.repaintData(groups, lastSummary);
      // Sign tracks the rendered frame: when paused (else branch) the scene
      // stays on the cached frame, so the sign must stay in step with it too.
      emptyState.update(lastSummary);
      // After repaint on purpose: the isometric renderer rebuilds the scene's
      // children on paint, and a banner pushed first would be wiped mid-rise.
      onVisibleFrame?.(lastSummary);
    } else {
      renderer.showCached(lastSummary);
    }
    returnDiff?.record(lastSummary);
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

// Flowerbed (D PoC) opt-in. Two ways to enable:
//   - persisted settings.appearance.flowerbed === 'enabled'
//   - URL `?flowerbed=enabled` override (lets reviewers preview without
//     touching their settings.toml)
// Returns boolean. Lives at module scope so the renderer's flowerbed getter
// `isFlowerbedEnabled` getter always reads the live currentSettings.
function shouldRenderFlowerbed(settings) {
  const override = flowerbedQueryOverride();
  if (override !== null) return override;
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
