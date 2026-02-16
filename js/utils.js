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
  const ariaOpts = { day: 'numeric', month: 'long' };
  if (!start && !end) return { text: 'TBD', aria: 'To be decided' };
  const fmt = (d) => d.toLocaleDateString('en-AU', opts);
  const afmt = (d) => d.toLocaleDateString('en-AU', ariaOpts);
  if (start && end) return { text: `${fmt(start)} \u2013 ${fmt(end)}`, aria: `${afmt(start)} to ${afmt(end)}` };
  if (start) return { text: `From ${fmt(start)}`, aria: `From ${afmt(start)}` };
  return { text: `Until ${fmt(end)}`, aria: `Until ${afmt(end)}` };
}
