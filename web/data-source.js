import { showErrorToast } from './error-toast.js';

function tauriApi() {
    return (typeof window !== 'undefined' && window.__TAURI__) ? window.__TAURI__ : null;
  }

export function isTauriRuntime() {
    return tauriApi() !== null;
  }

export async function loadSummary({ dataUrl }) {
    const api = tauriApi();
    if (api?.core?.invoke) {
      try {
        return await api.core.invoke('garden_summary');
      } catch (err) {
        logGardenError('garden_summary invoke failed', err);
        return null;
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

export function subscribeGardenUpdates(onSummary) {
    const api = tauriApi();
    if (!api?.event || typeof api.event.listen !== 'function') return;
    api.event
      .listen('garden:updated', (event) => onSummary(event.payload))
      .catch((err) => logGardenError('garden:updated listen failed', err));
  }

export function subscribeGardenScanning(onScanning) {
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
        motion: 'system'
      },
      data: {
        auto_rescan: true
      }
    };
  }

function normalizeSettings(value) {
    const base = defaultSettings();
    const appearance = value && typeof value.appearance === 'object' ? value.appearance : {};
    const data = value && typeof value.data === 'object' ? value.data : {};
    return {
      appearance: {
        time_mode: validChoice(appearance.time_mode, ['system', 'day', 'dusk', 'night'], base.appearance.time_mode),
        season_mode: validChoice(appearance.season_mode, ['system', 'spring', 'summer', 'autumn', 'winter'], base.appearance.season_mode),
        motion: validChoice(appearance.motion, ['system', 'reduced', 'off'], base.appearance.motion)
      },
      data: {
        auto_rescan: typeof data.auto_rescan === 'boolean' ? data.auto_rescan : base.data.auto_rescan
      }
    };
  }

function validChoice(value, allowed, fallback) {
    return allowed.includes(value) ? value : fallback;
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
