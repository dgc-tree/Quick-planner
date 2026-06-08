import { getInitials, getAssignedColor, getCategoryColor, formatDateRange, normaliseAssigned } from './utils.js';
import { ASSIGNED_COLORS } from './theme.js';
import { attachLongPress } from './context-menu.js';

const checkedItems = new Map(); // taskId → previousStatus
const assignedNames = Object.keys(ASSIGNED_COLORS);

export function renderTodoList(container, tasks, callbacks = {}) {
  const actionable = [...tasks];
  actionable.sort((a, b) => {
    const aDate = a.startDate || a.endDate;
    const bDate = b.startDate || b.endDate;
    if (!aDate && !bDate) return 0;
    if (!aDate) return 1;
    if (!bDate) return -1;
    return aDate - bDate;
  });

  container.innerHTML = '';

  if (actionable.length === 0) {
    container.innerHTML = '<div class="empty-state">No tasks</div>';
    return;
  }

  // Group by start-date month (fall back to end date, then undated)
  const monthKey = (t) => {
    const d = t.startDate || t.endDate;
    return d ? `${d.getFullYear()}-${d.getMonth()}` : 'no-date';
  };
  const monthLabel = (t) => {
    const d = t.startDate || t.endDate;
    if (!d) return 'No date set';
    return d.toLocaleDateString('en-AU', { month: 'long', year: 'numeric' });
  };
  let currentMonth = null;

  for (const task of actionable) {
    const key = monthKey(task);
    if (key !== currentMonth) {
      currentMonth = key;
      const header = document.createElement('div');
      header.className = 'todo-month-header';
      header.textContent = monthLabel(task);
      container.appendChild(header);
    }
    if (task.status === 'Done' && !checkedItems.has(task.id)) {
      checkedItems.set(task.id, 'To Do');
    }
    const isChecked = checkedItems.has(task.id) || task.status === 'Done';
    const row = document.createElement('div');
    row.className = 'todo-item' + (isChecked ? ' todo-done' : '');

    const checkbox = document.createElement('div');
    checkbox.className = 'todo-checkbox' + (isChecked ? ' checked' : '');
    checkbox.setAttribute('role', 'checkbox');
    checkbox.setAttribute('aria-checked', isChecked);
    checkbox.addEventListener('click', (e) => {
      e.stopPropagation();
      const nowChecked = !checkbox.classList.contains('checked');
      checkbox.classList.toggle('checked', nowChecked);
      checkbox.setAttribute('aria-checked', nowChecked);
      if (nowChecked) {
        checkedItems.set(task.id, task.status);
        row.classList.add('todo-done');
        if (callbacks.onStatusChange) callbacks.onStatusChange(task, 'Done');
      } else {
        const prev = checkedItems.get(task.id) || 'To Do';
        checkedItems.delete(task.id);
        row.classList.remove('todo-done');
        if (callbacks.onStatusChange) callbacks.onStatusChange(task, prev);
      }
    });

    const cat = getCategoryColor(task.category);
    const badge = document.createElement('span');
    badge.className = 'category-badge';
    badge.style.background = cat.bg;
    badge.style.color = cat.text;
    badge.textContent = task.category;

    let tqBadge = null;
    if (task.tradeQuote) {
      tqBadge = document.createElement('span');
      tqBadge.className = 'trade-quote-badge';
      tqBadge.title = 'Trade quote required';
      tqBadge.textContent = 'TQ';
    }

    const name = document.createElement('span');
    name.className = 'todo-task-name';
    name.textContent = task.task;

    const room = document.createElement('span');
    room.className = 'todo-room';
    room.textContent = task.room;

    const dateRange = formatDateRange(task.startDate, task.endDate);
    const dates = document.createElement('span');
    dates.className = 'todo-dates';
    dates.textContent = dateRange.text;
    dates.setAttribute('aria-label', dateRange.aria);

    const members = normaliseAssigned(task.assigned);

    const avatarStack = document.createElement('div');
    avatarStack.className = 'card-avatar-stack todo-avatar-tap';

    function renderTodoAvatars() {
      avatarStack.innerHTML = '';
      const show = members.length > 3 ? members.slice(0, 2) : (members.length > 0 ? members : ['']);
      show.forEach(name => {
        const span = document.createElement('span');
        span.className = 'card-avatar';
        const { bg, text: txt } = getAssignedColor(name);
        span.style.background = bg;
        span.style.color = txt;
        span.textContent = getInitials(name);
        span.title = name || 'Unassigned';
        avatarStack.appendChild(span);
      });
      if (members.length > 3) {
        const overflow = document.createElement('span');
        overflow.className = 'card-avatar avatar-overflow';
        overflow.textContent = `+${members.length - 2}`;
        overflow.title = members.slice(2).join(', ');
        avatarStack.appendChild(overflow);
      }
    }
    renderTodoAvatars();

    avatarStack.addEventListener('click', (e) => {
      e.stopPropagation();
      // Cycle the first member through available names
      const firstMember = members[0] || '';
      const curIdx = assignedNames.indexOf(firstMember);
      const nextIdx = (curIdx + 1) % assignedNames.length;
      const nextName = assignedNames[nextIdx];
      if (members.length === 0) {
        members.push(nextName);
      } else {
        members[0] = nextName;
      }
      task.assigned = [...members];
      renderTodoAvatars();
      if (callbacks.onAssignChange) callbacks.onAssignChange(task, [...members]);
    });

    const colMeta = document.createElement('div');
    colMeta.className = 'todo-col-meta';
    colMeta.appendChild(room);
    colMeta.appendChild(badge);
    if (tqBadge) colMeta.appendChild(tqBadge);

    const footer = document.createElement('div');
    footer.className = 'todo-footer';
    footer.appendChild(dates);
    footer.appendChild(avatarStack);

    const colMain = document.createElement('div');
    colMain.className = 'todo-col-main';
    colMain.appendChild(name);
    colMain.appendChild(footer);

    row.appendChild(checkbox);
    row.appendChild(colMeta);
    row.appendChild(colMain);

    row.addEventListener('click', (e) => {
      if (e.target === checkbox) return;
      if (callbacks.onTaskClick) callbacks.onTaskClick(task);
    });

    // Right-click context menu
    row.addEventListener('contextmenu', (e) => {
      if (e.shiftKey) return;
      e.preventDefault();
      if (callbacks.onContextMenu) callbacks.onContextMenu(e, task);
    });

    row.dataset.taskId = task.id;
    container.appendChild(row);
  }

  // Long-press for mobile
  attachLongPress(container, '.todo-item', (el) => {
    const id = el.dataset.taskId;
    return actionable.find(t => String(t.id) === id);
  }, (syntheticEvent, task) => {
    if (callbacks.onContextMenu) callbacks.onContextMenu(syntheticEvent, task);
  });
}

