import { CATEGORY_COLORS, ASSIGNED_COLORS } from './theme.js';

export function esc(str) {
  const d = document.createElement('div');
  d.textContent = str || '';
  return d.innerHTML;
}

export function getInitials(name) {
  return name ? name.slice(0, 2).toUpperCase() : '?';
}

export function getAssignedColor(name) {
  const raw = ASSIGNED_COLORS[name] || '#222222';
  return {
    bg: typeof raw === 'object' ? raw.bg : raw,
    text: typeof raw === 'object' ? raw.text : '#fff',
  };
}

export function getCategoryColor(category) {
  return CATEGORY_COLORS[category] || { bg: '#E2E8F0', text: '#4A5568' };
}

export function formatDateRange(start, end) {
  const opts = { day: 'numeric', month: 'short' };
  if (!start && !end) return 'TBD';
  if (start && end) return `${start.toLocaleDateString('en-AU', opts)} \u2013 ${end.toLocaleDateString('en-AU', opts)}`;
  if (start) return `From ${start.toLocaleDateString('en-AU', opts)}`;
  return `Until ${end.toLocaleDateString('en-AU', opts)}`;
}
