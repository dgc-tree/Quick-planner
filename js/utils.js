import { CATEGORY_COLORS, getAvatarColor } from './theme.js';

export function esc(str) {
  const d = document.createElement('div');
  d.textContent = str || '';
  return d.innerHTML;
}

export function getInitials(name) {
  return name ? name.slice(0, 2).toUpperCase() : '?';
}

// Normalise an assignee list: split string-or-array input into an array,
// trim each name, drop empties, and dedupe case-insensitively. Preserves
// the first-seen casing of each unique name.
export function normaliseAssigned(assigned) {
  const arr = Array.isArray(assigned) ? assigned : (assigned ? [assigned] : []);
  const seen = new Set();
  const out = [];
  for (const raw of arr) {
    const name = (raw == null ? '' : String(raw)).trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

export function getAssignedColor(name) {
  return getAvatarColor(name);
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
