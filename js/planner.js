import { esc, getInitials, getAssignedColor, getCategoryColor } from './utils.js';

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

  const minDate = new Date(Math.min(...scheduled.map(t => t.startDate.getTime())));
  const maxDate = new Date(Math.max(...scheduled.map(t => t.endDate.getTime())));
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
    <div class="planner-scroll">
    <div class="planner-wrapper" data-view-size="${_viewSize}">
      <div class="planner-left">
        <div class="planner-label-col"><span class="planner-toolbar-label">Month</span></div>
        ${[...groups.entries()].map(([room, roomTasks]) => `
          <div class="planner-group-left">
            <div class="planner-group-header">${esc(room)}</div>
            ${roomTasks.map(t => `<div class="planner-label" title="${esc(t.task)}">${esc(t.task)}</div>`).join('')}
          </div>
        `).join('')}
      </div>
      <div class="planner-right">
        <div class="planner-timeline-header">
          ${months.map(m => `<div class="month-header" style="left:${m.leftPct}%;width:${m.widthPct}%">${m.label}</div>`).join('')}
          ${todayPct !== null ? `<div class="today-marker-header" style="left:${todayPct}%"><span>Today</span></div>` : ''}
        </div>
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

  // View size buttons
  container.querySelectorAll('.view-size-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      _viewSize = btn.dataset.size;
      container.querySelector('.planner-wrapper').dataset.viewSize = _viewSize;
      container.querySelectorAll('.view-size-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  // Delegated click for bars and unscheduled chips
  const allTasks = [...scheduled, ...unscheduled];
  container.addEventListener('click', (e) => {
    const bar = e.target.closest('.planner-bar');
    const chip = e.target.closest('.unscheduled-chip');
    const el = bar || chip;
    if (!el || !_plannerCallbacks.onBarClick) return;
    const taskId = parseInt(el.dataset.taskId, 10);
    const task = allTasks.find(t => t.id === taskId);
    if (task) _plannerCallbacks.onBarClick(task);
  });
}

function taskRowHTML(task, minDate, totalDays) {
  const cat = getCategoryColor(task.category);
  const startOffset = daysBetween(minDate, task.startDate);
  const duration = daysBetween(task.startDate, task.endDate);
  const leftPct = (startOffset / totalDays) * 100;
  const widthPct = Math.max((duration / totalDays) * 100, 1);
  const initials = getInitials(task.assigned);
  const { bg: assignedBg, text: assignedText } = getAssignedColor(task.assigned);

  return `
    <div class="planner-row">
      <div class="planner-bar-container">
        <div class="planner-bar" data-task-id="${task.id}" style="left:${leftPct}%;width:${widthPct}%;background:${cat.bg};color:${cat.text};border-left:3px solid ${cat.text};cursor:pointer"
             title="${esc(task.task)} (${esc(task.category)}) - ${esc(task.assigned)}">
          <span class="bar-label">${esc(task.task)}</span>
          <span class="bar-avatar" style="background:${assignedBg};color:${assignedText}">${initials}</span>
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
