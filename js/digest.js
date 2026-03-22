/**
 * digest.js — Change digest / notification system
 * Shows changes made by OTHER users in shared projects.
 */

import { isLoggedIn, isSandbox, getUser } from './auth.js';
import { loadActiveProjectId } from './storage.js';

const API_BASE = 'https://qp-api.davegregurke.workers.dev';
const DIGEST_SEEN_KEY = 'qp-digest-seen';
const DIGEST_FREQ_KEY = 'qp-digest-freq';

let _bellBtn = null;
let _badge = null;
let _panel = null;
let _changes = [];

// ─── Settings ────────────────────────────────────────────────────────────────

export function getDigestFrequency() {
  return localStorage.getItem(DIGEST_FREQ_KEY) || 'daily';
}

export function setDigestFrequency(freq) {
  localStorage.setItem(DIGEST_FREQ_KEY, freq);
}

function getLastSeen() {
  return localStorage.getItem(DIGEST_SEEN_KEY) || new Date(Date.now() - 7 * 86400000).toISOString();
}

function markSeen() {
  localStorage.setItem(DIGEST_SEEN_KEY, new Date().toISOString());
}

// ─── Since calculation based on frequency ────────────────────────────────────

function getSinceDate() {
  const freq = getDigestFrequency();
  const now = new Date();
  switch (freq) {
    case 'hourly': return new Date(now - 3600000).toISOString();
    case 'daily': return new Date(now.setHours(0, 0, 0, 0)).toISOString();
    case 'workweek': {
      const d = new Date();
      const day = d.getDay();
      const diff = day === 0 ? 6 : day - 1; // Monday
      d.setDate(d.getDate() - diff);
      d.setHours(0, 0, 0, 0);
      return d.toISOString();
    }
    case 'monday': {
      const d = new Date();
      const day = d.getDay();
      const diff = day === 0 ? 6 : day - 1;
      d.setDate(d.getDate() - diff);
      d.setHours(0, 0, 0, 0);
      return d.toISOString();
    }
    case 'monthly': return new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    default: return new Date(now.setHours(0, 0, 0, 0)).toISOString();
  }
}

// ─── API ─────────────────────────────────────────────────────────────────────

async function fetchChangelog(projectId, since) {
  const token = localStorage.getItem('qp-auth-token');
  if (!token) return [];
  try {
    const res = await fetch(`${API_BASE}/projects/${projectId}/changelog?since=${encodeURIComponent(since)}`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (!res.ok) return [];
    return await res.json();
  } catch { return []; }
}

// ─── Format changes for display ──────────────────────────────────────────────

const FIELD_LABELS = {
  task: 'name', status: 'status', category: 'category', room: 'room',
  assigned: 'assigned', start_date: 'start date', end_date: 'end date', notes: 'notes',
};

function formatChange(change) {
  const who = change.user_name || change.user_email?.split('@')[0] || 'Someone';
  const ago = timeAgo(new Date(change.created_at + 'Z'));

  if (change.change_type === 'add') {
    return { who, task: change.task_name, detail: 'added this task', ago };
  }
  if (change.change_type === 'delete') {
    return { who, task: change.task_name, detail: 'deleted this task', ago };
  }

  // Parse field changes
  let fields;
  try { fields = JSON.parse(change.fields_changed); } catch { fields = {}; }
  const parts = [];
  for (const [key, val] of Object.entries(fields)) {
    const label = FIELD_LABELS[key] || key;
    if (key === 'status') {
      parts.push(`${label} → ${val.to}`);
    } else if (key === 'assigned') {
      try {
        const names = JSON.parse(val.to);
        parts.push(`assigned to ${Array.isArray(names) ? names.join(', ') : val.to}`);
      } catch { parts.push(`${label} changed`); }
    } else if (key === 'start_date' || key === 'end_date') {
      parts.push(`${label} → ${val.to || 'cleared'}`);
    } else {
      parts.push(`${label} changed`);
    }
  }

  return { who, task: change.task_name, detail: parts.join(', ') || 'updated', ago };
}

function timeAgo(date) {
  const ms = Date.now() - date.getTime();
  if (ms < 60000) return 'just now';
  if (ms < 3600000) return `${Math.floor(ms / 60000)}m ago`;
  if (ms < 86400000) return `${Math.floor(ms / 3600000)}h ago`;
  if (ms < 604800000) return `${Math.floor(ms / 86400000)}d ago`;
  return date.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
}

// ─── UI ──────────────────────────────────────────────────────────────────────

export function initDigest() {
  if (!isLoggedIn() || isSandbox()) return;

  // Inject bell button into sidebar (before settings)
  const settingsBtn = document.getElementById('sidebar-settings-btn');
  if (!settingsBtn || document.getElementById('sidebar-digest-btn')) return;

  _bellBtn = document.createElement('button');
  _bellBtn.id = 'sidebar-digest-btn';
  _bellBtn.className = 'sidebar-item sidebar-digest-btn';
  _bellBtn.title = 'Notifications';
  _bellBtn.innerHTML = `
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0"/></svg>
    <span class="sidebar-label">Notifications</span>
    <span class="digest-badge hidden" id="digest-badge">0</span>
  `;
  settingsBtn.parentNode.insertBefore(_bellBtn, settingsBtn);

  _badge = _bellBtn.querySelector('#digest-badge');
  _bellBtn.addEventListener('click', toggleDigestPanel);

  // Create digest panel
  _panel = document.createElement('div');
  _panel.id = 'digest-panel';
  _panel.className = 'digest-panel hidden';
  _panel.innerHTML = `
    <div class="digest-header">
      <h3>Notifications</h3>
      <button class="digest-close" title="Close">&times;</button>
    </div>
    <div class="digest-list" id="digest-list"></div>
    <div class="digest-empty hidden" id="digest-empty">No changes from other users.</div>
  `;
  document.body.appendChild(_panel);

  _panel.querySelector('.digest-close').addEventListener('click', () => {
    _panel.classList.add('hidden');
  });

  // Check for changes
  checkForChanges();
}

async function checkForChanges() {
  const projectId = loadActiveProjectId();
  if (!projectId) return;

  const since = getSinceDate();
  const changes = await fetchChangelog(projectId, since);

  // Filter out own changes
  const me = getUser();
  _changes = changes.filter(c => c.user_id !== me?.id);

  // Count unseen
  const lastSeen = getLastSeen();
  const unseen = _changes.filter(c => (c.created_at + 'Z') > lastSeen);

  if (unseen.length > 0 && _badge) {
    _badge.textContent = unseen.length > 99 ? '99+' : unseen.length;
    _badge.classList.remove('hidden');
  } else if (_badge) {
    _badge.classList.add('hidden');
  }
}

function toggleDigestPanel() {
  const showing = _panel.classList.contains('hidden');
  _panel.classList.toggle('hidden', !showing);

  if (showing) {
    renderDigest();
    markSeen();
    if (_badge) _badge.classList.add('hidden');
  }
}

function renderDigest() {
  const list = _panel.querySelector('#digest-list');
  const empty = _panel.querySelector('#digest-empty');

  if (_changes.length === 0) {
    list.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }

  empty.classList.add('hidden');
  list.innerHTML = _changes.map(c => {
    const f = formatChange(c);
    return `<div class="digest-item">
      <div class="digest-item-header">
        <strong>${esc(f.who)}</strong>
        <span class="digest-item-ago">${f.ago}</span>
      </div>
      <div class="digest-item-task">${esc(f.task)}</div>
      <div class="digest-item-detail">${esc(f.detail)}</div>
    </div>`;
  }).join('');
}

function esc(s) {
  const el = document.createElement('span');
  el.textContent = s || '';
  return el.innerHTML;
}
