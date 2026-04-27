// Context menu for task cards — right-click (desktop) / long-press (mobile)

let menuEl = null;

const ICONS = {
  edit: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11.5 2.5a1.77 1.77 0 0 1 2.5 2.5L5.25 13.75 2 14.5l.75-3.25Z"/><path d="M10 4l2.5 2.5"/></svg>`,
  duplicate: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="5" width="9" height="9" rx="1.5"/><path d="M2 11V3.5A1.5 1.5 0 0 1 3.5 2H11"/></svg>`,
  archive: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="12" height="3" rx="0.75"/><path d="M3 6.5v6A1.5 1.5 0 0 0 4.5 14h7a1.5 1.5 0 0 0 1.5-1.5v-6"/><path d="M6.5 9h3"/></svg>`,
  delete: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 4.5h11"/><path d="M5.5 4.5V3a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1.5"/><path d="M3.5 4.5l.75 9a1.5 1.5 0 0 0 1.5 1.5h4.5a1.5 1.5 0 0 0 1.5-1.5l.75-9"/></svg>`,
};

const ITEMS = [
  { key: 'edit', label: 'Edit', icon: ICONS.edit },
  { key: 'duplicate', label: 'Duplicate', icon: ICONS.duplicate },
  { key: 'archive', label: 'Archive', icon: ICONS.archive },
  { key: 'delete', label: 'Delete', icon: ICONS.delete, destructive: true },
];

export function showContextMenu(event, task, callbacks) {
  hideContextMenu();

  const menu = document.createElement('div');
  menu.className = 'context-menu';

  for (const item of ITEMS) {
    const btn = document.createElement('button');
    btn.className = 'context-menu-item' + (item.destructive ? ' context-menu-item--destructive' : '');
    btn.innerHTML = `${item.icon}<span>${item.label}</span>`;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      hideContextMenu();
      if (item.key === 'edit') callbacks.onEdit?.();
      else if (item.key === 'delete') callbacks.onDelete?.();
      else if (item.key === 'duplicate') callbacks.onDuplicate?.();
      else if (item.key === 'archive') callbacks.onArchive?.();
    });
    menu.appendChild(btn);
  }

  document.body.appendChild(menu);
  menuEl = menu;

  // Position near pointer, clamped within viewport
  requestAnimationFrame(() => {
    const mw = menu.offsetWidth;
    const mh = menu.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let x = event.clientX;
    let y = event.clientY;
    if (x + mw > vw - 8) x = vw - mw - 8;
    if (x < 8) x = 8;
    if (y + mh > vh - 8) y = vh - mh - 8;
    if (y < 8) y = 8;
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
    menu.classList.add('context-menu--visible');
  });

  // Dismiss listeners
  document.addEventListener('click', _onOutsideClick, { capture: true, once: true });
  document.addEventListener('keydown', _onEscape);
  window.addEventListener('scroll', hideContextMenu, { capture: true, once: true });
}

export function hideContextMenu() {
  if (!menuEl) return;
  menuEl.remove();
  menuEl = null;
  document.removeEventListener('click', _onOutsideClick, { capture: true });
  document.removeEventListener('keydown', _onEscape);
  window.removeEventListener('scroll', hideContextMenu, { capture: true });
}

function _onOutsideClick(e) {
  if (menuEl && !menuEl.contains(e.target)) {
    hideContextMenu();
  }
}

function _onEscape(e) {
  if (e.key === 'Escape') hideContextMenu();
}

// ── Long-press helper ──
// Attach to a container using event delegation.
// selector: CSS selector for the interactive elements (cards/bars/rows)
// taskLookup: (el) => task object
// onContextMenu: (syntheticEvent, task) => void

export function attachLongPress(container, selector, taskLookup, onContextMenu) {
  let timer = null;
  let startX = 0;
  let startY = 0;
  let activeEl = null;

  container.addEventListener('pointerdown', (e) => {
    const el = e.target.closest(selector);
    if (!el) return;
    const task = taskLookup(el);
    if (!task) return;

    startX = e.clientX;
    startY = e.clientY;
    activeEl = el;

    timer = setTimeout(() => {
      timer = null;
      navigator.vibrate?.(50);
      const syntheticEvent = { clientX: startX, clientY: startY };
      onContextMenu(syntheticEvent, task);
    }, 500);
  });

  container.addEventListener('pointermove', (e) => {
    if (!timer) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (Math.sqrt(dx * dx + dy * dy) > 10) {
      clearTimeout(timer);
      timer = null;
    }
  });

  const cancel = () => {
    if (timer) { clearTimeout(timer); timer = null; }
  };
  container.addEventListener('pointerup', cancel);
  container.addEventListener('pointerleave', cancel);
  container.addEventListener('pointercancel', cancel);
}
