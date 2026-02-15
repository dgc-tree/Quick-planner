import { fetchSheetData } from './data.js';
import { buildFilterOptions, populateDropdown, applyFilters } from './filters.js';
import { renderKanban } from './kanban.js';
import { renderPlanner } from './planner.js';
import { openEditModal } from './modal.js';
import { updateTask } from './sheet-writer.js';

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
  return { categories: opts.categories, assignees: opts.assigned, allTasks };
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
  });
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

  if (currentView === 'kanban') {
    kanbanContainer.classList.remove('hidden');
    plannerContainer.classList.add('hidden');
    const groupBy = $('#group-by').value;
    renderKanban(kanbanContainer, filtered, groupBy, {
      onCardClick: handleTaskEdit,
      onStatusChange: handleStatusChange,
    });
  } else {
    kanbanContainer.classList.add('hidden');
    plannerContainer.classList.remove('hidden');
    renderPlanner(plannerContainer, filtered, {
      onBarClick: handleTaskEdit,
    });
  }
}

function updateSummary() {}


function showLoading(show) {
  $('#loading').classList.toggle('hidden', !show);
  if (show) {
    $('#kanban-view').classList.add('hidden');
    $('#planner-view').classList.add('hidden');
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

document.addEventListener('DOMContentLoaded', () => {
  init();

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

  // Manual refresh
  $('#refresh-btn').addEventListener('click', () => {
    refreshData(false);
    startAutoSync(); // Reset the timer on manual refresh
  });
});
