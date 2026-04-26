export function buildFilterOptions(tasks) {
  const live = tasks.filter(t => !t.archived);
  const unique = (key) => [...new Set(live.map(t => t[key]).filter(Boolean))].sort();
  return {
    rooms: unique('room'),
    categories: unique('category'),
    assigned: [...new Set(live.flatMap(t => Array.isArray(t.assigned) ? t.assigned : [t.assigned]).filter(Boolean))].sort(),
  };
}

export function populateDropdown(selectEl, options, label) {
  selectEl.innerHTML = `<option value="">All</option>` +
    options.map(o => `<option value="${o}">${o}</option>`).join('');
}

export function applyFilters(tasks, filters) {
  const q = filters.search ? filters.search.toLowerCase() : '';
  return tasks.filter(t => {
    if (t.archived) return false;
    if (filters.room && t.room !== filters.room) return false;
    if (filters.category && t.category !== filters.category) return false;
    if (filters.assigned) {
      const arr = Array.isArray(t.assigned) ? t.assigned : (t.assigned ? [t.assigned] : []);
      if (!arr.includes(filters.assigned)) return false;
    }
    if (q) {
      const assignedStr = (Array.isArray(t.assigned) ? t.assigned : [t.assigned]).filter(Boolean).join(' ').toLowerCase();
      if (!t.task.toLowerCase().includes(q) && !t.category.toLowerCase().includes(q) && !t.room.toLowerCase().includes(q) && !assignedStr.includes(q)) return false;
    }
    // Date overlap filter — unscheduled tasks always pass
    if (filters.dateFrom || filters.dateTo) {
      const dateFrom = filters.dateFrom ? new Date(filters.dateFrom + 'T00:00:00') : null;
      const dateTo = filters.dateTo ? new Date(filters.dateTo + 'T00:00:00') : null;
      const tStart = t.startDate || null;
      const tEnd = t.endDate || null;
      if (tStart || tEnd) {
        if (dateFrom && dateTo) {
          if ((tEnd || tStart) < dateFrom || (tStart || tEnd) > dateTo) return false;
        } else if (dateFrom) {
          if ((tEnd || tStart) < dateFrom) return false;
        } else if (dateTo) {
          if ((tStart || tEnd) > dateTo) return false;
        }
      }
    }
    return true;
  });
}
