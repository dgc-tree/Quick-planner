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
        // Sent so a future server schema can store them; today's worker
        // ignores unknown fields without erroring.
        archived: !!t.archived,
        archived_at: t.archivedAt || null,
        archive_reason: t.archiveReason || '',
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
 * Pull all data from the server and replace localStorage.
 * Server is authoritative when logged in — local data is fully replaced.
 */
export async function syncFromServer() {
  if (isSandbox() || !isLoggedIn()) return false;
  try {
    const remote = await pullAllData();
    if (!Array.isArray(remote) || remote.length === 0) return false;

    // Build an index of local tasks so we can preserve any fields the server
    // schema doesn't yet round-trip (archived, archiveReason, cost, contact,
    // tradeQuote). Without this, a refresh would wipe local-only state.
    const localTasksById = new Map();
    for (const lp of loadProjects()) {
      for (const lt of (lp.tasks || [])) localTasksById.set(lt.id, lt);
    }

    const projects = remote.map(rp => ({
      id: rp.id,
      name: rp.name,
      type: rp.type || 'local',
      tasks: (rp.tasks || []).map(t => {
        const merged = {
          id: t.id,
          task: t.task,
          status: t.status,
          category: t.category,
          room: t.room,
          assigned: Array.isArray(t.assigned) ? t.assigned : JSON.parse(t.assigned || '[]'),
          startDate: t.start_date || null,
          endDate: t.end_date || null,
          dependencies: Array.isArray(t.dependencies) ? t.dependencies.join(', ') : (t.dependencies || ''),
          notes: t.notes || '',
          updatedAt: t.updated_at ? new Date(t.updated_at).getTime() : Date.now(),
        };
        // Archive fields: server is authoritative once the schema migration
        // has run (column present). Before that, fall back to the local copy
        // so the field survives a sync pull.
        if ('archived' in t) {
          merged.archived = !!t.archived;
          merged.archivedAt = t.archived_at ? new Date(t.archived_at).getTime() : null;
          merged.archiveReason = t.archive_reason || '';
        } else {
          const local = localTasksById.get(t.id);
          if (local) {
            if (local.archived !== undefined) merged.archived = local.archived;
            if (local.archivedAt !== undefined) merged.archivedAt = local.archivedAt;
            if (local.archiveReason !== undefined) merged.archiveReason = local.archiveReason;
          }
        }
        // Other local-only fields the server schema still doesn't track.
        const local = localTasksById.get(t.id);
        if (local) {
          if (local.cost !== undefined && local.cost !== null) merged.cost = local.cost;
          if (local.contact) merged.contact = local.contact;
          if (local.tradeQuote !== undefined) merged.tradeQuote = local.tradeQuote;
        }
        return merged;
      }),
    }));

    saveProjects(projects);
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
