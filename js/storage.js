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

const BIN_KEY = 'qp-bin';
const BIN_TTL_DAYS = 30;

export function loadBin() {
  try {
    const raw = localStorage.getItem(BIN_KEY);
    if (!raw) return [];
    const bin = JSON.parse(raw);
    const cutoff = Date.now() - BIN_TTL_DAYS * 24 * 60 * 60 * 1000;
    return bin.filter(entry => entry.deletedAt > cutoff);
  } catch { return []; }
}

export function addToBin(task) {
  const bin = loadBin();
  bin.push({ task: JSON.parse(JSON.stringify(task, (k, v) => v instanceof Date ? v.toISOString() : v)), deletedAt: Date.now() });
  localStorage.setItem(BIN_KEY, JSON.stringify(bin));
}

export function restoreFromBin(taskName) {
  const bin = loadBin();
  const idx = bin.findIndex(e => e.task.task === taskName);
  if (idx === -1) return null;
  const [entry] = bin.splice(idx, 1);
  localStorage.setItem(BIN_KEY, JSON.stringify(bin));
  return entry.task;
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

const PROJECTS_KEY = 'qp-projects';
const ACTIVE_PROJECT_KEY = 'qp-active-project';
const DATE_REPLACER = (k, v) => v instanceof Date ? v.toISOString() : v;

export function loadProjects() {
  try {
    const raw = localStorage.getItem(PROJECTS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

export function saveProjects(arr) {
  localStorage.setItem(PROJECTS_KEY, JSON.stringify(arr, DATE_REPLACER));
}

export function loadActiveProjectId() {
  return localStorage.getItem(ACTIVE_PROJECT_KEY) || 'sheet';
}

export function saveActiveProjectId(id) {
  if (id == null) {
    localStorage.removeItem(ACTIVE_PROJECT_KEY);
  } else {
    localStorage.setItem(ACTIVE_PROJECT_KEY, id);
  }
}

export function saveProjectTasks(id, tasks) {
  const projects = loadProjects();
  const idx = projects.findIndex(p => p.id === id);
  if (idx === -1) return;
  projects[idx].tasks = JSON.parse(JSON.stringify(tasks, DATE_REPLACER));
  localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects));
}

export function loadUserName() {
  return localStorage.getItem('qp-user-name') || '';
}

export function saveUserName(name) {
  localStorage.setItem('qp-user-name', name);
}

const COLUMN_COLORS_KEY = 'qp-column-colors';

export function loadColumnColors() {
  try {
    const raw = localStorage.getItem(COLUMN_COLORS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

export function saveColumnColors(colors) {
  localStorage.setItem(COLUMN_COLORS_KEY, JSON.stringify(colors));
}
