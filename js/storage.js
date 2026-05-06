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

function loadBinAll() {
  try {
    const raw = localStorage.getItem(BIN_KEY);
    if (!raw) return [];
    const bin = JSON.parse(raw);
    const cutoff = Date.now() - BIN_TTL_DAYS * 24 * 60 * 60 * 1000;
    return bin.filter(entry => entry.deletedAt > cutoff);
  } catch { return []; }
}

export function loadBin(projectId = null) {
  const bin = loadBinAll();
  if (projectId == null) return bin;
  return bin.filter(e => e.projectId === projectId);
}

export function addToBin(task, reason = '', projectId = null) {
  const bin = loadBinAll();
  const entry = {
    task: JSON.parse(JSON.stringify(task, (k, v) => v instanceof Date ? v.toISOString() : v)),
    deletedAt: Date.now(),
  };
  if (reason) entry.deleteReason = reason;
  if (projectId) entry.projectId = projectId;
  bin.push(entry);
  localStorage.setItem(BIN_KEY, JSON.stringify(bin));
}

export function restoreFromBin(taskName, projectId = null) {
  const bin = loadBinAll();
  const idx = bin.findIndex(e =>
    e.task.task === taskName && (projectId == null || e.projectId === projectId)
  );
  if (idx === -1) return null;
  const [entry] = bin.splice(idx, 1);
  localStorage.setItem(BIN_KEY, JSON.stringify(bin));
  return entry.task;
}

export function migrateBinToProjectScope(activeProjectId) {
  if (localStorage.getItem('qp-bin-projectid-v1')) return;
  if (!activeProjectId) return;
  try {
    const raw = localStorage.getItem(BIN_KEY);
    if (raw) {
      const bin = JSON.parse(raw);
      let changed = false;
      for (const entry of bin) {
        if (!entry.projectId) {
          entry.projectId = activeProjectId;
          changed = true;
        }
      }
      if (changed) localStorage.setItem(BIN_KEY, JSON.stringify(bin));
    }
    localStorage.setItem('qp-bin-projectid-v1', '1');
  } catch (err) {
    console.warn('Bin projectId migration failed:', err.message);
  }
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

function migrateMembers() {
  if (localStorage.getItem('qp-members-v1')) return;
  try {
    const raw = localStorage.getItem(PROJECTS_KEY);
    if (!raw) { localStorage.setItem('qp-members-v1', '1'); return; }
    const projects = JSON.parse(raw);

    // Build per-project canonical member list (case-fold dedupe; canonical
    // casing = most frequent occurrence, ties broken by first-seen).
    for (const project of projects) {
      const counts = new Map();
      const variants = new Map();
      let order = 0;
      const firstOrder = new Map();
      const visit = (name) => {
        const trimmed = String(name == null ? '' : name).trim();
        if (!trimmed) return;
        const key = trimmed.toLowerCase();
        counts.set(key, (counts.get(key) || 0) + 1);
        if (!variants.has(key)) variants.set(key, new Map());
        const vmap = variants.get(key);
        vmap.set(trimmed, (vmap.get(trimmed) || 0) + 1);
        if (!firstOrder.has(key)) firstOrder.set(key, order++);
      };
      for (const t of (project.tasks || [])) {
        const arr = Array.isArray(t.assigned) ? t.assigned : (t.assigned ? [t.assigned] : []);
        for (const n of arr) visit(n);
      }
      // Pick canonical casing per key
      const canonicalByKey = new Map();
      for (const [key, vmap] of variants) {
        let bestVariant = null, bestCount = -1;
        for (const [v, c] of vmap) {
          if (c > bestCount) { bestCount = c; bestVariant = v; }
        }
        canonicalByKey.set(key, bestVariant);
      }
      const members = [...counts.keys()]
        .sort((a, b) => firstOrder.get(a) - firstOrder.get(b))
        .map(key => ({ name: canonicalByKey.get(key) }));
      project.members = members;

      // Rewrite every task's assigned array to canonical casing, drop
      // case-insensitive duplicates within the same task.
      for (const t of (project.tasks || [])) {
        const arr = Array.isArray(t.assigned) ? t.assigned : (t.assigned ? [t.assigned] : []);
        const seen = new Set();
        const out = [];
        for (const raw of arr) {
          const trimmed = String(raw == null ? '' : raw).trim();
          if (!trimmed) continue;
          const key = trimmed.toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          out.push(canonicalByKey.get(key) || trimmed);
        }
        if (JSON.stringify(out) !== JSON.stringify(arr)) {
          t.assigned = out;
        }
      }
    }
    localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects, DATE_REPLACER));

    // Apply the same canonicalisation to bin entries so restored tasks
    // come back with the canonical name. Match each entry to its project
    // via entry.projectId (set by migrateBinToProjectScope).
    const projectsByKey = new Map(projects.map(p => [p.id, p]));
    const fold = (s) => String(s == null ? '' : s).trim().toLowerCase();
    const canonicalForProject = (projectId, name) => {
      const project = projectsByKey.get(projectId);
      if (!project || !Array.isArray(project.members)) return name;
      const member = project.members.find(m => fold(m.name) === fold(name));
      return member ? member.name : name;
    };

    try {
      const binRaw = localStorage.getItem(BIN_KEY);
      if (binRaw) {
        const bin = JSON.parse(binRaw);
        let binChanged = false;
        for (const entry of bin) {
          if (!entry.task || !entry.projectId) continue;
          const arr = Array.isArray(entry.task.assigned) ? entry.task.assigned : (entry.task.assigned ? [entry.task.assigned] : []);
          const seen = new Set();
          const out = [];
          for (const raw of arr) {
            const trimmed = String(raw == null ? '' : raw).trim();
            if (!trimmed) continue;
            const key = trimmed.toLowerCase();
            if (seen.has(key)) continue;
            seen.add(key);
            out.push(canonicalForProject(entry.projectId, trimmed));
          }
          if (JSON.stringify(out) !== JSON.stringify(arr)) {
            entry.task.assigned = out;
            binChanged = true;
          }
        }
        if (binChanged) localStorage.setItem(BIN_KEY, JSON.stringify(bin));
      }
    } catch (err) {
      console.warn('Bin canonicalisation skipped:', err.message);
    }

    // Project bin: each entry stores a whole project blob; rebuild members
    // from its own tasks then canonicalise.
    try {
      const pbinRaw = localStorage.getItem(PROJECT_BIN_KEY);
      if (pbinRaw) {
        const pbin = JSON.parse(pbinRaw);
        let pbinChanged = false;
        for (const entry of pbin) {
          if (!entry.project) continue;
          const proj = entry.project;
          const counts = new Map();
          const variants = new Map();
          for (const t of (proj.tasks || [])) {
            const arr = Array.isArray(t.assigned) ? t.assigned : (t.assigned ? [t.assigned] : []);
            for (const n of arr) {
              const trimmed = String(n == null ? '' : n).trim();
              if (!trimmed) continue;
              const k = trimmed.toLowerCase();
              counts.set(k, (counts.get(k) || 0) + 1);
              if (!variants.has(k)) variants.set(k, new Map());
              variants.get(k).set(trimmed, (variants.get(k).get(trimmed) || 0) + 1);
            }
          }
          const canonByKey = new Map();
          for (const [key, vmap] of variants) {
            let best = null, bestC = -1;
            for (const [v, c] of vmap) if (c > bestC) { bestC = c; best = v; }
            canonByKey.set(key, best);
          }
          proj.members = [...canonByKey.values()].map(name => ({ name }));
          for (const t of (proj.tasks || [])) {
            const arr = Array.isArray(t.assigned) ? t.assigned : (t.assigned ? [t.assigned] : []);
            const seen = new Set();
            const out = [];
            for (const raw of arr) {
              const trimmed = String(raw == null ? '' : raw).trim();
              if (!trimmed) continue;
              const key = trimmed.toLowerCase();
              if (seen.has(key)) continue;
              seen.add(key);
              out.push(canonByKey.get(key) || trimmed);
            }
            if (JSON.stringify(out) !== JSON.stringify(arr)) {
              t.assigned = out;
              pbinChanged = true;
            }
          }
        }
        if (pbinChanged) localStorage.setItem(PROJECT_BIN_KEY, JSON.stringify(pbin));
      }
    } catch (err) {
      console.warn('Project bin canonicalisation skipped:', err.message);
    }

    localStorage.setItem('qp-members-v1', '1');
  } catch (err) {
    console.warn('Members migration failed:', err.message);
  }
}

// One-shot rename: link any "Simone" / "SG" / "Simone G" assignments and
// canonical members to the full name "Simone Gregurke". Hardcoded for the
// owner's project, kept minimal because the proper fix is server-side
// (require last name at signup; allow editing display name in profile).
function migrateSimoneFullName() {
  if (localStorage.getItem('qp-simone-fullname-v1')) return;
  try {
    const TARGET = 'Simone Gregurke';
    const ALIASES = new Set(['simone', 'sg', 's g', 's gregurke', 'simone g', 'simone g.']);
    const isAlias = (n) => ALIASES.has(String(n == null ? '' : n).trim().toLowerCase());
    const canonicalise = (n) => isAlias(n) ? TARGET : n;

    const raw = localStorage.getItem(PROJECTS_KEY);
    if (raw) {
      const projects = JSON.parse(raw);
      let changed = false;
      for (const project of projects) {
        // Members: rename any aliased entries to TARGET, dedupe.
        if (Array.isArray(project.members)) {
          const seen = new Set();
          const out = [];
          for (const m of project.members) {
            const renamed = isAlias(m && m.name) ? { ...m, name: TARGET } : m;
            const k = String(renamed.name || '').trim().toLowerCase();
            if (!k || seen.has(k)) { changed = true; continue; }
            seen.add(k);
            if (renamed !== m) changed = true;
            out.push(renamed);
          }
          project.members = out;
        }
        // Tasks: canonicalise assigned[] entries.
        for (const t of (project.tasks || [])) {
          const arr = Array.isArray(t.assigned) ? t.assigned : (t.assigned ? [t.assigned] : []);
          const seen = new Set();
          const out = [];
          for (const raw2 of arr) {
            const renamed = canonicalise(raw2);
            const k = String(renamed || '').trim().toLowerCase();
            if (!k || seen.has(k)) continue;
            seen.add(k);
            out.push(renamed);
          }
          if (JSON.stringify(out) !== JSON.stringify(arr)) {
            t.assigned = out;
            changed = true;
          }
        }
      }
      if (changed) localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects, DATE_REPLACER));
    }

    // Bin entries: canonicalise assigned on each archived/trashed task.
    const binRaw = localStorage.getItem(BIN_KEY);
    if (binRaw) {
      const bin = JSON.parse(binRaw);
      let binChanged = false;
      for (const entry of bin) {
        const t = entry && entry.task;
        if (!t) continue;
        const arr = Array.isArray(t.assigned) ? t.assigned : (t.assigned ? [t.assigned] : []);
        const seen = new Set();
        const out = [];
        for (const raw2 of arr) {
          const renamed = canonicalise(raw2);
          const k = String(renamed || '').trim().toLowerCase();
          if (!k || seen.has(k)) continue;
          seen.add(k);
          out.push(renamed);
        }
        if (JSON.stringify(out) !== JSON.stringify(arr)) {
          t.assigned = out;
          binChanged = true;
        }
      }
      if (binChanged) localStorage.setItem(BIN_KEY, JSON.stringify(bin, DATE_REPLACER));
    }

    localStorage.setItem('qp-simone-fullname-v1', '1');
  } catch (err) {
    console.warn('Simone fullname migration failed:', err.message);
    localStorage.setItem('qp-simone-fullname-v1', '1');
  }
}

export function runMigrations() {
  migrateToUUIDs();
  migrateCategoryRenames();
  migrateAssignedToArray();
  migrateMembers();
  migrateSimoneFullName();
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

export function saveProjectMembers(id, members) {
  const projects = loadProjects();
  const idx = projects.findIndex(p => p.id === id);
  if (idx === -1) return;
  projects[idx].members = Array.isArray(members)
    ? members.map(m => ({ ...m }))
    : [];
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


