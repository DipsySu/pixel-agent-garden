import {
  loadSettings,
  loadSummary,
  subscribeGardenScanning,
  subscribeGardenUpdates,
  subscribeGardenErrors,
  logGardenError,
  openInTerminal
} from './data-source.js';
import { mountErrorToast } from './error-toast.js';
import { mountInsightPanel } from './insight-panel.js';
import { mountSettingsPanel } from './settings-panel.js';
import { mountPostcardExport } from './postcard.js';
import { mountReturnDiff } from './return-diff.js';
import { mountDashboardPanel } from './dashboard-panel.js';
import { renderHeatmap } from './render-heatmap.js';
import { groupSprites } from './render-helpers.js';
import { createGardenRenderer } from './render-garden.js';
import { renderBaseScene } from './render-svg.js';
import { renderIsoScene } from './render-iso.js';
import { applyStaticTranslations, currentLocale, setLocale } from './i18n.js';

const scene = document.getElementById('pg6-scene');
const assetRoot = window.__TAURI__ ? './assets' : '../assets';
const spriteRoot = assetRoot + '/sprites/';
const manifestUrl = spriteRoot + 'ivy_courtyard_manifest.json';
const dataUrl = './data/garden-summary.json';
// Which view is active: the flat side-elevation (render-svg.js) or the
// isometric 2.5D room (render-iso.js). Toggled by the header button + persisted
// to localStorage; `?iso=1` / `?iso=0` is a dev override that wins over the
// persisted choice. Browser fallback mode has no backend settings, so the
// view preference lives in localStorage rather than settings.toml.
const VIEW_STORE = 'pg6.view';
let isoView = (() => {
  try {
    const q = new URLSearchParams(window.location.search).get('iso');
    if (q === '1') return true;
    if (q === '0') return false;
    return window.localStorage && window.localStorage.getItem(VIEW_STORE) === 'iso';
  } catch (_) { return false; }
})();

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
  let currentSettings = withAppearanceOverrides(settings);
  let lastSummary = summary;
  const renderer = createGardenRenderer({
    scene,
    spriteRoot,
    isFlowerbedEnabled: () => shouldRenderFlowerbed(currentSettings),
  });
  // Single paint entry point so the initial render, settings re-paint, and
  // watcher tick all route through the same view branch.
  const paintScene = () => {
    if (isoView) {
      renderIsoScene(scene, assetRoot, {
        settings: currentSettings,
        groups,
        summary: lastSummary,
        spriteRoot,
      });
      return;
    }
    renderBaseScene(scene, assetRoot, {
      settings: currentSettings,
      flowerbedEnabled: shouldRenderFlowerbed(currentSettings),
    });
    renderer.renderEverything(groups, lastSummary);
  };
  paintScene();

  // View toggle (flat ↔ isometric). Shows the view it will switch TO, persists
  // the choice, and re-paints in place. Same pattern as the locale toggle but
  // without a reload — paintScene() rebuilds the scene for the chosen view.
  const viewToggle = document.getElementById('view-toggle');
  if (viewToggle) {
    const syncViewLabel = () => { viewToggle.textContent = isoView ? '2D' : '2.5D'; };
    syncViewLabel();
    viewToggle.addEventListener('click', () => {
      isoView = !isoView;
      try { window.localStorage && window.localStorage.setItem(VIEW_STORE, isoView ? 'iso' : 'flat'); } catch (_) { /* non-fatal */ }
      syncViewLabel();
      paintScene();
    });
  }

  const returnDiff = mountReturnDiff({
    hostFrame: document.querySelector('.pg6-frame'),
    initialSummary: lastSummary
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
    mountSettingsPanel({
      hostFooter: footer,
      initial: currentSettings,
      onChange: (next) => {
        currentSettings = next;
        // paintScene replaces scene.innerHTML and (flat view) rebuilds sprites.
        paintScene();
        insightPanel?.update(lastSummary);
        dashboardPanel?.update(lastSummary);
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
      paintScene();
    } else {
      renderer.showCached(lastSummary);
    }
    returnDiff?.record(lastSummary);
  });
}).catch((err) => {
  // Bootstrap failed (manifest fetch error, etc.). Best-effort: still paint
  // the base scene with default settings so the page doesn't sit blank with
  // dash placeholders. Sprites won't render — but at least there's a sky.
  logGardenError('garden bootstrap failed', err);
  try {
    renderBaseScene(scene, assetRoot, { settings: null });
  } catch (renderErr) {
    logGardenError('fallback base scene render failed', renderErr);
  }
});

// Flowerbed (D PoC) opt-in. Two ways to enable:
//   - persisted settings.appearance.flowerbed === 'enabled'
//   - URL `?flowerbed=enabled` override (lets reviewers preview without
//     touching their settings.toml)
// Returns boolean. Lives at module scope so renderEverything's
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

// Appearance overrides via URL query (mirrors ?flowerbed=) so a preview can be
// pinned to a time-of-day / season without persisted settings — handy for
// review + screenshots, e.g. `?time=day&season=summer`. Returns the settings
// unchanged when no recognized override is present.
function appearanceQueryOverride(key, allowed) {
  try {
    const value = (new URLSearchParams(window.location.search).get(key) || '').toLowerCase();
    return allowed.includes(value) ? value : null;
  } catch (_) {
    return null;
  }
}

function withAppearanceOverrides(settings) {
  const time = appearanceQueryOverride('time', ['system', 'day', 'dusk', 'night']);
  const season = appearanceQueryOverride('season', ['system', 'spring', 'summer', 'autumn', 'winter']);
  if (!time && !season) return settings;
  return {
    ...settings,
    appearance: {
      ...settings.appearance,
      ...(time ? { time_mode: time } : {}),
      ...(season ? { season_mode: season } : {})
    }
  };
}
