import { fetchSheetData } from './data.js';
import { buildFilterOptions, populateDropdown, applyFilters } from './filters.js';
import { renderKanban } from './kanban.js';
import { renderPlanner, setViewSize } from './planner.js';
import { renderTodoList } from './todolist.js';
import { openEditModal } from './modal.js';
import { updateTask } from './sheet-writer.js';
import { initCustomColors, applyCustomColors } from './theme-customizer.js';
import { shouldShowOnboarding, showOnboarding } from './onboarding.js';
import { loadCustomColors, saveCustomColors, loadUserSwatches, saveUserSwatches } from './storage.js';
import { initBgEffects, getConfig, setConfig } from './bg-effects.js';

const AUTO_SYNC_INTERVAL = 5 * 60 * 1000; // 5 minutes

let allTasks = [];
let currentView = localStorage.getItem('qp-view') || 'kanban';
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
  initBgEffects();
}

function startAutoSync() {
  if (syncTimer) clearInterval(syncTimer);
  syncTimer = setInterval(() => refreshData(true), AUTO_SYNC_INTERVAL);
}

async function refreshData(silent = false) {
  const sidebarSyncBtn = $('#sidebar-sync-btn');
  sidebarSyncBtn.classList.add('refreshing');
  sidebarSyncBtn.disabled = true;
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

  sidebarSyncBtn.classList.remove('refreshing');
  sidebarSyncBtn.disabled = false;
  if (!silent) showLoading(false);
}

function updateLastSynced() {
  const el = $('#sidebar-last-synced');
  const now = new Date();
  const timeStr = now.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' });
  el.textContent = `Synced ${timeStr}`;
  el.title = `Last: ${now.toLocaleString('en-AU')}`;
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
    todolistContainer.classList.remove('hidden');
    renderTodoList(todolistContainer, filtered, {
      onStatusChange: handleStatusChange,
      onTaskClick: handleTaskEdit,
      onAssignChange: (task, newAssigned) => {
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
  $active.addEventListener('change', () => setConfig({ active: $active.checked }));

  // --- Open / close settings view ---
  function showSettings() {
    previousView = currentView;
    $('.app-header').classList.add('hidden');
    $('#kanban-view').classList.add('hidden');
    $('#planner-view').classList.add('hidden');
    $('#todolist-view').classList.add('hidden');
    settingsView.classList.remove('hidden');
    $active.checked = getConfig().active;
    window.scrollTo(0, 0);
  }

  function hideSettings() {
    settingsView.classList.add('hidden');
    $('.app-header').classList.remove('hidden');
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
  // Set active tab from saved view
  document.querySelectorAll('.view-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.view === currentView);
  });
  $('#group-by-wrap').classList.toggle('hidden', currentView !== 'kanban');
  $('#view-size-wrap').classList.toggle('hidden', currentView !== 'planner');

  document.querySelectorAll('.view-btn').forEach(btn => {
    btn.addEventListener('click', () => {
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
      render();
    });
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
  const closeMenu = () => {
    menuBtn.classList.remove('open');
    menuBtn.setAttribute('aria-expanded', 'false');
    menuBtn.title = 'Open menu';
    menuBtn.setAttribute('aria-label', 'Open menu');
    menuOverlay.classList.remove('open');
  };
  menuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = menuBtn.classList.toggle('open');
    menuBtn.setAttribute('aria-expanded', String(isOpen));
    const label = isOpen ? 'Close menu' : 'Open menu';
    menuBtn.title = label;
    menuBtn.setAttribute('aria-label', label);
    menuOverlay.classList.toggle('open', isOpen);
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
  if (sidebarSync) sidebarSync.addEventListener('click', () => {
    refreshData(false);
    startAutoSync();
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
  const mobileThemeBtn = $('#mobile-theme-btn');
  const mobileSyncBtn = $('#mobile-sync-btn');
  if (mobileSettingsBtn) mobileSettingsBtn.addEventListener('click', () => {
    closeMenu();
    if (window._showSettings) window._showSettings();
  });
  const mobileCb = document.getElementById('mobile-theme-checkbox');
  if (mobileCb) mobileCb.addEventListener('change', () => {
    closeMenu();
    toggleTheme();
  });
  if (mobileSyncBtn) mobileSyncBtn.addEventListener('click', () => {
    closeMenu();
    refreshData(false);
    startAutoSync();
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
