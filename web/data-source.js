function tauriApi() {
    return (typeof window !== 'undefined' && window.__TAURI__) ? window.__TAURI__ : null;
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

export function subscribeGardenUpdates(onSummary) {
    const api = tauriApi();
    if (!api?.event || typeof api.event.listen !== 'function') return;
    api.event
      .listen('garden:updated', (event) => onSummary(event.payload))
      .catch((err) => logGardenError('garden:updated listen failed', err));
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
  }
