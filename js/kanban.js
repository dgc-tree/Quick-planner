import { CATEGORY_COLORS, ASSIGNED_COLORS, STATUS_COLORS } from './theme.js';

const STATUS_ORDER = ['Backlog', 'To Do', 'In Progress', 'Blocked/Waiting', 'Done'];

let draggedCard = null;
let draggedTaskId = null;
let placeholder = null;

export function renderKanban(container, tasks, groupBy = 'room') {
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
      header.style.background = statusColor.bg;
      header.style.color = statusColor.text;
    }
    header.innerHTML = `
      <span class="column-title">${esc(groupName)}</span>
      <span class="column-count">${groupTasks.length}</span>
    `;

    const cardList = document.createElement('div');
    cardList.className = 'kanban-cards';
    cardList.dataset.group = groupName;

    for (const task of groupTasks) {
      cardList.appendChild(createCard(task));
    }

    // Drop zone events on the card list
    cardList.addEventListener('dragover', handleDragOver);
    cardList.addEventListener('dragenter', handleDragEnter);
    cardList.addEventListener('dragleave', handleDragLeave);
    cardList.addEventListener('drop', handleDrop);

    col.appendChild(header);
    col.appendChild(cardList);
    container.appendChild(col);
  }
}

function createCard(task) {
  const cat = CATEGORY_COLORS[task.category] || { bg: '#E2E8F0', text: '#4A5568' };
  const assignedColor = ASSIGNED_COLORS[task.assigned] || '#A0AEC0';
  const initials = getInitials(task.assigned);
  const dates = formatDateRange(task.startDate, task.endDate);

  const card = document.createElement('div');
  card.className = 'kanban-card';
  card.draggable = true;
  card.dataset.taskId = task.id;

  let depsHTML = '';
  if (task.dependencies) {
    depsHTML = `<div class="card-deps">Depends on: ${esc(task.dependencies)}</div>`;
  }

  card.innerHTML = `
    <span class="category-badge" style="background:${cat.bg};color:${cat.text}">
      ${esc(task.category)}
    </span>
    <div class="card-title">${esc(task.task)}</div>
    <div class="card-meta">
      <span class="card-room">${esc(task.room)}</span>
    </div>
    <div class="card-footer">
      <span class="card-dates">${dates}</span>
      <span class="card-avatar" style="background:${assignedColor}" title="${esc(task.assigned)}">
        ${initials}
      </span>
    </div>
    ${depsHTML}
  `;

  // Expand on click
  card.addEventListener('click', (e) => {
    if (card.classList.contains('dragging')) return;
    card.classList.toggle('expanded');
  });

  // Drag events
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
    // Update column counts
    document.querySelectorAll('.kanban-column').forEach(col => {
      const count = col.querySelector('.kanban-cards').children.length;
      col.querySelector('.column-count').textContent = count;
    });
  });

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

function formatDateRange(start, end) {
  const opts = { day: 'numeric', month: 'short' };
  if (!start && !end) return 'TBD';
  if (start && end) return `${start.toLocaleDateString('en-AU', opts)} - ${end.toLocaleDateString('en-AU', opts)}`;
  if (start) return `From ${start.toLocaleDateString('en-AU', opts)}`;
  return `Until ${end.toLocaleDateString('en-AU', opts)}`;
}

function getInitials(name) {
  if (!name) return '?';
  return name.slice(0, 2).toUpperCase();
}

function esc(str) {
  const d = document.createElement('div');
  d.textContent = str || '';
  return d.innerHTML;
}
