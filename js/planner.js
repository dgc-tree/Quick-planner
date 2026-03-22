import { esc, getInitials, getAssignedColor, getCategoryColor } from './utils.js';
import { attachLongPress } from './context-menu.js';

let _plannerCallbacks = {};
let _viewSize = 'medium';

export function setViewSize(size) { _viewSize = size; }

export function renderPlanner(container, tasks, callbacks = {}) {
  _plannerCallbacks = callbacks;
  const scheduled = tasks.filter(t => t.startDate && t.endDate);
  const unscheduled = tasks.filter(t => !t.startDate || !t.endDate);

  if (!scheduled.length) {
    container.innerHTML = '<div class="empty-state">No scheduled tasks to display in planner view.</div>';
    return;
  }

  // Round to month boundaries so last month always has full calendar width
  const rawMin = new Date(Math.min(...scheduled.map(t => t.startDate.getTime())));
  const rawMax = new Date(Math.max(...scheduled.map(t => t.endDate.getTime())));
  const minDate = new Date(rawMin.getFullYear(), rawMin.getMonth(), 1);
  const maxDate = new Date(rawMax.getFullYear(), rawMax.getMonth() + 1, 0);
  const totalDays = daysBetween(minDate, maxDate);

  const months = getMonthHeaders(minDate, maxDate);

  const groups = new Map();
  for (const task of scheduled) {
    if (!groups.has(task.room)) groups.set(task.room, []);
    groups.get(task.room).push(task);
  }

  const today = new Date();
  const todayPct = (today >= minDate && today <= maxDate)
    ? (daysBetween(minDate, today) / totalDays) * 100
    : null;

  container.dataset.viewSize = _viewSize;

  container.innerHTML = `
    <div class="planner-toolbar">
      <span class="planner-toolbar-label">View size</span>
      <div class="planner-view-size">
        <button class="view-size-btn${_viewSize === 'large' ? ' active' : ''}" data-size="large">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="1" y="3" width="14" height="10" rx="1.5"/></svg>
          Large
        </button>
        <button class="view-size-btn${_viewSize === 'medium' ? ' active' : ''}" data-size="medium">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="4" width="12" height="8" rx="1.5"/></svg>
          Medium
        </button>
      </div>
    </div>
    <div class="planner-timeline-header">
      <div class="planner-timeline-month-col">
        <span class="planner-toolbar-label">Month</span>
      </div>
      <div class="planner-timeline-labels">
        ${months.map((m, i) => i === months.length - 1
          ? `<div class="month-header" style="left:${m.leftPct}%;right:0;padding-right:16px">${m.label}</div>`
          : `<div class="month-header" style="left:${m.leftPct}%;width:${m.widthPct}%">${m.label}</div>`
        ).join('')}
        ${todayPct !== null ? `<div class="today-marker-header" style="left:${todayPct}%"><span>Today</span></div>` : ''}
      </div>
    </div>
    <div class="planner-scroll">
    <div class="planner-wrapper" data-view-size="${_viewSize}">
      <div class="planner-left">
        ${[...groups.entries()].map(([room, roomTasks]) => `
          <div class="planner-group-left">
            <div class="planner-group-header">${esc(room)}</div>
            ${roomTasks.map(t => `<div class="planner-label" title="${esc(t.task)}">${esc(t.task)}</div>`).join('')}
          </div>
        `).join('')}
      </div>
      <div class="planner-right">
        <div class="planner-body">
          ${todayPct !== null ? `<div class="today-line" style="left:${todayPct}%"></div>` : ''}
          ${[...groups.entries()].map(([room, roomTasks]) => `
            <div class="planner-group-right">
              <div class="planner-group-header-spacer"></div>
              ${roomTasks.map(t => taskRowHTML(t, minDate, totalDays)).join('')}
            </div>
          `).join('')}
        </div>
      </div>
    </div>
    </div>
    ${unscheduled.length ? `
      <div class="unscheduled-section">
        <h3>Unscheduled (${unscheduled.length})</h3>
        <div class="unscheduled-list">
          ${unscheduled.map(t => `<span class="unscheduled-chip" data-task-id="${t.id}">${esc(t.task)} <small>(${esc(t.room)})</small></span>`).join('')}
        </div>
      </div>
    ` : ''}
  `;

  // Scroll sync: translate labels to follow horizontal scroll
  const scroll = container.querySelector('.planner-scroll');
  const labels = container.querySelector('.planner-timeline-labels');
  scroll.addEventListener('scroll', () => {
    labels.style.transform = `translateX(-${scroll.scrollLeft}px)`;
  }, { passive: true });

  // View size buttons
  container.querySelectorAll('.view-size-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      _viewSize = btn.dataset.size;
      container.dataset.viewSize = _viewSize;
      container.querySelector('.planner-wrapper').dataset.viewSize = _viewSize;
      container.querySelectorAll('.view-size-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      // Re-sync after size change (scroll position unchanged)
      labels.style.transform = `translateX(-${scroll.scrollLeft}px)`;
    });
  });

  // Delegated click for bars and unscheduled chips
  const allTasks = [...scheduled, ...unscheduled];
  container.addEventListener('click', (e) => {
    const bar = e.target.closest('.planner-bar');
    const chip = e.target.closest('.unscheduled-chip');
    const el = bar || chip;
    if (!el || !_plannerCallbacks.onBarClick) return;
    const taskId = el.dataset.taskId;
    const task = allTasks.find(t => String(t.id) === taskId);
    if (task) _plannerCallbacks.onBarClick(task);
  });

  // Right-click context menu for bars
  container.addEventListener('contextmenu', (e) => {
    if (e.shiftKey) return;
    const bar = e.target.closest('.planner-bar');
    if (!bar || !_plannerCallbacks.onContextMenu) return;
    e.preventDefault();
    const taskId = bar.dataset.taskId;
    const task = allTasks.find(t => String(t.id) === taskId);
    if (task) _plannerCallbacks.onContextMenu(e, task);
  });

  // Long-press for mobile
  attachLongPress(container, '.planner-bar', (el) => {
    const taskId = el.dataset.taskId;
    return allTasks.find(t => String(t.id) === taskId);
  }, (syntheticEvent, task) => {
    if (_plannerCallbacks.onContextMenu) _plannerCallbacks.onContextMenu(syntheticEvent, task);
  });

  // Drag-to-reschedule
  setupPlannerDrag(container, allTasks, minDate, totalDays);
}

function renderBarAvatarStack(assigned) {
  const members = Array.isArray(assigned) ? assigned : (assigned ? [assigned] : []);
  if (members.length === 0) {
    const { bg, text } = getAssignedColor('');
    return `<div class="bar-avatar-stack"><span class="bar-avatar" style="background:${bg};color:${text}" title="Unassigned">?</span></div>`;
  }
  const show = members.length > 3 ? members.slice(0, 2) : members;
  const overflow = members.length > 3 ? members.length - 2 : 0;
  const avatars = show.map(name => {
    const { bg, text } = getAssignedColor(name);
    return `<span class="bar-avatar" style="background:${bg};color:${text}" title="${esc(name)}">${getInitials(name)}</span>`;
  }).join('');
  const overflowBadge = overflow > 0 ? `<span class="bar-avatar avatar-overflow" title="${members.slice(2).map(n => esc(n)).join(', ')}">+${overflow}</span>` : '';
  return `<div class="bar-avatar-stack">${avatars}${overflowBadge}</div>`;
}

function taskRowHTML(task, minDate, totalDays) {
  const cat = getCategoryColor(task.category);
  const startOffset = daysBetween(minDate, task.startDate);
  const duration = daysBetween(task.startDate, task.endDate);
  const leftPct = (startOffset / totalDays) * 100;
  const widthPct = Math.max((duration / totalDays) * 100, 1);
  const assignedTitle = Array.isArray(task.assigned) ? task.assigned.join(', ') : (task.assigned || '');

  return `
    <div class="planner-row">
      <div class="planner-bar-container">
        <div class="planner-bar${task.status === 'Done' ? ' planner-bar--done' : ''}" data-task-id="${task.id}" data-start-pct="${leftPct}" data-width-pct="${widthPct}" data-duration="${duration}" style="left:${leftPct}%;width:${widthPct}%;background:${cat.bg};color:${cat.text};border-left:3px solid ${cat.text}"
             title="${esc(task.task)} (${esc(task.category)}) - ${esc(assignedTitle)}">
          <div class="planner-bar-handle planner-bar-handle--left" data-handle="left"></div>
          <span class="bar-label">${esc(task.task)}</span>
          ${renderBarAvatarStack(task.assigned)}
          <div class="planner-bar-handle planner-bar-handle--right" data-handle="right"></div>
        </div>
      </div>
    </div>
  `;
}

function getMonthHeaders(min, max) {
  const totalDays = daysBetween(min, max);
  const headers = [];
  const d = new Date(min.getFullYear(), min.getMonth(), 1);
  while (d <= max) {
    const monthStart = new Date(Math.max(d.getTime(), min.getTime()));
    const monthEnd = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    const clampedEnd = new Date(Math.min(monthEnd.getTime(), max.getTime()));
    const leftPct = (daysBetween(min, monthStart) / totalDays) * 100;
    const widthPct = (daysBetween(monthStart, clampedEnd) / totalDays) * 100;
    const isMobile = window.innerWidth <= 768;
    const monthStr = d.toLocaleDateString('en-AU', { month: isMobile ? 'short' : 'long', year: '2-digit' });
    // Slice to 3 chars for short month to avoid locale inconsistency (May/June/July)
    const label = isMobile ? monthStr.replace(/^(\w{3})\w*/, '$1') : monthStr;
    headers.push({
      label,
      leftPct,
      widthPct,
    });
    d.setMonth(d.getMonth() + 1);
  }
  return headers;
}

function daysBetween(a, b) {
  return Math.max(1, Math.round((b - a) / (1000 * 60 * 60 * 24)));
}

/* ── Drag-to-reschedule ─────────────────────────────────────── */

function setupPlannerDrag(container, allTasks, minDate, totalDays) {
  const THRESHOLD = 5;  // px before drag starts
  const MS_PER_DAY = 1000 * 60 * 60 * 24;
  let dragState = null;

  container.addEventListener('pointerdown', (e) => {
    const bar = e.target.closest('.planner-bar');
    if (!bar) return;

    const handle = e.target.closest('.planner-bar-handle');
    const mode = handle ? handle.dataset.handle : 'move';  // 'left', 'right', or 'move'

    const taskId = bar.dataset.taskId;
    const task = allTasks.find(t => String(t.id) === taskId);
    if (!task || !task.startDate || !task.endDate) return;

    const barContainer = bar.closest('.planner-bar-container');
    const bodyEl = container.querySelector('.planner-body');
    const containerWidth = bodyEl.offsetWidth;

    const startPct = parseFloat(bar.dataset.startPct);
    const widthPct = parseFloat(bar.dataset.widthPct);

    dragState = {
      bar,
      barContainer,
      bodyEl,
      containerWidth,
      task,
      mode,
      startX: e.clientX,
      startY: e.clientY,
      moved: false,
      startPct,
      widthPct,
      ghost: null,
    };

    bar.setPointerCapture(e.pointerId);
    e.preventDefault();
  });

  container.addEventListener('pointermove', (e) => {
    if (!dragState) return;
    const dx = e.clientX - dragState.startX;
    const dy = e.clientY - dragState.startY;

    if (!dragState.moved) {
      if (Math.abs(dx) < THRESHOLD && Math.abs(dy) < THRESHOLD) return;
      dragState.moved = true;
      dragState.bar.classList.add('dragging');

      // Create ghost
      const ghost = document.createElement('div');
      ghost.className = 'planner-bar-ghost';
      ghost.style.background = dragState.bar.style.background;
      ghost.style.borderLeft = dragState.bar.style.borderLeft;
      ghost.style.left = dragState.startPct + '%';
      ghost.style.width = dragState.widthPct + '%';
      dragState.barContainer.appendChild(ghost);
      dragState.ghost = ghost;
    }

    const deltaPct = (dx / dragState.containerWidth) * 100;

    if (dragState.mode === 'move') {
      const newLeft = Math.max(0, Math.min(dragState.startPct + deltaPct, 100 - dragState.widthPct));
      dragState.bar.style.left = newLeft + '%';
      dragState.bar.style.width = dragState.widthPct + '%';
    } else if (dragState.mode === 'left') {
      const maxDelta = dragState.widthPct - (1 / totalDays * 100);  // min 1 day
      const clampedDelta = Math.min(deltaPct, maxDelta);
      const newLeft = Math.max(0, dragState.startPct + clampedDelta);
      const newWidth = dragState.widthPct - (newLeft - dragState.startPct);
      dragState.bar.style.left = newLeft + '%';
      dragState.bar.style.width = Math.max(newWidth, 1 / totalDays * 100) + '%';
    } else if (dragState.mode === 'right') {
      const minWidthPct = (1 / totalDays) * 100;
      const newWidth = Math.max(dragState.widthPct + deltaPct, minWidthPct);
      const maxWidth = 100 - dragState.startPct;
      dragState.bar.style.width = Math.min(newWidth, maxWidth) + '%';
    }
  });

  container.addEventListener('pointerup', (e) => {
    if (!dragState) return;
    const state = dragState;
    dragState = null;

    state.bar.classList.remove('dragging');
    if (state.ghost) state.ghost.remove();

    if (!state.moved) return;  // under threshold — let click handler fire

    // Prevent the delegated click from firing after a drag
    const suppressClick = (ev) => { ev.stopPropagation(); };
    container.addEventListener('click', suppressClick, { capture: true, once: true });

    // Compute new dates from final bar position
    const finalLeftPct = parseFloat(state.bar.style.left);
    const finalWidthPct = parseFloat(state.bar.style.width);

    const startDayOffset = Math.round((finalLeftPct / 100) * totalDays);
    const durationDays = Math.max(1, Math.round((finalWidthPct / 100) * totalDays));

    const newStart = new Date(minDate.getTime() + startDayOffset * MS_PER_DAY);
    const newEnd = new Date(newStart.getTime() + durationDays * MS_PER_DAY);

    // Normalise to midnight
    newStart.setHours(0, 0, 0, 0);
    newEnd.setHours(0, 0, 0, 0);

    // Only call back if dates actually changed
    const startChanged = newStart.getTime() !== state.task.startDate.getTime();
    const endChanged = newEnd.getTime() !== state.task.endDate.getTime();
    if ((startChanged || endChanged) && _plannerCallbacks.onReschedule) {
      _plannerCallbacks.onReschedule(state.task, newStart, newEnd);
    } else {
      // Snap bar back to original position
      state.bar.style.left = state.startPct + '%';
      state.bar.style.width = state.widthPct + '%';
    }
  });

  container.addEventListener('pointercancel', () => {
    if (!dragState) return;
    dragState.bar.classList.remove('dragging');
    if (dragState.ghost) dragState.ghost.remove();
    // Snap back
    dragState.bar.style.left = dragState.startPct + '%';
    dragState.bar.style.width = dragState.widthPct + '%';
    dragState = null;
  });
}
