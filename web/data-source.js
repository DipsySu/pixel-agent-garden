import { showErrorToast } from './error-toast.js';

function tauriApi() {
    return (typeof window !== 'undefined' && window.__TAURI__) ? window.__TAURI__ : null;
  }

export function isTauriRuntime() {
    return tauriApi() !== null;
  }

/**
 * Demo mode (PRD 2.0 §P5-3): `?demo=1` pins the garden to the bundled sample
 * summary so the website "try it online" page — and a desktop app opened with
 * the same flag — render a mature canned garden instead of live local data.
 * This is THE single decision point for the summary source; callers must not
 * re-check the URL themselves.
 */
export function isDemoMode() {
    if (typeof window === 'undefined' || !window.location) return false;
    try {
      return new URLSearchParams(window.location.search).get('demo') === '1';
    } catch (_) {
      return false;
    }
  }

export async function loadSummary({ dataUrl }) {
    // Demo mode skips the backend entirely and falls through to the same
    // fetch path the browser fallback uses (web/data/garden-summary.json).
    if (!isDemoMode()) {
      const api = tauriApi();
      if (api?.core?.invoke) {
        try {
          return await api.core.invoke('garden_summary');
        } catch (err) {
          logGardenError('garden_summary invoke failed', err);
          return null;
        }
      }
    }
    try {
      const response = await fetch(dataUrl);
      return response.ok ? response.json() : null;
    } catch {
      return null;
    }
  }

export async function loadSettings() {
    const api = tauriApi();
    if (api?.core?.invoke) {
      try {
        return normalizeSettings(await api.core.invoke('get_settings'));
      } catch (err) {
        logGardenError('get_settings invoke failed', err);
      }
    }
    return defaultSettings();
  }

export async function loadRings() {
    // Demo gate (review finding): the canned garden must never surface the
    // user's REAL memory — a desktop app opened with ?demo=1 would otherwise
    // render real project names in the Rings tab while the scene shows the
    // sample. Same rule as loadSummary.
    if (isDemoMode()) return null;
    const api = tauriApi();
    if (!api?.core?.invoke) return null;
    try {
      return await api.core.invoke('garden_rings');
    } catch (err) {
      logGardenError('garden_rings invoke failed', err);
      return null;
    }
  }

export async function loadPrices() {
    // Demo gate: real prices.json is user data; demo mode shows the
    // unavailable state instead.
    if (isDemoMode()) return null;
    const api = tauriApi();
    if (!api?.core?.invoke) return null;
    try {
      return await api.core.invoke('load_prices');
    } catch (err) {
      logGardenError('load_prices invoke failed', err);
      return null;
    }
  }

/**
 * Persist settings. Returns the normalized value on success, null in browser
 * mode (no backend) or on failure. Callers use this to drive optimistic UI.
 */
export async function setSettings(value) {
    const api = tauriApi();
    if (!api?.core?.invoke) return null;
    const payload = normalizeSettings(value);
    try {
      const saved = await api.core.invoke('set_settings', { settings: payload });
      return normalizeSettings(saved);
    } catch (err) {
      logGardenError('set_settings invoke failed', err);
      return null;
    }
  }

/**
 * Open a project root in the user's configured terminal. No-op in browser
 * fallback mode (no backend). Returns true when the invoke was dispatched.
 */
export async function openInTerminal(path) {
    const api = tauriApi();
    if (!api?.core?.invoke) return false;
    if (!path) return false;
    try {
      await api.core.invoke('open_in_terminal', { path });
      return true;
    } catch (err) {
      logGardenError('open_in_terminal invoke failed', err);
      return false;
    }
  }

/**
 * Save a generated postcard image. Desktop uses the Rust save dialog command;
 * browser preview falls back to a normal user-initiated download link.
 */
export async function savePostcard(blob, suggestedName) {
    const api = tauriApi();
    if (api?.core?.invoke) {
      try {
        const bytes = Array.from(new Uint8Array(await blob.arrayBuffer()));
        return await api.core.invoke('save_postcard', { bytes, suggestedName });
      } catch (err) {
        logGardenError('save_postcard invoke failed', err);
        throw err;
      }
    }

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = suggestedName || 'garden-postcard.png';
    link.rel = 'noopener';
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    return true;
  }

export function subscribeGardenUpdates(onSummary) {
    // Demo mode shows a frozen sample; a live watcher push must not replace it.
    if (isDemoMode()) return;
    const api = tauriApi();
    if (!api?.event || typeof api.event.listen !== 'function') return;
    api.event
      .listen('garden:updated', (event) => onSummary(event.payload))
      .catch((err) => logGardenError('garden:updated listen failed', err));
  }

export function subscribeGardenScanning(onScanning) {
    // Demo mode never rescans — without this, a background scan would flip the
    // freshness pill to "Scanning..." and (updates being muted above) leave it
    // stuck there.
    if (isDemoMode()) return;
    const api = tauriApi();
    if (!api?.event || typeof api.event.listen !== 'function') return;
    api.event
      .listen('garden:scanning', (event) => onScanning(event.payload || {}))
      .catch((err) => logGardenError('garden:scanning listen failed', err));
  }

/**
 * Subscribe to backend `garden:error` events and forward them to the toast
 * layer. Safe to call in browser mode — it's a no-op there.
 */
export function subscribeGardenErrors() {
    const api = tauriApi();
    if (!api?.event || typeof api.event.listen !== 'function') return;
    api.event
      .listen('garden:error', (event) => {
        const payload = event.payload || {};
        showErrorToast({
          source: payload.source || 'backend',
          message: payload.message || 'Unknown backend error'
        });
      })
      .catch((err) => logGardenError('garden:error listen failed', err));
  }

function defaultSettings() {
    return {
      appearance: {
        time_mode: 'system',
        season_mode: 'system',
        motion: 'system',
        flowerbed: 'disabled'
      },
      data: {
        auto_rescan: true
      },
      integrations: {
        terminal: 'iterm',
        terminal_command: '',
        tray_top_n: 5
      },
      desktop: {
        launch_at_login: false,
        close_to_tray: false
      }
    };
  }

function normalizeSettings(value) {
    const base = defaultSettings();
    const appearance = value && typeof value.appearance === 'object' ? value.appearance : {};
    const data = value && typeof value.data === 'object' ? value.data : {};
    // Preserve integrations verbatim (terminal launcher config). The settings
    // UI doesn't edit these yet, so we must round-trip them untouched —
    // dropping the section would reset the user's terminal choice on every save.
    const integrations = value && typeof value.integrations === 'object' ? value.integrations : {};
    const desktop = value && typeof value.desktop === 'object' ? value.desktop : {};
    return {
      appearance: {
        time_mode: validChoice(appearance.time_mode, ['system', 'day', 'dusk', 'night'], base.appearance.time_mode),
        season_mode: validChoice(appearance.season_mode, ['system', 'spring', 'summer', 'autumn', 'winter'], base.appearance.season_mode),
        motion: validChoice(appearance.motion, ['system', 'reduced', 'off'], base.appearance.motion),
        flowerbed: validChoice(appearance.flowerbed, ['enabled', 'disabled'], base.appearance.flowerbed)
      },
      data: {
        auto_rescan: typeof data.auto_rescan === 'boolean' ? data.auto_rescan : base.data.auto_rescan
      },
      integrations: {
        terminal: validChoice(integrations.terminal, ['system', 'iterm', 'warp', 'custom'], base.integrations.terminal),
        terminal_command: typeof integrations.terminal_command === 'string' ? integrations.terminal_command : base.integrations.terminal_command,
        tray_top_n: validPositiveInteger(integrations.tray_top_n, base.integrations.tray_top_n)
      },
      desktop: {
        launch_at_login: typeof desktop.launch_at_login === 'boolean' ? desktop.launch_at_login : base.desktop.launch_at_login,
        close_to_tray: typeof desktop.close_to_tray === 'boolean' ? desktop.close_to_tray : base.desktop.close_to_tray
      }
    };
  }

function validChoice(value, allowed, fallback) {
    return allowed.includes(value) ? value : fallback;
  }

function validPositiveInteger(value, fallback) {
    return Number.isInteger(value) && value > 0 ? value : fallback;
  }

export function logGardenError(message, err) {
    if (typeof console !== 'undefined' && console.error) {
      console.error('[garden] ' + message, err);
    }
    // Also surface to the toast so users see something went wrong instead of
    // having to open the devtools. `source` doubles as the dedupe key — bursts
    // from the same call site collapse into a single toast.
    const detail = err && err.message ? err.message : (err ? String(err) : '');
    showErrorToast({
      source: deriveToastSource(message),
      message: detail ? message + ' — ' + detail : message
    });
  }

function deriveToastSource(message) {
    if (!message) return 'error';
    const m = String(message);
    if (m.includes('garden_summary')) return 'scan';
    if (m.includes('settings')) return 'settings';
    if (m.includes('listen')) return 'events';
    if (m.includes('bootstrap')) return 'startup';
    return 'error';
  }
