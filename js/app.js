import { buildFilterOptions, populateDropdown, applyFilters } from './filters.js';
import { renderKanban } from './kanban.js';
import { renderPlanner, setViewSize } from './planner.js';
import { renderTodoList } from './todolist.js';
import { openEditModal } from './modal.js';
import { initCustomColors, applyCustomColors } from './theme-customizer.js';
import { getAvatarColor } from './theme.js';
import { shouldShowOnboarding, showOnboarding, TEMPLATES } from './onboarding.js';
import {
  loadCustomColors, saveCustomColors, loadUserSwatches, saveUserSwatches, addToBin,
  loadBin, restoreFromBin, addProjectToBin, loadProjectBin, restoreProjectFromBin,
  loadProjects, saveProjects, loadActiveProjectId, saveActiveProjectId, saveProjectTasks,
  loadUserName, saveUserName, exportBackup, runMigrations,
} from './storage.js';
import { importCSV, sheetsUrlToCsvUrl, exportToCSV } from './projects.js';
import { openColorPickerModal } from './color-picker.js';
import { showContextMenu } from './context-menu.js';
import {
  isLoggedIn, isSandbox, getUser, logout, showAuthModal, hideAuthModal, initAuthUI, verifySession,
  requestEmailChange, requestPasswordChange, validatePasswordLength, checkPasswordBreach,
  renderPasswordStrength, verifyToken, hasWeakPassword, loadZxcvbn, deleteProjectOnServer,
} from './auth.js';
import { syncToServer, syncFromServer, initialSync } from './sync.js';
import { initPeopleSection } from './people.js';
import { initChat, onProjectSwitch as chatProjectSwitch, clearConversation, hideBubble as hideChatBubble, showBubble as showChatBubble, setTTSEnabled, setBriefingMode, getTTSEnabled, getBriefingMode, openPanel as openChatPanel } from './ai-chat.js';
import { getProviderConfig, setProvider, setLocalConfig, testClaudeConnection, testLocalConnection } from './ai-llm.js';
// bg-effects: lazy-loaded so a failure never blocks data/rendering
let _bgFx = { initBgEffects() {}, getConfig: () => ({ active: false }), setConfig() {} };
const bgFxReady = import('./bg-effects.js')
  .then(m => { _bgFx = m; })
  .catch(err => console.warn('bg-effects unavailable:', err));

let APP_VERSION = 'dev';
import('./version.js').then(v => { APP_VERSION = v.APP_VERSION; }).catch(() => {});

let allTasks = [];
let currentView = localStorage.getItem('qp-view') || 'kanban';
let filters = { room: '', category: '', assigned: '', search: '', dateFrom: '', dateTo: '' };
let currentProjectId = loadActiveProjectId();
let _updateFilterBadge = () => {};

const $ = (sel) => document.querySelector(sel);

function getProjectType() {
  if (!currentProjectId) return 'local';
  const projects = loadProjects();
  return projects.find(p => p.id === currentProjectId)?.type ?? 'local';
}

function getProjectName() {
  if (!currentProjectId) return '';
  const projects = loadProjects();
  return projects.find(p => p.id === currentProjectId)?.name ?? 'Project';
}

function persistTaskChange() {
  saveProjectTasks(currentProjectId, allTasks);
  syncToServer();
}

async function loadProjectData() {
  let projects = loadProjects();

  // Ensure at least one project exists so tasks always have a home
  if (!projects.length) {
    const id = crypto.randomUUID();
    projects = [{ id, name: 'Renos', type: 'local', tasks: [] }];
    saveProjects(projects);
    currentProjectId = id;
    saveActiveProjectId(id);
  }

  // If no active project (or stale ID), fall back to first available
  if (!currentProjectId || !projects.find(p => p.id === currentProjectId)) {
    const fallback = projects[0];
    currentProjectId = fallback.id;
    saveActiveProjectId(currentProjectId);
  }

  const project = projects.find(p => p.id === currentProjectId);
  if (project) {
    allTasks = project.tasks.map(t => ({
      ...t,
      startDate: t.startDate ? new Date(t.startDate) : null,
      endDate: t.endDate ? new Date(t.endDate) : null,
    }));
  }
}

async function switchProject(id) {
  if (window._closeOverlayViews) window._closeOverlayViews();
  currentProjectId = id;
  saveActiveProjectId(id);
  showLoading(true);
  try {
    await loadProjectData();
    updateSummary();
    setupFilters();
    render();
  } catch (err) {
    showError(err.message);
  }
  showLoading(false);
  renderSidebarProjects();
  chatProjectSwitch();
}

// Position a body-level popover below its trigger, clamped within viewport
function positionPopover(menu, trigger) {
  const rect = trigger.getBoundingClientRect();
  const menuW = 220; // safe over-estimate; actual content may be narrower
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - menuW - 8));
  menu.style.top  = (rect.bottom + 6) + 'px';
  menu.style.left = left + 'px';
  menu.style.right = 'auto';
  document.querySelector('.sidebar-rail')?.classList.add('sidebar-popover-open');
}

function closeAllPopovers() {
  document.querySelectorAll('.sidebar-project-menu.open').forEach(m => m.classList.remove('open'));
  document.querySelector('.sidebar-rail')?.classList.remove('sidebar-popover-open');
}

function renderSidebarProjects() {
  // Clean up any body-level dynamic menus from the previous render
  document.querySelectorAll('.sidebar-project-menu--dynamic').forEach(m => m.remove());

  const list = $('#sidebar-projects-list');
  const mobileList = $('#mobile-projects-list');
  const projects = loadProjects();

  function makeItem(id, name, isLocal) {
    const li = document.createElement('li');
    li.className = 'sidebar-project-item' + (id === currentProjectId ? ' active' : '');
    li.setAttribute('title', `Switch to ${name}`);
    const label = document.createElement('span');
    label.className = 'sidebar-project-label';
    label.textContent = name;
    li.appendChild(label);
    li.addEventListener('click', () => switchProject(id));

    // Options button (•••) for all projects
    const opts = document.createElement('button');
    opts.className = 'sidebar-project-opts';
    opts.setAttribute('aria-label', `Options for ${name}`);
    opts.innerHTML = '<span>•••</span>';
    opts.addEventListener('click', (e) => {
      e.stopPropagation();
      const wasOpen = menu.classList.contains('open');
      closeAllPopovers();
      if (!wasOpen) {
        if (menu.parentElement !== document.body) document.body.appendChild(menu);
        menu.classList.add('open');
        positionPopover(menu, opts);
      }
    });

    const menu = document.createElement('div');
    menu.className = 'sidebar-project-menu sidebar-project-menu--dynamic';

    const exportItem = document.createElement('button');
    exportItem.className = 'sidebar-project-menu-item';
    exportItem.textContent = 'Export CSV';
    exportItem.addEventListener('click', (e) => {
      e.stopPropagation();
      menu.classList.remove('open');
      const tasks = id === currentProjectId ? allTasks : (loadProjects().find(p => p.id === id)?.tasks || []);
      exportToCSV(tasks, name);
    });
    menu.appendChild(exportItem);

    if (isLocal) {
      const renameItem = document.createElement('button');
      renameItem.className = 'sidebar-project-menu-item';
      renameItem.textContent = 'Rename project';
      renameItem.addEventListener('click', (e) => {
        e.stopPropagation();
        menu.classList.remove('open');
        handleRenameProject(id, name);
      });
      menu.appendChild(renameItem);

      const dupItem = document.createElement('button');
      dupItem.className = 'sidebar-project-menu-item';
      dupItem.textContent = 'Duplicate project';
      dupItem.addEventListener('click', (e) => {
        e.stopPropagation();
        menu.classList.remove('open');
        handleDuplicateProject(id, name);
      });
      menu.appendChild(dupItem);

      const delItem = document.createElement('button');
      delItem.className = 'sidebar-project-menu-item sidebar-project-menu-item--danger';
      delItem.textContent = 'Delete project';
      delItem.addEventListener('click', (e) => {
        e.stopPropagation();
        menu.classList.remove('open');
        handleDeleteProject(id, name);
      });
      menu.appendChild(delItem);
    }

    li.appendChild(opts);
    li.appendChild(menu);
    return li;
  }

  if (list) {
    list.innerHTML = '';
    projects.forEach(p => list.appendChild(makeItem(p.id, p.name, true)));
  }

  if (mobileList) {
    mobileList.innerHTML = '';
    projects.forEach(p => mobileList.appendChild(makeItem(p.id, p.name, true)));
  }

  // Export button in settings
  const exportSection = $('#settings-export-section');
  if (exportSection) exportSection.classList.remove('hidden');
}

function showConfirmDialog({ title, body, confirmLabel, onConfirm }) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay open';
  overlay.innerHTML = `
    <div class="modal-dialog" role="dialog" style="max-width:360px">
      <div class="modal-delete-confirm" style="position:relative;background:none;box-shadow:none;padding:32px 24px">
        <h1 class="modal-delete-title">${title}</h1>
        <p class="modal-delete-body">${body}</p>
        <div class="modal-delete-actions">
          <button class="modal-btn modal-cancel">Cancel</button>
          <button class="modal-btn modal-delete-confirm-btn">${confirmLabel || 'Confirm'}</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  const remove = () => overlay.remove();
  overlay.querySelector('.modal-cancel').addEventListener('click', remove);
  overlay.querySelector('.modal-delete-confirm-btn').addEventListener('click', () => { remove(); onConfirm(); });
  overlay.addEventListener('click', (e) => { if (e.target === overlay) remove(); });
}

function handleRenameProject(id, currentName) {
  const newName = prompt('Rename project:', currentName);
  if (!newName || newName.trim() === '' || newName.trim() === currentName) return;
  const projects = loadProjects();
  const project = projects.find(p => p.id === id);
  if (!project) return;
  project.name = newName.trim();
  saveProjects(projects);
  syncToServer();
  renderSidebarProjects();
}

function handleDuplicateProject(id, name) {
  const defaultName = `${name} (copy)`;
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay open';
  overlay.innerHTML = `
    <div class="modal-dialog" role="dialog" style="max-width:360px">
      <div class="modal-delete-confirm" style="position:relative;background:none;box-shadow:none;padding:32px 24px">
        <h1 class="modal-delete-title">Duplicate project</h1>
        <div class="modal-field" style="margin:16px 0 24px">
          <label>Project name</label>
          <input type="text" class="dup-name-input" value="${defaultName.replace(/"/g, '&quot;')}" />
        </div>
        <div class="modal-delete-actions">
          <button class="modal-btn modal-cancel">Cancel</button>
          <button class="modal-btn modal-save dup-save-btn">Save</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const input = overlay.querySelector('.dup-name-input');
  const saveBtn = overlay.querySelector('.dup-save-btn');
  input.focus();
  input.select();

  const remove = () => overlay.remove();
  const doDuplicate = () => {
    const dupName = input.value.trim();
    if (!dupName) return;
    remove();
    const projects = loadProjects();
    const source = projects.find(p => p.id === id);
    if (!source) return;
    const newId = crypto.randomUUID();
    const now = Date.now();
    const clonedTasks = (source.tasks || []).map(t => ({
      ...JSON.parse(JSON.stringify(t)),
      id: crypto.randomUUID(),
      updatedAt: now,
    }));
    const newProject = { id: newId, name: dupName, type: 'local', tasks: clonedTasks };
    projects.push(newProject);
    saveProjects(projects);
    syncToServer();
    currentProjectId = newId;
    saveActiveProjectId(newId);
    renderSidebarProjects();
    loadProjectData().then(() => render());
    showToast(`Duplicated as "${dupName}"`);
  };

  saveBtn.addEventListener('click', doDuplicate);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doDuplicate();
    if (e.key === 'Escape') remove();
  });
  overlay.addEventListener('click', (e) => { if (e.target === overlay) remove(); });
}

function handleDeleteProject(id, name) {
  showConfirmDialog({
    title: `Delete "${name}"?`,
    body: 'This project and all its tasks will be moved to the bin for 30 days.',
    confirmLabel: 'Yes, delete',
    onConfirm: () => {
      const projects = loadProjects();
      const project = projects.find(p => p.id === id);
      if (project) addProjectToBin(project);
      const remaining = projects.filter(p => p.id !== id);
      saveProjects(remaining);
      // Use targeted DELETE, not full sync — full sync would delete any
      // server projects whose IDs aren't in the local payload (data loss risk).
      deleteProjectOnServer(id).catch(err => console.warn('[sync] delete project failed:', err.message));
      if (currentProjectId === id) {
        switchProject(remaining.length ? remaining[0].id : null);
      } else {
        renderSidebarProjects();
      }
    },
  });
}

async function handleVerifyParams() {
  const params = new URLSearchParams(window.location.search);
  const token = params.get('verify_token');
  const type = params.get('verify_type');
  if (!token || !type) return;
  window.history.replaceState({}, '', window.location.pathname);
  try {
    const result = await verifyToken(token, type);
    if (result.verified) {
      const msg = type === 'email_change' ? 'Email updated successfully' : 'Password updated successfully';
      showToast(msg, 'success');
      if (getUser()) { await verifySession(); updateAccountUI(); }
    }
  } catch (e) {
    const msg = e.message.includes('expired') ? 'Verification link has expired. Please try again.'
      : e.message.includes('email_taken') ? 'That email is no longer available.'
      : 'Invalid or already used verification link.';
    showToast(msg, 'error');
  }
}

async function initApp() {
  showLoading(true);
  try {
    await handleVerifyParams();
    runMigrations();

    // If logged in (real account), verify token before showing anything
    if (isLoggedIn() && !isSandbox()) {
      let valid = false;
      try { valid = await verifySession(); } catch { valid = false; }
      if (!valid) {
        // Token expired or invalid — back to login gate
        showLoading(false);
        document.body.classList.add('auth-gate');
        showAuthModal(async () => { await initApp(); }, { gate: true });
        return;
      }
      await syncFromServer();
    }

    // Seed demo data on first sandbox entry
    if (isSandbox() && !loadProjects().length) {
      const tpl = TEMPLATES[0];
      const tasks = tpl.tasks.map(t => ({ ...t, id: crypto.randomUUID(), updatedAt: Date.now() }));
      const projectId = crypto.randomUUID();
      saveProjects([{ id: projectId, name: `${tpl.icon} ${tpl.label}`, tasks }]);
      saveActiveProjectId(projectId);
    }

    await loadProjectData();
    updateSummary();
    setupFilters();
    render();
    // Reset scroll position on mobile after login/init
    if (window.innerWidth <= 768) {
      window.scrollTo(0, 0);
      document.querySelector('main').scrollTop = 0;
    }
  } catch (err) {
    showError(err.message);
  }
  showLoading(false);
  try {
    renderSidebarProjects();
    updateAccountUI();
  } catch (err) {
    console.error('[init] post-render error:', err);
  }
  document.body.classList.remove('auth-gate');
  hideAuthModal();

  // Onboarding for first-time visitors — only if no projects exist yet
  if (shouldShowOnboarding() && !loadProjects().length) {
    showOnboarding((projectId) => {
      if (projectId && projectId !== 'sheet') switchProject(projectId);
    });
  }

  bgFxReady.then(() => _bgFx.initBgEffects());
  const versionEl = document.getElementById('settings-version');
  if (versionEl) versionEl.textContent = `v${APP_VERSION}`;

  // QP Chat assistant — LOCAL DEV ONLY (comment out before pushing to live)
  initChat({
    getTasks: () => allTasks,
    onUpdateTask: (taskId, fields) => {
      const task = allTasks.find(t => t.id === taskId);
      if (!task) return;
      if (fields.task !== undefined) task.task = fields.task;
      if (fields.room !== undefined) task.room = fields.room;
      if (fields.category !== undefined) task.category = fields.category;
      if (fields.status !== undefined) task.status = fields.status;
      if (fields.assigned !== undefined) task.assigned = Array.isArray(fields.assigned) ? fields.assigned : (fields.assigned ? fields.assigned.split(',').filter(Boolean) : []);
      if (fields.startDate !== undefined) task.startDate = fields.startDate ? new Date(fields.startDate) : null;
      if (fields.endDate !== undefined) task.endDate = fields.endDate ? new Date(fields.endDate) : null;
      if (fields.dependencies !== undefined) task.dependencies = fields.dependencies;
      task.updatedAt = Date.now();
      setupFilters();
      render();
      persistTaskChange();
    },
    onAddTask: (fields) => {
      handleTaskCreate(fields);
    },
    onDeleteTask: (taskId) => {
      const task = allTasks.find(t => t.id === taskId);
      if (task) handleTaskDelete(task);
    },
  });
}

async function init() {
  initAuthUI();
  setupAccountButtons();

  if (!isLoggedIn()) {
    // Gate: hide app, show login
    document.body.classList.add('auth-gate');
    showAuthModal(async () => {
      await initApp();
    }, { gate: true });
    return;
  }

  await initApp();
}

function getInitials(user) {
  if (!user) return '';
  if (user.name) {
    const parts = user.name.trim().split(/\s+/);
    return parts.map(p => p[0]).slice(0, 2).join('').toUpperCase();
  }
  return (user.email || '?')[0].toUpperCase();
}

function updateAccountUI() {
  const loggedOut = $('#settings-account-logged-out');
  const loggedIn = $('#settings-account-logged-in');
  const emailEl = $('#settings-account-email');
  const user = getUser();
  const loggedInNow = isLoggedIn();

  // Settings card
  if (loggedOut && loggedIn) {
    if (loggedInNow) {
      loggedOut.classList.add('hidden');
      loggedIn.classList.remove('hidden');
      if (emailEl && user) emailEl.textContent = isSandbox() ? 'Sandbox mode (demo data)' : user.email;
    } else {
      loggedOut.classList.remove('hidden');
      loggedIn.classList.add('hidden');
    }
  }

  // Sandbox body class for badge
  document.body.classList.toggle('sandbox-mode', isSandbox());

  // Sidebar avatar
  const sidebarAvatar = $('#sidebar-account-avatar');
  const sidebarLabel = $('#sidebar-account-label');
  if (sidebarAvatar) {
    if (loggedInNow && user) {
      const initials = isSandbox() ? '🏗️' : getInitials(user);
      sidebarAvatar.textContent = initials;
      sidebarAvatar.classList.add('has-initials');
      if (isSandbox()) { sidebarAvatar.classList.add('sandbox'); }
      else {
        sidebarAvatar.classList.remove('sandbox');
        const ac = getAvatarColor(initials, { isOwner: true });
        sidebarAvatar.style.background = ac.bg;
        sidebarAvatar.style.color = ac.text;
      }
      if (sidebarLabel) sidebarLabel.textContent = isSandbox() ? 'Sandbox' : (user.name || user.email.split('@')[0]);
    } else {
      sidebarAvatar.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z"/></svg>';
      sidebarAvatar.classList.remove('has-initials');
      if (sidebarLabel) sidebarLabel.textContent = 'Account';
    }
  }

  // Mobile avatar
  const mobileAvatar = $('#mobile-account-avatar');
  const mobileLabel = $('#mobile-account-label');
  if (mobileAvatar) {
    if (loggedInNow && user) {
      const initials = getInitials(user);
      mobileAvatar.textContent = initials;
      mobileAvatar.classList.add('has-initials');
      if (mobileLabel) mobileLabel.textContent = user.name || user.email.split('@')[0];
    } else {
      mobileAvatar.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z"/></svg>';
      mobileAvatar.classList.remove('has-initials');
      if (mobileLabel) mobileLabel.textContent = 'Account';
    }
  }
}

function setupAccountButtons() {
  const loginBtn = $('#settings-login-btn');
  const logoutBtn = $('#settings-logout-btn');

  // Sidebar + mobile account buttons
  const authCallback = async () => {
    if (isSandbox()) {
      // Load the first template as sandbox data
      const tpl = TEMPLATES[0];
      const tasks = tpl.tasks.map(t => ({ ...t, id: crypto.randomUUID(), updatedAt: Date.now() }));
      const projectId = crypto.randomUUID();
      const projects = [{ id: projectId, name: `${tpl.icon} ${tpl.label}`, tasks }];
      saveProjects(projects);
      saveActiveProjectId(projectId);
      await loadProjectData();
      render();
      renderSidebarProjects();
      updateAccountUI();
      showToast('Sandbox mode - demo data loaded', 'info');
      return;
    }
    showToast('Syncing data...', 'info');
    await initialSync();
    await loadProjectData();
    render();
    renderSidebarProjects();
    updateAccountUI();
    showToast('Signed in and synced', 'success');
    if (hasWeakPassword()) {
      setTimeout(() => showToast('Your password doesn\u2019t meet current security standards. Update it in Settings \u203A Account.', 'warning'), 1500);
    }
  };
  const accountHandler = () => {
    if (isLoggedIn()) {
      // Navigate to settings (reuse existing settings button)
      $('#sidebar-settings-btn')?.click();
    } else {
      showAuthModal(authCallback);
    }
  };
  const sidebarAccountBtn = $('#sidebar-account-btn');
  if (sidebarAccountBtn) sidebarAccountBtn.addEventListener('click', accountHandler);
  const mobileAccountBtn = $('#mobile-account-btn');
  if (mobileAccountBtn) mobileAccountBtn.addEventListener('click', () => {
    // Close mobile menu by clicking overlay backdrop, then open auth/settings
    const overlay = $('#mobile-menu-overlay');
    if (overlay?.classList.contains('open')) {
      $('#mobile-menu-btn')?.click(); // toggle close
    }
    if (isLoggedIn()) {
      $('#sidebar-settings-btn')?.click();
    } else {
      showAuthModal(authCallback);
    }
  });

  if (loginBtn) {
    loginBtn.addEventListener('click', () => {
      showAuthModal(authCallback);
    });
  }

  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      logout();
      updateAccountUI();
      document.body.classList.add('auth-gate');
      showAuthModal(async () => {
        await initApp();
      }, { gate: true });
    });
  }

  // ── Change email ──
  const emailToggle = $('#change-email-toggle');
  const emailForm = $('#change-email-form');
  const emailCancel = $('#change-email-cancel');
  const emailSubmit = $('#change-email-submit');
  if (emailToggle && emailForm) {
    emailToggle.addEventListener('click', () => emailForm.classList.toggle('hidden'));
    emailCancel?.addEventListener('click', () => { emailForm.classList.add('hidden'); setMsg('change-email-msg'); });
    emailSubmit?.addEventListener('click', async () => {
      const newEmail = $('#new-email-input')?.value.trim();
      if (!newEmail) return;
      emailSubmit.disabled = true;
      emailSubmit.textContent = 'Sending...';
      setMsg('change-email-msg');
      try {
        const result = await requestEmailChange(newEmail);
        setMsg('change-email-msg', result.message, 'success');
      } catch (e) {
        setMsg('change-email-msg', e.message, 'error');
      } finally {
        emailSubmit.disabled = false;
        emailSubmit.textContent = 'Send verification email';
      }
    });
  }

  // ── Change password ──
  const pwToggle = $('#change-password-toggle');
  const pwForm = $('#change-password-form');
  const pwCancel = $('#change-password-cancel');
  const pwSubmit = $('#change-password-submit');
  const newPwInput = $('#new-password-input');
  const pwStrength = $('#new-password-strength');
  if (pwToggle && pwForm) {
    pwToggle.addEventListener('click', () => pwForm.classList.toggle('hidden'));
    pwCancel?.addEventListener('click', () => { pwForm.classList.add('hidden'); setMsg('change-password-msg'); });
    if (newPwInput && pwStrength) {
      newPwInput.addEventListener('focus', () => {
        loadZxcvbn().then(() => {
          if (newPwInput.value) renderPasswordStrength(newPwInput.value, pwStrength);
        });
      }, { once: true });
      newPwInput.addEventListener('input', () => {
        renderPasswordStrength(newPwInput.value, pwStrength);
        // If zxcvbn still loading, re-render once it arrives
        if (!window.zxcvbn) loadZxcvbn().then(() => renderPasswordStrength(newPwInput.value, pwStrength));
      });
    }
    pwSubmit?.addEventListener('click', async () => {
      const currentPw = $('#current-password-input')?.value;
      const newPw = newPwInput?.value;
      if (!currentPw || !newPw) return;
      if (!validatePasswordLength(newPw)) {
        setMsg('change-password-msg', 'Password must be at least 15 characters', 'error');
        return;
      }
      const breached = await checkPasswordBreach(newPw);
      if (breached) {
        setMsg('change-password-msg', 'This password has appeared in a data breach. Please choose a different one.', 'error');
        return;
      }
      pwSubmit.disabled = true;
      pwSubmit.textContent = 'Sending...';
      setMsg('change-password-msg');
      try {
        const result = await requestPasswordChange(currentPw, newPw);
        setMsg('change-password-msg', result.message, 'success');
      } catch (e) {
        setMsg('change-password-msg', e.message, 'error');
      } finally {
        pwSubmit.disabled = false;
        pwSubmit.textContent = 'Send verification email';
      }
    });
  }
}

function setMsg(id, text, type) {
  const el = document.getElementById(id);
  if (!el) return;
  if (!text) { el.classList.add('hidden'); el.textContent = ''; return; }
  el.textContent = text;
  el.className = `settings-msg ${type}`;
  el.classList.remove('hidden');
}

function setupFilters() {
  const opts = buildFilterOptions(allTasks);
  populateDropdown($('#filter-room'), opts.rooms, 'Rooms');
  populateDropdown($('#filter-category'), opts.categories, 'Categories');
  populateDropdown($('#filter-assigned'), opts.assigned, 'Assigned');
}

function getModalOptions() {
  const opts = buildFilterOptions(allTasks);
  return { categories: opts.categories, assignees: opts.assigned, rooms: opts.rooms, allTasks, getActiveProjectId: () => currentProjectId };
}

function handleTaskEdit(task) {
  openEditModal(task, getModalOptions(), ({ originalTask, updatedFields }) => {
    applyLocalUpdate(task, updatedFields);
    render();
    persistTaskChange();
    showToast('Saved', 'success');
  }, handleRoomChange, {
    onDelete: (t) => handleTaskDelete(t),
    onDuplicate: (t) => handleTaskDuplicate(t),
  });
}

function handleRoomChange({ action, oldRoom, newRoom, affectedTasks }) {
  if (action === 'rename') {
    affectedTasks.forEach(t => { t.room = newRoom; t.updatedAt = Date.now(); });
    setupFilters();
    render();
    persistTaskChange();
    showToast(`Room renamed`, 'success');
  } else if (action === 'delete') {
    affectedTasks.forEach(t => { t.room = ''; t.updatedAt = Date.now(); });
    setupFilters();
    render();
    persistTaskChange();
    showToast(`Room deleted`, 'success');
  }
}

function handleStatusChange(task, newStatus) {
  task.status = newStatus;
  task.updatedAt = Date.now();
  persistTaskChange();
}

function handleTaskDelete(task) {
  addToBin(task);
  const idx = allTasks.findIndex(t => t === task);
  if (idx !== -1) allTasks.splice(idx, 1);
  setupFilters();
  render();
  persistTaskChange();
  showToast('Task moved to bin (30 days to restore)', 'success');
}

function handleTaskDuplicate(task) {
  const copy = {
    ...task,
    id: crypto.randomUUID(),
    task: task.task + ' (copy)',
    startDate: task.startDate ? new Date(task.startDate) : null,
    endDate: task.endDate ? new Date(task.endDate) : null,
    status: 'To Do',
    updatedAt: Date.now(),
  };
  allTasks.push(copy);
  setupFilters();
  render();
  persistTaskChange();
  showToast('Task duplicated', 'success');
}

function handleTaskCreate(fields) {
  const rawCost = typeof fields.cost === 'string' ? fields.cost.replace(/[$,]/g, '') : fields.cost;
  const newTask = {
    id: crypto.randomUUID(),
    task: fields.task || 'New Task',
    room: fields.room || '',
    category: fields.category || '',
    status: fields.status || 'To Do',
    assigned: fields.assigned ? (Array.isArray(fields.assigned) ? fields.assigned : fields.assigned.split(',').filter(Boolean)) : [],
    startDate: fields.startDate ? new Date(fields.startDate) : null,
    endDate: fields.endDate ? new Date(fields.endDate) : null,
    dependencies: fields.dependencies || '',
    notes: fields.notes || '',
    cost: rawCost ? parseFloat(rawCost) || null : null,
    contact: fields.contact || '',
    updatedAt: Date.now(),
  };
  allTasks.push(newTask);
  setupFilters();
  render();
  persistTaskChange();
  showToast('Task created', 'success');
}

function applyLocalUpdate(task, fields) {
  if (fields.task) task.task = fields.task;
  if (fields.room !== undefined) task.room = fields.room;
  if (fields.category) task.category = fields.category;
  task.assigned = Array.isArray(fields.assigned) ? fields.assigned : (fields.assigned ? fields.assigned.split(',').filter(Boolean) : []);
  if (fields.status) task.status = fields.status;
  task.startDate = fields.startDate ? new Date(fields.startDate) : null;
  task.endDate = fields.endDate ? new Date(fields.endDate) : null;
  task.dependencies = fields.dependencies || '';
  task.tradeQuote = !!fields.tradeQuote;
  task.notes = fields.notes !== undefined ? (fields.notes || '') : (task.notes || '');
  if (fields.cost !== undefined) {
    const raw = typeof fields.cost === 'string' ? fields.cost.replace(/[$,]/g, '') : fields.cost;
    task.cost = raw ? parseFloat(raw) || null : null;
  }
  task.contact = fields.contact !== undefined ? (fields.contact || '') : (task.contact || '');
  task.updatedAt = Date.now();
}

function render() {
  const filtered = applyFilters(allTasks, filters);
  const kanbanContainer = $('#kanban-view');
  const plannerContainer = $('#planner-view');
  const todolistContainer = $('#todolist-view');

  kanbanContainer.classList.add('hidden');
  plannerContainer.classList.add('hidden');
  todolistContainer.classList.add('hidden');
  // Ensure overlay views are dismissed when rendering a task view
  const settingsEl = $('#settings-view');
  const trashEl = $('#trash-view');
  if (!settingsEl.classList.contains('hidden') || !trashEl.classList.contains('hidden')) {
    settingsEl.classList.add('hidden');
    trashEl.classList.add('hidden');
    $('.app-header').classList.remove('hidden');
    document.querySelector('main').classList.remove('settings-open');
  }

  if (currentView === 'kanban') {
    kanbanContainer.classList.remove('hidden');
    const groupBy = $('#group-by').value;
    renderKanban(kanbanContainer, filtered, groupBy, {
      onCardClick: handleTaskEdit,
      onStatusChange: handleStatusChange,
      onContextMenu: (event, task) => {
        showContextMenu(event, task, {
          onEdit: () => handleTaskEdit(task),
          onDelete: () => handleTaskDelete(task),
          onDuplicate: () => handleTaskDuplicate(task),
        });
      },
    });
  } else if (currentView === 'planner') {
    plannerContainer.classList.remove('hidden');
    renderPlanner(plannerContainer, filtered, {
      onBarClick: handleTaskEdit,
      onContextMenu: (event, task) => {
        showContextMenu(event, task, {
          onEdit: () => handleTaskEdit(task),
          onDelete: () => handleTaskDelete(task),
          onDuplicate: () => handleTaskDuplicate(task),
        });
      },
      onReschedule: (task, newStart, newEnd) => {
        task.startDate = newStart;
        task.endDate = newEnd;
        task.updatedAt = Date.now();
        persistTaskChange();
        render();
        showToast('Task rescheduled', 'success');
      },
    });
  } else if (currentView === 'todolist') {
    todolistContainer.classList.remove('hidden');
    renderTodoList(todolistContainer, filtered, {
      onStatusChange: handleStatusChange,
      onTaskClick: handleTaskEdit,
      onContextMenu: (event, task) => {
        showContextMenu(event, task, {
          onEdit: () => handleTaskEdit(task),
          onDelete: () => handleTaskDelete(task),
          onDuplicate: () => handleTaskDuplicate(task),
        });
      },
      onAssignChange: (task, newAssigned) => {
        task.assigned = Array.isArray(newAssigned) ? newAssigned : [newAssigned];
        task.updatedAt = Date.now();
        persistTaskChange();
        const label = Array.isArray(newAssigned) ? newAssigned.join(', ') : newAssigned;
        showToast(`Assigned to ${label}`, 'success');
      },
    });
  }
  renderFilterChips();
}

function fmtDateChip(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  return `${d.getDate()} ${d.toLocaleString('en-AU', { month: 'short' })}`;
}

function renderFilterChips() {
  const container = $('#filter-chips');
  if (!container) return;
  const activeFilters = ['room', 'category', 'assigned'].filter(k => filters[k]);
  const hasDateFilter = filters.dateFrom || filters.dateTo;
  if (activeFilters.length === 0 && !hasDateFilter) {
    container.classList.remove('has-chips');
    container.innerHTML = '';
    return;
  }
  container.classList.add('has-chips');
  const labels = { room: 'Room', category: 'Category', assigned: 'Assigned' };
  let html = '';
  activeFilters.forEach(key => {
    html += `<span class="filter-chip"><span class="filter-chip-label">${labels[key]}:</span> ${filters[key]}<button class="filter-chip-remove" data-filter="${key}" title="Remove filter" aria-label="Remove ${labels[key]} filter">&times;</button></span>`;
  });
  if (filters.dateFrom) {
    html += `<span class="filter-chip"><span class="filter-chip-label">From:</span> ${fmtDateChip(filters.dateFrom)}<button class="filter-chip-remove" data-filter="dateFrom" title="Remove filter" aria-label="Remove From date filter">&times;</button></span>`;
  }
  if (filters.dateTo) {
    html += `<span class="filter-chip"><span class="filter-chip-label">To:</span> ${fmtDateChip(filters.dateTo)}<button class="filter-chip-remove" data-filter="dateTo" title="Remove filter" aria-label="Remove To date filter">&times;</button></span>`;
  }
  html += `<button class="filter-chips-clear">Clear filters</button>`;
  container.innerHTML = html;

  const dateFilterIdMap = { dateFrom: 'date-from', dateTo: 'date-to' };
  container.querySelectorAll('.filter-chip-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.filter;
      filters[key] = '';
      const elKey = dateFilterIdMap[key] || key;
      const d = $(`#filter-${elKey}`); if (d) d.value = '';
      const m = $(`#m-filter-${elKey}`); if (m) m.value = '';
      _updateFilterBadge();
      render();
    });
  });
  container.querySelector('.filter-chips-clear').addEventListener('click', () => {
    filters.room = ''; filters.category = ''; filters.assigned = '';
    filters.dateFrom = ''; filters.dateTo = '';
    ['room', 'category', 'assigned'].forEach(key => {
      const d = $(`#filter-${key}`); if (d) d.value = '';
      const m = $(`#m-filter-${key}`); if (m) m.value = '';
    });
    const dfFrom = $('#filter-date-from'); if (dfFrom) dfFrom.value = '';
    const dfTo = $('#filter-date-to'); if (dfTo) dfTo.value = '';
    const mdfFrom = $('#m-filter-date-from'); if (mdfFrom) mdfFrom.value = '';
    const mdfTo = $('#m-filter-date-to'); if (mdfTo) mdfTo.value = '';
    _updateFilterBadge();
    render();
  });
}

function updateSummary() {}


function showLoading(show) {
  const el = $('#loading');
  if (show) {
    el.innerHTML = buildSkeleton(currentView);
    el.classList.remove('hidden');
    $('#kanban-view').classList.add('hidden');
    $('#planner-view').classList.add('hidden');
    $('#todolist-view').classList.add('hidden');
  } else {
    el.classList.add('hidden');
  }
}

function buildSkeleton(view) {
  if (view === 'planner') {
    const rows = Array(8).fill(0).map(() =>
      `<div class="skeleton-row"><div class="skeleton-label skeleton-pulse"></div><div class="skeleton-bar skeleton-pulse" style="width:${30 + Math.random() * 50}%"></div></div>`
    ).join('');
    return `<div class="skeleton skeleton-planner"><div class="skeleton-header skeleton-pulse"></div>${rows}</div>`;
  }
  if (view === 'todolist') {
    const cards = Array(6).fill(0).map(() =>
      `<div class="skeleton-card skeleton-pulse"></div>`
    ).join('');
    return `<div class="skeleton skeleton-todolist">${cards}</div>`;
  }
  // kanban
  const cols = Array(3).fill(0).map(() => {
    const cards = Array(3 + Math.floor(Math.random() * 3)).fill(0).map(() =>
      `<div class="skeleton-card skeleton-pulse"></div>`
    ).join('');
    return `<div class="skeleton-col"><div class="skeleton-col-header skeleton-pulse"></div>${cards}</div>`;
  }).join('');
  return `<div class="skeleton skeleton-kanban">${cols}</div>`;
}

function showError(msg) {
  const el = $('#error');
  el.innerHTML = `<div class="notification-inner"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg><div class="notification-text"><strong>Error</strong><span>${msg}</span></div></div>`;
  el.classList.remove('hidden');
}

function showToast(message, type = 'success') {
  const root = document.getElementById('toast-root');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  root.appendChild(toast);
  const duration = type === 'warning' ? 6000 : 3000;
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// ─── Import modal ─────────────────────────────────────────────────────────────

function setupImportModal() {
  const modal = $('#import-modal');
  const dropzone = $('#import-dropzone');
  const fileInput = $('#import-file-input');
  const urlInput = $('#import-url-input');
  const fieldsEl = $('#import-fields');
  const projectNameEl = $('#import-project-name');
  const userNameEl = $('#import-user-name');
  const errorEl = $('#import-error');
  const progressEl = $('#import-progress');
  const progressMsg = $('#import-progress-msg');
  const confirmBtn = $('#import-confirm');
  const cancelBtn = $('#import-cancel');

  let pendingCsvText = null;

  function openModal() {
    pendingCsvText = null;
    urlInput.value = '';
    projectNameEl.value = '';
    userNameEl.value = loadUserName();
    fieldsEl.classList.add('hidden');
    errorEl.classList.add('hidden');
    errorEl.textContent = '';
    progressEl.classList.add('hidden');
    confirmBtn.disabled = true;
    modal.showModal();
  }

  function showError(msg) {
    errorEl.textContent = msg;
    errorEl.classList.remove('hidden');
    fieldsEl.classList.add('hidden');
    confirmBtn.disabled = true;
    pendingCsvText = null;
  }

  function onValidCSV(text, suggestedName) {
    pendingCsvText = text;
    errorEl.classList.add('hidden');
    projectNameEl.value = suggestedName;
    fieldsEl.classList.remove('hidden');
    confirmBtn.disabled = false;
  }

  // Drop zone — click to browse
  dropzone.addEventListener('click', () => fileInput.click());
  const browseLink = dropzone.querySelector('.import-browse-link');
  if (browseLink) browseLink.addEventListener('click', (e) => { e.stopPropagation(); fileInput.click(); });

  // Drag and drop
  dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('drag-over'); });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag-over'));
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  });

  // File input
  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) processFile(fileInput.files[0]);
    fileInput.value = '';
  });

  function processFile(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        importCSV(e.target.result); // validates — throws if bad
        const name = file.name.replace(/\.csv$/i, '').replace(/_/g, ' ');
        onValidCSV(e.target.result, name);
      } catch (err) {
        showError(err.message);
      }
    };
    reader.readAsText(file);
  }

  // URL paste — validate on blur or enter
  async function processUrl() {
    const url = urlInput.value.trim();
    if (!url) return;
    confirmBtn.disabled = true;
    errorEl.classList.add('hidden');
    try {
      const csvUrl = sheetsUrlToCsvUrl(url);
      const res = await fetch(csvUrl);
      if (!res.ok) throw new Error(res.status === 403
        ? "Can't access the sheet — make sure it's set to 'Anyone with the link can view'"
        : `Fetch failed (${res.status})`);
      const text = await res.text();
      importCSV(text); // validate
      // Try to get a name from URL path
      const nameMatch = url.match(/\/spreadsheets\/d\/[^/]+\/[^/]*\/([^/?#]+)/);
      const name = nameMatch ? decodeURIComponent(nameMatch[1]).replace(/_/g, ' ') : 'Imported project';
      onValidCSV(text, name);
    } catch (err) {
      showError(err.message);
    }
  }

  urlInput.addEventListener('blur', processUrl);
  urlInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); processUrl(); } });

  // Confirm
  confirmBtn.addEventListener('click', async () => {
    if (!pendingCsvText) return;

    const name = projectNameEl.value.trim() || 'Imported project';
    const userName = userNameEl.value.trim();
    if (userName) saveUserName(userName);

    // Show progress
    fieldsEl.classList.add('hidden');
    errorEl.classList.add('hidden');
    confirmBtn.disabled = true;
    cancelBtn.disabled = true;
    progressMsg.textContent = userName
      ? `Thanks ${userName}, converting your tasks — this is going to be epic…`
      : 'Converting your tasks — this is going to be epic…';
    progressEl.classList.remove('hidden');

    // Small artificial delay for delight
    await new Promise(r => setTimeout(r, 900));

    try {
      const tasks = importCSV(pendingCsvText);
      const project = {
        id: crypto.randomUUID(),
        name,
        type: 'local',
        tasks: [],
        createdAt: Date.now(),
      };
      const projects = loadProjects();
      projects.push(project);
      saveProjects(projects);
      saveProjectTasks(project.id, tasks);
      syncToServer();

      modal.close();
      cancelBtn.disabled = false;
      await switchProject(project.id);
      showToast('Project ready!', 'success');
    } catch (err) {
      progressEl.classList.add('hidden');
      cancelBtn.disabled = false;
      confirmBtn.disabled = false;
      showError(err.message);
    }
  });

  // Cancel / backdrop close
  cancelBtn.addEventListener('click', () => modal.close());
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.close(); });

  // Expose for sidebar popout
  window._openImportModal = openModal;

  // Mobile import btn — opens modal directly
  const mobileImportBtn = $('#mobile-import-btn');
  if (mobileImportBtn) mobileImportBtn.addEventListener('click', () => {
    const menuBtn = $('#mobile-menu-btn');
    const menuOverlay = $('#mobile-menu-overlay');
    if (menuBtn) menuBtn.classList.remove('open');
    if (menuOverlay) menuOverlay.classList.remove('open');
    openModal();
  });
}

// ─── Settings panel ───────────────────────────────────────────────────────────

function setupSettingsPanel() {
  const PRESETS = [
    { hex: '#00E3FF', label: 'Cyan' },
    { hex: '#4F86F7', label: 'Blue' },
    { hex: '#7C5CFC', label: 'Purple' },
    { hex: '#E84393', label: 'Pink' },
    { hex: '#FF6B35', label: 'Orange' },
    { hex: '#2ECC71', label: 'Green' },
    { hex: '#F1C40F', label: 'Gold' },
    { hex: '#C9B458', label: 'Deep Gold' },
    { hex: '#A8998A', label: 'Warm Grey' },
  ];
  const DEFAULT_PRIMARY = '#00E3FF';

  const settingsView = $('#settings-view');
  const swatchContainer = $('#settings-swatches');
  const userSwatchesWrap = $('#settings-user-swatches-wrap');
  const userSwatchesContainer = $('#settings-user-swatches');
  const saved = loadCustomColors() || { primary1: DEFAULT_PRIMARY, secondary1: null, secondary2: null };
  const colors = { ...saved };
  let selected = colors.primary1 || DEFAULT_PRIMARY;
  let previousView = currentView;

  function clearAllActive() {
    swatchContainer.querySelectorAll('.onboarding-swatch').forEach(s => s.classList.remove('active'));
    userSwatchesContainer.querySelectorAll('.onboarding-swatch').forEach(s => s.classList.remove('active'));
  }

  function selectSwatch(hex) {
    selected = hex;
    colors.primary1 = hex;
    applyCustomColors(colors);
    clearAllActive();
    const all = [...swatchContainer.querySelectorAll('.onboarding-swatch'), ...userSwatchesContainer.querySelectorAll('.onboarding-swatch')];
    for (const s of all) {
      if (s.dataset.hex === hex) s.classList.add('active');
    }
  }

  // --- Preset swatches ---
  swatchContainer.innerHTML = '';
  PRESETS.forEach(p => {
    const swatch = document.createElement('button');
    swatch.className = 'onboarding-swatch' + (p.hex === selected ? ' active' : '');
    swatch.dataset.hex = p.hex;
    swatch.style.background = p.hex;
    swatch.title = p.label;
    swatch.setAttribute('aria-label', p.label);
    swatch.addEventListener('click', () => selectSwatch(p.hex));
    swatchContainer.appendChild(swatch);
  });

  const plus = document.createElement('button');
  plus.className = 'onboarding-swatch onboarding-swatch-plus';
  plus.title = 'Custom colour';
  plus.setAttribute('aria-label', 'Custom colour');
  plus.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>';
  plus.addEventListener('click', () => {
    clearAllActive();
    plus.classList.add('active');
    openColorPickerModal({
      title: 'Custom colour',
      initialHex: selected,
      onSave: (hex) => {
        plus.classList.remove('active');
        const allKnown = [...PRESETS.map(p => p.hex), ...loadUserSwatches()];
        if (!allKnown.includes(hex)) {
          const swatches = loadUserSwatches();
          swatches.push(hex);
          saveUserSwatches(swatches);
          renderUserSwatches();
        }
        selectSwatch(hex);
      },
    });
  });
  swatchContainer.appendChild(plus);

  // --- User-saved swatches (long-press to delete) ---
  function dismissConfirm() {
    const old = userSwatchesContainer.querySelector('.swatch-remove-confirm');
    if (old) old.remove();
    userSwatchesContainer.querySelectorAll('.jiggling').forEach(el => el.classList.remove('jiggling'));
  }

  function renderUserSwatches() {
    const userSwatches = loadUserSwatches();
    userSwatchesContainer.innerHTML = '';
    if (userSwatches.length === 0) {
      userSwatchesWrap.style.display = 'none';
      return;
    }
    userSwatchesWrap.style.display = '';
    userSwatches.forEach((hex, i) => {
      const wrap = document.createElement('div');
      wrap.className = 'swatch-removable';

      const swatch = document.createElement('button');
      swatch.className = 'onboarding-swatch' + (hex === selected ? ' active' : '');
      swatch.dataset.hex = hex;
      swatch.style.background = hex;
      swatch.title = hex;
      swatch.setAttribute('aria-label', `Custom colour ${hex}`);

      let pressTimer = null;
      let didLongPress = false;

      function startPress() {
        didLongPress = false;
        pressTimer = setTimeout(() => {
          didLongPress = true;
          dismissConfirm();
          wrap.classList.add('jiggling');
          const confirm = document.createElement('button');
          confirm.className = 'swatch-remove-confirm';
          confirm.textContent = 'Remove';
          confirm.addEventListener('click', (e) => {
            e.stopPropagation();
            const swatches = loadUserSwatches();
            swatches.splice(i, 1);
            saveUserSwatches(swatches);
            renderUserSwatches();
          });
          wrap.appendChild(confirm);
        }, 500);
      }
      function cancelPress() {
        clearTimeout(pressTimer);
      }

      swatch.addEventListener('pointerdown', startPress);
      swatch.addEventListener('pointerup', cancelPress);
      swatch.addEventListener('pointerleave', cancelPress);
      swatch.addEventListener('click', (e) => {
        if (didLongPress) { e.preventDefault(); return; }
        dismissConfirm();
        selectSwatch(hex);
      });

      wrap.appendChild(swatch);
      userSwatchesContainer.appendChild(wrap);
    });
  }
  renderUserSwatches();

  settingsView.addEventListener('click', dismissConfirm);

  // Reset brand palette to default cyan
  $('#settings-reset').addEventListener('click', () => {
    colors.primary1 = DEFAULT_PRIMARY;
    colors.secondary1 = null;
    colors.secondary2 = null;
    saveCustomColors(colors);
    applyCustomColors(colors);
    selectSwatch(DEFAULT_PRIMARY);
  });

  // --- BG Effects toggle ---
  const $active = $('#bgfx-active');
  $active.addEventListener('change', () => _bgFx.setConfig({ active: $active.checked }));

  // --- Export CSV ---
  const exportBtn = $('#settings-export-btn');
  if (exportBtn) {
    exportBtn.addEventListener('click', () => {
      exportToCSV(allTasks, getProjectName());
    });
  }

  // --- Backup / Restore ---
  const backupBtn = $('#settings-backup-btn');
  const restoreBtn = $('#settings-restore-btn');
  const restoreInput = $('#settings-restore-input');
  if (backupBtn) backupBtn.addEventListener('click', () => exportBackup());
  if (restoreBtn) restoreBtn.addEventListener('click', () => restoreInput.click());
  if (restoreInput) restoreInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    restoreInput.value = '';
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const data = JSON.parse(reader.result);
        const keys = Object.keys(data).filter(k => k.startsWith('qp-'));
        if (!keys.length) { showToast('No backup data found in file', 'error'); return; }
        const { openRestoreModal } = await import('./restore-modal.js');
        openRestoreModal(data, { onComplete: () => { window.location.href = window.location.pathname; }, showToast });
      } catch (err) {
        showToast('Invalid backup file', 'error');
      }
    };
    reader.readAsText(file);
  });

  // --- People section ---
  const _people = initPeopleSection($('#settings-people'), {
    getActiveProjectId: () => currentProjectId,
  });

  // --- Assistant settings ---
  const aiKeyInput = $('#settings-ai-key');
  const aiTtsToggle = $('#settings-ai-tts');
  const aiBriefingSelect = $('#settings-ai-briefing');
  const aiClearBtn = $('#settings-ai-clear');
  const aiClaudeRadio = $('#settings-ai-provider-claude');
  const aiLocalRadio = $('#settings-ai-provider-local');
  const aiClaudeFields = $('#settings-ai-claude-fields');
  const aiLocalFields = $('#settings-ai-local-fields');
  const aiTestBtn = $('#settings-ai-test');
  const aiStatus = $('#settings-ai-status');
  const aiEndpointInput = $('#settings-ai-endpoint');
  const aiModelInput = $('#settings-ai-model');
  const aiLocalKeyInput = $('#settings-ai-local-key');
  const aiLocalTestBtn = $('#settings-ai-local-test');
  const aiLocalStatus = $('#settings-ai-local-status');

  // Load saved provider config
  const providerCfg = getProviderConfig();
  if (aiKeyInput) aiKeyInput.value = providerCfg.apiKey;
  if (aiEndpointInput) aiEndpointInput.value = providerCfg.endpoint;
  if (aiModelInput) aiModelInput.value = providerCfg.model;
  if (aiLocalKeyInput) aiLocalKeyInput.value = providerCfg.localKey;
  if (aiTtsToggle) aiTtsToggle.checked = getTTSEnabled();
  if (aiBriefingSelect) aiBriefingSelect.value = getBriefingMode();

  // Show correct provider fields
  function showProviderFields(provider) {
    if (aiClaudeFields) aiClaudeFields.classList.toggle('hidden', provider !== 'claude');
    if (aiLocalFields) aiLocalFields.classList.toggle('hidden', provider !== 'local');
  }
  if (providerCfg.provider === 'local' && aiLocalRadio) aiLocalRadio.checked = true;
  showProviderFields(providerCfg.provider);

  // Provider radio change
  document.querySelectorAll('input[name="ai-provider"]').forEach(radio => {
    radio.addEventListener('change', () => {
      setProvider(radio.value);
      showProviderFields(radio.value);
      showToast(`Provider set to ${radio.value === 'claude' ? 'Claude API' : 'Local LLM'}`, 'success');
    });
  });

  // Helper: update Claude status display
  function setClaudeStatus(text, type) {
    if (!aiStatus) return;
    aiStatus.textContent = text;
    const cls = type === 'ok' ? 'settings-ai-status-ok'
      : type === 'err' ? 'settings-ai-status-err'
      : type === 'info' ? 'settings-ai-status-info' : '';
    aiStatus.className = `settings-ai-status ${cls}`;
  }

  // Show persisted verification status on load
  if (providerCfg.apiKey && aiStatus) {
    const verified = localStorage.getItem('qp-ai-verified');
    if (verified === 'ok') {
      setClaudeStatus('\u2713 Connected — key stored in this browser only', 'ok');
    } else if (providerCfg.apiKey.startsWith('sk-ant-')) {
      setClaudeStatus('Key saved — click Test connection to verify', 'info');
    } else {
      setClaudeStatus('Key should start with sk-ant-', 'err');
    }
  }

  // Claude API key — auto-save on input (paste or type) with debounce
  let _aiKeySaveTimer = null;
  function saveApiKey() {
    const val = aiKeyInput.value.trim();
    if (val) {
      localStorage.setItem('qp-ai-key', val);
      localStorage.removeItem('qp-ai-verified');
      if (!val.startsWith('sk-ant-')) {
        setClaudeStatus('Key should start with sk-ant-', 'err');
      } else {
        setClaudeStatus('Key saved — click Test connection to verify', 'info');
      }
    } else {
      localStorage.removeItem('qp-ai-key');
      localStorage.removeItem('qp-ai-verified');
      setClaudeStatus('', '');
    }
  }

  if (aiKeyInput) {
    aiKeyInput.addEventListener('input', () => {
      clearTimeout(_aiKeySaveTimer);
      _aiKeySaveTimer = setTimeout(saveApiKey, 400);
    });
    aiKeyInput.addEventListener('change', () => {
      clearTimeout(_aiKeySaveTimer);
      saveApiKey();
    });
  }

  // Claude test connection — button stays standard, feedback in status text only
  if (aiTestBtn) aiTestBtn.addEventListener('click', async () => {
    aiTestBtn.disabled = true;
    aiTestBtn.textContent = 'Testing\u2026';
    setClaudeStatus('Connecting to Anthropic\u2026', 'info');
    try {
      const result = await testClaudeConnection();
      if (result.ok) {
        setClaudeStatus(`\u2713 Connected (${result.models})`, 'ok');
        localStorage.setItem('qp-ai-verified', 'ok');
        showToast('API key verified — advanced features unlocked', 'success');
      } else {
        setClaudeStatus(result.message, 'err');
        localStorage.removeItem('qp-ai-verified');
        showToast(result.message, 'error');
      }
    } catch (err) {
      setClaudeStatus(err.message, 'err');
      localStorage.removeItem('qp-ai-verified');
      showToast('Could not reach Anthropic API', 'error');
    }
    aiTestBtn.disabled = false;
    aiTestBtn.textContent = 'Test connection';
  });

  // Local LLM settings
  if (aiEndpointInput) aiEndpointInput.addEventListener('change', () => {
    setLocalConfig({ endpoint: aiEndpointInput.value.trim() });
    if (aiLocalStatus) { aiLocalStatus.textContent = ''; aiLocalStatus.className = 'settings-ai-status'; }
    showToast('Endpoint saved', 'success');
  });
  if (aiModelInput) aiModelInput.addEventListener('change', () => {
    setLocalConfig({ model: aiModelInput.value.trim() });
    showToast('Model saved', 'success');
  });
  if (aiLocalKeyInput) aiLocalKeyInput.addEventListener('change', () => {
    setLocalConfig({ localKey: aiLocalKeyInput.value.trim() });
    showToast('API key saved', 'success');
  });

  // Local LLM test connection
  if (aiLocalTestBtn) aiLocalTestBtn.addEventListener('click', async () => {
    aiLocalTestBtn.disabled = true;
    aiLocalTestBtn.textContent = 'Testing…';
    if (aiLocalStatus) { aiLocalStatus.textContent = ''; aiLocalStatus.className = 'settings-ai-status'; }
    try {
      const result = await testLocalConnection();
      if (aiLocalStatus) {
        aiLocalStatus.textContent = result.ok
          ? `Connected (${result.models})`
          : result.message;
        aiLocalStatus.className = `settings-ai-status ${result.ok ? 'settings-ai-status-ok' : 'settings-ai-status-err'}`;
      }
      showToast(result.ok ? `Connected to local LLM (${result.models})` : result.message, result.ok ? 'success' : 'error');
    } catch (err) {
      if (aiLocalStatus) {
        aiLocalStatus.textContent = `Error: ${err.message}`;
        aiLocalStatus.className = 'settings-ai-status settings-ai-status-err';
      }
      showToast(`Could not reach local LLM: ${err.message}`, 'error');
    }
    aiLocalTestBtn.disabled = false;
    aiLocalTestBtn.textContent = 'Test connection';
  });

  // TTS + briefing + clear
  if (aiTtsToggle) aiTtsToggle.addEventListener('change', () => {
    setTTSEnabled(aiTtsToggle.checked);
    showToast(`Voice responses ${aiTtsToggle.checked ? 'enabled' : 'disabled'}`, 'success');
  });

  if (aiBriefingSelect) aiBriefingSelect.addEventListener('change', () => {
    setBriefingMode(aiBriefingSelect.value);
    showToast(`Task summary set to ${aiBriefingSelect.value}`, 'success');
  });

  if (aiClearBtn) aiClearBtn.addEventListener('click', () => {
    showConfirmDialog({
      title: 'Clear chat history?',
      body: 'All assistant messages will be permanently deleted.',
      confirmLabel: 'Clear',
      onConfirm: () => {
        clearConversation();
        showToast('Conversation cleared', 'success');
      },
    });
  });

  // --- Settings tabs ---
  const settingsTabs = document.querySelectorAll('.settings-tab');
  const settingsPanels = document.querySelectorAll('.settings-tab-panel');

  function switchSettingsTab(tabName) {
    settingsTabs.forEach(t => t.classList.toggle('active', t.dataset.tab === tabName));
    settingsPanels.forEach(p => p.classList.toggle('active', p.dataset.panel === tabName));
    settingsView.scrollTop = 0;
  }

  settingsTabs.forEach(tab => {
    tab.addEventListener('click', () => switchSettingsTab(tab.dataset.tab));
  });

  // --- Open / close settings view ---
  function showSettings() {
    previousView = currentView;
    $('.app-header').classList.add('hidden');
    $('#kanban-view').classList.add('hidden');
    $('#planner-view').classList.add('hidden');
    $('#todolist-view').classList.add('hidden');
    trashView.classList.add('hidden');
    settingsView.classList.remove('hidden');
    $active.checked = _bgFx.getConfig().active;
    document.querySelector('main').classList.add('settings-open');
    // Reset to General tab
    switchSettingsTab('general');
    sessionStorage.setItem('qp-view', 'settings');
    // Refresh people section
    if (_people) _people.load();
  }

  function hideSettings() {
    settingsView.classList.add('hidden');
    $('.app-header').classList.remove('hidden');
    document.querySelector('main').classList.remove('settings-open');
    saveCustomColors(colors);
    sessionStorage.removeItem('qp-view');
    // Restore previous view
    currentView = previousView;
    render();
  }

  // Restore settings view if it was open before refresh
  if (sessionStorage.getItem('qp-view') === 'settings') {
    showSettings();
  }

  $('#sidebar-settings-btn').addEventListener('click', showSettings);
  $('#settings-back').addEventListener('click', hideSettings);

  $('#settings-master-setup')?.addEventListener('click', () => {
    hideSettings();
    showOnboarding((projectId) => {
      if (projectId && projectId !== 'sheet') switchProject(projectId);
    });
  });

  // Expose for mobile menu
  window._showSettings = showSettings;

  // --- Trash view ---
  const trashView = $('#trash-view');
  const trashList = $('#trash-list');
  const trashSearch = $('#trash-search');

  function hideAllViews() {
    $('.app-header').classList.add('hidden');
    $('#kanban-view').classList.add('hidden');
    $('#planner-view').classList.add('hidden');
    $('#todolist-view').classList.add('hidden');
    settingsView.classList.add('hidden');
    document.querySelector('main').classList.add('settings-open');
  }

  function renderTrashList(filter = '') {
    const taskBin = loadBin();
    const projectBin = loadProjectBin();
    const q = filter.toLowerCase();
    const filteredTasks = q ? taskBin.filter(e => e.task.task?.toLowerCase().includes(q) || e.task.room?.toLowerCase().includes(q)) : taskBin;
    const filteredProjects = q ? projectBin.filter(e => e.project.name?.toLowerCase().includes(q)) : projectBin;
    const totalItems = filteredTasks.length + filteredProjects.length;

    if (!totalItems) {
      trashList.innerHTML = `
        <div class="trash-empty">
          <img class="trash-empty-animal" src="images/mascot-trash.png" alt="" aria-hidden="true">
          <p class="trash-empty-title">${q ? 'No results' : 'Nothing to do.'}</p>
          <p class="trash-empty-body">${q ? 'No deleted items match that search.' : 'You can restore projects and their tasks before they are automatically deleted after 30 days.'}</p>
        </div>`;
      return;
    }

    let html = `<p class="trash-intro">You can restore projects and their tasks before they are automatically deleted after 30 days.</p>`;

    // Projects section
    if (filteredProjects.length) {
      html += filteredProjects.map((entry) => {
        const p = entry.project;
        const daysAgo = Math.floor((Date.now() - entry.deletedAt) / 86400000);
        const expires = 30 - daysAgo;
        const taskCount = (p.tasks || []).length;
        return `
          <div class="trash-project" data-project-id="${p.id}">
            <button class="trash-project-header" aria-expanded="false">
              <span class="trash-project-name">${p.name || '(untitled)'}</span>
              <span class="trash-project-meta">${taskCount} task${taskCount !== 1 ? 's' : ''} · deleted ${daysAgo === 0 ? 'today' : daysAgo + 'd ago'} · expires in ${expires}d</span>
              <svg class="trash-project-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>
            </button>
            <div class="trash-project-tasks hidden">
              ${(p.tasks || []).map(t => `
                <div class="trash-item trash-item--nested">
                  <div class="trash-item-title">${t.task || '(no name)'}</div>
                  <div class="trash-item-meta">${[t.room, t.status, t.category].filter(Boolean).join(' · ')}</div>
                </div>
              `).join('')}
              <div class="trash-item-actions">
                <button class="modal-btn modal-save trash-restore-project-btn" data-project-id="${p.id}">Restore project</button>
                <button class="modal-btn modal-cancel trash-delete-project-btn" data-project-id="${p.id}">Delete permanently</button>
              </div>
            </div>
          </div>
        `;
      }).join('');
    }

    // Tasks section (individual tasks not attached to a project)
    if (filteredTasks.length) {
      if (filteredProjects.length) html += `<div class="trash-section-label">Individual tasks</div>`;
      html += filteredTasks.map((entry, i) => {
        const t = entry.task;
        const daysAgo = Math.floor((Date.now() - entry.deletedAt) / 86400000);
        const expires = 30 - daysAgo;
        return `
          <div class="trash-item" data-index="${i}">
            <div class="trash-item-title">${t.task || '(no name)'}</div>
            <div class="trash-item-meta">${[t.room, t.status, t.category].filter(Boolean).join(' · ')}</div>
            <div class="trash-item-meta">Deleted ${daysAgo === 0 ? 'today' : daysAgo + 'd ago'} · expires in ${expires}d</div>
            <div class="trash-item-actions">
              <button class="modal-btn modal-save trash-restore-btn" data-name="${encodeURIComponent(t.task)}">Restore</button>
              <button class="modal-btn modal-cancel trash-delete-btn" data-name="${encodeURIComponent(t.task)}">Delete permanently</button>
            </div>
          </div>
        `;
      }).join('');
    }

    trashList.innerHTML = html;

    // Project expand/collapse
    trashList.querySelectorAll('.trash-project-header').forEach(btn => {
      btn.addEventListener('click', () => {
        const expanded = btn.getAttribute('aria-expanded') === 'true';
        btn.setAttribute('aria-expanded', !expanded);
        btn.nextElementSibling.classList.toggle('hidden', expanded);
      });
    });

    // Restore project
    trashList.querySelectorAll('.trash-restore-project-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.projectId;
        const restored = restoreProjectFromBin(id);
        if (restored) {
          // Revive date strings on tasks
          (restored.tasks || []).forEach(t => {
            ['startDate', 'endDate'].forEach(k => { if (t[k]) t[k] = new Date(t[k]); });
          });
          const projects = loadProjects();
          projects.push(restored);
          saveProjects(projects);
          syncToServer();
          renderSidebarProjects();
          showToast('Project restored', 'success');
          renderTrashList(trashSearch.value);
        }
      });
    });

    // Delete project permanently
    trashList.querySelectorAll('.trash-delete-project-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.projectId;
        showConfirmDialog({
          title: 'Delete permanently?',
          body: 'This project and all its tasks cannot be recovered.',
          confirmLabel: 'Delete',
          onConfirm: () => {
            restoreProjectFromBin(id); // removes from bin
            renderTrashList(trashSearch.value);
          },
        });
      });
    });

    // Restore individual task
    trashList.querySelectorAll('.trash-restore-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const name = decodeURIComponent(btn.dataset.name);
        const restored = restoreFromBin(name);
        if (restored) {
          ['startDate', 'endDate'].forEach(k => { if (restored[k]) restored[k] = new Date(restored[k]); });
          allTasks.push(restored);
          persistTaskChange();
          showToast('Task restored', 'success');
          renderTrashList(trashSearch.value);
        }
      });
    });

    // Delete individual task permanently
    trashList.querySelectorAll('.trash-delete-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const name = decodeURIComponent(btn.dataset.name);
        showConfirmDialog({
          title: 'Delete permanently?',
          body: 'This task cannot be recovered.',
          confirmLabel: 'Delete',
          onConfirm: () => {
            restoreFromBin(name);
            renderTrashList(trashSearch.value);
          },
        });
      });
    });
  }

  function showTrashView() {
    hideAllViews();
    trashView.classList.remove('hidden');
    trashView.scrollTop = 0;
    trashSearch.value = '';
    renderTrashList();
  }

  function hideTrashView() {
    trashView.classList.add('hidden');
    $('.app-header').classList.remove('hidden');
    document.querySelector('main').classList.remove('settings-open');
    currentView = previousView;
    render();
  }

  trashSearch.addEventListener('input', () => renderTrashList(trashSearch.value));
  $('#trash-back').addEventListener('click', hideTrashView);
  $('#sidebar-trash-btn').addEventListener('click', () => { previousView = currentView; showTrashView(); });

  const mobileTrashBtn = $('#mobile-trash-btn');
  if (mobileTrashBtn) mobileTrashBtn.addEventListener('click', () => {
    closeMenu();
    previousView = currentView;
    showTrashView();
  });

  window._showTrash = showTrashView;

  // Logo / home tap — return to last main view from any overlay
  function goHome() {
    if (trashView && !trashView.classList.contains('hidden')) {
      hideTrashView();
    } else if (settingsView && !settingsView.classList.contains('hidden')) {
      hideSettings();
    }
  }
  $('#sidebar-top').addEventListener('click', goHome);
  const mobileLogo = $('#mobile-logo-home');
  if (mobileLogo) mobileLogo.addEventListener('click', goHome);
}

document.addEventListener('DOMContentLoaded', () => {
  // Apply saved custom colors before first render
  initCustomColors();

  init();

  // Settings panel
  setupSettingsPanel();

  // Import modal
  setupImportModal();

  // Sidebar + project button — popout with two options
  const sidebarAddBtn = $('#sidebar-import-btn');
  const sidebarAddMenu = $('#sidebar-add-menu');
  if (sidebarAddBtn && sidebarAddMenu) {
    document.body.appendChild(sidebarAddMenu);
    sidebarAddBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const wasOpen = sidebarAddMenu.classList.contains('open');
      closeAllPopovers();
      if (!wasOpen) {
        sidebarAddMenu.classList.add('open');
        positionPopover(sidebarAddMenu, sidebarAddBtn);
      }
    });
    $('#sidebar-add-import-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      sidebarAddMenu.classList.remove('open');
      if (window._openImportModal) window._openImportModal();
    });
    $('#sidebar-add-template-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      sidebarAddMenu.classList.remove('open');
      showOnboarding((projectId) => {
        if (projectId && projectId !== 'sheet') switchProject(projectId);
      });
    });
  }

  // Close popovers: outside click, Escape, scroll
  document.addEventListener('click', closeAllPopovers);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAllPopovers(); });
  window.addEventListener('scroll', closeAllPopovers, { passive: true });

  // Add task — FAB (mobile) + header button (desktop)
  function handleAddTask() {
    const blankTask = { id: null, task: '', room: '', category: '', status: 'To Do', assigned: [], startDate: null, endDate: null, dependencies: '' };
    openEditModal(blankTask, getModalOptions(), ({ updatedFields }) => {
      handleTaskCreate(updatedFields);
    }, handleRoomChange, {});
  }
  const fabAdd = $('#fab-add');
  if (fabAdd) fabAdd.addEventListener('click', handleAddTask);
  const headerAddBtn = $('#header-add-btn');
  if (headerAddBtn) headerAddBtn.addEventListener('click', handleAddTask);

  // View toggles
  // Set active tab from saved view
  document.querySelectorAll('.view-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.view === currentView);
  });
  $('#group-by-wrap').classList.toggle('hidden', currentView !== 'kanban');
  $('#view-size-wrap').classList.toggle('hidden', currentView !== 'planner');

  function closeOverlayViews() {
    $('#settings-view').classList.add('hidden');
    $('#trash-view').classList.add('hidden');
    $('.app-header').classList.remove('hidden');
    document.querySelector('main').classList.remove('settings-open');
  }
  window._closeOverlayViews = closeOverlayViews;

  document.querySelectorAll('.view-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      closeOverlayViews();
      document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentView = btn.dataset.view;
      localStorage.setItem('qp-view', currentView);
      $('#group-by-wrap').classList.toggle('hidden', currentView !== 'kanban');
      $('#view-size-wrap').classList.toggle('hidden', currentView !== 'planner');
      window.scrollTo(0, 0);
      document.querySelector('main').scrollTop = 0;
      render();
    });
  });

  // Filters
  ['filter-room', 'filter-category', 'filter-assigned'].forEach(id => {
    $(`#${id}`).addEventListener('change', (e) => {
      filters[id.replace('filter-', '')] = e.target.value;
      updateFilterBadge();
      render();
    });
  });

  // Date filters (desktop)
  ['filter-date-from', 'filter-date-to'].forEach(id => {
    const el = $(`#${id}`);
    if (el) {
      el.addEventListener('change', (e) => {
        const key = id === 'filter-date-from' ? 'dateFrom' : 'dateTo';
        filters[key] = e.target.value;
        // Sync to mobile
        const mId = id.replace('filter-', 'm-filter-');
        const mEl = $(`#${mId}`);
        if (mEl) mEl.value = e.target.value;
        updateFilterBadge();
        render();
      });
    }
  });

  // Search (desktop)
  $('#search-tasks').addEventListener('input', (e) => {
    filters.search = e.target.value.trim();
    render();
  });

  // Mobile search overlay
  const mobileSearchOverlay = $('#mobile-search-overlay');
  const mobileSearchInput = $('#mobile-search-input');
  const mobileSearchBtn = $('#mobile-search-btn');
  const mobileSearchClose = $('#mobile-search-close');
  const mobileSearchResults = $('#mobile-search-results');

  function renderMobileSearchResults(q) {
    if (!mobileSearchResults) return;
    if (!q) { mobileSearchResults.innerHTML = ''; return; }
    const lower = q.toLowerCase();
    const matches = allTasks.filter(t =>
      t.task.toLowerCase().includes(lower) ||
      (t.room && t.room.toLowerCase().includes(lower)) ||
      (t.category && t.category.toLowerCase().includes(lower))
    ).slice(0, 25);

    if (matches.length === 0) {
      mobileSearchResults.innerHTML = `<div class="mobile-search-empty">No tasks match "<strong>${q}</strong>"</div>`;
      return;
    }
    mobileSearchResults.innerHTML = '';
    matches.forEach(task => {
      const row = document.createElement('button');
      row.className = 'mobile-search-result-row';
      row.innerHTML = `<span class="msr-title">${task.task}</span><span class="msr-meta">${task.room}${task.status ? ' · ' + task.status : ''}</span>`;
      row.addEventListener('click', () => {
        closeMobileSearch();
        handleTaskEdit(task);
      });
      mobileSearchResults.appendChild(row);
    });
  }

  function openMobileSearch() {
    mobileSearchInput.value = filters.search;
    renderMobileSearchResults(filters.search);
    mobileSearchOverlay.classList.add('open');
    requestAnimationFrame(() => mobileSearchInput.focus());
  }
  function closeMobileSearch() {
    mobileSearchOverlay.classList.remove('open');
    mobileSearchInput.blur();
  }

  if (mobileSearchBtn) mobileSearchBtn.addEventListener('click', openMobileSearch);
  if (mobileSearchClose) mobileSearchClose.addEventListener('click', closeMobileSearch);
  if (mobileSearchInput) {
    mobileSearchInput.addEventListener('input', (e) => {
      const q = e.target.value.trim();
      filters.search = q;
      renderMobileSearchResults(q);
      // Mirror to desktop input for consistency
      const desktopInput = $('#search-tasks');
      if (desktopInput) desktopInput.value = q;
      render();
    });
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && mobileSearchOverlay && mobileSearchOverlay.classList.contains('open')) {
      closeMobileSearch();
    }
  });

  // Mobile filter overlay
  const mobileFilterOverlay = $('#mobile-filter-overlay');
  const mobileFilterBtn = $('#mobile-filter-btn');
  const mobileFilterBadge = $('#mobile-filter-badge');
  const mobileFilterDone = $('#mobile-filter-done');
  const mobileFilterClear = $('#mobile-filter-clear');
  const desktopFilterBtn = $('#desktop-filter-btn');
  const desktopFilterBadge = $('#desktop-filter-badge');
  const desktopFilterPopover = $('#desktop-filter-popover');

  // Desktop filter popover toggle
  if (desktopFilterBtn && desktopFilterPopover) {
    desktopFilterBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = desktopFilterPopover.classList.toggle('hidden') === false;
      desktopFilterBtn.classList.toggle('active', isOpen);
      if (isOpen) {
        const rect = desktopFilterBtn.getBoundingClientRect();
        desktopFilterPopover.style.top = (rect.bottom + 10) + 'px';
        desktopFilterPopover.style.right = (window.innerWidth - rect.right) + 'px';
      }
    });
    document.addEventListener('click', (e) => {
      if (!desktopFilterPopover.classList.contains('hidden') &&
          !desktopFilterBtn.contains(e.target) &&
          !desktopFilterPopover.contains(e.target)) {
        desktopFilterPopover.classList.add('hidden');
        desktopFilterBtn.classList.remove('active');
      }
    });
  }

  function updateFilterBadge() {
    const count = [filters.room, filters.category, filters.assigned, filters.dateFrom, filters.dateTo].filter(Boolean).length;
    if (mobileFilterBadge) {
      mobileFilterBadge.textContent = count;
      mobileFilterBadge.classList.toggle('hidden', count === 0);
    }
    if (desktopFilterBadge) {
      desktopFilterBadge.textContent = count;
      desktopFilterBadge.classList.toggle('hidden', count === 0);
    }
  }
  _updateFilterBadge = updateFilterBadge;

  function syncMobileFilterSelects() {
    // Copy options from desktop selects (populated by buildFilterOptions)
    ['room', 'category', 'assigned'].forEach(key => {
      const desktop = $(`#filter-${key}`);
      const mobile = $(`#m-filter-${key}`);
      if (desktop && mobile) {
        mobile.innerHTML = desktop.innerHTML;
        mobile.value = filters[key];
      }
    });
    // Sync date filter values to mobile
    const mDateFrom = $('#m-filter-date-from');
    const mDateTo = $('#m-filter-date-to');
    if (mDateFrom) mDateFrom.value = filters.dateFrom;
    if (mDateTo) mDateTo.value = filters.dateTo;
    const mGroupBy = $('#m-group-by');
    const dGroupBy = $('#group-by');
    if (mGroupBy && dGroupBy) mGroupBy.value = dGroupBy.value;
    // Show/hide group-by row based on current view
    const mGroupByWrap = $('#m-group-by-wrap');
    if (mGroupByWrap) mGroupByWrap.style.display = currentView === 'kanban' ? '' : 'none';
  }

  function openMobileFilter() {
    syncMobileFilterSelects();
    mobileFilterOverlay.classList.add('open');
  }
  function closeMobileFilter() {
    mobileFilterOverlay.classList.remove('open');
  }

  if (mobileFilterBtn) mobileFilterBtn.addEventListener('click', openMobileFilter);
  if (mobileFilterDone) mobileFilterDone.addEventListener('click', closeMobileFilter);
  if (mobileFilterClear) {
    mobileFilterClear.addEventListener('click', () => {
      filters.room = ''; filters.category = ''; filters.assigned = '';
      filters.dateFrom = ''; filters.dateTo = '';
      ['room', 'category', 'assigned'].forEach(key => {
        const d = $(`#filter-${key}`); if (d) d.value = '';
        const m = $(`#m-filter-${key}`); if (m) m.value = '';
      });
      const dfFrom = $('#filter-date-from'); if (dfFrom) dfFrom.value = '';
      const dfTo = $('#filter-date-to'); if (dfTo) dfTo.value = '';
      const mdfFrom = $('#m-filter-date-from'); if (mdfFrom) mdfFrom.value = '';
      const mdfTo = $('#m-filter-date-to'); if (mdfTo) mdfTo.value = '';
      updateFilterBadge();
      render();
    });
  }

  ['room', 'category', 'assigned'].forEach(key => {
    const mSel = $(`#m-filter-${key}`);
    if (mSel) {
      mSel.addEventListener('change', (e) => {
        filters[key] = e.target.value;
        const dSel = $(`#filter-${key}`);
        if (dSel) dSel.value = e.target.value;
        updateFilterBadge();
        render();
      });
    }
  });

  // Mobile date filter handlers
  ['m-filter-date-from', 'm-filter-date-to'].forEach(id => {
    const el = $(`#${id}`);
    if (el) {
      el.addEventListener('change', (e) => {
        const key = id === 'm-filter-date-from' ? 'dateFrom' : 'dateTo';
        filters[key] = e.target.value;
        const dId = id.replace('m-filter-', 'filter-');
        const dEl = $(`#${dId}`);
        if (dEl) dEl.value = e.target.value;
        updateFilterBadge();
        render();
      });
    }
  });

  const mGroupBy = $('#m-group-by');
  if (mGroupBy) {
    mGroupBy.addEventListener('change', (e) => {
      const dGroupBy = $('#group-by');
      if (dGroupBy) dGroupBy.value = e.target.value;
      render();
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && mobileFilterOverlay && mobileFilterOverlay.classList.contains('open')) {
      closeMobileFilter();
    }
  });

  // Group by
  $('#group-by').addEventListener('change', () => render());

  // View size (filter version, mobile)
  document.querySelectorAll('#view-size-wrap .view-size-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#view-size-wrap .view-size-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      setViewSize(btn.dataset.size);
      render();
    });
  });

  // Mobile hamburger menu
  const menuBtn = $('#mobile-menu-btn');
  const menuOverlay = $('#mobile-menu-overlay');
  const themeFooter = document.getElementById('mobile-menu-theme-footer');
  let _savedTheme = null;
  const hideThemeFooter = () => { if (themeFooter) themeFooter.classList.remove('visible'); };
  const closeMenu = () => {
    menuBtn.classList.remove('open');
    menuBtn.setAttribute('aria-expanded', 'false');
    menuBtn.title = 'Open menu';
    menuBtn.setAttribute('aria-label', 'Open menu');
    menuOverlay.classList.remove('open');
    // Auto-save theme on dismiss (keep whatever is currently set)
    _savedTheme = null;
    hideThemeFooter();
  };
  menuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = menuBtn.classList.toggle('open');
    menuBtn.setAttribute('aria-expanded', String(isOpen));
    const label = isOpen ? 'Close menu' : 'Open menu';
    menuBtn.title = label;
    menuBtn.setAttribute('aria-label', label);
    if (isOpen) {
      menuOverlay.classList.add('open');
    } else {
      closeMenu();
    }
  });
  menuOverlay.addEventListener('click', (e) => {
    if (e.target === menuOverlay) closeMenu();
  });
  // Theme mode: light | dark | system
  const THEME_MODES = ['light', 'dark', 'system'];
  let _themeMode = localStorage.getItem('qp-theme-mode') || 'system';

  function applyThemeMode(mode) {
    _themeMode = mode;
    localStorage.setItem('qp-theme-mode', mode);
    let resolved = mode;
    if (mode === 'system') {
      resolved = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    document.documentElement.setAttribute('data-theme', resolved);
    localStorage.setItem('qp-theme', resolved);
    syncThemeUI();
  }

  function cycleThemeMode() {
    const next = THEME_MODES[(THEME_MODES.indexOf(_themeMode) + 1) % 3];
    applyThemeMode(next);
  }

  function syncThemeUI() {
    // Sidebar mode icon
    const group = document.querySelector('.sidebar-theme-group');
    if (group) group.setAttribute('data-mode', _themeMode);
    // Sidebar mode buttons
    document.querySelectorAll('.sidebar-mode-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mode === _themeMode);
    });
    // Sidebar surface buttons
    const surface = localStorage.getItem('qp-surface') || 'frost';
    document.querySelectorAll('.sidebar-surface-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.surface === surface);
    });
    // Mobile checkbox (keep compatible)
    const mobileCb = document.getElementById('mobile-theme-checkbox');
    if (mobileCb) mobileCb.checked = document.documentElement.getAttribute('data-theme') === 'dark';
  }

  // Listen for OS theme changes when in system mode
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (_themeMode === 'system') applyThemeMode('system');
  });

  // Init
  applyThemeMode(_themeMode);

  // Sidebar theme panel toggle
  const themeCycleBtn = document.getElementById('sidebar-theme-cycle');
  const themeGroup = document.getElementById('sidebar-theme-group');
  if (themeCycleBtn) themeCycleBtn.addEventListener('click', () => {
    themeGroup.classList.toggle('open');
  });

  // Sidebar mode buttons
  document.querySelectorAll('.sidebar-mode-btn').forEach(btn => {
    btn.addEventListener('click', () => applyThemeMode(btn.dataset.mode));
  });

  // Sidebar surface buttons
  document.querySelectorAll('.sidebar-surface-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const val = btn.dataset.surface;
      localStorage.setItem('qp-surface', val);
      document.documentElement.setAttribute('data-surface', val);
      syncThemeUI();
    });
  });

  // Sidebar expand/collapse toggle (WCAG 1.4.13 keyboard accessible)
  const sidebarRail = document.querySelector('.sidebar-rail');
  const sidebarToggle = $('#sidebar-toggle');
  const sidebarToggleLabel = sidebarToggle.querySelector('.sidebar-label');
  sidebarToggle.addEventListener('click', () => {
    const expanded = sidebarRail.classList.toggle('sidebar-expanded');
    sidebarRail.classList.toggle('sidebar-pinned-closed', !expanded);
    sidebarToggle.setAttribute('aria-expanded', String(expanded));
    sidebarToggleLabel.textContent = expanded ? 'Hide menu' : 'Menu';
  });
  sidebarRail.addEventListener('mouseleave', () => {
    sidebarRail.classList.remove('sidebar-pinned-closed');
  });

  // Wire mobile menu items
  const mobileSettingsBtn = $('#mobile-settings-btn');
  if (mobileSettingsBtn) mobileSettingsBtn.addEventListener('click', () => {
    closeMenu();
    if (window._showSettings) window._showSettings();
  });
  const mobileCb = document.getElementById('mobile-theme-checkbox');
  if (mobileCb) mobileCb.addEventListener('change', () => {
    // Capture theme before toggling so Cancel can revert
    _savedTheme = document.documentElement.getAttribute('data-theme') || 'light';
    cycleThemeMode();
    if (themeFooter) themeFooter.classList.add('visible');
  });
  const mobileThemeCancel = document.getElementById('mobile-theme-cancel');
  const mobileThemeSave = document.getElementById('mobile-theme-save');
  if (mobileThemeCancel) mobileThemeCancel.addEventListener('click', () => {
    if (_savedTheme) {
      document.documentElement.setAttribute('data-theme', _savedTheme);
      localStorage.setItem('qp-theme', _savedTheme);
      syncThemeUI();
    }
    _savedTheme = null;
    hideThemeFooter();
    closeMenu();
  });
  if (mobileThemeSave) mobileThemeSave.addEventListener('click', () => {
    _savedTheme = null;
    hideThemeFooter();
    closeMenu();
  });

  // Auto-hide primary nav on scroll (mobile only)
  (function() {
    const primaryNav = document.querySelector('.primary-nav');
    const header = document.querySelector('.app-header');
    const mainEl = document.querySelector('main');
    const mq = window.matchMedia('(max-width: 768px), (orientation: landscape) and (max-height: 500px)');

    let lastY = 0;
    let ticking = false;

    function updateHeaderPadding() {
      if (mq.matches) {
        const totalH = (primaryNav ? primaryNav.offsetHeight : 0) + header.offsetHeight;
        mainEl.style.paddingTop = (totalH + 24) + 'px';
      } else {
        mainEl.style.paddingTop = '';
      }
    }

    function onScroll() {
      if (!mq.matches) return;
      const y = window.scrollY;
      const threshold = window.innerHeight * 0.5;

      if (y > threshold && y > lastY) {
        if (primaryNav) primaryNav.classList.add('header-hidden');
        header.classList.add('secondary-raised');
      } else if (y < lastY) {
        if (primaryNav) primaryNav.classList.remove('header-hidden');
        header.classList.remove('secondary-raised');
      }
      lastY = y;
    }

    window.addEventListener('scroll', () => {
      if (!ticking) {
        requestAnimationFrame(() => { onScroll(); ticking = false; });
        ticking = true;
      }
    }, { passive: true });

    mq.addEventListener('change', updateHeaderPadding);
    updateHeaderPadding();
    window.addEventListener('resize', updateHeaderPadding);
  })();
});
