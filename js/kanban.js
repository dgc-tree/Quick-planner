import { STATUS_COLORS } from './theme.js';
import { esc, getInitials, getAssignedColor, getCategoryColor, formatDateRange, normaliseAssigned } from './utils.js';
import { openColorPickerModal } from './color-picker.js';
import { loadColumnColors, saveColumnColors } from './storage.js';
import { attachLongPress } from './context-menu.js';

const STATUS_ORDER = ['To Do', 'In Progress', 'Blocked', 'Done'];
const isTouchDevice = window.matchMedia('(pointer: coarse)').matches;

let draggedCard = null;
let draggedTaskId = null;
let placeholder = null;
let _callbacks = {};
let _currentGroupBy = 'room';
let _tasks = [];

export function renderKanban(container, tasks, groupBy = 'room', callbacks = {}) {
  _callbacks = callbacks;
  _currentGroupBy = groupBy;
  _tasks = tasks;
  const groups = new Map();
  for (const task of tasks) {
    const key = task[groupBy] || 'Ungrouped';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(task);
  }

  // When grouping by status, use fixed column ordering
  let entries;
  if (groupBy === 'status') {
    entries = [];
    for (const status of STATUS_ORDER) {
      entries.push([status, groups.get(status) || []]);
    }
    // Add any statuses not in STATUS_ORDER
    for (const [key, tasks] of groups) {
      if (!STATUS_ORDER.includes(key)) {
        entries.push([key, tasks]);
      }
    }
  } else {
    entries = [...groups.entries()];
  }

  container.innerHTML = '';
  for (const [groupName, groupTasks] of entries) {
    const col = document.createElement('div');
    col.className = 'kanban-column';
    col.dataset.group = groupName;

    const header = document.createElement('div');
    header.className = 'kanban-column-header';
    const statusColor = groupBy === 'status' ? STATUS_COLORS[groupName] : null;
    if (statusColor) {
      header.classList.add('status-colored');
      const storedColor = loadColumnColors()[groupName];
      const bg = storedColor || statusColor.bg;
      const text = storedColor ? contrastText(storedColor) : statusColor.text;
      header.style.background = bg;
      header.style.color = text;
    }
    header.innerHTML = `<span class="column-title">${esc(groupName)}</span>`;

    if (statusColor) {
      const menuWrap = document.createElement('div');
      menuWrap.className = 'kanban-col-menu-wrap';

      const colorBtn = document.createElement('button');
      colorBtn.className = 'column-color-btn';
      colorBtn.title = 'Column options';
      colorBtn.innerHTML = '···';

      const menu = document.createElement('div');
      menu.className = 'kanban-col-menu';

      const customiseItem = document.createElement('button');
      customiseItem.className = 'kanban-col-menu-item';
      customiseItem.textContent = 'Customise Colour';

      menu.appendChild(customiseItem);
      menuWrap.appendChild(colorBtn);
      menuWrap.appendChild(menu);

      colorBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = menu.classList.contains('open');
        document.querySelectorAll('.kanban-col-menu.open').forEach(m => m.classList.remove('open'));
        if (!isOpen) menu.classList.add('open');
      });

      customiseItem.addEventListener('click', (e) => {
        e.stopPropagation();
        menu.classList.remove('open');
        openColumnColorPicker(groupName, header);
      });

      document.addEventListener('click', () => menu.classList.remove('open'), { capture: false });

      header.appendChild(menuWrap);
    }

    const cardList = document.createElement('div');
    cardList.className = 'kanban-cards';
    cardList.dataset.group = groupName;

    for (const task of groupTasks) {
      cardList.appendChild(createCard(task));
    }

    // Drop zone events on the card list (desktop only)
    if (!isTouchDevice) {
      cardList.addEventListener('dragover', handleDragOver);
      cardList.addEventListener('dragenter', handleDragEnter);
      cardList.addEventListener('dragleave', handleDragLeave);
      cardList.addEventListener('drop', handleDrop);
    }

    col.appendChild(header);
    col.appendChild(cardList);
    container.appendChild(col);
  }

  // Long-press for mobile
  attachLongPress(container, '.kanban-card', (el) => {
    const id = el.dataset.taskId;
    return tasks.find(t => String(t.id) === id);
  }, (syntheticEvent, task) => {
    if (callbacks.onContextMenu) callbacks.onContextMenu(syntheticEvent, task);
  });
}

function contrastText(hex) {
  const r = parseInt(hex.slice(1,3), 16);
  const g = parseInt(hex.slice(3,5), 16);
  const b = parseInt(hex.slice(5,7), 16);
  return (0.299*r + 0.587*g + 0.114*b) / 255 > 0.55 ? '#101010' : '#FFFFFF';
}

function openColumnColorPicker(columnName, header) {
  const stored = loadColumnColors()[columnName];
  const def = STATUS_COLORS[columnName];
  const initial = stored || (def ? def.bg.startsWith('#') ? def.bg : '#2B6CB0' : '#2B6CB0');
  openColorPickerModal({
    title: `${columnName} colour`,
    initialHex: initial,
    onSave: (hex) => {
      const colors = loadColumnColors();
      colors[columnName] = hex;
      const textColor = contrastText(hex);
      header.style.background = hex;
      header.style.color = textColor;
      saveColumnColors(colors);
      const slug = columnName.toLowerCase().replace(/\s+/g, '-');
      document.documentElement.style.setProperty(`--status-${slug}-text`, textColor);
    },
  });
}

function renderAvatarStack(assigned, cls = 'card-avatar') {
  const members = normaliseAssigned(assigned);
  if (members.length === 0) {
    const { bg, text } = getAssignedColor('');
    return `<div class="${cls}-stack"><span class="${cls}" style="background:${bg};color:${text}" title="Unassigned">?</span></div>`;
  }
  const show = members.length > 3 ? members.slice(0, 2) : members;
  const overflow = members.length > 3 ? members.length - 2 : 0;
  const avatars = show.map(name => {
    const { bg, text } = getAssignedColor(name);
    return `<span class="${cls}" style="background:${bg};color:${text}" title="${esc(name)}">${getInitials(name)}</span>`;
  }).join('');
  const overflowBadge = overflow > 0 ? `<span class="${cls} avatar-overflow" title="${members.slice(2).map(n => esc(n)).join(', ')}">+${overflow}</span>` : '';
  return `<div class="${cls}-stack">${avatars}${overflowBadge}</div>`;
}

function createCard(task) {
  const cat = getCategoryColor(task.category);
  const { text: dates, aria: datesAria } = formatDateRange(task.startDate, task.endDate);

  const card = document.createElement('div');
  card.className = 'kanban-card';
  if (!isTouchDevice) card.draggable = true;
  card.dataset.taskId = task.id;

  let depsHTML = '';
  if (task.dependencies) {
    depsHTML = `<div class="card-deps">Depends on: ${esc(task.dependencies)}</div>`;
  }

  const assignedTitle = Array.isArray(task.assigned) ? task.assigned.join(', ') : (task.assigned || '');

  card.innerHTML = `
    <div class="card-room">${esc(task.room)}</div>
    <div class="card-badges">
      <span class="category-badge" style="background:${cat.bg};color:${cat.text}">
        ${esc(task.category)}
      </span>
      ${task.tradeQuote ? '<span class="trade-quote-badge" title="Trade quote required">TQ</span>' : ''}
      ${task.cost != null ? `<span class="cost-badge" title="$${Number(task.cost).toLocaleString()}">$${task.cost >= 1000 ? Math.round(task.cost / 1000) + 'k' : task.cost}</span>` : ''}
    </div>
    <div class="card-title">${esc(task.task)}</div>
    <div class="card-footer">
      <span class="card-dates" aria-label="${datesAria}">${dates}</span>
      ${renderAvatarStack(task.assigned)}
    </div>
    ${depsHTML}
  `;

  // Click — open edit modal or expand
  card.addEventListener('click', (e) => {
    if (card.classList.contains('dragging')) return;
    if (_callbacks.onCardClick) {
      _callbacks.onCardClick(task);
    } else {
      card.classList.toggle('expanded');
    }
  });

  // Right-click context menu
  card.addEventListener('contextmenu', (e) => {
    if (e.shiftKey) return; // Let native menu through with Shift
    e.preventDefault();
    if (_callbacks.onContextMenu) _callbacks.onContextMenu(e, task);
  });

  // Drag events (desktop only — draggable suppresses click on touch devices)
  if (!isTouchDevice) {
    card.addEventListener('dragstart', (e) => {
      draggedCard = card;
      draggedTaskId = task.id;
      card.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', task.id);
      // Slight delay so the browser captures the card image before we ghost it
      requestAnimationFrame(() => {
        card.style.opacity = '0.4';
      });
    });

    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
      card.style.opacity = '';
      draggedCard = null;
      draggedTaskId = null;
      removePlaceholder();
      // Remove all drop highlights
      document.querySelectorAll('.kanban-cards.drag-over').forEach(el => {
        el.classList.remove('drag-over');
      });
    });
  }

  return card;
}

function handleDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';

  const cardList = e.currentTarget;
  const afterElement = getDragAfterElement(cardList, e.clientY);

  if (!placeholder) {
    placeholder = document.createElement('div');
    placeholder.className = 'kanban-card-placeholder';
  }

  if (afterElement) {
    cardList.insertBefore(placeholder, afterElement);
  } else {
    cardList.appendChild(placeholder);
  }
}

function handleDragEnter(e) {
  e.preventDefault();
  e.currentTarget.classList.add('drag-over');
}

function handleDragLeave(e) {
  // Only remove if we're actually leaving the container
  const cardList = e.currentTarget;
  const rect = cardList.getBoundingClientRect();
  const x = e.clientX;
  const y = e.clientY;
  if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
    cardList.classList.remove('drag-over');
    removePlaceholder();
  }
}

function handleDrop(e) {
  e.preventDefault();
  const cardList = e.currentTarget;
  cardList.classList.remove('drag-over');

  if (!draggedCard) return;

  removePlaceholder();

  const afterElement = getDragAfterElement(cardList, e.clientY);
  if (afterElement) {
    cardList.insertBefore(draggedCard, afterElement);
  } else {
    cardList.appendChild(draggedCard);
  }

  // When grouped by status, notify about status change
  if (_currentGroupBy === 'status' && _callbacks.onStatusChange) {
    const newStatus = cardList.dataset.group;
    const task = _tasks.find(t => t.id === draggedTaskId);
    if (task && task.status !== newStatus) {
      _callbacks.onStatusChange(task, newStatus);
    }
  }
}

function getDragAfterElement(container, y) {
  const cards = [...container.querySelectorAll('.kanban-card:not(.dragging):not(.kanban-card-placeholder)')];

  let closest = null;
  let closestOffset = Number.NEGATIVE_INFINITY;

  for (const card of cards) {
    const box = card.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    if (offset < 0 && offset > closestOffset) {
      closestOffset = offset;
      closest = card;
    }
  }

  return closest;
}

function removePlaceholder() {
  if (placeholder && placeholder.parentNode) {
    placeholder.parentNode.removeChild(placeholder);
  }
}
