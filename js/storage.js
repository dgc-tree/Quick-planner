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

export function addToBin(task, reason = '') {
  const bin = loadBin();
  const entry = {
    task: JSON.parse(JSON.stringify(task, (k, v) => v instanceof Date ? v.toISOString() : v)),
    deletedAt: Date.now(),
  };
  if (reason) entry.deleteReason = reason;
  bin.push(entry);
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

const PROJECT_BIN_KEY = 'qp-project-bin';

export function loadProjectBin() {
  try {
    const raw = localStorage.getItem(PROJECT_BIN_KEY);
    if (!raw) return [];
    const bin = JSON.parse(raw);
    const cutoff = Date.now() - BIN_TTL_DAYS * 24 * 60 * 60 * 1000;
    return bin.filter(entry => entry.deletedAt > cutoff);
  } catch { return []; }
}

export function addProjectToBin(project) {
  const bin = loadProjectBin();
  bin.push({
    project: JSON.parse(JSON.stringify(project, (k, v) => v instanceof Date ? v.toISOString() : v)),
    deletedAt: Date.now(),
  });
  localStorage.setItem(PROJECT_BIN_KEY, JSON.stringify(bin));
}

export function restoreProjectFromBin(projectId) {
  const bin = loadProjectBin();
  const idx = bin.findIndex(e => e.project.id === projectId);
  if (idx === -1) return null;
  const [entry] = bin.splice(idx, 1);
  localStorage.setItem(PROJECT_BIN_KEY, JSON.stringify(bin));
  return entry.project;
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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function migrateToUUIDs() {
  if (localStorage.getItem('qp-uuid-migrated')) return;
  try {
    const raw = localStorage.getItem(PROJECTS_KEY);
    if (!raw) { localStorage.setItem('qp-uuid-migrated', '1'); return; }
    const projects = JSON.parse(raw);
    let changed = false;
    for (const project of projects) {
      if (!UUID_RE.test(project.id)) {
        const oldId = project.id;
        project.id = crypto.randomUUID();
        changed = true;
        // Update active project reference
        if (localStorage.getItem(ACTIVE_PROJECT_KEY) === String(oldId)) {
          localStorage.setItem(ACTIVE_PROJECT_KEY, project.id);
        }
      }
      if (Array.isArray(project.tasks)) {
        for (const task of project.tasks) {
          if (!UUID_RE.test(String(task.id))) {
            task.id = crypto.randomUUID();
            changed = true;
          }
          if (!task.updatedAt) {
            task.updatedAt = Date.now();
            changed = true;
          }
        }
      }
    }
    if (changed) {
      localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects, DATE_REPLACER));
    }
    localStorage.setItem('qp-uuid-migrated', '1');
  } catch (err) {
    console.warn('UUID migration failed:', err.message);
  }
}

function migrateCategoryRenames() {
  if (localStorage.getItem('qp-category-v1')) return;
  try {
    const raw = localStorage.getItem(PROJECTS_KEY);
    if (!raw) { localStorage.setItem('qp-category-v1', '1'); return; }
    const projects = JSON.parse(raw);
    let changed = false;
    for (const project of projects) {
      if (!Array.isArray(project.tasks)) continue;
      for (const task of project.tasks) {
        if (task.category === 'Buy new') {
          task.category = 'Major Projects';
          changed = true;
        }
      }
    }
    if (changed) {
      localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects, DATE_REPLACER));
    }
    localStorage.setItem('qp-category-v1', '1');
  } catch (err) {
    console.warn('Category migration failed:', err.message);
  }
}

function migrateAssignedToArray() {
  if (localStorage.getItem('qp-assigned-array-v1')) return;
  try {
    const raw = localStorage.getItem(PROJECTS_KEY);
    if (!raw) { localStorage.setItem('qp-assigned-array-v1', '1'); return; }
    const projects = JSON.parse(raw);
    let changed = false;
    for (const project of projects) {
      if (!Array.isArray(project.tasks)) continue;
      for (const task of project.tasks) {
        if (!Array.isArray(task.assigned)) {
          task.assigned = task.assigned ? [task.assigned] : [];
          changed = true;
        }
      }
    }
    if (changed) {
      localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects, DATE_REPLACER));
    }
    localStorage.setItem('qp-assigned-array-v1', '1');
  } catch (err) {
    console.warn('Assigned array migration failed:', err.message);
  }
}

export function runMigrations() {
  migrateToUUIDs();
  migrateCategoryRenames();
  migrateAssignedToArray();
}

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
  const id = localStorage.getItem(ACTIVE_PROJECT_KEY);
  return id === 'sheet' ? null : (id || null);
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

// Keys that must never be included in backup exports (security-sensitive)
const BACKUP_EXCLUDE = new Set(['qp-auth-token', 'qp-auth-user', 'qp-sandbox']);

export function exportBackup() {
  const data = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key.startsWith('qp-') && !BACKUP_EXCLUDE.has(key)) {
      data[key] = localStorage.getItem(key);
    }
  }
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
  a.href = url;
  a.download = `qp-backup-${stamp}.json`;
  a.click();
  URL.revokeObjectURL(url);
}


