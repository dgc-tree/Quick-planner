import { fetchSheetData } from './data.js';
import { buildFilterOptions, populateDropdown, applyFilters } from './filters.js';
import { renderKanban } from './kanban.js';
import { renderPlanner } from './planner.js';
import { renderTodoList, clearChecked } from './todolist.js';
import { openEditModal } from './modal.js';
import { updateTask } from './sheet-writer.js';
import { initCustomColors, applyCustomColors, removeCustomColors } from './theme-customizer.js';
import { shouldShowOnboarding, showOnboarding } from './onboarding.js';
import { createColorPicker } from './color-picker.js';
import { loadCustomColors, saveCustomColors } from './storage.js';

const AUTO_SYNC_INTERVAL = 5 * 60 * 1000; // 5 minutes

let allTasks = [];
let currentView = 'kanban';
let filters = { room: '', category: '', assigned: '' };
let syncTimer = null;

const $ = (sel) => document.querySelector(sel);

async function init() {
  showLoading(true);
  try {
    allTasks = await fetchSheetData();
    updateSummary();
    setupFilters();
    render();
  } catch (err) {
    showError(err.message);
  }
  showLoading(false);
  startAutoSync();
}

function startAutoSync() {
  if (syncTimer) clearInterval(syncTimer);
  syncTimer = setInterval(() => refreshData(true), AUTO_SYNC_INTERVAL);
}

async function refreshData(silent = false) {
  const refreshBtn = $('#refresh-btn');
  refreshBtn.classList.add('refreshing');
  refreshBtn.disabled = true;
  $('#error').classList.add('hidden');

  if (!silent) showLoading(true);

  try {
    allTasks = await fetchSheetData();
    updateSummary();
    setupFilters();
    render();
    updateLastSynced();
  } catch (err) {
    if (!silent) showError(err.message);
  }

  refreshBtn.classList.remove('refreshing');
  refreshBtn.disabled = false;
  if (!silent) showLoading(false);
}

function updateLastSynced() {
  const el = $('#last-synced');
  const now = new Date();
  el.textContent = `Synced ${now.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' })}`;
  el.title = `Last: ${now.toLocaleString('en-AU')}`;
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
  return { categories: opts.categories, assignees: opts.assigned, rooms: opts.rooms, allTasks };
}

function handleTaskEdit(task) {
  openEditModal(task, getModalOptions(), ({ originalTask, updatedFields }) => {
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

    // Optimistic local update
    applyLocalUpdate(task, updatedFields);
    render();

    // Async write to sheet
    updateTask(originalTask, sheetUpdates)
      .then(res => {
        if (res && res.success) {
          showToast('Saved to sheet', 'success');
        } else {
          showToast(res?.error || 'Save may have failed', 'error');
        }
      })
      .catch(err => showToast('Sheet write failed: ' + err.message, 'error'));
  }, handleRoomChange);
}

async function handleRoomChange({ action, oldRoom, newRoom, affectedTasks }) {
  if (action === 'rename') {
    // Optimistic local rename
    affectedTasks.forEach(t => { t.room = newRoom; });
    setupFilters();
    render();
    // Batch write to sheet
    let ok = 0, fail = 0;
    for (const t of affectedTasks) {
      try {
        const res = await updateTask(t.task, { room: newRoom });
        if (res && res.success) ok++; else fail++;
      } catch { fail++; }
    }
    showToast(`Room renamed: ${ok} updated${fail ? `, ${fail} failed` : ''}`, fail ? 'error' : 'success');
  } else if (action === 'delete') {
    // Clear room on affected tasks
    affectedTasks.forEach(t => { t.room = ''; });
    setupFilters();
    render();
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
  const sheetUpdates = { status: newStatus };

  // Optimistic local update
  task.status = newStatus;

  // Async write to sheet
  updateTask(task.task, sheetUpdates)
    .then(res => {
      if (res && res.success) {
        showToast('Status updated', 'success');
      } else {
        showToast(res?.error || 'Save may have failed', 'error');
      }
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
    clearChecked();
    todolistContainer.classList.remove('hidden');
    renderTodoList(todolistContainer, filtered, {
      onStatusChange: handleStatusChange,
      onTaskClick: handleTaskEdit,
    });
  }
}

function updateSummary() {}


function showLoading(show) {
  $('#loading').classList.toggle('hidden', !show);
  if (show) {
    $('#kanban-view').classList.add('hidden');
    $('#planner-view').classList.add('hidden');
    $('#todolist-view').classList.add('hidden');
  }
}

function showError(msg) {
  const el = $('#error');
  el.textContent = `Failed to load data: ${msg}. Check the sheet is publicly shared.`;
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

function setupSettingsPanel() {
  const modal = $('#settings-modal');
  const container = $('#settings-pickers');
  const saved = loadCustomColors() || { primary1: '#00E3FF', secondary1: null, secondary2: null };
  const colors = { ...saved };

  const pickers = [
    { label: 'Primary', key: 'primary1' },
    { label: 'Secondary 1', key: 'secondary1' },
    { label: 'Secondary 2', key: 'secondary2' },
  ];

  container.innerHTML = '';
  for (const p of pickers) {
    const picker = createColorPicker({
      label: p.label,
      value: colors[p.key],
      onChange: (hex) => {
        colors[p.key] = hex;
        applyCustomColors(colors);
      },
    });
    container.appendChild(picker);
  }

  $('#settings-btn').addEventListener('click', () => {
    modal.classList.add('open');
  });

  $('#settings-close').addEventListener('click', () => {
    saveCustomColors(colors);
    modal.classList.remove('open');
  });

  $('#settings-reset').addEventListener('click', () => {
    removeCustomColors();
    modal.classList.remove('open');
    // Reload to get default tokens
    location.reload();
  });
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

  // View toggles
  document.querySelectorAll('.view-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentView = btn.dataset.view;
      $('#group-by-wrap').classList.toggle('hidden', currentView !== 'kanban');
      render();
    });
  });

  // Filters
  ['filter-room', 'filter-category', 'filter-assigned'].forEach(id => {
    $(`#${id}`).addEventListener('change', (e) => {
      filters[id.replace('filter-', '')] = e.target.value;
      render();
    });
  });

  // Group by
  $('#group-by').addEventListener('change', () => render());

  // Mobile hamburger menu
  const menuBtn = $('#mobile-menu-btn');
  const menuOverlay = $('#mobile-menu-overlay');
  const closeMenu = () => {
    menuBtn.classList.remove('open');
    menuBtn.setAttribute('aria-expanded', 'false');
    menuOverlay.classList.remove('open');
  };
  menuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = menuBtn.classList.toggle('open');
    menuBtn.setAttribute('aria-expanded', String(isOpen));
    menuOverlay.classList.toggle('open', isOpen);
  });
  menuOverlay.addEventListener('click', (e) => {
    if (e.target === menuOverlay) closeMenu();
  });
  // Wire fullscreen menu items to existing buttons
  const mobileSettingsBtn = $('#mobile-settings-btn');
  const mobileThemeBtn = $('#mobile-theme-btn');
  const mobileSyncBtn = $('#mobile-sync-btn');
  if (mobileSettingsBtn) mobileSettingsBtn.addEventListener('click', () => {
    closeMenu();
    $('#settings-btn').click();
  });
  const updateThemeLabel = () => {
    const label = document.querySelector('.mobile-theme-label');
    if (!label) return;
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    label.textContent = isDark ? 'Light mode' : 'Dark mode';
  };
  updateThemeLabel();
  if (mobileThemeBtn) mobileThemeBtn.addEventListener('click', () => {
    closeMenu();
    $('#theme-toggle').click();
    updateThemeLabel();
  });
  if (mobileSyncBtn) mobileSyncBtn.addEventListener('click', () => {
    closeMenu();
    $('#refresh-btn').click();
  });

  // Manual refresh
  $('#refresh-btn').addEventListener('click', () => {
    refreshData(false);
    startAutoSync(); // Reset the timer on manual refresh
  });
});
