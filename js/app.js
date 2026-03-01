import { buildFilterOptions, populateDropdown, applyFilters } from './filters.js';
import { renderKanban } from './kanban.js';
import { renderPlanner, setViewSize } from './planner.js';
import { renderTodoList } from './todolist.js';
import { openEditModal } from './modal.js';
import { updateTask } from './sheet-writer.js';
import { initCustomColors, applyCustomColors } from './theme-customizer.js';
import { shouldShowOnboarding, showOnboarding } from './onboarding.js';
import {
  loadCustomColors, saveCustomColors, loadUserSwatches, saveUserSwatches, addToBin,
  loadBin, restoreFromBin,
  loadProjects, saveProjects, loadActiveProjectId, saveActiveProjectId, saveProjectTasks,
  loadUserName, saveUserName,
} from './storage.js';
import { importCSV, sheetsUrlToCsvUrl, exportToCSV } from './projects.js';
// bg-effects: lazy-loaded so a failure never blocks data/rendering
let _bgFx = { initBgEffects() {}, getConfig: () => ({ active: false }), setConfig() {} };
const bgFxReady = import('./bg-effects.js')
  .then(m => { _bgFx = m; })
  .catch(err => console.warn('bg-effects unavailable:', err));

let allTasks = [];
let currentView = localStorage.getItem('qp-view') || 'kanban';
let filters = { room: '', category: '', assigned: '', search: '' };
let syncTimer = null;
let currentProjectId = loadActiveProjectId();

const $ = (sel) => document.querySelector(sel);

function getProjectType() {
  if (!currentProjectId || currentProjectId === 'sheet') return 'local';
  const projects = loadProjects();
  return projects.find(p => p.id === currentProjectId)?.type ?? 'local';
}

function getProjectName() {
  if (!currentProjectId || currentProjectId === 'sheet') return '';
  const projects = loadProjects();
  return projects.find(p => p.id === currentProjectId)?.name ?? 'Project';
}

function persistTaskChange() {
  if (getProjectType() === 'local') {
    saveProjectTasks(currentProjectId, allTasks);
  }
}

async function loadProjectData() {
  if (!currentProjectId || currentProjectId === 'sheet') {
    allTasks = [];
    return;
  }
  const projects = loadProjects();
  const project = projects.find(p => p.id === currentProjectId);
  if (!project) {
    // Project deleted externally — clear active project
    currentProjectId = null;
    saveActiveProjectId(null);
    allTasks = [];
  } else {
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
  clearInterval(syncTimer);
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
  if (exportSection) exportSection.classList.toggle('hidden', getProjectType() !== 'local');
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

function handleDeleteProject(id, name) {
  showConfirmDialog({
    title: `Delete "${name}"?`,
    body: 'This project and all its tasks will be permanently removed.',
    confirmLabel: 'Yes, delete',
    onConfirm: () => {
      const projects = loadProjects().filter(p => p.id !== id);
      saveProjects(projects);
      if (currentProjectId === id) {
        switchProject('sheet');
      } else {
        renderSidebarProjects();
      }
    },
  });
}

async function init() {
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
  bgFxReady.then(() => _bgFx.initBgEffects());
}


function setupFilters() {
  const opts = buildFilterOptions(allTasks);
  populateDropdown($('#filter-room'), opts.rooms, 'Rooms');
  populateDropdown($('#filter-category'), opts.categories, 'Categories');
  populateDropdown($('#filter-assigned'), opts.assigned, 'Assigned');
}

function getModalOptions() {
  const opts = buildFilterOptions(allTasks);
  return { categories: opts.categories, assignees: opts.assigned, rooms: opts.rooms, allTasks };
}

function handleTaskEdit(task) {
  openEditModal(task, getModalOptions(), ({ originalTask, updatedFields }) => {
    // Optimistic local update
    applyLocalUpdate(task, updatedFields);
    render();
    persistTaskChange();

    if (getProjectType() === 'local') {
      showToast('Saved', 'success');
      return;
    }

    // Format dates for sheet (dd/mm)
    const sheetUpdates = { ...updatedFields };
    if (sheetUpdates.startDate) {
      const d = new Date(sheetUpdates.startDate);
      sheetUpdates.startDate = `${d.getDate()}/${d.getMonth() + 1}`;
    }
    if (sheetUpdates.endDate) {
      const d = new Date(sheetUpdates.endDate);
      sheetUpdates.endDate = `${d.getDate()}/${d.getMonth() + 1}`;
    }

    updateTask(originalTask, sheetUpdates)
      .then(res => {
        if (res && res.success) {
          showToast('Saved to sheet', 'success');
        } else {
          showToast(res?.error || 'Save may have failed', 'error');
        }
      })
      .catch(err => showToast('Sheet write failed: ' + err.message, 'error'));
  }, handleRoomChange, {
    onDelete: (t) => handleTaskDelete(t),
    onDuplicate: (t) => handleTaskDuplicate(t),
  });
}

async function handleRoomChange({ action, oldRoom, newRoom, affectedTasks }) {
  if (action === 'rename') {
    affectedTasks.forEach(t => { t.room = newRoom; });
    setupFilters();
    render();
    persistTaskChange();

    if (getProjectType() === 'local') {
      showToast(`Room renamed`, 'success');
      return;
    }

    let ok = 0, fail = 0;
    for (const t of affectedTasks) {
      try {
        const res = await updateTask(t.task, { room: newRoom });
        if (res && res.success) ok++; else fail++;
      } catch { fail++; }
    }
    showToast(`Room renamed: ${ok} updated${fail ? `, ${fail} failed` : ''}`, fail ? 'error' : 'success');
  } else if (action === 'delete') {
    affectedTasks.forEach(t => { t.room = ''; });
    setupFilters();
    render();
    persistTaskChange();

    if (getProjectType() === 'local') {
      showToast(`Room deleted`, 'success');
      return;
    }

    let ok = 0, fail = 0;
    for (const t of affectedTasks) {
      try {
        const res = await updateTask(t.task, { room: '' });
        if (res && res.success) ok++; else fail++;
      } catch { fail++; }
    }
    showToast(`Room deleted: ${ok} cleared${fail ? `, ${fail} failed` : ''}`, fail ? 'error' : 'success');
  }
}

function handleStatusChange(task, newStatus) {
  task.status = newStatus;
  persistTaskChange();

  if (getProjectType() === 'local') return;

  updateTask(task.task, { status: newStatus })
    .then(res => {
      if (res && res.success) {
        showToast('Status updated', 'success');
      } else {
        showToast(res?.error || 'Save may have failed', 'error');
      }
    })
    .catch(err => showToast('Sheet write failed: ' + err.message, 'error'));
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
    id: Date.now(),
    task: task.task + ' (copy)',
    startDate: task.startDate ? new Date(task.startDate) : null,
    endDate: task.endDate ? new Date(task.endDate) : null,
    status: 'To Do',
  };
  allTasks.push(copy);
  setupFilters();
  render();
  persistTaskChange();

  if (getProjectType() === 'local') {
    showToast('Task duplicated', 'success');
    return;
  }

  const sheetUpdates = {
    task: copy.task, room: copy.room, category: copy.category,
    status: copy.status, assigned: copy.assigned,
    startDate: copy.startDate ? `${copy.startDate.getDate()}/${copy.startDate.getMonth() + 1}` : '',
    endDate: copy.endDate ? `${copy.endDate.getDate()}/${copy.endDate.getMonth() + 1}` : '',
    dependencies: copy.dependencies || '',
  };
  updateTask('__new__', sheetUpdates)
    .then(res => {
      if (res && res.success) showToast('Task duplicated', 'success');
      else showToast(res?.error || 'Duplicate may not have saved to sheet', 'error');
    })
    .catch(err => showToast('Sheet write failed: ' + err.message, 'error'));
}

function handleTaskCreate(fields) {
  const newTask = {
    id: Date.now(),
    task: fields.task || 'New Task',
    room: fields.room || '',
    category: fields.category || '',
    status: fields.status || 'To Do',
    assigned: fields.assigned || '',
    startDate: fields.startDate ? new Date(fields.startDate) : null,
    endDate: fields.endDate ? new Date(fields.endDate) : null,
    dependencies: fields.dependencies || '',
  };
  allTasks.push(newTask);
  setupFilters();
  render();
  persistTaskChange();

  if (getProjectType() === 'local') {
    showToast('Task created', 'success');
    return;
  }

  const sheetUpdates = {
    task: newTask.task, room: newTask.room, category: newTask.category,
    status: newTask.status, assigned: newTask.assigned,
    startDate: newTask.startDate ? `${newTask.startDate.getDate()}/${newTask.startDate.getMonth() + 1}` : '',
    endDate: newTask.endDate ? `${newTask.endDate.getDate()}/${newTask.endDate.getMonth() + 1}` : '',
    dependencies: newTask.dependencies,
  };
  updateTask('__new__', sheetUpdates)
    .then(res => {
      if (res && res.success) showToast('Task created', 'success');
      else showToast(res?.error || 'Create may not have saved to sheet', 'error');
    })
    .catch(err => showToast('Sheet write failed: ' + err.message, 'error'));
}

function applyLocalUpdate(task, fields) {
  if (fields.task) task.task = fields.task;
  if (fields.room !== undefined) task.room = fields.room;
  if (fields.category) task.category = fields.category;
  task.assigned = fields.assigned || '';
  if (fields.status) task.status = fields.status;
  task.startDate = fields.startDate ? new Date(fields.startDate) : null;
  task.endDate = fields.endDate ? new Date(fields.endDate) : null;
  task.dependencies = fields.dependencies || '';
}

function render() {
  const filtered = applyFilters(allTasks, filters);
  const kanbanContainer = $('#kanban-view');
  const plannerContainer = $('#planner-view');
  const todolistContainer = $('#todolist-view');

  kanbanContainer.classList.add('hidden');
  plannerContainer.classList.add('hidden');
  todolistContainer.classList.add('hidden');

  if (currentView === 'kanban') {
    kanbanContainer.classList.remove('hidden');
    const groupBy = $('#group-by').value;
    renderKanban(kanbanContainer, filtered, groupBy, {
      onCardClick: handleTaskEdit,
      onStatusChange: handleStatusChange,
    });
  } else if (currentView === 'planner') {
    plannerContainer.classList.remove('hidden');
    renderPlanner(plannerContainer, filtered, {
      onBarClick: handleTaskEdit,
    });
  } else if (currentView === 'todolist') {
    todolistContainer.classList.remove('hidden');
    renderTodoList(todolistContainer, filtered, {
      onStatusChange: handleStatusChange,
      onTaskClick: handleTaskEdit,
      onAssignChange: (task, newAssigned) => {
        task.assigned = newAssigned;
        persistTaskChange();
        if (getProjectType() === 'local') {
          showToast(`Assigned to ${newAssigned}`, 'success');
          return;
        }
        updateTask(task.task, { assigned: newAssigned })
          .then(res => {
            if (res && res.success) showToast(`Assigned to ${newAssigned}`, 'success');
            else showToast(res?.error || 'Save may have failed', 'error');
          })
          .catch(err => showToast('Sheet write failed: ' + err.message, 'error'));
      },
    });
  }
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
  el.innerHTML = `<div class="notification-inner"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg><div class="notification-text"><strong>Connection error</strong><span>${msg}. Check the sheet is publicly shared.</span></div></div>`;
  el.classList.remove('hidden');
}

function showToast(message, type = 'success') {
  const root = document.getElementById('toast-root');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  root.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
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
        id: String(Date.now()),
        name,
        type: 'local',
        tasks: [],
        createdAt: Date.now(),
      };
      const projects = loadProjects();
      projects.push(project);
      saveProjects(projects);
      saveProjectTasks(project.id, tasks);

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
  const customRow = $('#settings-custom-row');
  const colorInput = $('#settings-color-input');
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
    swatch.addEventListener('click', () => {
      customRow.style.display = 'none';
      selectSwatch(p.hex);
    });
    swatchContainer.appendChild(swatch);
  });

  const plus = document.createElement('button');
  plus.className = 'onboarding-swatch onboarding-swatch-plus';
  plus.title = 'Custom colour';
  plus.setAttribute('aria-label', 'Custom colour');
  plus.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>';
  plus.addEventListener('click', () => {
    colorInput.value = selected;
    customRow.style.display = 'flex';
    clearAllActive();
    plus.classList.add('active');
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
        customRow.style.display = 'none';
        selectSwatch(hex);
      });

      wrap.appendChild(swatch);
      userSwatchesContainer.appendChild(wrap);
    });
  }
  renderUserSwatches();

  settingsView.addEventListener('click', dismissConfirm);

  // --- Custom colour picker actions ---
  $('#settings-custom-cancel').addEventListener('click', () => {
    customRow.style.display = 'none';
    selectSwatch(selected);
  });
  $('#settings-custom-save').addEventListener('click', () => {
    const hex = colorInput.value;
    customRow.style.display = 'none';
    const allKnown = [...PRESETS.map(p => p.hex), ...loadUserSwatches()];
    if (!allKnown.includes(hex)) {
      const swatches = loadUserSwatches();
      swatches.push(hex);
      saveUserSwatches(swatches);
      renderUserSwatches();
    }
    selectSwatch(hex);
  });

  colorInput.addEventListener('input', () => {
    colors.primary1 = colorInput.value;
    applyCustomColors(colors);
  });

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
    settingsView.scrollTop = 0;
    // Refresh export section visibility
    const exportSection = $('#settings-export-section');
    if (exportSection) exportSection.classList.toggle('hidden', getProjectType() !== 'local');
  }

  function hideSettings() {
    settingsView.classList.add('hidden');
    $('.app-header').classList.remove('hidden');
    document.querySelector('main').classList.remove('settings-open');
    saveCustomColors(colors);
    // Restore previous view
    currentView = previousView;
    render();
  }

  $('#sidebar-settings-btn').addEventListener('click', showSettings);
  $('#settings-back').addEventListener('click', hideSettings);
  $('#settings-done').addEventListener('click', hideSettings);

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
    const bin = loadBin();
    const q = filter.toLowerCase();
    const items = q ? bin.filter(e => e.task.task?.toLowerCase().includes(q) || e.task.room?.toLowerCase().includes(q)) : bin;
    if (!items.length) {
      trashList.innerHTML = `
        <div class="trash-empty">
          <img class="trash-empty-animal" src="images/mascot-trash.png" alt="" aria-hidden="true">
          <p class="trash-empty-title">${q ? 'No results' : 'Nothing to do.'}</p>
          <p class="trash-empty-body">${q ? 'No deleted tasks match that search.' : 'You can restore tasks before they are automatically deleted after 30 days.'}</p>
        </div>`;
      return;
    }
    trashList.innerHTML = items.map((entry, i) => {
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

    trashList.querySelectorAll('.trash-restore-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const name = decodeURIComponent(btn.dataset.name);
        const restored = restoreFromBin(name);
        if (restored) {
          // Revive date strings
          ['startDate', 'endDate'].forEach(k => { if (restored[k]) restored[k] = new Date(restored[k]); });
          allTasks.push(restored);
          persistTaskChange();
          showToast('Task restored', 'success');
          renderTrashList(trashSearch.value);
        }
      });
    });

    trashList.querySelectorAll('.trash-delete-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const name = decodeURIComponent(btn.dataset.name);
        showConfirmDialog({
          title: 'Delete permanently?',
          body: 'This task cannot be recovered.',
          confirmLabel: 'Delete',
          onConfirm: () => {
            restoreFromBin(name); // removes from bin without returning to tasks
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

  // Onboarding for first-time visitors
  if (shouldShowOnboarding()) {
    showOnboarding();
  }

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
      showOnboarding();
    });
  }

  // Close popovers: outside click, Escape, scroll
  document.addEventListener('click', closeAllPopovers);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAllPopovers(); });
  window.addEventListener('scroll', closeAllPopovers, { passive: true });

  // Add task — FAB (mobile) + header button (desktop)
  function handleAddTask() {
    const blankTask = { id: null, task: '', room: '', category: '', status: 'To Do', assigned: '', startDate: null, endDate: null, dependencies: '' };
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
    const count = [filters.room, filters.category, filters.assigned].filter(Boolean).length;
    if (mobileFilterBadge) {
      mobileFilterBadge.textContent = count;
      mobileFilterBadge.classList.toggle('hidden', count === 0);
    }
    if (desktopFilterBadge) {
      desktopFilterBadge.textContent = count;
      desktopFilterBadge.classList.toggle('hidden', count === 0);
    }
  }

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
      ['room', 'category', 'assigned'].forEach(key => {
        const d = $(`#filter-${key}`); if (d) d.value = '';
        const m = $(`#m-filter-${key}`); if (m) m.value = '';
      });
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
  // Theme toggle helper
  function toggleTheme() {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    document.documentElement.setAttribute('data-theme', isDark ? 'light' : 'dark');
    localStorage.setItem('qp-theme', isDark ? 'light' : 'dark');
    syncThemeCheckboxes();
  }

  function syncThemeCheckboxes() {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const sidebarCb = document.getElementById('sidebar-theme-checkbox');
    const mobileCb = document.getElementById('mobile-theme-checkbox');
    if (sidebarCb) sidebarCb.checked = isDark;
    if (mobileCb) mobileCb.checked = isDark;
  }
  syncThemeCheckboxes();

  // Sidebar buttons
  document.getElementById('sidebar-theme-checkbox').addEventListener('change', toggleTheme);
  const sidebarSync = $('#sidebar-sync-btn');
  if (sidebarSync) sidebarSync.addEventListener('click', () => {});

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
  const mobileSyncBtn = $('#mobile-sync-btn');
  if (mobileSettingsBtn) mobileSettingsBtn.addEventListener('click', () => {
    closeMenu();
    if (window._showSettings) window._showSettings();
  });
  const mobileCb = document.getElementById('mobile-theme-checkbox');
  if (mobileCb) mobileCb.addEventListener('change', () => {
    // Capture theme before toggling so Cancel can revert
    _savedTheme = document.documentElement.getAttribute('data-theme') || 'light';
    toggleTheme();
    if (themeFooter) themeFooter.classList.add('visible');
  });
  const mobileThemeCancel = document.getElementById('mobile-theme-cancel');
  const mobileThemeSave = document.getElementById('mobile-theme-save');
  if (mobileThemeCancel) mobileThemeCancel.addEventListener('click', () => {
    if (_savedTheme) {
      document.documentElement.setAttribute('data-theme', _savedTheme);
      localStorage.setItem('qp-theme', _savedTheme);
      syncThemeCheckboxes();
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
  if (mobileSyncBtn) mobileSyncBtn.addEventListener('click', () => { closeMenu(); });

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
