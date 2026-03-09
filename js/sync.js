/**
 * Sync engine — pushes localStorage data to qp-api Worker when logged in.
 * Offline-first: localStorage is always the immediate source of truth.
 * Server sync happens in the background after each save.
 */

import { isLoggedIn, isSandbox, pushAllData, pullAllData } from './auth.js';
import { loadProjects, saveProjects } from './storage.js';

let _syncing = false;

/**
 * Push all local projects + tasks to the server.
 * Call this after any data mutation (add/edit/delete task or project).
 * No-op if user is not logged in.
 */
export async function syncToServer() {
  if (isSandbox() || !isLoggedIn() || _syncing) return;
  _syncing = true;
  try {
    const projects = loadProjects();
    // Serialise dates to ISO strings for the API
    const payload = projects.map(p => ({
      id: p.id,
      name: p.name,
      type: p.type || 'local',
      tasks: (p.tasks || []).map(t => ({
        id: t.id,
        task: t.task || '',
        status: t.status || 'Not Started',
        category: t.category || '',
        room: t.room || '',
        assigned: Array.isArray(t.assigned) ? t.assigned : [],
        start_date: t.startDate instanceof Date ? t.startDate.toISOString() : (t.startDate || null),
        end_date: t.endDate instanceof Date ? t.endDate.toISOString() : (t.endDate || null),
        dependencies: Array.isArray(t.dependencies) ? t.dependencies : [],
        notes: t.notes || '',
      })),
    }));
    await pushAllData(payload);
    console.debug('[sync] pushed', projects.length, 'projects');
  } catch (err) {
    console.warn('[sync] push failed:', err.message);
  } finally {
    _syncing = false;
  }
}

/**
 * Pull all data from the server and merge into localStorage.
 * Server data wins for tasks that exist on both sides (by ID).
 * Local-only tasks are preserved.
 */
export async function syncFromServer() {
  if (isSandbox() || !isLoggedIn()) return false;
  try {
    const remote = await pullAllData();
    if (!Array.isArray(remote) || remote.length === 0) return false;

    const local = loadProjects();
    const localMap = new Map(local.map(p => [p.id, p]));

    // Merge: remote projects win, but preserve local-only projects
    for (const rp of remote) {
      const tasks = (rp.tasks || []).map(t => ({
        id: t.id,
        task: t.task,
        status: t.status,
        category: t.category,
        room: t.room,
        assigned: Array.isArray(t.assigned) ? t.assigned : JSON.parse(t.assigned || '[]'),
        startDate: t.start_date || null,
        endDate: t.end_date || null,
        dependencies: Array.isArray(t.dependencies) ? t.dependencies : JSON.parse(t.dependencies || '[]'),
        notes: t.notes || '',
        updatedAt: t.updated_at ? new Date(t.updated_at).getTime() : Date.now(),
      }));
      localMap.set(rp.id, {
        id: rp.id,
        name: rp.name,
        type: rp.type || 'local',
        tasks,
      });
    }

    saveProjects([...localMap.values()]);
    console.debug('[sync] pulled', remote.length, 'projects from server');
    return true;
  } catch (err) {
    console.warn('[sync] pull failed:', err.message);
    return false;
  }
}

/**
 * Initial sync on login: push local data to server, then pull to merge.
 */
export async function initialSync() {
  if (isSandbox() || !isLoggedIn()) return;
  await syncToServer();
  await syncFromServer();
}

// Legacy export for backwards compatibility with old init call
export function initSync() {
  // Auto-sync on load if logged in
  if (isLoggedIn()) {
    syncFromServer().catch(() => {});
  }
}
