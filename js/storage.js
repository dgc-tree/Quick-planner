const STORAGE_KEY = 'qp-custom-colors';

export function loadCustomColors() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function saveCustomColors(colors) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(colors));
}

export function clearCustomColors() {
  localStorage.removeItem(STORAGE_KEY);
}

const USER_SWATCHES_KEY = 'qp-user-swatches';

export function loadUserSwatches() {
  try {
    const raw = localStorage.getItem(USER_SWATCHES_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveUserSwatches(swatches) {
  localStorage.setItem(USER_SWATCHES_KEY, JSON.stringify(swatches));
}

export function hasVisited() {
  return localStorage.getItem('qp-visited') === '1';
}

export function markVisited() {
  localStorage.setItem('qp-visited', '1');
}

const BG_EFFECTS_KEY = 'qp-bg-effects';

export function loadBgEffects() {
  try {
    const raw = localStorage.getItem(BG_EFFECTS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveBgEffects(cfg) {
  localStorage.setItem(BG_EFFECTS_KEY, JSON.stringify(cfg));
}
