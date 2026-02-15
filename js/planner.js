import { CATEGORY_COLORS, ASSIGNED_COLORS } from './theme.js';

let _plannerCallbacks = {};

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
    <div class="planner-wrapper">
      <div class="planner-header">
        <div class="planner-label-col"></div>
        <div class="planner-timeline-header">
          ${months.map(m => `<div class="month-header" style="left:${m.leftPct}%;width:${m.widthPct}%">${m.label}</div>`).join('')}
          ${todayPct !== null ? `<div class="today-marker-header" style="left:${todayPct}%"><span>Today</span></div>` : ''}
        </div>
      </div>
      <div class="planner-body">
        ${todayPct !== null ? `<div class="today-line" style="left:calc(220px + (100% - 220px) * ${todayPct / 100})"></div>` : ''}
        ${[...groups.entries()].map(([room, roomTasks]) => `
          <div class="planner-group">
            <div class="planner-group-header">${esc(room)}</div>
            ${roomTasks.map(t => taskRowHTML(t, minDate, totalDays)).join('')}
          </div>
        `).join('')}
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
  const cat = CATEGORY_COLORS[task.category] || { bg: '#E2E8F0', text: '#4A5568' };
  const startOffset = daysBetween(minDate, task.startDate);
  const duration = daysBetween(task.startDate, task.endDate);
  const leftPct = (startOffset / totalDays) * 100;
  const widthPct = Math.max((duration / totalDays) * 100, 1);
  const initials = task.assigned ? task.assigned.slice(0, 2).toUpperCase() : '';
  const rawColor = ASSIGNED_COLORS[task.assigned] || '#222222';
  const assignedBg = typeof rawColor === 'object' ? rawColor.bg : rawColor;
  const assignedText = typeof rawColor === 'object' ? rawColor.text : '#fff';

  return `
    <div class="planner-row">
      <div class="planner-label" title="${esc(task.task)}">${esc(task.task)}</div>
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
    headers.push({
      label: d.toLocaleDateString('en-AU', { month: 'short', year: 'numeric' }),
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

function esc(str) {
  const d = document.createElement('div');
  d.textContent = str || '';
  return d.innerHTML;
}
