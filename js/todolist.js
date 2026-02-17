import { getInitials, getAssignedColor, getCategoryColor, formatDateRange } from './utils.js';
import { ASSIGNED_COLORS } from './theme.js';

const checkedItems = new Map(); // taskId → previousStatus
const assignedNames = Object.keys(ASSIGNED_COLORS);

export function renderTodoList(container, tasks, callbacks = {}) {
  const today = new Date();
  today.setHours(23, 59, 59, 999);

  const actionable = tasks.filter(t => {
    if (t.status === 'Done' && !checkedItems.has(t.id)) return false;
    if (!t.startDate) return false;
    return t.startDate <= today;
  });

  actionable.sort((a, b) => a.startDate - b.startDate);

  container.innerHTML = '';

  if (actionable.length === 0) {
    container.innerHTML = '<div class="empty-state">No actionable tasks</div>';
    return;
  }

  for (const task of actionable) {
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

    const { bg: assignedBg, text: assignedText } = getAssignedColor(task.assigned);
    const avatar = document.createElement('span');
    avatar.className = 'card-avatar todo-avatar-tap';
    avatar.style.background = assignedBg;
    avatar.style.color = assignedText;
    avatar.title = task.assigned || '';
    avatar.textContent = getInitials(task.assigned);

    avatar.addEventListener('click', (e) => {
      e.stopPropagation();
      const curIdx = assignedNames.indexOf(task.assigned);
      const nextIdx = (curIdx + 1) % assignedNames.length;
      const nextName = assignedNames[nextIdx];
      task.assigned = nextName;
      const { bg, text: txt } = getAssignedColor(nextName);
      avatar.style.background = bg;
      avatar.style.color = txt;
      avatar.textContent = getInitials(nextName);
      avatar.title = nextName;
      if (callbacks.onAssignChange) callbacks.onAssignChange(task, nextName);
    });

    const colMeta = document.createElement('div');
    colMeta.className = 'todo-col-meta';
    colMeta.appendChild(room);
    colMeta.appendChild(badge);

    const footer = document.createElement('div');
    footer.className = 'todo-footer';
    footer.appendChild(dates);
    footer.appendChild(avatar);

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

    container.appendChild(row);
  }
}

export function clearChecked() {
  checkedItems.clear();
}
