import { createClassicWallRenderer } from './classic-wall-renderer.js';
import { createIsometricRenderer } from './isometric-renderer.js';

const STORAGE_KEY = 'pg6.renderer';

export function createSceneRenderer(options) {
  const mode = normalizeRendererMode(options.mode);
  if (mode === 'isometric') return createIsometricRenderer(options);
  return createClassicWallRenderer(options);
}

export function rendererModeFromLocation(location = window.location) {
  try {
    const value = new URLSearchParams(location.search).get('renderer');
    if (isRendererMode(value)) return value;
  } catch (_) {
    // Fall through to persisted/default mode.
  }
  return rendererModeFromStorage() || defaultRendererMode();
}

export function rendererModeFromStorage(storage = safeStorage()) {
  try {
    const value = storage?.getItem(STORAGE_KEY);
    return isRendererMode(value) ? value : null;
  } catch (_) {
    return null;
  }
}

export function persistRendererMode(value, storage = safeStorage()) {
  const mode = normalizeRendererMode(value);
  try {
    storage?.setItem(STORAGE_KEY, mode);
  } catch (_) {
    // Storage is best-effort only; renderer switching must still work.
  }
  return mode;
}

export function nextRendererMode(value) {
  return normalizeRendererMode(value) === 'isometric' ? 'classic' : 'isometric';
}

export function normalizeRendererMode(value) {
  return value === 'isometric' ? 'isometric' : 'classic';
}

function isRendererMode(value) {
  return value === 'classic' || value === 'isometric';
}

function defaultRendererMode() {
  // Tauri cannot easily receive `?renderer=isometric` from tauri.conf when using
  // frontendDist. On this experimental branch, default desktop dev sessions to
  // the 2.5D renderer while browser fallback stays on the stable wall view.
  return typeof window !== 'undefined' && window.__TAURI__ ? 'isometric' : 'classic';
}

function safeStorage() {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch (_) {
    return null;
  }
}
