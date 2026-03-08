/**
 * Offline-first sync engine.
 * Phase 0: queue infrastructure only — no Supabase calls until Phase 1.
 *
 * Architecture:
 * - localStorage remains the UI's source of truth
 * - Mutations are queued in `qp-sync-queue` for background push
 * - On reconnect, queue flushes then pulls remote changes (merge by updatedAt)
 */

import { isConfigured, getClient } from './supabase.js';

const QUEUE_KEY = 'qp-sync-queue';

// ── Queue management ────────────────────────────────────────────────────────

function loadQueue() {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveQueue(queue) {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

/**
 * Enqueue a mutation for background sync.
 * @param {'upsert'|'delete'} action
 * @param {'task'|'project'|'bin'} table
 * @param {object} payload - the record data
 */
export function enqueue(action, table, payload) {
  if (!isConfigured()) return;
  const queue = loadQueue();
  queue.push({ action, table, payload, queuedAt: Date.now() });
  saveQueue(queue);
}

// ── Flush queue (Phase 1: implement Supabase writes) ────────────────────────

async function flushQueue() {
  if (!isConfigured()) return;
  const client = await getClient();
  if (!client) return;

  const queue = loadQueue();
  if (!queue.length) return;

  const failed = [];
  for (const entry of queue) {
    try {
      // Phase 1: implement per-table upsert/delete via client
      // e.g. await client.from(entry.table + 's').upsert(entry.payload);
      console.debug('[sync] would push:', entry.action, entry.table, entry.payload?.id);
    } catch (err) {
      console.warn('[sync] push failed, re-queuing:', err.message);
      failed.push(entry);
    }
  }
  saveQueue(failed);
}

// ── Pull remote changes (Phase 1: implement Supabase reads + merge) ─────────

async function pullRemote() {
  if (!isConfigured()) return;
  // Phase 1: fetch tasks where updatedAt > last sync timestamp
  // Merge by updatedAt (last-write-wins per task)
}

// ── Online/offline listeners ────────────────────────────────────────────────

let _initialised = false;

export function initSync() {
  if (_initialised) return;
  _initialised = true;

  if (!isConfigured()) return;

  window.addEventListener('online', () => {
    console.debug('[sync] back online — flushing queue');
    flushQueue().then(pullRemote);
  });

  // Flush on init if online
  if (navigator.onLine) {
    flushQueue().then(pullRemote);
  }
}

// ── Status helpers ──────────────────────────────────────────────────────────

export function getPendingCount() {
  return loadQueue().length;
}

export function isSyncEnabled() {
  return isConfigured();
}
