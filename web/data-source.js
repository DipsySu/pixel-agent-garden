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

export function subscribeGardenUpdates(onSummary) {
    const api = tauriApi();
    if (!api?.event || typeof api.event.listen !== 'function') return;
    api.event
      .listen('garden:updated', (event) => onSummary(event.payload))
      .catch((err) => logGardenError('garden:updated listen failed', err));
  }

export function logGardenError(message, err) {
    if (typeof console !== 'undefined' && console.error) {
      console.error('[garden] ' + message, err);
    }
  }
