export const CATEGORY_COLORS = {
  'Cleaning':      { bg: 'var(--category-cleaning-bg)',      text: 'var(--category-cleaning-text)' },
  'Packing':       { bg: 'var(--category-packing-bg)',       text: 'var(--category-packing-text)' },
  'Organising':    { bg: 'var(--category-organising-bg)',    text: 'var(--category-organising-text)' },
  'Painting':      { bg: 'var(--category-painting-bg)',      text: 'var(--category-painting-text)' },
  'Basic repairs': { bg: 'var(--category-basic-repairs-bg)', text: 'var(--category-basic-repairs-text)' },
  'Trade Quote':      { bg: 'var(--category-trade-quote-bg)',      text: 'var(--category-trade-quote-text)' },
  'Major Projects':   { bg: 'var(--category-major-projects-bg)',  text: 'var(--category-major-projects-text)' },
  'Outside':          { bg: 'var(--category-outside-bg)',         text: 'var(--category-outside-text)' },
  'Selling':       { bg: 'var(--category-selling-bg)',       text: 'var(--category-selling-text)' },
  'In progress':   { bg: 'var(--category-in-progress-bg)',   text: 'var(--category-in-progress-text)' },
  'We have these': { bg: 'var(--category-we-have-these-bg)', text: 'var(--category-we-have-these-text)' },
};

// Avatar palette — distinct hues, WCAG AA safe text on each
// Owner uses their primary accent; others get assigned from this pool
const AVATAR_PALETTE = [
  { bg: '#6366F1', text: '#FFFFFF' }, // indigo
  { bg: '#EC4899', text: '#FFFFFF' }, // pink
  { bg: '#F59E0B', text: '#1A1A1A' }, // amber
  { bg: '#10B981', text: '#FFFFFF' }, // emerald
  { bg: '#8B5CF6', text: '#FFFFFF' }, // violet
  { bg: '#EF4444', text: '#FFFFFF' }, // red
  { bg: '#06B6D4', text: '#1A1A1A' }, // cyan
  { bg: '#84CC16', text: '#1A1A1A' }, // lime
  { bg: '#F97316', text: '#FFFFFF' }, // orange
  { bg: '#14B8A6', text: '#FFFFFF' }, // teal
];

// Persistent colour assignments stored in localStorage
const STORAGE_KEY = 'qp-avatar-colors';

function loadAvatarMap() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; } catch { return {}; }
}

function saveAvatarMap(map) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
}

/**
 * Get avatar colour for a user. Owner gets primary accent, others get
 * a stable colour from the palette (persisted across sessions).
 * @param {string} name - display name or initials
 * @param {object} [opts] - { isOwner: bool }
 * @returns {{ bg: string, text: string }}
 */
export function getAvatarColor(name, opts = {}) {
  if (opts.isOwner) {
    return { bg: 'var(--accent)', text: 'var(--on-accent-primary1)' };
  }

  const map = loadAvatarMap();

  // Already assigned?
  if (map[name]) return map[name];

  // Find first unused palette colour
  const usedBgs = new Set(Object.values(map).map(v => v.bg));
  const available = AVATAR_PALETTE.find(c => !usedBgs.has(c.bg));
  const colour = available || AVATAR_PALETTE[Object.keys(map).length % AVATAR_PALETTE.length];

  map[name] = { bg: colour.bg, text: colour.text };
  saveAvatarMap(map);
  return map[name];
}

/**
 * Set a custom avatar colour for a user (from settings).
 */
export function setAvatarColor(name, bg, text) {
  const map = loadAvatarMap();
  map[name] = { bg, text };
  saveAvatarMap(map);
}

// Legacy compat — kept for any remaining direct references
export const ASSIGNED_COLORS = new Proxy({}, {
  get(_, name) {
    return getAvatarColor(String(name));
  }
});

export const STATUS_COLORS = {
  'To Do':           { bg: 'var(--status-todo-bg)',        text: 'var(--status-todo-text)' },
  'In Progress':     { bg: 'var(--status-in-progress-bg)', text: 'var(--status-in-progress-text)' },
  'Blocked':         { bg: 'var(--status-blocked-bg)',      text: 'var(--status-blocked-text)' },
  'Done':            { bg: 'var(--status-done-bg)',         text: 'var(--status-done-text)' },
};
