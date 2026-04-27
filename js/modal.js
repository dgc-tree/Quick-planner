import { esc, getInitials, getAssignedColor } from './utils.js';
import { isLoggedIn, isSandbox, apiCall } from './auth.js';

let _drp = { openDateRangePicker() {}, closeDateRangePicker() {} };
import('./date-range-picker.js').then(m => { _drp = m; }).catch(err => console.warn('date-range-picker unavailable:', err));

const STATUS_OPTIONS = ['To Do', 'In Progress', 'Blocked', 'Done'];

function displayDate(d) {
  if (!d) return 'Set date';
  const day = d.getDate();
  const mon = d.toLocaleString('en-AU', { month: 'short' });
  const thisYear = new Date().getFullYear();
  // Only show year if different from current year
  if (d.getFullYear() !== thisYear) {
    return `${day} ${mon} ${String(d.getFullYear()).slice(-2)}`;
  }
  return `${day} ${mon}`;
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
    notes: task.notes || '',
    cost: task.cost != null ? String(task.cost) : '',
    contact: task.contact || '',
  };

  modalEl.className = 'modal-overlay';
  modalEl.innerHTML = `
    <div class="modal-dialog" role="dialog" aria-label="${task.id !== null ? 'Edit task' : 'New task'}">
      <div class="modal-header">
        <div class="modal-field modal-field--task-header">
          <span>Task</span>
          <input type="text" name="task" form="modal-task-form" value="${esc(task.task)}">
        </div>
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
            <button type="button" class="modal-more-item" id="menu-archive-btn" role="menuitem">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v11a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8"/><path d="M10 13h4"/></svg>
              Archive
            </button>
            <button type="button" class="modal-more-item danger" id="menu-delete-btn" role="menuitem">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg>
              Delete
            </button>
          </div>
        </div>
        ` : ''}
      </div>
      <form class="modal-form" id="modal-task-form" autocomplete="off">
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
              <div class="modal-field modal-field--dates">
                <span>Dates</span>
                <button type="button" class="modal-date-range-btn${task.startDate || task.endDate ? '' : ' empty'}">${task.startDate || task.endDate ? `${displayDate(task.startDate)} – ${displayDate(task.endDate)}` : 'Set dates'}</button>
                <input type="hidden" name="startDate" value="${fmtDate(task.startDate)}">
                <input type="hidden" name="endDate" value="${fmtDate(task.endDate)}">
              </div>
              <div class="modal-field modal-field--deps">
                <span>Dependencies</span>
                <div class="dep-search-wrap">
                  <input type="text" class="dep-search-input" placeholder="Search tasks..." autocomplete="off">
                  <div class="dep-dropdown hidden"></div>
                  <input type="hidden" name="dependencies" value="${esc(Array.isArray(task.dependencies) ? task.dependencies.join(', ') : (task.dependencies || ''))}">
                  <div class="dep-selected"></div>
                </div>
              </div>
            </div>
            <div class="modal-row">
              <label class="modal-field modal-field--toggle">
                <span>Trade</span>
                <span class="modal-toggle-wrap">
                  <input type="checkbox" name="tradeQuote" class="toggle-input"${task.tradeQuote ? ' checked' : ''}>
                  <span class="toggle-track"><span class="toggle-thumb"></span></span>
                </span>
              </label>
              <div class="modal-field" style="flex:1">
                <span>Cost</span>
                <input type="text" name="cost" inputmode="decimal" placeholder="$0.00" value="${task.cost != null ? task.cost : ''}">
              </div>
              <div class="modal-field modal-field--contact" style="flex:2">
                <span>Contact</span>
                <input type="text" name="contact" placeholder="Name, phone or email" value="${esc(task.contact || '')}">
              </div>
            </div>
            <div class="modal-field">
              <span>Notes</span>
              <textarea name="notes" rows="3" placeholder="Details, specifications, payment terms...">${esc(task.notes || '')}</textarea>
            </div>
          </div>
          <div class="modal-layout-side">
            <div class="modal-field">
              <span>Assigned</span>
              <div class="modal-assigned-row">
                <div class="modal-members-wrap">
                  <div class="modal-members-grid"></div>
                  <input type="hidden" name="assigned" value="${esc(taskAssigned.join(','))}">
                </div>
                <button type="button" class="modal-invite-trigger hidden" title="Invite by email">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg>
                  Invite
                </button>
              </div>
            </div>
            <div class="modal-invite-overlay hidden">
              <div class="modal-invite-overlay-content">
                <div class="modal-invite-overlay-header">
                  <span>Invite by email</span>
                  <button type="button" class="modal-invite-overlay-close" title="Close">&times;</button>
                </div>
                <div class="modal-member-invite-form">
                  <input type="text" class="modal-member-invite-input" placeholder="Enter email address..." inputmode="email" autocomplete="off">
                  <button type="button" class="modal-member-invite-send" title="Send invite">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                  </button>
                </div>
                <div class="modal-member-invite-msg hidden"></div>
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
    if ((fd.get('notes') || '') !== initial.notes) return true;
    if ((fd.get('cost') || '') !== initial.cost) return true;
    if ((fd.get('contact') || '') !== initial.contact) return true;
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
  // Exclude archived tasks from dependency candidates — depending on a hidden
  // task is confusing; restore from Archive first if you really need it.
  const otherTasks = (options.allTasks || []).filter(t => t.task !== task.task && !t.archived);
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

  // Toggle-to-assign member grid
  const membersGrid = modalEl.querySelector('.modal-members-grid');
  // Deduplicate members case-insensitively (keep first occurrence's casing)
  let selectedMembers = [...new Map(taskAssigned.map(n => [n.toLowerCase(), n])).values()];
  const allRaw = [...selectedMembers, ...(options.assignees || [])];
  const allMembers = [...new Map(allRaw.map(n => [n.toLowerCase(), n])).values()].sort();

  function syncMembersHidden() {
    assignedHidden.value = selectedMembers.join(',');
  }

  function renderMemberGrid() {
    membersGrid.innerHTML = '';
    const active = allMembers.filter(n => selectedMembers.includes(n));
    const inactive = allMembers.filter(n => !selectedMembers.includes(n));
    const ordered = [...active, ...inactive];
    let dividerInserted = false;

    ordered.forEach(name => {
      const isActive = selectedMembers.includes(name);
      if (!isActive && !dividerInserted && active.length > 0) {
        const sep = document.createElement('span');
        sep.className = 'modal-members-divider';
        membersGrid.appendChild(sep);
        dividerInserted = true;
      }
      const { bg, text } = getAssignedColor(name);
      const av = document.createElement('button');
      av.type = 'button';
      av.className = 'modal-member-avatar' + (isActive ? '' : ' modal-member-avatar--inactive');
      av.style.background = isActive ? bg : '';
      av.style.color = isActive ? text : '';
      av.title = isActive ? `Remove ${name}` : `Assign ${name}`;
      av.textContent = getInitials(name);
      av.addEventListener('click', () => {
        if (isActive) {
          selectedMembers = selectedMembers.filter(n => n !== name);
        } else {
          selectedMembers.push(name);
        }
        syncMembersHidden();
        renderMemberGrid();
      });
      membersGrid.appendChild(av);
    });
  }

  // Invite flow
  const inviteTrigger = modalEl.querySelector('.modal-invite-trigger');
  const inviteOverlay = modalEl.querySelector('.modal-invite-overlay');
  const canInvite = isLoggedIn() && !isSandbox() && typeof options.getActiveProjectId === 'function';

  if (canInvite) {
    inviteTrigger.classList.remove('hidden');
    // Wire trigger button → open overlay
    const inviteClose = inviteOverlay.querySelector('.modal-invite-overlay-close');
    inviteTrigger.addEventListener('click', () => { inviteOverlay.classList.remove('hidden'); });
    inviteClose.addEventListener('click', () => { inviteOverlay.classList.add('hidden'); });

    const inviteForm = inviteOverlay.querySelector('.modal-member-invite-form');
    const inviteInput = inviteOverlay.querySelector('.modal-member-invite-input');
    const inviteMsg = inviteOverlay.querySelector('.modal-member-invite-msg');

    const sendBtn = inviteForm.querySelector('.modal-member-invite-send');
    sendBtn.addEventListener('click', async () => {
      const email = inviteInput.value.trim();
      if (!email) return;
      sendBtn.disabled = true;
      inviteMsg.classList.add('hidden');
      try {
        const projectId = options.getActiveProjectId();
        await apiCall(`/projects/${projectId}/members`, {
          method: 'POST',
          body: JSON.stringify({ email, role: 'member' }),
        });
        inviteMsg.textContent = `Invite sent to ${email}`;
        inviteMsg.className = 'modal-member-invite-msg modal-member-invite-msg--ok';
        inviteMsg.classList.remove('hidden');
        inviteInput.value = '';
        const name = email.split('@')[0];
        if (!selectedMembers.includes(name) && !selectedMembers.includes(email)) {
          selectedMembers.push(email);
          syncMembersHidden();
          renderMemberGrid();
        }
      } catch (err) {
        inviteMsg.textContent = err.message;
        inviteMsg.className = 'modal-member-invite-msg modal-member-invite-msg--err';
        inviteMsg.classList.remove('hidden');
      }
      sendBtn.disabled = false;
    });
    inviteInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); sendBtn.click(); }
    });
  }

  renderMemberGrid();
  syncMembersHidden();

  // Date picker wiring — single button opens Airbnb-style range picker
  const dateRangeBtn = modalEl.querySelector('.modal-date-range-btn');
  const startNative = modalEl.querySelector('input[name="startDate"]');
  const endNative = modalEl.querySelector('input[name="endDate"]');

  function updateDateRangeBtn() {
    const s = startNative.value ? new Date(startNative.value + 'T00:00:00') : null;
    const e = endNative.value ? new Date(endNative.value + 'T00:00:00') : null;
    if (s || e) {
      dateRangeBtn.textContent = `${displayDate(s)} – ${displayDate(e)}`;
      dateRangeBtn.classList.remove('empty');
    } else {
      dateRangeBtn.textContent = 'Set dates';
      dateRangeBtn.classList.add('empty');
    }
  }

  if (dateRangeBtn) {
    dateRangeBtn.addEventListener('click', (e) => {
      e.preventDefault();
      const curStart = startNative.value ? new Date(startNative.value + 'T00:00:00') : null;
      const curEnd = endNative.value ? new Date(endNative.value + 'T00:00:00') : null;
      _drp.openDateRangePicker({
        anchor: dateRangeBtn,
        startDate: curStart,
        endDate: curEnd,
        onSave({ start, end }) {
          startNative.value = start ? fmtDate(start) : '';
          endNative.value = end ? fmtDate(end) : '';
          updateDateRangeBtn();
        },
        onCancel() {},
      });
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

    const menuArchiveBtn = modalEl.querySelector('#menu-archive-btn');
    if (actions.onArchive) {
      menuArchiveBtn.addEventListener('click', () => {
        closeMenu();
        close();
        actions.onArchive(task);
      });
    } else if (menuArchiveBtn) {
      menuArchiveBtn.style.display = 'none';
    }

    const menuDelBtn = modalEl.querySelector('#menu-delete-btn');
    if (actions.onDelete) {
      menuDelBtn.addEventListener('click', () => {
        closeMenu();
        close();
        actions.onDelete(task);
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
    const fieldNames = ['task', 'room', 'category', 'status', 'startDate', 'endDate', 'dependencies', 'notes', 'cost', 'contact'];
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
