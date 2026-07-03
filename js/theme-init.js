// Runs before first paint to prevent FOUC - must remain a plain script (not a module).
(function () {
  const saved = localStorage.getItem('qp-theme');
  if (saved === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
  const surface = localStorage.getItem('qp-surface');
  if (surface) document.documentElement.setAttribute('data-surface', surface);
  const v = localStorage.getItem('qp-view') || 'kanban';
  const btn = document.querySelector('.view-btn[data-view="' + v + '"]');
  if (btn) btn.classList.add('active');
})();
