import { ASSIGNED_COLORS } from './theme.js';

const STATUS_OPTIONS = ['To Do', 'In Progress', 'Blocked', 'Done'];

let modalEl = null;

/**
 * Open an edit modal pre-filled with task data.
 * @param {object} task       — the task object
 * @param {object} options    — { categories: string[], assignees: string[], allTasks: object[] }
 * @param {function} onSave   — called with { originalTask, updatedFields }
 */
export function openEditModal(task, options, onSave) {
  if (!modalEl) {
    modalEl = document.createElement('div');
    modalEl.id = 'edit-modal';
    document.getElementById('modal-root').appendChild(modalEl);
  }

  const fmtDate = (d) => {
    if (!d) return '';
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  const rawColor = ASSIGNED_COLORS[task.assigned] || '#6B7280';
  const assignedBg = typeof rawColor === 'object' ? rawColor.bg : rawColor;
  const assignedText = typeof rawColor === 'object' ? rawColor.text : '#fff';
  const initials = task.assigned ? task.assigned.slice(0, 2).toUpperCase() : '?';

  modalEl.className = 'modal-overlay';
  modalEl.innerHTML = `
    <div class="modal-dialog" role="dialog" aria-label="Edit task">
      <div class="modal-header">
        <h2 class="modal-title">Edit Task</h2>
        <div class="modal-header-right">
          <div class="modal-avatar-wrap">
            <button type="button" class="modal-avatar" style="background:${assignedBg};color:${assignedText}" title="${esc(task.assigned || 'Unassigned')}">
              ${initials}
            </button>
            <select class="modal-avatar-select" name="assigned">
              <option value="">Unassigned</option>
              ${options.assignees.map(a =>
                `<option value="${esc(a)}"${a === task.assigned ? ' selected' : ''}>${esc(a)}</option>`
              ).join('')}
            </select>
          </div>
          <button type="button" class="modal-close" aria-label="Close">&times;</button>
        </div>
      </div>
      <form class="modal-form" autocomplete="off">
        <label class="modal-field">
          <span>Task</span>
          <input type="text" name="task" value="${esc(task.task)}">
        </label>
        <label class="modal-field">
          <span>Room</span>
          <input type="text" value="${esc(task.room)}" disabled>
        </label>
        <div class="modal-row">
          <label class="modal-field">
            <span>Category</span>
            <select name="category">
              ${options.categories.map(c =>
                `<option value="${esc(c)}"${c === task.category ? ' selected' : ''}>${esc(c)}</option>`
              ).join('')}
            </select>
          </label>
          <label class="modal-field">
            <span>Status</span>
            <select name="status">
              ${STATUS_OPTIONS.map(s =>
                `<option value="${esc(s)}"${s === task.status ? ' selected' : ''}>${esc(s)}</option>`
              ).join('')}
            </select>
          </label>
        </div>
        <div class="modal-row">
          <label class="modal-field">
            <span>Start Date</span>
            <input type="date" name="startDate" value="${fmtDate(task.startDate)}">
          </label>
          <label class="modal-field">
            <span>End Date</span>
            <input type="date" name="endDate" value="${fmtDate(task.endDate)}">
          </label>
        </div>
        <div class="modal-field">
          <span>Dependencies</span>
          <div class="dep-search-wrap">
            <input type="text" class="dep-search-input" placeholder="Search tasks..." autocomplete="off">
            <div class="dep-dropdown hidden"></div>
            <input type="hidden" name="dependencies" value="${esc(task.dependencies)}">
            <div class="dep-selected"></div>
          </div>
        </div>
        <div class="modal-actions">
          <button type="button" class="modal-btn modal-cancel">Cancel</button>
          <button type="submit" class="modal-btn modal-save">Save</button>
        </div>
      </form>
    </div>
  `;

  modalEl.classList.add('open');

  // --- Searchable dependency picker ---
  const depHidden = modalEl.querySelector('input[name="dependencies"]');
  const depSearchInput = modalEl.querySelector('.dep-search-input');
  const depDropdown = modalEl.querySelector('.dep-dropdown');
  const depSelected = modalEl.querySelector('.dep-selected');
  const otherTasks = (options.allTasks || []).filter(t => t.task !== task.task);
  let selectedDeps = task.dependencies ? task.dependencies.split(',').map(s => s.trim()).filter(Boolean) : [];

  function syncDepHidden() {
    depHidden.value = selectedDeps.join(', ');
  }

  function renderDepChips() {
    depSelected.innerHTML = selectedDeps.map(name =>
      `<span class="dep-chip">${esc(name)}<button type="button" class="dep-chip-remove" data-name="${esc(name)}">&times;</button></span>`
    ).join('');
    depSelected.querySelectorAll('.dep-chip-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        selectedDeps = selectedDeps.filter(n => n !== btn.dataset.name);
        syncDepHidden();
        renderDepChips();
      });
    });
  }

  function showDropdown(filter) {
    const q = (filter || '').toLowerCase();
    const matches = otherTasks.filter(t =>
      (!q || t.task.toLowerCase().includes(q)) && !selectedDeps.includes(t.task)
    ).slice(0, 5);
    if (matches.length === 0) {
      depDropdown.classList.add('hidden');
      return;
    }
    depDropdown.innerHTML = matches.map(t =>
      `<div class="dep-option" data-task="${esc(t.task)}">${esc(t.task)} <small style="color:var(--text-secondary)">(${esc(t.room)})</small></div>`
    ).join('');
    depDropdown.classList.remove('hidden');
    depDropdown.querySelectorAll('.dep-option').forEach(opt => {
      opt.addEventListener('click', () => {
        selectedDeps.push(opt.dataset.task);
        syncDepHidden();
        renderDepChips();
        depSearchInput.value = '';
        depDropdown.classList.add('hidden');
      });
    });
  }

  depSearchInput.addEventListener('input', () => showDropdown(depSearchInput.value));
  depSearchInput.addEventListener('focus', () => showDropdown(depSearchInput.value));
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.dep-search-wrap')) depDropdown.classList.add('hidden');
  }, { once: false });

  renderDepChips();
  syncDepHidden();

  const form = modalEl.querySelector('form');
  const close = () => {
    modalEl.classList.remove('open');
  };

  // Avatar-based assignee picker
  const avatarBtn = modalEl.querySelector('.modal-avatar');
  const avatarSelect = modalEl.querySelector('.modal-avatar-select');
  avatarBtn.addEventListener('click', () => avatarSelect.click());
  avatarSelect.addEventListener('change', () => {
    const name = avatarSelect.value;
    const rc = ASSIGNED_COLORS[name] || '#6B7280';
    const bg = typeof rc === 'object' ? rc.bg : rc;
    const text = typeof rc === 'object' ? rc.text : '#fff';
    avatarBtn.style.background = bg;
    avatarBtn.style.color = text;
    avatarBtn.textContent = name ? name.slice(0, 2).toUpperCase() : '?';
    avatarBtn.title = name || 'Unassigned';
  });

  // Cancel / Close
  modalEl.querySelector('.modal-cancel').addEventListener('click', close);
  modalEl.querySelector('.modal-close').addEventListener('click', close);

  // Backdrop click
  modalEl.addEventListener('click', (e) => {
    if (e.target === modalEl) close();
  });

  // Escape key
  const onKey = (e) => {
    if (e.key === 'Escape') {
      close();
      document.removeEventListener('keydown', onKey);
    }
  };
  document.addEventListener('keydown', onKey);

  // Save
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const updatedFields = {};
    const fieldNames = ['task', 'category', 'status', 'startDate', 'endDate', 'dependencies'];
    for (const name of fieldNames) {
      updatedFields[name] = fd.get(name) || '';
    }
    updatedFields.assigned = avatarSelect.value || '';
    close();
    document.removeEventListener('keydown', onKey);
    onSave({ originalTask: task.task, updatedFields });
  });

  // Focus first input
  setTimeout(() => modalEl.querySelector('input[name="task"]').focus(), 50);
}

function esc(str) {
  const d = document.createElement('div');
  d.textContent = str || '';
  return d.innerHTML;
}
