// Date Range Picker — Airbnb-style calendar popover
// Reusable component: openDateRangePicker({ anchor, startDate, endDate, onSave, onCancel })

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

let activePickerEl = null;
let activeCleanup = null;

function sameDay(a, b) {
  if (!a || !b) return false;
  return a.getFullYear() === b.getFullYear() &&
         a.getMonth() === b.getMonth() &&
         a.getDate() === b.getDate();
}

function dayOnly(d) {
  if (!d) return null;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function toISO(d) {
  if (!d) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function fmtDisplay(d) {
  if (!d) return '';
  const day = d.getDate();
  const mon = d.toLocaleString('en-AU', { month: 'short' });
  const yr = String(d.getFullYear()).slice(-2);
  return `${day} ${mon} ${yr}`;
}

function buildMonthGrid(year, month) {
  // month is 0-indexed
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  // Monday = 0, Sunday = 6
  let startDow = (firstDay.getDay() + 6) % 7;
  const daysInMonth = lastDay.getDate();

  const cells = [];

  // Fill leading days from previous month
  const prevMonth = new Date(year, month, 0);
  const prevDays = prevMonth.getDate();
  for (let i = startDow - 1; i >= 0; i--) {
    cells.push({ day: prevDays - i, month: month - 1, year, outside: true });
  }

  // Current month
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ day: d, month, year, outside: false });
  }

  // Fill trailing days
  const remaining = 7 - (cells.length % 7);
  if (remaining < 7) {
    for (let d = 1; d <= remaining; d++) {
      cells.push({ day: d, month: month + 1, year, outside: true });
    }
  }

  return cells;
}

function cellToDate(cell) {
  return new Date(cell.year, cell.month, cell.day);
}

export function closeDateRangePicker() {
  if (activePickerEl) {
    activePickerEl.remove();
    activePickerEl = null;
  }
  if (activeCleanup) {
    activeCleanup();
    activeCleanup = null;
  }
}

export function openDateRangePicker({ anchor, startDate, endDate, onSave, onCancel }) {
  // Close any existing picker
  closeDateRangePicker();

  let selStart = startDate ? dayOnly(startDate) : null;
  let selEnd = endDate ? dayOnly(endDate) : null;
  let hoverDate = null;
  let pickingEnd = !!(selStart && !selEnd); // if start already set, pick end next

  // Display months: start from the month of the start date, or current month
  const baseDate = selStart || new Date();
  let leftMonth = baseDate.getMonth();
  let leftYear = baseDate.getFullYear();

  // Create the picker element
  const el = document.createElement('div');
  el.className = 'date-range-picker';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Date range picker');
  document.body.appendChild(el);
  activePickerEl = el;

  function rightMonth() {
    let m = leftMonth + 1;
    let y = leftYear;
    if (m > 11) { m = 0; y++; }
    return { month: m, year: y };
  }

  function prevMonthNav() {
    leftMonth--;
    if (leftMonth < 0) { leftMonth = 11; leftYear--; }
    renderPicker();
  }

  function nextMonthNav() {
    leftMonth++;
    if (leftMonth > 11) { leftMonth = 0; leftYear++; }
    renderPicker();
  }

  function handleDayClick(date) {
    if (!selStart || pickingEnd === false) {
      // Picking start
      selStart = date;
      selEnd = null;
      pickingEnd = true;
    } else {
      // Picking end
      if (date < selStart) {
        // Clicked before start — swap
        selEnd = selStart;
        selStart = date;
      } else {
        selEnd = date;
      }
      pickingEnd = false;
    }
    hoverDate = null;
    renderPicker();
  }

  function handleDayHover(date) {
    if (pickingEnd && selStart) {
      hoverDate = date;
      renderPicker();
    }
  }

  function getEffectiveEnd() {
    if (selEnd) return selEnd;
    if (pickingEnd && hoverDate && selStart) {
      return hoverDate < selStart ? null : hoverDate;
    }
    return null;
  }

  function getEffectiveStart() {
    if (pickingEnd && hoverDate && selStart && hoverDate < selStart) {
      return hoverDate;
    }
    return selStart;
  }

  function renderMonth(year, month) {
    const cells = buildMonthGrid(year, month);
    const today = dayOnly(new Date());
    const effStart = getEffectiveStart();
    const effEnd = getEffectiveEnd();

    let html = '<div class="drp-grid">';
    // Day name headers
    DAY_NAMES.forEach(n => {
      html += `<div class="drp-day-name">${n}</div>`;
    });

    cells.forEach(cell => {
      const d = cellToDate(cell);
      const classes = ['drp-day'];
      if (cell.outside) classes.push('drp-day--outside');
      if (!cell.outside && sameDay(d, today)) classes.push('drp-day--today');
      if (!cell.outside && effStart && sameDay(d, effStart)) classes.push('drp-day--selected', 'drp-day--start');
      if (!cell.outside && effEnd && sameDay(d, effEnd)) classes.push('drp-day--selected', 'drp-day--end');
      if (!cell.outside && effStart && effEnd && d > effStart && d < effEnd) classes.push('drp-day--in-range');

      html += `<button type="button" class="${classes.join(' ')}" data-date="${toISO(d)}">${cell.day}</button>`;
    });

    html += '</div>';
    return html;
  }

  function renderPicker() {
    const rm = rightMonth();
    const leftLabel = `${MONTH_NAMES[leftMonth]} ${leftYear}`;
    const rightLabel = `${MONTH_NAMES[rm.month]} ${rm.year}`;

    el.innerHTML = `
      <div class="drp-header">
        <button type="button" class="drp-nav drp-prev" aria-label="Previous month">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
        </button>
        <span class="drp-month-label">${leftLabel}</span>
        <span class="drp-month-sep">&mdash;</span>
        <span class="drp-month-label">${rightLabel}</span>
        <button type="button" class="drp-nav drp-next" aria-label="Next month">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>
        </button>
      </div>
      <div class="drp-months">
        <div class="drp-month">${renderMonth(leftYear, leftMonth)}</div>
        <div class="drp-month">${renderMonth(rm.year, rm.month)}</div>
      </div>
      <div class="drp-selection-bar">
        <span class="drp-sel-label">
          <span class="drp-sel-part ${selStart ? 'drp-sel-active' : ''}">
            ${selStart ? fmtDisplay(selStart) : 'Start date'}
          </span>
          <span class="drp-sel-arrow">&rarr;</span>
          <span class="drp-sel-part ${selEnd ? 'drp-sel-active' : ''}">
            ${selEnd ? fmtDisplay(selEnd) : 'End date'}
          </span>
        </span>
      </div>
      <div class="drp-actions">
        <button type="button" class="drp-btn drp-clear">Clear</button>
        <div class="drp-actions-right">
          <button type="button" class="drp-btn drp-cancel">Cancel</button>
          <button type="button" class="drp-btn drp-save">Apply</button>
        </div>
      </div>
    `;

    // Event handlers
    el.querySelector('.drp-prev').addEventListener('click', prevMonthNav);
    el.querySelector('.drp-next').addEventListener('click', nextMonthNav);

    el.querySelectorAll('.drp-day:not(.drp-day-name)').forEach(btn => {
      if (!btn.dataset.date) return;
      btn.addEventListener('click', () => {
        handleDayClick(new Date(btn.dataset.date + 'T00:00:00'));
      });
      btn.addEventListener('pointerenter', (e) => {
        if (e.pointerType === 'touch') return;
        handleDayHover(new Date(btn.dataset.date + 'T00:00:00'));
      });
    });

    el.querySelector('.drp-clear').addEventListener('click', (e) => {
      e.stopPropagation();
      selStart = null;
      selEnd = null;
      pickingEnd = false;
      hoverDate = null;
      renderPicker();
    });

    el.querySelector('.drp-cancel').addEventListener('click', () => {
      closeDateRangePicker();
      if (onCancel) onCancel();
    });

    el.querySelector('.drp-save').addEventListener('click', () => {
      const result = { start: selStart || null, end: selEnd || null };
      closeDateRangePicker();
      if (onSave) onSave(result);
    });
  }

  // Position the picker
  function positionPicker() {
    const rect = anchor.getBoundingClientRect();
    const pickerH = 440; // approximate height
    const pickerW = el.offsetWidth || 580;
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;

    // Mobile: full-width bottom sheet
    if (window.innerWidth <= 768) {
      el.classList.add('drp-mobile');
      el.style.top = '';
      el.style.left = '';
      el.style.right = '';
      return;
    }

    el.classList.remove('drp-mobile');

    // Desktop: position below or above anchor
    let top, left;
    if (spaceBelow >= pickerH || spaceBelow >= spaceAbove) {
      top = rect.bottom + 8;
    } else {
      top = rect.top - pickerH - 8;
    }

    left = rect.left;
    // Clamp to viewport
    if (left + pickerW > window.innerWidth - 16) {
      left = window.innerWidth - pickerW - 16;
    }
    if (left < 16) left = 16;
    if (top < 8) top = 8;

    el.style.top = top + 'px';
    el.style.left = left + 'px';
  }

  renderPicker();
  positionPicker();

  // Close on Escape
  function onKeyDown(e) {
    if (e.key === 'Escape') {
      closeDateRangePicker();
      if (onCancel) onCancel();
    }
  }

  // Close on click outside
  function onClickOutside(e) {
    // After innerHTML re-render, the clicked element is orphaned from the DOM —
    // treat orphaned nodes as internal clicks (they were picker buttons)
    if (!document.body.contains(e.target)) return;
    if (!el.contains(e.target) && !anchor.contains(e.target)) {
      closeDateRangePicker();
      if (onCancel) onCancel();
    }
  }

  document.addEventListener('keydown', onKeyDown);
  // Delay adding click listener to avoid immediate close from the triggering click
  setTimeout(() => document.addEventListener('click', onClickOutside), 0);

  activeCleanup = () => {
    document.removeEventListener('keydown', onKeyDown);
    document.removeEventListener('click', onClickOutside);
  };
}
