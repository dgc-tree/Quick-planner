import { fetchSheetData } from './data.js';
import { buildFilterOptions, populateDropdown, applyFilters } from './filters.js';
import { renderKanban } from './kanban.js';
import { renderPlanner } from './planner.js';

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
    updateLastSynced();
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
  el.title = `Auto-syncs every 5 minutes. Last: ${now.toLocaleString('en-AU')}`;
}

function setupFilters() {
  const opts = buildFilterOptions(allTasks);
  populateDropdown($('#filter-room'), opts.rooms, 'Rooms');
  populateDropdown($('#filter-category'), opts.categories, 'Categories');
  populateDropdown($('#filter-assigned'), opts.assigned, 'Assigned');
}

function render() {
  const filtered = applyFilters(allTasks, filters);
  const kanbanContainer = $('#kanban-view');
  const plannerContainer = $('#planner-view');

  if (currentView === 'kanban') {
    kanbanContainer.classList.remove('hidden');
    plannerContainer.classList.add('hidden');
    const groupBy = $('#group-by').value;
    renderKanban(kanbanContainer, filtered, groupBy);
  } else {
    kanbanContainer.classList.add('hidden');
    plannerContainer.classList.remove('hidden');
    renderPlanner(plannerContainer, filtered);
  }
}

function updateSummary() {
  const rooms = new Set(allTasks.map(t => t.room)).size;
  $('#summary').textContent = `${allTasks.length} tasks across ${rooms} rooms`;
}

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
