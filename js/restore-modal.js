/**
 * Restore-backup modal — compares backup projects against current data
 * and restores all backup data with a visual diff.
 */

import { esc } from './utils.js';
import { loadProjects, saveProjects } from './storage.js';

const BACKUP_EXCLUDE = new Set(['qp-projects', 'qp-auth-token', 'qp-auth-user', 'qp-sandbox']);

function analyseBackup(backupData) {
  const currentProjects = loadProjects();
  const currentByName = new Map(currentProjects.map(p => [p.name, p]));

  let backupProjects = [];
  if (backupData['qp-projects']) {
    try { backupProjects = JSON.parse(backupData['qp-projects']); } catch { /* ignore */ }
  }

  // Deduplicate backup projects by name (last one wins)
  const seen = new Map();
  for (const bp of backupProjects) seen.set(bp.name, bp);
  backupProjects = [...seen.values()];

  const conflicts = [];
  const newProjects = [];

  for (const bp of backupProjects) {
    const existing = currentByName.get(bp.name);
    if (existing) {
      conflicts.push({ name: bp.name, currentProject: existing, backupProject: bp });
    } else {
      newProjects.push({ name: bp.name, backupProject: bp });
    }
  }

  const settingsKeys = Object.keys(backupData)
    .filter(k => k.startsWith('qp-') && !BACKUP_EXCLUDE.has(k));

  return { conflicts, newProjects, settingsKeys, backupData, currentProjects };
}

function getLatestEdit(project) {
  if (!project || !project.tasks || !project.tasks.length) return null;
  let max = 0;
  for (const t of project.tasks) {
    const ts = t.updatedAt || 0;
    if (ts > max) max = ts;
  }
  return max || null;
}

function formatTimestamp(ts) {
  if (!ts) return 'Unknown';
  const d = new Date(ts);
  if (isNaN(d.getTime())) return 'Unknown';
  const now = Date.now();
  const diff = now - d.getTime();
  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;
  const day = d.getDate();
  const mon = d.toLocaleString('en-AU', { month: 'short' });
  const yr = String(d.getFullYear()).slice(-2);
  return `${day} ${mon} ${yr}`;
}

function taskCount(project) {
  return project && project.tasks ? project.tasks.length : 0;
}

let modalEl = null;

export function openRestoreModal(backupData, { onComplete, showToast }) {
  const analysis = analyseBackup(backupData);
  const { conflicts, newProjects, settingsKeys } = analysis;

  // Nothing to restore
  if (!conflicts.length && !newProjects.length && !settingsKeys.length) {
    showToast('Backup file is empty', 'error');
    return;
  }

  if (!modalEl) {
    modalEl = document.createElement('div');
    modalEl.id = 'restore-modal';
    document.getElementById('modal-root').appendChild(modalEl);
  }

  // Build HTML
  let conflictsHTML = '';
  if (conflicts.length) {
    conflictsHTML = `
      <div class="restore-section">
        <h3 class="restore-section-title">Matching projects</h3>
        <p class="restore-section-desc">Backup data will replace your current project data.</p>
        ${conflicts.map(c => `
          <div class="restore-project-card restore-conflict-card">
            <div class="restore-project-name">${esc(c.name)}</div>
            <div class="restore-card-comparison">
              <div class="restore-col">
                <span class="restore-col-label">Current</span>
                <span class="restore-stat">${taskCount(c.currentProject)} tasks</span>
                <span class="restore-stat restore-stat-date">Last edit: ${formatTimestamp(getLatestEdit(c.currentProject))}</span>
              </div>
              <div class="restore-col restore-col-backup">
                <span class="restore-col-label">From backup</span>
                <span class="restore-stat">${taskCount(c.backupProject)} tasks</span>
                <span class="restore-stat restore-stat-date">Last edit: ${formatTimestamp(getLatestEdit(c.backupProject))}</span>
              </div>
            </div>
          </div>
        `).join('')}
      </div>`;
  }

  let newHTML = '';
  if (newProjects.length) {
    newHTML = `
      <div class="restore-section">
        <h3 class="restore-section-title">New projects</h3>
        ${newProjects.map(p => `
          <div class="restore-project-row">
            <span class="restore-project-name">${esc(p.name)}</span>
            <span class="restore-stat">${taskCount(p.backupProject)} tasks</span>
          </div>
        `).join('')}
      </div>`;
  }

  let settingsHTML = '';
  if (settingsKeys.length) {
    settingsHTML = `
      <div class="restore-section">
        <div class="restore-project-row">
          <span class="restore-project-name">${settingsKeys.length} settings keys</span>
          <span class="restore-stat">Colours, swatches, preferences</span>
        </div>
      </div>`;
  }

  modalEl.className = 'modal-overlay';
  modalEl.innerHTML = `
    <div class="modal-dialog restore-dialog" role="dialog" aria-label="Restore backup">
      <div class="modal-header">
        <h2 class="modal-title">Restore Backup</h2>
      </div>
      <div class="restore-body">
        ${conflictsHTML}
        ${newHTML}
        ${settingsHTML}
      </div>
      <div class="modal-actions">
        <div class="modal-actions-right">
          <button type="button" class="modal-btn modal-cancel restore-cancel-btn">Cancel</button>
          <button type="button" class="modal-btn modal-save restore-confirm-btn">Restore from backup</button>
        </div>
      </div>
    </div>
  `;

  modalEl.classList.add('open');

  const close = () => {
    modalEl.classList.remove('open');
    document.removeEventListener('keydown', onKey);
  };

  // Cancel
  modalEl.querySelector('.restore-cancel-btn').addEventListener('click', close);
  modalEl.addEventListener('click', (e) => { if (e.target === modalEl) close(); });
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);

  // Confirm
  const confirmBtn = modalEl.querySelector('.restore-confirm-btn');
  confirmBtn.addEventListener('click', () => {
    if (conflicts.length > 0) {
      showReplaceConfirmation(conflicts.length, () => {
        executeRestore(analysis, { onComplete, showToast });
        close();
      });
    } else {
      executeRestore(analysis, { onComplete, showToast });
      close();
    }
  });
}

function showReplaceConfirmation(count, onConfirm) {
  const dialog = modalEl.querySelector('.modal-dialog');
  if (dialog.querySelector('.modal-delete-confirm')) return;

  const confirmEl = document.createElement('div');
  confirmEl.className = 'modal-delete-confirm';
  confirmEl.innerHTML = `
    <h1 class="modal-delete-title">Replace ${count} project${count > 1 ? 's' : ''}?</h1>
    <p class="modal-delete-body">This will permanently replace the entire current project data. This cannot be undone.</p>
    <div class="modal-delete-actions">
      <button type="button" class="modal-btn modal-cancel">Cancel</button>
      <button type="button" class="modal-btn modal-delete-confirm-btn">Yes, replace</button>
    </div>
  `;
  dialog.appendChild(confirmEl);
  confirmEl.querySelector('.modal-cancel').addEventListener('click', () => confirmEl.remove());
  confirmEl.querySelector('.modal-delete-confirm-btn').addEventListener('click', () => {
    confirmEl.remove();
    onConfirm();
  });
}

function executeRestore(analysis, { onComplete, showToast }) {
  const { conflicts, newProjects, settingsKeys, backupData, currentProjects } = analysis;
  let projects = [...currentProjects];
  let projectsChanged = 0;
  let settingsRestored = 0;

  for (const c of conflicts) {
    const idx = projects.findIndex(p => p.name === c.name);
    if (idx !== -1) {
      projects[idx] = c.backupProject;
      projectsChanged++;
    }
  }

  for (const np of newProjects) {
    projects.push(np.backupProject);
    projectsChanged++;
  }

  for (const k of settingsKeys) {
    localStorage.setItem(k, backupData[k]);
    settingsRestored++;
  }

  if (projectsChanged > 0) {
    saveProjects(projects);
  }

  const parts = [];
  if (projectsChanged) parts.push(`${projectsChanged} project${projectsChanged > 1 ? 's' : ''}`);
  if (settingsRestored) parts.push(`${settingsRestored} settings`);
  showToast(`Restored ${parts.join(' and ')}`, 'success');

  setTimeout(() => onComplete(), 600);
}
