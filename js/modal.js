import { esc, getInitials, getAssignedColor } from './utils.js';

const STATUS_OPTIONS = ['To Do', 'In Progress', 'Blocked', 'Done'];

function displayDate(d) {
  if (!d) return 'Set date';
  const day = d.getDate();
  const mon = d.toLocaleString('en-AU', { month: 'short' });
  const yr = String(d.getFullYear()).slice(-2);
  return `${day} ${mon} ${yr}`;
}

function ariaDate(label, d) {
  if (!d) return label;
  return `${label}: ${d.getDate()} ${d.toLocaleString('en-AU', { month: 'long' })} ${d.getFullYear()}`;
}

let modalEl = null;

/**
 * Open an edit modal pre-filled with task data.
 * @param {object} task       — the task object
 * @param {object} options    — { categories: string[], assignees: string[], rooms: string[], allTasks: object[] }
 * @param {function} onSave   — called with { originalTask, updatedFields }
 * @param {function} onRoomChange — called with { action, oldRoom, newRoom, affectedTasks }
 */
export function openEditModal(task, options, onSave, onRoomChange) {
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

  const { bg: assignedBg, text: assignedText } = getAssignedColor(task.assigned);
  const initials = getInitials(task.assigned);

  const rooms = options.rooms || [];

  // Snapshot initial values for dirty checking
  const initial = {
    room: task.room || '',
    task: task.task || '',
    category: task.category || '',
    status: task.status || '',
    startDate: fmtDate(task.startDate),
    endDate: fmtDate(task.endDate),
    dependencies: task.dependencies || '',
    assigned: task.assigned || '',
  };

  modalEl.className = 'modal-overlay';
  modalEl.innerHTML = `
    <div class="modal-dialog" role="dialog" aria-label="Edit task">
      <div class="modal-header">
        <h2 class="modal-title">Edit Task</h2>
      </div>
      <form class="modal-form" autocomplete="off">
        <div class="modal-field">
          <span>Room</span>
          <div class="room-field-wrap" id="room-field-wrap">
            <select name="room">
              ${rooms.map(r =>
                `<option value="${esc(r)}"${r === task.room ? ' selected' : ''}>${esc(r)}</option>`
              ).join('')}
              <option value="__new__">+ New Room</option>
            </select>
            <button type="button" class="room-action-btn" id="room-edit-btn" title="Rename room">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.863 4.487Zm0 0L19.5 7.125"/></svg>
            </button>
          </div>
        </div>
        <div class="modal-row">
          <label class="modal-field" style="flex:1;min-width:0">
            <span>Task</span>
            <input type="text" name="task" value="${esc(task.task)}">
          </label>
          <div class="modal-field" style="flex:0 0 auto">
            <span>Assigned</span>
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
          </div>
        </div>
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
            <div class="date-picker-wrap">
              <button type="button" class="date-display${task.startDate ? '' : ' empty'}" data-for="startDate">${displayDate(task.startDate)}</button>
              <input type="date" name="startDate" class="date-native" value="${fmtDate(task.startDate)}"
                     aria-label="${ariaDate('Start Date', task.startDate)}">
            </div>
          </label>
          <label class="modal-field">
            <span>End Date</span>
            <div class="date-picker-wrap">
              <button type="button" class="date-display${task.endDate ? '' : ' empty'}" data-for="endDate">${displayDate(task.endDate)}</button>
              <input type="date" name="endDate" class="date-native" value="${fmtDate(task.endDate)}"
                     aria-label="${ariaDate('End Date', task.endDate)}">
            </div>
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

  // --- Dirty checking ---
  const avatarSelect = modalEl.querySelector('.modal-avatar-select');
  const form = modalEl.querySelector('form');

  function isDirty() {
    const fd = new FormData(form);
    if ((fd.get('room') || '') !== initial.room) return true;
    if ((fd.get('task') || '') !== initial.task) return true;
    if ((fd.get('category') || '') !== initial.category) return true;
    if ((fd.get('status') || '') !== initial.status) return true;
    if ((fd.get('startDate') || '') !== initial.startDate) return true;
    if ((fd.get('endDate') || '') !== initial.endDate) return true;
    if ((fd.get('dependencies') || '') !== initial.dependencies) return true;
    if ((avatarSelect.value || '') !== initial.assigned) return true;
    return false;
  }

  const close = () => {
    modalEl.classList.remove('open');
    document.removeEventListener('keydown', onKey);
  };

  const tryClose = () => {
    if (isDirty()) {
      if (!confirm('You have unsaved changes. Close without saving?')) return;
    }
    close();
  };

  // --- Room management ---
  const roomWrap = modalEl.querySelector('#room-field-wrap');
  const roomSelect = roomWrap.querySelector('select[name="room"]');
  const roomEditBtn = modalEl.querySelector('#room-edit-btn');

  roomSelect.addEventListener('change', () => {
    if (roomSelect.value === '__new__') {
      showRoomInlineInput('', (newName) => {
        if (!newName) {
          roomSelect.value = task.room || rooms[0] || '';
          return;
        }
        const opt = document.createElement('option');
        opt.value = newName;
        opt.textContent = newName;
        roomSelect.insertBefore(opt, roomSelect.querySelector('option[value="__new__"]'));
        roomSelect.value = newName;
      });
    }
  });

  roomEditBtn.addEventListener('click', () => {
    const currentRoom = roomSelect.value;
    if (!currentRoom || currentRoom === '__new__') return;
    showRoomInlineInput(currentRoom, (newName) => {
      if (!newName || newName === currentRoom) return;
      const affectedTasks = (options.allTasks || []).filter(t => t.room === currentRoom);
      if (onRoomChange) {
        onRoomChange({ action: 'rename', oldRoom: currentRoom, newRoom: newName, affectedTasks });
      }
      const opt = roomSelect.querySelector(`option[value="${CSS.escape(currentRoom)}"]`);
      if (opt) {
        opt.value = newName;
        opt.textContent = newName;
      }
      roomSelect.value = newName;
    });
  });

  function showRoomInlineInput(prefill, onDone) {
    const existing = roomWrap.querySelector('.room-inline-input');
    if (existing) existing.remove();

    roomSelect.style.display = 'none';
    roomEditBtn.style.display = 'none';

    const wrap = document.createElement('div');
    wrap.className = 'room-inline-input';
    wrap.innerHTML = `
      <input type="text" value="${esc(prefill)}" placeholder="Room name...">
      <button type="button" class="room-confirm-btn" title="Confirm">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m4.5 12.75 6 6 9-13.5"/></svg>
      </button>
      <button type="button" class="room-cancel-btn" title="Cancel">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 18 18 6M6 6l12 12"/></svg>
      </button>
    `;
    roomWrap.appendChild(wrap);

    const inp = wrap.querySelector('input');
    inp.focus();
    inp.select();

    const finish = (val) => {
      wrap.remove();
      roomSelect.style.display = '';
      roomEditBtn.style.display = '';
      onDone(val ? val.trim() : '');
    };

    wrap.querySelector('.room-confirm-btn').addEventListener('click', () => finish(inp.value));
    wrap.querySelector('.room-cancel-btn').addEventListener('click', () => finish(''));
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); finish(inp.value); }
      if (e.key === 'Escape') finish('');
    });
  }

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

  // Avatar-based assignee picker
  const avatarBtn = modalEl.querySelector('.modal-avatar');
  avatarBtn.addEventListener('click', () => avatarSelect.click());
  avatarSelect.addEventListener('change', () => {
    const name = avatarSelect.value;
    const { bg, text } = getAssignedColor(name);
    avatarBtn.style.background = bg;
    avatarBtn.style.color = text;
    avatarBtn.textContent = getInitials(name);
    avatarBtn.title = name || 'Unassigned';
  });

  // Date picker wiring
  modalEl.querySelectorAll('.date-picker-wrap').forEach(wrap => {
    const btn = wrap.querySelector('.date-display');
    const native = wrap.querySelector('.date-native');
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      native.showPicker ? native.showPicker() : native.click();
    });
    native.addEventListener('change', () => {
      if (native.value) {
        const d = new Date(native.value + 'T00:00:00');
        btn.textContent = displayDate(d);
        btn.classList.remove('empty');
        const label = btn.dataset.for === 'startDate' ? 'Start Date' : 'End Date';
        native.setAttribute('aria-label', ariaDate(label, d));
      } else {
        btn.textContent = 'Set date';
        btn.classList.add('empty');
        const label = btn.dataset.for === 'startDate' ? 'Start Date' : 'End Date';
        native.setAttribute('aria-label', label);
      }
    });
  });

  // Cancel
  modalEl.querySelector('.modal-cancel').addEventListener('click', tryClose);

  // Backdrop click
  modalEl.addEventListener('click', (e) => {
    if (e.target === modalEl) tryClose();
  });

  // Escape key
  const onKey = (e) => {
    if (e.key === 'Escape') tryClose();
  };
  document.addEventListener('keydown', onKey);

  // Save
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const updatedFields = {};
    const fieldNames = ['task', 'room', 'category', 'status', 'startDate', 'endDate', 'dependencies'];
    for (const name of fieldNames) {
      updatedFields[name] = fd.get(name) || '';
    }
    updatedFields.assigned = avatarSelect.value || '';
    close();
    onSave({ originalTask: task.task, updatedFields });
  });

  // Focus first input
  setTimeout(() => modalEl.querySelector('input[name="task"]').focus(), 50);
}
