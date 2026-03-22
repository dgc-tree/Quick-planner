// People / Invite settings panel
// Manages project members and pending invitations

import { isLoggedIn, isSandbox } from './auth.js';

const API_BASE = 'https://qp-api.davegregurke.workers.dev';

function getToken() {
  return localStorage.getItem('qp-auth-token');
}

async function apiCall(path, options = {}) {
  const token = getToken();
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

const ROLE_ORDER = { owner: 0, admin: 1, member: 2, viewer: 3 };
const ROLE_LABELS = { owner: 'Owner', admin: 'Admin', member: 'Member', viewer: 'Viewer' };
const STALE_DAYS = 7;

function daysSince(dateStr) {
  if (!dateStr) return 0;
  const d = new Date(dateStr.endsWith('Z') ? dateStr : dateStr + 'Z');
  return Math.floor((Date.now() - d.getTime()) / 86400000);
}

function fmtDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr.endsWith('Z') ? dateStr : dateStr + 'Z');
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: '2-digit' });
}

function roleClass(role) {
  return `people-role people-role--${role}`;
}

export function initPeopleSection(container, { getActiveProjectId }) {
  if (!container) return;

  let currentProjectId = null;
  let members = [];
  let invites = [];
  let searchQuery = '';

  function canShow() {
    return isLoggedIn() && !isSandbox();
  }

  function show() {
    container.classList.toggle('hidden', !canShow());
  }

  async function load() {
    currentProjectId = getActiveProjectId();
    if (!canShow() || !currentProjectId) {
      show();
      return;
    }
    // Keep card hidden until data arrives — prevents "Loading team..." flash
    try {
      const data = await apiCall(`/projects/${currentProjectId}/members`);
      members = data.members || [];
      invites = data.invites || [];
      show();
      render();
    } catch (e) {
      show();
      renderError(e.message);
    }
  }

  function renderLoading() {
    const body = container.querySelector('.people-body');
    if (body) body.innerHTML = '<p class="people-loading">Loading team...</p>';
  }

  function renderError(msg) {
    const body = container.querySelector('.people-body');
    if (body) body.innerHTML = `<p class="people-error">${msg}</p>`;
  }

  function render() {
    const body = container.querySelector('.people-body');
    if (!body) return;

    const q = searchQuery.toLowerCase();
    const filteredMembers = members.filter(m =>
      !q || m.email.toLowerCase().includes(q) || (m.name || '').toLowerCase().includes(q)
    );
    const filteredInvites = invites.filter(i =>
      !q || i.email.toLowerCase().includes(q)
    );
    const totalCount = filteredMembers.length + filteredInvites.length;

    // Sort members: owner first, then by role, then alpha
    filteredMembers.sort((a, b) => (ROLE_ORDER[a.role] ?? 9) - (ROLE_ORDER[b.role] ?? 9) || a.email.localeCompare(b.email));

    let html = '';

    // Invite form — email + inline role select + primary invite button
    html += `
      <div class="people-invite-form">
        <div class="people-invite-row">
          <div class="people-invite-input-wrap">
            <input type="email" class="people-invite-input" placeholder="Invite by email" aria-label="Email to invite">
          </div>
          <select class="people-invite-role" aria-label="Role for invited user">
            <option value="member">Member</option>
            <option value="admin">Admin</option>
            <option value="viewer">Viewer</option>
          </select>
          <button class="people-invite-btn modal-btn modal-save" type="button">Invite</button>
        </div>
        <div class="people-invite-msg hidden"></div>
      </div>
    `;

    // Avatar grid grouped by role
    const grouped = { owner: [], admin: [], member: [], viewer: [] };
    for (const m of filteredMembers) grouped[m.role]?.push(m);

    // Search (only show if 5+ people)
    if (totalCount >= 5) {
      html += `
        <div class="people-search-wrap">
          <input type="search" class="people-search-input" placeholder="Filter members..." value="${searchQuery.replace(/"/g, '&quot;')}" aria-label="Filter members">
        </div>
      `;
    }

    // Empty state
    if (filteredMembers.length === 0 && filteredInvites.length === 0) {
      if (members.length <= 1 && invites.length === 0 && !q) {
        html += `
          <div class="people-empty">
            <p class="people-empty-title">Just you for now</p>
            <p class="people-empty-desc">Invite collaborators above to start working together.</p>
          </div>
        `;
      } else {
        html += '<p class="people-no-results">No matches</p>';
      }
    }

    // Render avatar groups
    const groupLabels = { owner: 'Owner', admin: 'Admins', member: 'Members', viewer: 'Viewers' };
    for (const role of ['owner', 'admin', 'member', 'viewer']) {
      if (grouped[role].length === 0) continue;
      html += `<div class="people-group">`;
      html += `<h4 class="people-section-label">${groupLabels[role]}</h4>`;
      html += `<div class="people-avatar-grid">`;
      for (const m of grouped[role]) {
        const initial = (m.name || m.email)[0].toUpperCase();
        const displayName = m.name || m.email.split('@')[0];
        const isOwner = m.role === 'owner';
        html += `
          <div class="people-avatar-card" data-member-id="${m.id}" data-user-id="${m.user_id}" title="${esc(escHtml(m.email))}">
            <div class="people-avatar">${initial}</div>
            <span class="people-avatar-name">${esc(highlightMatch(displayName, q))}</span>
            ${!isOwner ? `<button class="people-edit-access-btn" data-member-id="${m.id}">Edit access</button>
            <div class="people-access-panel hidden" data-member-id="${m.id}">
              <select class="people-role-select" data-member-id="${m.id}">
                <option value="admin"${m.role === 'admin' ? ' selected' : ''}>Admin</option>
                <option value="member"${m.role === 'member' ? ' selected' : ''}>Member</option>
                <option value="viewer"${m.role === 'viewer' ? ' selected' : ''}>Viewer</option>
              </select>
              <button class="people-remove-btn" data-member-id="${m.id}">Remove</button>
            </div>` : ''}
          </div>
        `;
      }
      html += `</div></div>`;
    }

    // Pending invites
    if (filteredInvites.length > 0) {
      html += '<div class="people-group">';
      html += '<h4 class="people-section-label">Pending invitations</h4>';
      html += '<div class="people-table people-table--pending">';
      for (const inv of filteredInvites) {
        const stale = daysSince(inv.created_at) >= STALE_DAYS;
        html += `
          <div class="people-row people-row--pending ${stale ? 'people-row--stale' : ''}" data-invite-id="${inv.id}">
            <div class="people-avatar people-avatar--pending">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
            </div>
            <div class="people-info">
              <span class="people-name">${esc(highlightMatch(inv.email, q))}</span>
              <span class="people-email people-invite-date ${stale ? 'people-date--stale' : ''}">
                Invited ${fmtDate(inv.created_at)}${stale ? ' - stale' : ''}
              </span>
            </div>
            <span class="${roleClass(inv.role)}">${ROLE_LABELS[inv.role]}</span>
            <div class="people-invite-actions">
              <button class="people-resend-btn" data-invite-id="${inv.id}" title="Resend invitation">Resend</button>
              <button class="people-remove-invite-btn" data-invite-id="${inv.id}" aria-label="Cancel invitation for ${esc(escHtml(inv.email))}">Remove</button>
            </div>
          </div>
        `;
      }
      html += '</div></div>';
    }

    body.innerHTML = html;
    wireEvents(body);
  }

  function wireEvents(body) {
    // Invite
    const inviteBtn = body.querySelector('.people-invite-btn');
    const inviteInput = body.querySelector('.people-invite-input');
    const inviteRole = body.querySelector('.people-invite-role');
    const inviteMsg = body.querySelector('.people-invite-msg');

    if (inviteBtn) {
      const doInvite = async () => {
        const email = inviteInput.value.trim();
        if (!email) return;
        inviteBtn.disabled = true;
        inviteMsg.classList.add('hidden');
        try {
          const result = await apiCall(`/projects/${currentProjectId}/members`, {
            method: 'POST',
            body: JSON.stringify({ email, role: inviteRole.value }),
          });
          invites.push(result);
          inviteInput.value = '';
          render();
        } catch (e) {
          inviteMsg.textContent = e.message;
          inviteMsg.className = 'people-invite-msg people-invite-msg--error';
          inviteMsg.classList.remove('hidden');
        }
        inviteBtn.disabled = false;
      };
      inviteBtn.addEventListener('click', doInvite);
      inviteInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doInvite(); });
    }

    // Search
    const searchInput = body.querySelector('.people-search-input');
    if (searchInput) {
      searchInput.addEventListener('input', () => {
        searchQuery = searchInput.value;
        render();
        // Re-focus search after re-render
        const newInput = body.querySelector('.people-search-input');
        if (newInput) { newInput.focus(); newInput.selectionStart = newInput.selectionEnd = newInput.value.length; }
      });
    }

    // Edit Access toggle
    body.querySelectorAll('.people-edit-access-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const mid = btn.dataset.memberId;
        const panel = body.querySelector(`.people-access-panel[data-member-id="${mid}"]`);
        if (panel) {
          const showing = panel.classList.contains('hidden');
          // Close all other panels first
          body.querySelectorAll('.people-access-panel').forEach(p => p.classList.add('hidden'));
          body.querySelectorAll('.people-edit-access-btn').forEach(b => b.classList.remove('active'));
          if (showing) {
            panel.classList.remove('hidden');
            btn.classList.add('active');
          }
        }
      });
    });

    // Role change
    body.querySelectorAll('.people-role-select').forEach(sel => {
      sel.addEventListener('change', async () => {
        const mid = sel.dataset.memberId;
        try {
          await apiCall(`/projects/${currentProjectId}/members/${mid}`, {
            method: 'PUT',
            body: JSON.stringify({ role: sel.value }),
          });
          const m = members.find(m => m.id === mid);
          if (m) m.role = sel.value;
          render();
        } catch (e) {
          sel.nextElementSibling?.insertAdjacentHTML('afterend', `<span class="people-error">${e.message}</span>`);
        }
      });
    });

    // Remove member — inline confirmation
    body.querySelectorAll('.people-remove-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const mid = btn.dataset.memberId;
        const card = btn.closest('.people-avatar-card');
        if (card.querySelector('.people-confirm-revoke')) return;

        const confirm = document.createElement('div');
        confirm.className = 'people-confirm-revoke';
        confirm.innerHTML = `
          <span>Remove?</span>
          <button class="people-confirm-yes">Yes</button>
          <button class="people-confirm-no">Cancel</button>
        `;
        card.appendChild(confirm);
        requestAnimationFrame(() => confirm.classList.add('people-confirm-visible'));

        confirm.querySelector('.people-confirm-no').addEventListener('click', () => {
          confirm.classList.remove('people-confirm-visible');
          setTimeout(() => confirm.remove(), 200);
        });
        confirm.querySelector('.people-confirm-yes').addEventListener('click', async () => {
          try {
            await apiCall(`/projects/${currentProjectId}/members/${mid}`, { method: 'DELETE' });
            members = members.filter(m => m.id !== mid);
            render();
          } catch (e) {
            confirm.querySelector('span').textContent = e.message;
          }
        });
      });
    });

    // Remove invite
    body.querySelectorAll('.people-remove-invite-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const iid = btn.dataset.inviteId;
        btn.disabled = true;
        btn.textContent = 'Removing...';
        try {
          await apiCall(`/projects/${currentProjectId}/invites/${iid}`, { method: 'DELETE' });
          invites = invites.filter(i => i.id !== iid);
          render();
        } catch (e) {
          btn.textContent = 'Failed';
          setTimeout(() => { btn.textContent = 'Remove'; btn.disabled = false; }, 2000);
        }
      });
    });

    // Resend invite
    body.querySelectorAll('.people-resend-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const iid = btn.dataset.inviteId;
        btn.disabled = true;
        btn.textContent = 'Sending...';
        try {
          await apiCall(`/projects/${currentProjectId}/invites/${iid}/resend`, { method: 'POST' });
          // Update local timestamp to clear stale status
          const inv = invites.find(i => i.id === iid);
          if (inv) inv.created_at = new Date().toISOString();
          render();
        } catch (e) {
          btn.textContent = 'Failed';
          setTimeout(() => { btn.textContent = 'Resend'; btn.disabled = false; }, 2000);
        }
      });
    });
  }

  // Expose for external use
  return { load, show };
}

// ── Utilities ────────────────────────────────────────────────────────────

function esc(html) {
  // Allow <mark> from highlightMatch, escape everything else
  return html;
}

function highlightMatch(text, query) {
  if (!query) return escHtml(text);
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx < 0) return escHtml(text);
  const before = text.slice(0, idx);
  const match = text.slice(idx, idx + query.length);
  const after = text.slice(idx + query.length);
  return `${escHtml(before)}<mark>${escHtml(match)}</mark>${escHtml(after)}`;
}

function escHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
