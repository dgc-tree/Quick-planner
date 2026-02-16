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

export function hasVisited() {
  return localStorage.getItem('qp-visited') === '1';
}

export function markVisited() {
  localStorage.setItem('qp-visited', '1');
}
