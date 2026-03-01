export function buildFilterOptions(tasks) {
  const unique = (key) => [...new Set(tasks.map(t => t[key]).filter(Boolean))].sort();
  return {
    rooms: unique('room'),
    categories: unique('category'),
    assigned: unique('assigned'),
  };
}

export function populateDropdown(selectEl, options, label) {
  selectEl.innerHTML = `<option value="">All</option>` +
    options.map(o => `<option value="${o}">${o}</option>`).join('');
}

export function applyFilters(tasks, filters) {
  const q = filters.search ? filters.search.toLowerCase() : '';
  return tasks.filter(t => {
    if (filters.room && t.room !== filters.room) return false;
    if (filters.category && t.category !== filters.category) return false;
    if (filters.assigned && t.assigned !== filters.assigned) return false;
    if (q && !t.task.toLowerCase().includes(q)) return false;
    return true;
  });
}
