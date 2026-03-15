import { esc, getInitials, getAssignedColor } from './utils.js';
import { isLoggedIn, isSandbox, apiCall } from './auth.js';

let _drp = { openDateRangePicker() {}, closeDateRangePicker() {} };
import('./date-range-picker.js').then(m => { _drp = m; }).catch(err => console.warn('date-range-picker unavailable:', err));

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
  return `${label}: ${d.getDate()} ${d.toLocaleString('en-AU', { month: 'long' })} ${String(d.getFullYear()).slice(-2)}`;
}

let modalEl = null;

/**
 * Open an edit modal pre-filled with task data.
 * @param {object} task       — the task object
 * @param {object} options    — { categories: string[], assignees: string[], rooms: string[], allTasks: object[] }
 * @param {function} onSave   — called with { originalTask, updatedFields }
 * @param {function} onRoomChange — called with { action, oldRoom, newRoom, affectedTasks }
 */
export function openEditModal(task, options, onSave, onRoomChange, actions = {}) {
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

  // Coerce assigned to array for backward compat
  const taskAssigned = Array.isArray(task.assigned) ? task.assigned : (task.assigned ? [task.assigned] : []);

  const rooms = options.rooms || [];

  // Snapshot initial values for dirty checking
  const initial = {
    room: task.room || '',
    task: task.task || '',
    category: task.category || '',
    status: task.status || '',
    startDate: fmtDate(task.startDate),
    endDate: fmtDate(task.endDate),
    dependencies: Array.isArray(task.dependencies) ? task.dependencies.join(', ') : (task.dependencies || ''),
    assigned: [...taskAssigned].sort().join(','),
    tradeQuote: !!task.tradeQuote,
  };

  modalEl.className = 'modal-overlay';
  modalEl.innerHTML = `
    <div class="modal-dialog" role="dialog" aria-label="${task.id !== null ? 'Edit task' : 'New task'}">
      <div class="modal-header">
        <h2 class="modal-title">${task.id !== null ? 'Edit Task' : 'New Task'}</h2>
        ${task.id !== null ? `
        <div class="modal-more-wrap">
          <button type="button" class="modal-more-btn" id="modal-more-btn" title="More options" aria-haspopup="true" aria-expanded="false">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></svg>
          </button>
          <div class="modal-more-menu hidden" id="modal-more-menu" role="menu">
            <button type="button" class="modal-more-item" id="menu-rename-btn" role="menuitem">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.863 4.487Z"/></svg>
              Rename room
            </button>
            <button type="button" class="modal-more-item" id="menu-duplicate-btn" role="menuitem">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="8" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
              Duplicate
            </button>
            <button type="button" class="modal-more-item danger" id="menu-delete-btn" role="menuitem">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg>
              Delete
            </button>
          </div>
        </div>
        ` : ''}
      </div>
      <form class="modal-form" autocomplete="off">
        <div class="modal-layout">
          <div class="modal-layout-main">
            <div class="modal-field">
              <span>Room</span>
              <div class="room-field-wrap" id="room-field-wrap">
                <select name="room">
                  ${rooms.map(r =>
                    `<option value="${esc(r)}"${r === task.room ? ' selected' : ''}>${esc(r)}</option>`
                  ).join('')}
                  <option value="__new__">+ New Room</option>
                </select>
              </div>
            </div>
            <div class="modal-field">
              <span>Task</span>
              <input type="text" name="task" value="${esc(task.task)}">
            </div>
            <div class="modal-row">
              <div class="modal-field">
                <span>Category</span>
                <div class="category-field-wrap" id="category-field-wrap">
                  <select name="category">
                    ${options.categories.map(c =>
                      `<option value="${esc(c)}"${c === task.category ? ' selected' : ''}>${esc(c)}</option>`
                    ).join('')}
                    <option value="__new__">+ New Category</option>
                  </select>
                </div>
              </div>
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
            <div class="modal-row">
              <div class="modal-field" style="flex:1">
                <span>Dependencies</span>
                <div class="dep-search-wrap">
                  <input type="text" class="dep-search-input" placeholder="Search tasks..." autocomplete="off">
                  <div class="dep-dropdown hidden"></div>
                  <input type="hidden" name="dependencies" value="${esc(Array.isArray(task.dependencies) ? task.dependencies.join(', ') : (task.dependencies || ''))}">
                  <div class="dep-selected"></div>
                </div>
              </div>
              <label class="modal-toggle-row modal-toggle-row--inline">
                <span>Trade quote</span>
                <input type="checkbox" name="tradeQuote" class="toggle-input"${task.tradeQuote ? ' checked' : ''}>
                <span class="toggle-track"><span class="toggle-thumb"></span></span>
              </label>
            </div>
          </div>
          <div class="modal-layout-side">
            <div class="modal-field">
              <span>Assigned</span>
              <div class="modal-members-wrap">
                <div class="modal-members-list"></div>
                <button type="button" class="modal-member-add" title="Add member">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                </button>
                <div class="modal-member-dropdown hidden"></div>
                <input type="hidden" name="assigned" value="${esc(taskAssigned.join(','))}">
              </div>
            </div>
          </div>
        </div>
        <div class="modal-actions">
          <div class="modal-actions-right">
            <button type="button" class="modal-btn modal-cancel">Cancel</button>
            <button type="submit" class="modal-btn modal-save">Save</button>
          </div>
        </div>
      </form>
    </div>
  `;

  modalEl.classList.add('open');
  const menuBtn = document.getElementById('mobile-menu-btn');
  if (menuBtn) menuBtn.style.display = 'none';

  // --- Dirty checking ---
  const form = modalEl.querySelector('form');
  const assignedHidden = modalEl.querySelector('input[name="assigned"]');

  function isDirty() {
    const fd = new FormData(form);
    if ((fd.get('room') || '') !== initial.room) return true;
    if ((fd.get('task') || '') !== initial.task) return true;
    if ((fd.get('category') || '') !== initial.category) return true;
    if ((fd.get('status') || '') !== initial.status) return true;
    if ((fd.get('startDate') || '') !== initial.startDate) return true;
    if ((fd.get('endDate') || '') !== initial.endDate) return true;
    if ((fd.get('dependencies') || '') !== initial.dependencies) return true;
    const currentAssigned = (assignedHidden.value || '').split(',').filter(Boolean).sort().join(',');
    if (currentAssigned !== initial.assigned) return true;
    if (form.querySelector('[name="tradeQuote"]').checked !== initial.tradeQuote) return true;
    return false;
  }

  const close = () => {
    _drp.closeDateRangePicker();
    modalEl.classList.remove('open');
    if (menuBtn) menuBtn.style.display = '';
    document.removeEventListener('keydown', onKey);
  };

  const tryClose = () => {
    if (isDirty()) {
      const dialog = modalEl.querySelector('.modal-dialog');
      if (dialog.querySelector('.modal-dirty-confirm')) return;
      const confirmEl = document.createElement('div');
      confirmEl.className = 'modal-delete-confirm modal-dirty-confirm';
      confirmEl.innerHTML = `
        <h1 class="modal-delete-title">Unsaved changes</h1>
        <p class="modal-delete-body">Close without saving?</p>
        <div class="modal-delete-actions">
          <button type="button" class="modal-btn modal-cancel">Keep editing</button>
          <button type="button" class="modal-btn modal-discard-btn">Discard</button>
        </div>
      `;
      dialog.appendChild(confirmEl);
      confirmEl.querySelector('.modal-cancel').addEventListener('click', () => confirmEl.remove());
      confirmEl.querySelector('.modal-discard-btn').addEventListener('click', () => close());
      return;
    }
    close();
  };

  // --- Room management ---
  const roomWrap = modalEl.querySelector('#room-field-wrap');
  const roomSelect = roomWrap.querySelector('select[name="room"]');

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

  function triggerRenameRoom() {
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
  }

  function showRoomInlineInput(prefill, onDone) {
    const existing = roomWrap.querySelector('.room-inline-input');
    if (existing) existing.remove();

    roomSelect.style.display = 'none';

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
      onDone(val ? val.trim() : '');
    };

    wrap.querySelector('.room-confirm-btn').addEventListener('click', () => finish(inp.value));
    wrap.querySelector('.room-cancel-btn').addEventListener('click', () => finish(''));
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); finish(inp.value); }
      if (e.key === 'Escape') finish('');
    });
  }

  // --- Inline category input (mirrors room pattern) ---
  const categoryWrap = modalEl.querySelector('#category-field-wrap');
  const categorySelect = categoryWrap.querySelector('select[name="category"]');

  categorySelect.addEventListener('change', () => {
    if (categorySelect.value === '__new__') {
      showCategoryInlineInput('', (newName) => {
        if (!newName) {
          categorySelect.value = task.category || options.categories[0] || '';
          return;
        }
        const opt = document.createElement('option');
        opt.value = newName;
        opt.textContent = newName;
        categorySelect.insertBefore(opt, categorySelect.querySelector('option[value="__new__"]'));
        categorySelect.value = newName;
      });
    }
  });

  function showCategoryInlineInput(prefill, onDone) {
    const existing = categoryWrap.querySelector('.category-inline-input');
    if (existing) existing.remove();

    categorySelect.style.display = 'none';

    const wrap = document.createElement('div');
    wrap.className = 'room-inline-input category-inline-input';
    wrap.innerHTML = `
      <input type="text" value="${esc(prefill)}" placeholder="Category name...">
      <button type="button" class="room-confirm-btn" title="Confirm">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m4.5 12.75 6 6 9-13.5"/></svg>
      </button>
      <button type="button" class="room-cancel-btn" title="Cancel">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 18 18 6M6 6l12 12"/></svg>
      </button>
    `;
    categoryWrap.appendChild(wrap);

    const inp = wrap.querySelector('input');
    inp.focus();
    inp.select();

    const finish = (val) => {
      wrap.remove();
      categorySelect.style.display = '';
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
  const depRaw = Array.isArray(task.dependencies) ? task.dependencies.join(', ') : (task.dependencies || '');
  let selectedDeps = depRaw ? depRaw.split(',').map(s => s.trim()).filter(Boolean) : [];

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

  // Multi-member picker
  const membersList = modalEl.querySelector('.modal-members-list');
  const memberAddBtn = modalEl.querySelector('.modal-member-add');
  const memberDropdown = modalEl.querySelector('.modal-member-dropdown');
  let selectedMembers = [...taskAssigned];

  function syncMembersHidden() {
    assignedHidden.value = selectedMembers.join(',');
  }

  function renderMemberAvatars() {
    membersList.innerHTML = '';
    selectedMembers.forEach(name => {
      const { bg, text } = getAssignedColor(name);
      const av = document.createElement('button');
      av.type = 'button';
      av.className = 'modal-member-avatar';
      av.style.background = bg;
      av.style.color = text;
      av.title = `Remove ${name}`;
      av.textContent = getInitials(name);
      av.addEventListener('click', () => {
        selectedMembers = selectedMembers.filter(n => n !== name);
        syncMembersHidden();
        renderMemberAvatars();
      });
      membersList.appendChild(av);
    });
  }

  function showMemberDropdown() {
    const available = (options.assignees || []).filter(a => !selectedMembers.includes(a));
    const canInvite = isLoggedIn() && !isSandbox() && typeof options.getActiveProjectId === 'function';

    if (available.length === 0 && !canInvite) {
      memberDropdown.classList.add('hidden');
      return;
    }

    let html = available.map(a => {
      const { bg, text } = getAssignedColor(a);
      return `<button type="button" class="modal-member-option" data-name="${esc(a)}">
        <span class="modal-member-option-avatar" style="background:${bg};color:${text}">${getInitials(a)}</span>
        <span>${esc(a)}</span>
      </button>`;
    }).join('');

    if (canInvite) {
      if (available.length > 0) html += '<div class="modal-member-divider"></div>';
      html += `<div class="modal-member-invite">
        <button type="button" class="modal-member-option modal-member-invite-trigger">
          <span class="modal-member-invite-icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
          </span>
          <span>Invite by email</span>
        </button>
        <form class="modal-member-invite-form hidden">
          <input type="email" class="modal-member-invite-input" placeholder="name@example.com" required>
          <button type="submit" class="modal-member-invite-send" title="Send invite">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
          </button>
        </form>
        <div class="modal-member-invite-msg hidden"></div>
      </div>`;
    }

    memberDropdown.innerHTML = html;
    memberDropdown.classList.remove('hidden');

    // Existing member options
    memberDropdown.querySelectorAll('.modal-member-option:not(.modal-member-invite-trigger)').forEach(opt => {
      opt.addEventListener('click', (e) => {
        e.stopPropagation();
        selectedMembers.push(opt.dataset.name);
        syncMembersHidden();
        renderMemberAvatars();
        memberDropdown.classList.add('hidden');
      });
    });

    // Invite flow
    if (canInvite) {
      const trigger = memberDropdown.querySelector('.modal-member-invite-trigger');
      const form = memberDropdown.querySelector('.modal-member-invite-form');
      const input = memberDropdown.querySelector('.modal-member-invite-input');
      const msg = memberDropdown.querySelector('.modal-member-invite-msg');

      trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        trigger.classList.add('hidden');
        form.classList.remove('hidden');
        input.focus();
      });

      input.addEventListener('click', (e) => e.stopPropagation());

      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const email = input.value.trim();
        if (!email) return;
        const sendBtn = form.querySelector('.modal-member-invite-send');
        sendBtn.disabled = true;
        msg.classList.add('hidden');
        try {
          const projectId = options.getActiveProjectId();
          await apiCall(`/projects/${projectId}/members`, {
            method: 'POST',
            body: JSON.stringify({ email, role: 'member' }),
          });
          msg.textContent = `Invite sent to ${email}`;
          msg.className = 'modal-member-invite-msg modal-member-invite-msg--ok';
          msg.classList.remove('hidden');
          input.value = '';
          // Add the email as an assignable name and auto-assign
          const name = email.split('@')[0];
          if (!selectedMembers.includes(name) && !selectedMembers.includes(email)) {
            selectedMembers.push(email);
            syncMembersHidden();
            renderMemberAvatars();
          }
          setTimeout(() => memberDropdown.classList.add('hidden'), 1200);
        } catch (err) {
          msg.textContent = err.message;
          msg.className = 'modal-member-invite-msg modal-member-invite-msg--err';
          msg.classList.remove('hidden');
        }
        sendBtn.disabled = false;
      });
    }
  }

  memberAddBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = !memberDropdown.classList.contains('hidden');
    if (isOpen) {
      memberDropdown.classList.add('hidden');
    } else {
      showMemberDropdown();
    }
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.modal-members-wrap')) memberDropdown.classList.add('hidden');
  });

  renderMemberAvatars();
  syncMembersHidden();

  // Date picker wiring — opens Airbnb-style range picker
  const startBtn = modalEl.querySelector('.date-display[data-for="startDate"]');
  const endBtn = modalEl.querySelector('.date-display[data-for="endDate"]');
  const startNative = modalEl.querySelector('input[name="startDate"]');
  const endNative = modalEl.querySelector('input[name="endDate"]');

  function updateDateBtn(btn, native, d, field) {
    if (d) {
      native.value = fmtDate(d);
      btn.textContent = displayDate(d);
      btn.classList.remove('empty');
      native.setAttribute('aria-label', ariaDate(field, d));
    } else {
      native.value = '';
      btn.textContent = 'Set date';
      btn.classList.add('empty');
      native.setAttribute('aria-label', field);
    }
  }

  function openRangePickerFrom(anchor) {
    const curStart = startNative.value ? new Date(startNative.value + 'T00:00:00') : null;
    const curEnd = endNative.value ? new Date(endNative.value + 'T00:00:00') : null;
    _drp.openDateRangePicker({
      anchor,
      startDate: curStart,
      endDate: curEnd,
      onSave({ start, end }) {
        updateDateBtn(startBtn, startNative, start, 'Start Date');
        updateDateBtn(endBtn, endNative, end, 'End Date');
      },
      onCancel() {},
    });
  }

  if (startBtn) {
    startBtn.addEventListener('click', (e) => {
      e.preventDefault();
      openRangePickerFrom(startBtn);
    });
  }
  if (endBtn) {
    endBtn.addEventListener('click', (e) => {
      e.preventDefault();
      openRangePickerFrom(endBtn);
    });
  }

  // --- Three-dot menu ---
  const moreBtn = modalEl.querySelector('#modal-more-btn');
  const moreMenu = modalEl.querySelector('#modal-more-menu');

  if (moreBtn && moreMenu) {
    const closeMenu = () => {
      moreMenu.classList.add('hidden');
      moreBtn.setAttribute('aria-expanded', 'false');
    };

    moreBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = !moreMenu.classList.contains('hidden');
      isOpen ? closeMenu() : (moreMenu.classList.remove('hidden'), moreBtn.setAttribute('aria-expanded', 'true'));
    });

    document.addEventListener('click', (e) => {
      if (!e.target.closest('.modal-more-wrap')) closeMenu();
    });

    modalEl.querySelector('#menu-rename-btn').addEventListener('click', () => {
      closeMenu();
      triggerRenameRoom();
    });

    const menuDupBtn = modalEl.querySelector('#menu-duplicate-btn');
    if (actions.onDuplicate) {
      menuDupBtn.addEventListener('click', () => {
        closeMenu();
        close();
        actions.onDuplicate(task);
      });
    }

    const menuDelBtn = modalEl.querySelector('#menu-delete-btn');
    if (actions.onDelete) {
      menuDelBtn.addEventListener('click', () => {
        closeMenu();
        const dialog = modalEl.querySelector('.modal-dialog');
        const confirmEl = document.createElement('div');
        confirmEl.className = 'modal-delete-confirm';
        confirmEl.innerHTML = `
          <h1 class="modal-delete-title">Are you sure?</h1>
          <p class="modal-delete-body">Deleting the task will place it into the trash, but you can restore it up to 30 days before it is deleted permanently.</p>
          <div class="modal-delete-actions">
            <button type="button" class="modal-btn modal-cancel modal-delete-cancel">Cancel</button>
            <button type="button" class="modal-btn modal-delete-confirm-btn">Yes, delete</button>
          </div>
        `;
        dialog.appendChild(confirmEl);
        confirmEl.querySelector('.modal-delete-cancel').addEventListener('click', () => confirmEl.remove());
        confirmEl.querySelector('.modal-delete-confirm-btn').addEventListener('click', () => {
          close();
          actions.onDelete(task);
        });
      });
    }
  }

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
    updatedFields.assigned = assignedHidden.value || '';
    updatedFields.tradeQuote = form.querySelector('[name="tradeQuote"]').checked;
    close();
    onSave({ originalTask: task.task, updatedFields });
  });

  // Focus first input
  setTimeout(() => modalEl.querySelector('input[name="task"]').focus(), 50);
}
