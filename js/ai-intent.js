/**
 * ai-intent.js — Local pattern matcher + fuzzy task resolver
 * Handles ~65% of user queries with zero API calls.
 */

// ─── Date parsing (lightweight, no dependency) ────────────────────────────────

const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTH_NAMES = ['january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december'];
const MONTH_SHORT = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const NUM_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

function today() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function nextDayOfWeek(dayIndex, fromDate) {
  const d = new Date(fromDate || today());
  const diff = (dayIndex - d.getDay() + 7) % 7 || 7;
  d.setDate(d.getDate() + diff);
  return d;
}

/**
 * Parse a natural-language date string into a Date.
 * Returns null if unrecognised.
 */
export function parseDate(str) {
  if (!str) return null;
  const s = str.toLowerCase().trim();

  if (s === 'today') return today();
  if (s === 'tomorrow') { const d = today(); d.setDate(d.getDate() + 1); return d; }
  if (s === 'yesterday') { const d = today(); d.setDate(d.getDate() - 1); return d; }

  // "next [day]"
  const nextDay = s.match(/^next\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/);
  if (nextDay) return nextDayOfWeek(DAY_NAMES.indexOf(nextDay[1]));

  // "this [day]"
  const thisDay = s.match(/^this\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/);
  if (thisDay) {
    const target = DAY_NAMES.indexOf(thisDay[1]);
    const d = today();
    const diff = (target - d.getDay() + 7) % 7;
    if (diff === 0) return d; // today is that day
    d.setDate(d.getDate() + diff);
    return d;
  }

  // "in [N] days/weeks"
  const inN = s.match(/^in\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(day|days|week|weeks)$/);
  if (inN) {
    const n = NUM_WORDS[inN[1]] || parseInt(inN[1]);
    const d = today();
    d.setDate(d.getDate() + n * (inN[2].startsWith('week') ? 7 : 1));
    return d;
  }

  // "[N] [day]s from now" / "two fridays from now"
  const nDaysFrom = s.match(/^(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)s?\s+from\s+now$/);
  if (nDaysFrom) {
    const n = NUM_WORDS[nDaysFrom[1]] || parseInt(nDaysFrom[1]);
    const dayIdx = DAY_NAMES.indexOf(nDaysFrom[2]);
    let d = nextDayOfWeek(dayIdx);
    // Already got first occurrence, add (n-1) more weeks
    d.setDate(d.getDate() + (n - 1) * 7);
    return d;
  }

  // "end of [month]"
  const endOf = s.match(/^end\s+of\s+(\w+)$/);
  if (endOf) {
    const mi = MONTH_NAMES.indexOf(endOf[1]) !== -1 ? MONTH_NAMES.indexOf(endOf[1]) : MONTH_SHORT.indexOf(endOf[1]);
    if (mi !== -1) {
      const year = mi >= today().getMonth() ? today().getFullYear() : today().getFullYear() + 1;
      return new Date(year, mi + 1, 0); // Last day of month
    }
  }

  // "next week" / "next month"
  if (s === 'next week') { const d = today(); d.setDate(d.getDate() + 7); return d; }
  if (s === 'next month') { const d = today(); d.setMonth(d.getMonth() + 1); return d; }

  // ISO date passthrough
  const iso = s.match(/^\d{4}-\d{2}-\d{2}$/);
  if (iso) return new Date(s + 'T00:00:00');

  // "March 21" / "21 March" / "Mar 21"
  const monthDay = s.match(/^(\w+)\s+(\d{1,2})(?:st|nd|rd|th)?$/);
  if (monthDay) {
    const mi = MONTH_NAMES.indexOf(monthDay[1]) !== -1 ? MONTH_NAMES.indexOf(monthDay[1]) : MONTH_SHORT.indexOf(monthDay[1]);
    if (mi !== -1) {
      const year = mi >= today().getMonth() ? today().getFullYear() : today().getFullYear() + 1;
      return new Date(year, mi, parseInt(monthDay[2]));
    }
  }
  const dayMonth = s.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+(\w+)$/);
  if (dayMonth) {
    const mi = MONTH_NAMES.indexOf(dayMonth[2]) !== -1 ? MONTH_NAMES.indexOf(dayMonth[2]) : MONTH_SHORT.indexOf(dayMonth[2]);
    if (mi !== -1) {
      const year = mi >= today().getMonth() ? today().getFullYear() : today().getFullYear() + 1;
      return new Date(year, mi, parseInt(dayMonth[1]));
    }
  }

  // "21st of March 2026" / "21st of March" / "30th of April 2026"
  const dayOfMonth = s.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+of\s+(\w+)(?:\s+(\d{4}))?$/);
  if (dayOfMonth) {
    const mi = MONTH_NAMES.indexOf(dayOfMonth[2]) !== -1 ? MONTH_NAMES.indexOf(dayOfMonth[2]) : MONTH_SHORT.indexOf(dayOfMonth[2]);
    if (mi !== -1) {
      const year = dayOfMonth[3] ? parseInt(dayOfMonth[3]) : (mi >= today().getMonth() ? today().getFullYear() : today().getFullYear() + 1);
      return new Date(year, mi, parseInt(dayOfMonth[1]));
    }
  }

  // "March 21st 2026" / "April 30th 2026"
  const monthDayYear = s.match(/^(\w+)\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s+(\d{4}))?$/);
  if (monthDayYear && !monthDay) {
    const mi = MONTH_NAMES.indexOf(monthDayYear[1]) !== -1 ? MONTH_NAMES.indexOf(monthDayYear[1]) : MONTH_SHORT.indexOf(monthDayYear[1]);
    if (mi !== -1) {
      const year = monthDayYear[3] ? parseInt(monthDayYear[3]) : (mi >= today().getMonth() ? today().getFullYear() : today().getFullYear() + 1);
      return new Date(year, mi, parseInt(monthDayYear[2]));
    }
  }

  return null;
}

function fmtDate(d) {
  if (!d) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function fmtDateHuman(d) {
  if (!d) return '';
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${days[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]}`;
}

// ─── Fuzzy task matching ──────────────────────────────────────────────────────

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

function wordOverlapScore(query, taskName) {
  const qWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  const tWords = taskName.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  if (!qWords.length) return 0;
  const hits = qWords.filter(w => tWords.some(tw => tw.includes(w) || w.includes(tw)));
  return hits.length / qWords.length;
}

function scoreTask(query, task) {
  const q = query.toLowerCase().trim();
  const name = (task.task || task.name || '').toLowerCase();

  // Exact
  if (name === q) return 1.0;
  // Substring
  if (name.includes(q) || q.includes(name)) return 0.95;
  // Word overlap
  const overlap = wordOverlapScore(q, name);
  if (overlap >= 0.6) return 0.5 + overlap * 0.35; // 0.71–0.85
  // Levenshtein
  const dist = levenshtein(q, name);
  const maxLen = Math.max(q.length, name.length);
  const lev = 1 - dist / maxLen;
  return lev >= 0.4 ? lev : 0;
}

/**
 * Find all matching tasks above threshold, sorted by confidence then nearest due date.
 * Returns array of { task, confidence }.
 */
export function findTasks(query, tasks) {
  if (!query || !tasks.length) return [];
  return tasks
    .map(t => ({ task: t, confidence: scoreTask(query, t) }))
    .filter(m => m.confidence >= 0.4)
    .sort((a, b) => {
      if (Math.abs(a.confidence - b.confidence) > 0.05) return b.confidence - a.confidence;
      // Tie-break by nearest due date (null last)
      const aDate = a.task.endDate ? new Date(a.task.endDate).getTime() : Infinity;
      const bDate = b.task.endDate ? new Date(b.task.endDate).getTime() : Infinity;
      return aDate - bDate;
    });
}

/**
 * Find the best matching task by name. Returns { task, confidence } or null.
 */
export function findTask(query, tasks) {
  const matches = findTasks(query, tasks);
  return matches.length ? matches[0] : null;
}

// ─── Field extraction (natural language → task fields) ───────────────────────

const FIELD_KEYWORDS = [
  { keys: ['room', 'in room'], field: 'room', parse: v => v.trim() },
  { keys: ['category', 'cat', 'label'], field: 'category', parse: v => v.trim() },
  { keys: ['status'], field: 'status', parse: v => normaliseStatus(v) },
  { keys: ['assigned to', 'assign to', 'assign', 'assigned', 'assignee'], field: 'assigned', parse: v => v.split(/,\s*|\s+and\s+/).map(s => s.trim()).filter(Boolean) },
  { keys: ['start date', 'start', 'starting', 'begins'], field: 'startDate', parse: v => fmtDate(parseDate(v)) },
  { keys: ['end date', 'due date', 'due', 'end', 'finish', 'deadline', 'by'], field: 'endDate', parse: v => fmtDate(parseDate(v)) },
  { keys: ['cost', 'budget', 'price'], field: 'cost', parse: v => { const n = parseFloat(v.replace(/[$,]/g, '')); return isNaN(n) ? null : n; } },
  { keys: ['contact'], field: 'contact', parse: v => v.trim() },
  { keys: ['notes', 'note'], field: 'notes', parse: v => v.trim() },
];

// Build a single regex that matches any field keyword
const _fieldKeywordPattern = new RegExp(
  '\\b(' + FIELD_KEYWORDS.flatMap(f => f.keys).sort((a, b) => b.length - a.length).map(k => k.replace(/\s+/g, '\\s+')).join('|') + ')\\s*[:=]?\\s*',
  'gi'
);

/**
 * Extract task name and structured fields from a natural-language string.
 * @param {string} text - Everything after the trigger verb (e.g. "buy tiles, room Kitchen, due June 15")
 * @returns {{ taskName: string, fields: object }}
 */
export function extractFields(text) {
  const fields = {};
  let remaining = text.trim();

  // Extract quoted task name first
  const quoted = remaining.match(/^["'](.+?)["']\s*,?\s*/);
  let taskName = '';
  if (quoted) {
    taskName = quoted[1];
    remaining = remaining.slice(quoted[0].length);
  }

  // Find all field keyword positions
  _fieldKeywordPattern.lastIndex = 0;
  const splits = [];
  let m;
  while ((m = _fieldKeywordPattern.exec(remaining)) !== null) {
    splits.push({ index: m.index, length: m[0].length, keyword: m[1].toLowerCase().replace(/\s+/g, ' ') });
  }

  if (splits.length === 0) {
    // No field keywords found — entire text is the task name
    if (!taskName) taskName = remaining.replace(/,\s*$/, '').trim();
    return { taskName: capitaliseName(taskName), fields };
  }

  // Text before the first keyword is the task name (if not already set from quotes)
  if (!taskName) {
    taskName = remaining.slice(0, splits[0].index).replace(/,\s*$/, '').trim();
  }

  // Extract each field value (text between this keyword and the next)
  for (let i = 0; i < splits.length; i++) {
    const valueStart = splits[i].index + splits[i].length;
    const valueEnd = i + 1 < splits.length ? splits[i + 1].index : remaining.length;
    const rawValue = remaining.slice(valueStart, valueEnd).replace(/,\s*$/, '').trim();
    if (!rawValue) continue;

    const kw = splits[i].keyword;
    const def = FIELD_KEYWORDS.find(f => f.keys.some(k => k === kw));
    if (def) {
      const parsed = def.parse(rawValue);
      if (parsed !== null && parsed !== undefined) fields[def.field] = parsed;
    }
  }

  return { taskName: capitaliseName(taskName), fields };
}

function capitaliseName(name) {
  if (!name) return '';
  return name.charAt(0).toUpperCase() + name.slice(1);
}

// ─── Bulk task filtering ──────────────────────────────────────────────────

/**
 * Filter tasks by a natural-language descriptor.
 * Returns { matched: Task[], label: string } or null if no filter understood.
 */
function filterTasks(filterStr, tasks) {
  const f = filterStr.toLowerCase().trim()
    .replace(/^all\s+/, '').replace(/\s+tasks?$/, '').trim();

  if (!f || f === 'everything' || f === 'all') {
    return { matched: tasks, label: 'all tasks' };
  }

  // By status
  const status = STATUS_MAP[f];
  if (status) {
    const matched = tasks.filter(t => t.status === status);
    return { matched, label: `${status.toLowerCase()} tasks` };
  }

  // By room (fuzzy)
  const byRoom = tasks.filter(t => (t.room || '').toLowerCase().includes(f));
  if (byRoom.length > 0) {
    return { matched: byRoom, label: `tasks in "${byRoom[0].room}"` };
  }

  // By category (fuzzy)
  const byCat = tasks.filter(t => (t.category || '').toLowerCase().includes(f));
  if (byCat.length > 0) {
    return { matched: byCat, label: `"${byCat[0].category}" tasks` };
  }

  // By assigned person (fuzzy)
  const byPerson = tasks.filter(t =>
    (t.assigned || []).some(a => a.toLowerCase().includes(f))
  );
  if (byPerson.length > 0) {
    return { matched: byPerson, label: `tasks assigned to "${f}"` };
  }

  // By task name keyword ("tasks with/mentioning/containing X")
  const keyword = f.replace(/^(?:with|mentioning|containing|about|named)\s+/, '').trim();
  if (keyword) {
    const byName = tasks.filter(t => (t.task || t.name || '').toLowerCase().includes(keyword));
    if (byName.length > 0) {
      return { matched: byName, label: `tasks matching "${keyword}"` };
    }
  }

  return null;
}

// ─── Status normalisation ─────────────────────────────────────────────────────

const STATUS_MAP = {
  'done': 'Done', 'complete': 'Done', 'completed': 'Done', 'finished': 'Done', 'finish': 'Done',
  'in progress': 'In Progress', 'started': 'In Progress', 'working': 'In Progress', 'start': 'In Progress',
  'not started': 'To Do', 'todo': 'To Do', 'to do': 'To Do', 'pending': 'To Do', 'new': 'To Do',
  'blocked': 'Blocked', 'stuck': 'Blocked', 'waiting': 'Blocked', 'on hold': 'Blocked',
};

function normaliseStatus(raw) {
  return STATUS_MAP[raw.toLowerCase().trim()] || null;
}

// ─── Intent patterns ──────────────────────────────────────────────────────────

/**
 * Try to resolve a user message locally.
 * Returns { type, action, data, response } or null if unresolved.
 *
 * @param {string} message - User's message
 * @param {object} context - { tasks, project, user, today }
 */
export function resolveIntent(message, context) {
  const msg = message.trim();
  const lower = msg.toLowerCase();
  const { tasks } = context;
  const todayDate = today();
  const todayStr = fmtDate(todayDate);

  // ─── Read queries ─────────────────────────────────────────────────

  // "what's due today"
  if (/^what(?:'s| is)\s+due\s+today\??$/i.test(msg)) {
    const due = tasks.filter(t => t.endDate && fmtDate(new Date(t.endDate)) === todayStr);
    if (due.length === 0) return { type: 'read', response: 'Nothing due today!' };
    const list = due.map(t => `- ${t.task || t.name}${t.status === 'Done' ? ' (done)' : ''}`).join('\n');
    return { type: 'read', response: `Due today:\n${list}` };
  }

  // "what's due this week"
  if (/^what(?:'s| is)\s+due\s+this\s+week\??$/i.test(msg)) {
    const endOfWeek = new Date(todayDate);
    endOfWeek.setDate(endOfWeek.getDate() + (7 - endOfWeek.getDay()));
    const due = tasks.filter(t => {
      if (!t.endDate) return false;
      const d = new Date(t.endDate);
      return d >= todayDate && d <= endOfWeek;
    });
    if (due.length === 0) return { type: 'read', response: 'Nothing due this week!' };
    const list = due.map(t => `- ${t.task || t.name} (${fmtDateHuman(new Date(t.endDate))})`).join('\n');
    return { type: 'read', response: `Due this week:\n${list}` };
  }

  // "what's overdue"
  if (/^what(?:'s| is)\s+overdue\??$/i.test(msg)) {
    const overdue = tasks.filter(t => {
      if (!t.endDate || t.status === 'Done') return false;
      return new Date(t.endDate) < todayDate;
    });
    if (overdue.length === 0) return { type: 'read', response: 'Nothing overdue!' };
    const list = overdue.map(t => `- ${t.task || t.name} (was due ${fmtDateHuman(new Date(t.endDate))})`).join('\n');
    return { type: 'read', response: `Overdue:\n${list}` };
  }

  // "how many tasks in/for [month]" — month-qualified count (must come before generic "how many tasks")
  {
    const howManyMonth = lower.match(/^how\s+many\s+\w+\s+(?:in|for|due\s+in|due\s+for)\s+(\w+)\s*\??$/);
    if (howManyMonth) {
      const mName = howManyMonth[1];
      const mi = MONTH_NAMES.indexOf(mName) !== -1 ? MONTH_NAMES.indexOf(mName) : MONTH_SHORT.indexOf(mName);
      if (mi !== -1) {
        const year = mi >= todayDate.getMonth() ? todayDate.getFullYear() : todayDate.getFullYear() + 1;
        const startOfMonth = new Date(year, mi, 1);
        const endOfMonth = new Date(year, mi + 1, 0);
        const due = tasks.filter(t => {
          if (!t.endDate) return false;
          const d = new Date(t.endDate);
          return d >= startOfMonth && d <= endOfMonth;
        });
        const label = MONTH_NAMES[mi].charAt(0).toUpperCase() + MONTH_NAMES[mi].slice(1);
        if (due.length === 0) return { type: 'read', response: `No tasks due in ${label} ${year}.` };
        const list = due.map(t => `- ${t.task || t.name} (${fmtDateHuman(new Date(t.endDate))}${t.status === 'Done' ? ', done' : ''})`).join('\n');
        return { type: 'read', response: `${due.length} task${due.length > 1 ? 's' : ''} in ${label}:\n${list}` };
      }
    }
  }

  // "how many tasks" (generic, no month qualifier)
  if (/^how\s+many\s+\w*\s*tasks?\w*\s*\??$/i.test(msg) || /^how\s+many\s+tasks/i.test(msg)) {
    const total = tasks.length;
    const done = tasks.filter(t => t.status === 'Done').length;
    const inProgress = tasks.filter(t => t.status === 'In Progress').length;
    const toDo = tasks.filter(t => t.status === 'To Do').length;
    const blocked = tasks.filter(t => t.status === 'Blocked').length;
    let response = `${total} tasks total`;
    const parts = [];
    if (done) parts.push(`${done} done`);
    if (inProgress) parts.push(`${inProgress} in progress`);
    if (toDo) parts.push(`${toDo} to do`);
    if (blocked) parts.push(`${blocked} blocked`);
    if (parts.length) response += ` — ${parts.join(', ')}`;
    return { type: 'read', response };
  }

  // "what's due this month"
  if (/^what(?:'s| is)\s+due\s+this\s+month\??$/i.test(msg)) {
    const startOfMonth = new Date(todayDate.getFullYear(), todayDate.getMonth(), 1);
    const endOfMonth = new Date(todayDate.getFullYear(), todayDate.getMonth() + 1, 0);
    const due = tasks.filter(t => {
      if (!t.endDate) return false;
      const d = new Date(t.endDate);
      return d >= startOfMonth && d <= endOfMonth;
    });
    const monthName = MONTH_NAMES[todayDate.getMonth()];
    if (due.length === 0) return { type: 'read', response: `Nothing due in ${monthName.charAt(0).toUpperCase() + monthName.slice(1)}.` };
    const list = due.map(t => `- ${t.task || t.name} (${fmtDateHuman(new Date(t.endDate))}${t.status === 'Done' ? ', done' : ''})`).join('\n');
    return { type: 'read', response: `Due in ${monthName.charAt(0).toUpperCase() + monthName.slice(1)} (${due.length}):\n${list}` };
  }

  // "what's due next week"
  if (/^what(?:'s| is)\s+due\s+next\s+week\??$/i.test(msg)) {
    const startNext = new Date(todayDate);
    startNext.setDate(startNext.getDate() + (7 - startNext.getDay()));
    const endNext = new Date(startNext);
    endNext.setDate(endNext.getDate() + 6);
    const due = tasks.filter(t => {
      if (!t.endDate) return false;
      const d = new Date(t.endDate);
      return d >= startNext && d <= endNext;
    });
    if (due.length === 0) return { type: 'read', response: 'Nothing due next week!' };
    const list = due.map(t => `- ${t.task || t.name} (${fmtDateHuman(new Date(t.endDate))})`).join('\n');
    return { type: 'read', response: `Due next week:\n${list}` };
  }

  // "what's due in [month]" / "how about [month]" / "what about [month]" / "but what about just in [month]" etc.
  {
    const monthQuery = lower.match(/(?:what(?:'s| is)\s+due\s+in|due\s+in|how\s+about|what\s+about(?:\s+just)?(?:\s+in)?|anything\s+(?:due\s+)?in|tasks?\s+(?:due\s+)?in|but\s+what\s+about(?:\s+just)?(?:\s+in)?)\s+(\w+)\s*\??$/);
    if (monthQuery) {
      const mName = monthQuery[1].toLowerCase();
      const mi = MONTH_NAMES.indexOf(mName) !== -1 ? MONTH_NAMES.indexOf(mName) : MONTH_SHORT.indexOf(mName);
      if (mi !== -1) {
        const year = mi >= todayDate.getMonth() ? todayDate.getFullYear() : todayDate.getFullYear() + 1;
        const startOfMonth = new Date(year, mi, 1);
        const endOfMonth = new Date(year, mi + 1, 0);
        const due = tasks.filter(t => {
          if (!t.endDate) return false;
          const d = new Date(t.endDate);
          return d >= startOfMonth && d <= endOfMonth;
        });
        const label = MONTH_NAMES[mi].charAt(0).toUpperCase() + MONTH_NAMES[mi].slice(1);
        if (due.length === 0) return { type: 'read', response: `Nothing due in ${label} ${year}.` };
        const list = due.map(t => `- ${t.task || t.name} (${fmtDateHuman(new Date(t.endDate))}${t.status === 'Done' ? ', done' : ''})`).join('\n');
        return { type: 'read', response: `Due in ${label} (${due.length}):\n${list}` };
      }
    }
  }

  // "show me [status] tasks" / "what's [status]" / "list [status] tasks"
  const statusQuery = lower.match(/(?:show\s+(?:me\s+)?|what(?:'s| is)\s+|list\s+(?:all\s+)?)(not started|to ?do|in progress|done|completed?|blocked|stuck|overdue)\s*(?:tasks?)?\??$/);
  if (statusQuery) {
    const raw = statusQuery[1];
    if (raw === 'overdue') {
      // Reuse overdue logic
      return resolveIntent("what's overdue", context);
    }
    const status = normaliseStatus(raw);
    if (status) {
      const matching = tasks.filter(t => t.status === status);
      if (matching.length === 0) return { type: 'read', response: `No ${status.toLowerCase()} tasks.` };
      const list = matching.map(t => `- ${t.task || t.name}`).join('\n');
      return { type: 'read', response: `${status} (${matching.length}):\n${list}` };
    }
  }

  // "show me tasks in [room]" / "show me [room] tasks" / "[room] tasks"
  const roomQuery = lower.match(/(?:show\s+(?:me\s+)?(?:all\s+)?(?:tasks?\s+)?(?:in|for)\s+(?:the\s+)?|^(?:tasks?\s+(?:in|for)\s+(?:the\s+)?))(.+?)(?:\s+room)?$/);
  if (roomQuery) {
    const roomName = roomQuery[1].trim();
    const matching = tasks.filter(t => (t.room || '').toLowerCase().includes(roomName));
    if (matching.length > 0) {
      const list = matching.map(t => `- ${t.task || t.name} (${t.status})`).join('\n');
      return { type: 'read', response: `Tasks in "${matching[0].room}" (${matching.length}):\n${list}` };
    }
  }

  // ─── Summary / overview ─────────────────────────────────────────
  if (/^(?:summary|overview|rundown|give\s+me\s+(?:a\s+)?(?:summary|rundown|overview)|project\s+(?:summary|overview|status)|how(?:'s| is)\s+(?:the\s+)?project|status)\s*\??$/i.test(msg)) {
    const total = tasks.length;
    const done = tasks.filter(t => t.status === 'Done').length;
    const inProg = tasks.filter(t => t.status === 'In Progress').length;
    const toDo = tasks.filter(t => t.status === 'To Do').length;
    const blocked = tasks.filter(t => t.status === 'Blocked').length;
    const overdue = tasks.filter(t => t.endDate && t.status !== 'Done' && new Date(t.endDate) < todayDate).length;
    const pct = total ? Math.round((done / total) * 100) : 0;
    const totalCost = tasks.reduce((sum, t) => sum + (t.cost || 0), 0);

    let resp = `${total} tasks — ${pct}% complete`;
    const parts = [];
    if (done) parts.push(`${done} done`);
    if (inProg) parts.push(`${inProg} in progress`);
    if (toDo) parts.push(`${toDo} to do`);
    if (blocked) parts.push(`${blocked} blocked`);
    if (parts.length) resp += ` (${parts.join(', ')})`;
    if (overdue) resp += `\n${overdue} overdue`;
    if (totalCost) resp += `\nEstimated cost: $${totalCost.toLocaleString()}`;
    return { type: 'read', response: resp };
  }

  // ─── Who's doing what / assigned queries ────────────────────────
  // "what's assigned to [person]" / "[person]'s tasks" / "tasks for [person]"
  {
    const assignedQuery = lower.match(/(?:what(?:'s| is)\s+assigned\s+to|tasks?\s+(?:for|assigned\s+to)|show\s+(?:me\s+)?(.+?)(?:'s)\s+tasks?|(.+?)(?:'s)\s+tasks?)\s*(.+?)?\s*\??$/);
    if (assignedQuery) {
      const person = (assignedQuery[3] || assignedQuery[2] || assignedQuery[1] || '').trim();
      if (person) {
        const matching = tasks.filter(t =>
          (t.assigned || []).some(a => a.toLowerCase().includes(person.toLowerCase()))
        );
        if (matching.length === 0) return { type: 'read', response: `No tasks assigned to "${person}".` };
        const list = matching.map(t => `- ${t.task || t.name} (${t.status})`).join('\n');
        return { type: 'read', response: `${person}'s tasks (${matching.length}):\n${list}` };
      }
    }
  }

  // "who's working on what" / "who has tasks" / "workload"
  if (/^(?:who(?:'s| is)\s+(?:working\s+on\s+what|doing\s+what|assigned)|workload|team\s*(?:load|overview)?)\s*\??$/i.test(msg)) {
    const byPerson = {};
    for (const t of tasks) {
      if (t.status === 'Done') continue;
      for (const a of (t.assigned || [])) {
        if (!byPerson[a]) byPerson[a] = [];
        byPerson[a].push(t);
      }
    }
    const unassigned = tasks.filter(t => t.status !== 'Done' && (!t.assigned || t.assigned.length === 0));
    if (Object.keys(byPerson).length === 0 && unassigned.length === 0) {
      return { type: 'read', response: 'No active tasks assigned to anyone.' };
    }
    let resp = '';
    for (const [name, personTasks] of Object.entries(byPerson).sort((a, b) => b[1].length - a[1].length)) {
      resp += `${name}: ${personTasks.length} task${personTasks.length > 1 ? 's' : ''}\n`;
    }
    if (unassigned.length) resp += `Unassigned: ${unassigned.length}`;
    return { type: 'read', response: resp.trim() };
  }

  // ─── Category queries ──────────────────────────────────────────
  // "show [category] tasks" / "what needs a trade quote" / "[category] tasks"
  {
    const catQuery = lower.match(/(?:show\s+(?:me\s+)?|list\s+(?:all\s+)?|what(?:'s| is|\s+needs?)\s+)?(buy\s*new|trade\s*quote|organis(?:e|ing)|to\s*do|in\s*progress)\s*(?:tasks?)?\s*\??$/);
    if (catQuery) {
      const catRaw = catQuery[1].trim();
      const matching = tasks.filter(t => (t.category || '').toLowerCase().includes(catRaw));
      if (matching.length > 0) {
        const label = matching[0].category || catRaw;
        const list = matching.map(t => `- ${t.task || t.name} (${t.room || 'no room'})`).join('\n');
        return { type: 'read', response: `${label} (${matching.length}):\n${list}` };
      }
    }
  }

  // ─── Cost / budget ──────────────────────────────────────────────
  if (/^(?:total\s+cost|how\s+much|budget|cost\s*(?:breakdown|summary|total)?|what(?:'s| is)\s+(?:the\s+)?(?:total\s+)?cost)\s*\??$/i.test(msg)) {
    const costed = tasks.filter(t => t.cost);
    const total = costed.reduce((sum, t) => sum + t.cost, 0);
    if (costed.length === 0) return { type: 'read', response: 'No tasks have cost estimates.' };
    const uncosted = tasks.length - costed.length;
    let resp = `Estimated total: $${total.toLocaleString()} across ${costed.length} task${costed.length > 1 ? 's' : ''}`;
    if (uncosted > 0) resp += ` (${uncosted} task${uncosted > 1 ? 's' : ''} have no estimate)`;
    // Top 5 most expensive
    const top = [...costed].sort((a, b) => b.cost - a.cost).slice(0, 5);
    if (top.length > 1) {
      resp += '\n\nMost expensive:';
      for (const t of top) resp += `\n- ${t.task || t.name}: $${t.cost.toLocaleString()}`;
    }
    return { type: 'read', response: resp };
  }

  // ─── Unassigned / no date ───────────────────────────────────────
  if (/^(?:unassigned|(?:tasks?\s+)?(?:with\s+)?no\s*(?:one|body)\s*assigned|what\s+needs?\s+assign)/i.test(msg)) {
    const unassigned = tasks.filter(t => t.status !== 'Done' && (!t.assigned || t.assigned.length === 0));
    if (unassigned.length === 0) return { type: 'read', response: 'All active tasks are assigned.' };
    const list = unassigned.map(t => `- ${t.task || t.name}`).join('\n');
    return { type: 'read', response: `Unassigned (${unassigned.length}):\n${list}` };
  }

  if (/^(?:(?:tasks?\s+)?(?:with\s+)?no\s+(?:due\s+)?dates?|undated|(?:tasks?\s+)?without\s+(?:due\s+)?dates?|what\s+has\s+no\s+(?:due\s+)?date)/i.test(msg)) {
    const undated = tasks.filter(t => t.status !== 'Done' && !t.endDate);
    if (undated.length === 0) return { type: 'read', response: 'All active tasks have due dates.' };
    const list = undated.map(t => `- ${t.task || t.name} (${t.status})`).join('\n');
    return { type: 'read', response: `No due date (${undated.length}):\n${list}` };
  }

  // ─── Due before/after ──────────────────────────────────────────
  {
    const beforeAfter = lower.match(/(?:what(?:'s| is)\s+)?due\s+(before|after|by)\s+(.+?)\s*\??$/);
    if (beforeAfter) {
      const dir = beforeAfter[1]; // before/by = before, after = after
      const dateStr = beforeAfter[2];
      // Try month name first
      const mi = MONTH_NAMES.indexOf(dateStr) !== -1 ? MONTH_NAMES.indexOf(dateStr) : MONTH_SHORT.indexOf(dateStr);
      let boundary;
      if (mi !== -1) {
        const year = mi >= todayDate.getMonth() ? todayDate.getFullYear() : todayDate.getFullYear() + 1;
        boundary = dir === 'after' ? new Date(year, mi + 1, 0) : new Date(year, mi, 1);
      } else {
        boundary = parseDate(dateStr);
      }
      if (boundary) {
        const matching = tasks.filter(t => {
          if (!t.endDate || t.status === 'Done') return false;
          const d = new Date(t.endDate);
          return dir === 'after' ? d > boundary : d <= boundary;
        });
        const label = fmtDateHuman(boundary);
        if (matching.length === 0) return { type: 'read', response: `No active tasks due ${dir} ${label}.` };
        const list = matching.map(t => `- ${t.task || t.name} (${fmtDateHuman(new Date(t.endDate))})`).join('\n');
        return { type: 'read', response: `Due ${dir} ${label} (${matching.length}):\n${list}` };
      }
    }
  }

  // ─── What's next / priorities ───────────────────────────────────
  if (/^(?:what(?:'s| is|\s+should\s+I\s+(?:do|work\s+on))\s+next|next\s+up|priorities?|what\s+to\s+(?:do|work\s+on)(?:\s+next)?)\s*\??$/i.test(msg)) {
    const active = tasks.filter(t => t.status !== 'Done');
    if (active.length === 0) return { type: 'read', response: 'All tasks are done!' };
    // Priority: overdue first, then soonest due, then in-progress, then blocked
    const overdue = active.filter(t => t.endDate && new Date(t.endDate) < todayDate)
      .sort((a, b) => new Date(a.endDate) - new Date(b.endDate));
    const inProg = active.filter(t => t.status === 'In Progress' && !(t.endDate && new Date(t.endDate) < todayDate));
    const upcoming = active.filter(t => t.endDate && new Date(t.endDate) >= todayDate && t.status !== 'In Progress')
      .sort((a, b) => new Date(a.endDate) - new Date(b.endDate));

    let resp = '';
    if (overdue.length) {
      resp += 'Overdue:\n' + overdue.slice(0, 3).map(t => `- ${t.task || t.name} (was due ${fmtDateHuman(new Date(t.endDate))})`).join('\n');
    }
    if (inProg.length) {
      if (resp) resp += '\n\n';
      resp += 'In progress:\n' + inProg.slice(0, 3).map(t => `- ${t.task || t.name}`).join('\n');
    }
    if (upcoming.length && !overdue.length) {
      if (resp) resp += '\n\n';
      resp += 'Up next:\n' + upcoming.slice(0, 3).map(t => `- ${t.task || t.name} (due ${fmtDateHuman(new Date(t.endDate))})`).join('\n');
    }
    if (!resp) resp = `${active.length} active tasks but none have due dates set.`;
    return { type: 'read', response: resp };
  }

  // ─── Recent changes / activity ───────────────────────────────────
  if (/^(?:(?:show\s+)?recent\s+(?:changes|updates|activity|edits)|what(?:'s|\s+has)\s+changed|activity|changelog|history|what\s+(?:was|got)\s+(?:updated|changed|edited)(?:\s+recently)?)\s*\??$/i.test(msg)) {
    const withUpdates = tasks.filter(t => t.updatedAt).sort((a, b) => b.updatedAt - a.updatedAt);
    if (withUpdates.length === 0) return { type: 'read', response: 'No recent changes tracked.' };
    const now = Date.now();
    const recent = withUpdates.slice(0, 10);
    const list = recent.map(t => {
      const ago = now - t.updatedAt;
      let timeLabel;
      if (ago < 60000) timeLabel = 'just now';
      else if (ago < 3600000) timeLabel = `${Math.floor(ago / 60000)}m ago`;
      else if (ago < 86400000) timeLabel = `${Math.floor(ago / 3600000)}h ago`;
      else if (ago < 604800000) timeLabel = `${Math.floor(ago / 86400000)}d ago`;
      else timeLabel = fmtDateHuman(new Date(t.updatedAt));
      return `- ${t.task || t.name} (${t.status}) — ${timeLabel}`;
    }).join('\n');
    return { type: 'read', response: `Recent changes:\n${list}` };
  }

  // ─── Last-resort month extraction ────────────────────────────────
  // If ANY recognised month name appears in the message, treat it as a month query.
  // Catches typos ("takss in may"), conversational ("but just in may"), bare months ("march").
  // Skip if message contains mutation verbs — those should go to the LLM.
  {
    const hasMutationVerb = /\b(change|update|set|move|reschedule|assign|mark|rename|delete|remove|add|create|push|shift|delay|complete|finish)\b/i.test(lower);
    if (!hasMutationVerb) {
      const words = lower.replace(/[?.!,]+/g, '').split(/\s+/);
      for (const w of words) {
        const mi = MONTH_NAMES.indexOf(w) !== -1 ? MONTH_NAMES.indexOf(w) : MONTH_SHORT.indexOf(w);
        if (mi !== -1) {
          return resolveIntent(`what's due in ${MONTH_NAMES[mi]}`, context);
        }
      }
    }
  }

  // ─── Flexible bulk date mutation (token extraction) ──────────────
  // Catches natural phrasings like:
  //   "task that mention word patch need to update start date to 21 March 2026 and end date 30 April 2026"
  //   "change any task with patch start date to be 21 March and end date 30 April"
  //   "update patch tasks dates to start 21 march end 30 april"
  {
    const hasMutationWord = /\b(change|update|set|move|need\s+to\s+update|need\s+to\s+change)\b/i.test(lower);
    const hasDateWord = /\b(start\s+date|end\s+date|finish\s+date|due\s+date|date)\b/i.test(lower);
    if (hasMutationWord && hasDateWord) {
      // Extract start date
      const startMatch = lower.match(/start\s+date\s+(?:to\s+(?:be\s+)?|of\s+|:\s*)?(\d{1,2}(?:st|nd|rd|th)?\s+(?:of\s+)?\w+(?:\s+\d{4})?)/);
      const startDate = startMatch ? parseDate(startMatch[1].replace(/(?:st|nd|rd|th)\s+of\s+/g, ' ').replace(/(?:st|nd|rd|th)\s+/g, ' ')) : null;

      // Extract end/finish/due date
      const endMatch = lower.match(/(?:end|finish|due)\s+date\s+(?:to\s+(?:be\s+)?|of\s+|:\s*)?(\d{1,2}(?:st|nd|rd|th)?\s+(?:of\s+)?\w+(?:\s+\d{4})?)/);
      const endDate = endMatch ? parseDate(endMatch[1].replace(/(?:st|nd|rd|th)\s+of\s+/g, ' ').replace(/(?:st|nd|rd|th)\s+/g, ' ')) : null;

      if (startDate || endDate) {
        // Extract filter - look for keywords between mutation verb and date references
        let filterStr = lower
          .replace(/\b(?:change|update|set|move|need\s+to\s+update|need\s+to\s+change)\b/g, '')
          .replace(/start\s+date\s+(?:to\s+(?:be\s+)?|of\s+)?.*$/g, '')
          .replace(/(?:end|finish|due)\s+date\s+(?:to\s+(?:be\s+)?|of\s+)?.*$/g, '')
          .replace(/\b(?:any|all|every|tasks?|that|which|with|the|word|mention(?:s|ing)?|contain(?:s|ing)?|have|has|need)\b/g, '')
          .replace(/[",'.]/g, '')
          .trim();

        // Clean up multiple spaces
        filterStr = filterStr.replace(/\s+/g, ' ').trim();

        if (filterStr) {
          const result = filterTasks(filterStr, tasks);
          if (result && result.matched.length > 0) {
            const fields = {};
            const parts = [];
            if (startDate) { fields.startDate = fmtDate(startDate); parts.push(`start ${fmtDateHuman(startDate)}`); }
            if (endDate) { fields.endDate = fmtDate(endDate); parts.push(`end ${fmtDateHuman(endDate)}`); }
            return {
              type: 'clarify',
              response: `This will set ${parts.join(' and ')} on ${result.matched.length} ${result.label}. Proceed?`,
              pendingAction: {
                action: 'bulk_update',
                taskIds: result.matched.map(t => t.id),
                fields,
                label: result.label,
              },
            };
          }
          if (result && result.matched.length === 0) {
            return { type: 'read', response: `No ${result.label} found.` };
          }
        }
      }
    }
  }

  // ─── Bulk mutations (confirm before executing) ───────────────────

  // Compound: "change dates of [filter] with a start date of [date] and/with end/finish date of [date]"
  {
    const compound = lower.match(/^(?:change|set|update)\s+(?:the\s+)?dates?\s+(?:of|on|for)\s+(?:all\s+|any\s+)?(.+?)\s+(?:with|to\s+have)\s+(?:a\s+)?start\s+date\s+(?:of|to(?:\s+become)?)\s+(.+?)\s+(?:and\s+|with\s+)(?:a\s+)?(?:end|finish|due)\s+date\s+(?:of|to(?:\s+become)?)\s+(.+)$/);
    if (compound) {
      const filterStr = compound[1].replace(/\s*tasks?\s*$/i, '').trim();
      const startDate = parseDate(compound[2].replace(/(?:st|nd|rd|th)\s+of\s+/g, ' '));
      const endDate = parseDate(compound[3].replace(/(?:st|nd|rd|th)\s+of\s+/g, ' '));
      if (startDate || endDate) {
        const result = filterTasks(filterStr, tasks);
        if (result && result.matched.length > 0) {
          const fields = {};
          const parts = [];
          if (startDate) { fields.startDate = fmtDate(startDate); parts.push(`start ${fmtDateHuman(startDate)}`); }
          if (endDate) { fields.endDate = fmtDate(endDate); parts.push(`end ${fmtDateHuman(endDate)}`); }
          return {
            type: 'clarify',
            response: `This will set ${parts.join(' and ')} on ${result.matched.length} ${result.label}. Proceed?`,
            pendingAction: {
              action: 'bulk_update',
              taskIds: result.matched.map(t => t.id),
              fields,
              label: result.label,
            },
          };
        }
        if (result && result.matched.length === 0) {
          return { type: 'read', response: `No ${result.label} found.` };
        }
      }
    }
  }

  // "change/set/move date of all [filter] to [date]"
  {
    const bulkDate = lower.match(/^(?:change|set|move|update)\s+(?:the\s+)?(?:(?:end|due|finish)\s+)?dates?\s+(?:of|on|for)\s+(?:all\s+|any\s+)?(.+?)\s+to(?:\s+become)?\s+(.+)$/);
    if (bulkDate) {
      const filterStr = bulkDate[1];
      const dateStr = bulkDate[2];
      const date = parseDate(dateStr);
      if (date) {
        const result = filterTasks(filterStr, tasks);
        if (result && result.matched.length > 0) {
          return {
            type: 'clarify',
            response: `This will change the end date to ${fmtDateHuman(date)} on ${result.matched.length} ${result.label}. Proceed?`,
            pendingAction: {
              action: 'bulk_update',
              taskIds: result.matched.map(t => t.id),
              fields: { endDate: fmtDate(date) },
              label: result.label,
            },
          };
        }
        if (result && result.matched.length === 0) {
          return { type: 'read', response: `No ${result.label} found.` };
        }
      }
    }
  }

  // "change start date of all [filter] to [date]"
  {
    const bulkStart = lower.match(/^(?:change|set|move|update)\s+(?:the\s+)?start\s+date\s+(?:of|on|for)\s+(?:all\s+|any\s+)?(.+?)\s+to(?:\s+become)?\s+(.+)$/);
    if (bulkStart) {
      const date = parseDate(bulkStart[2]);
      if (date) {
        const result = filterTasks(bulkStart[1], tasks);
        if (result && result.matched.length > 0) {
          return {
            type: 'clarify',
            response: `This will change the start date to ${fmtDateHuman(date)} on ${result.matched.length} ${result.label}. Proceed?`,
            pendingAction: {
              action: 'bulk_update',
              taskIds: result.matched.map(t => t.id),
              fields: { startDate: fmtDate(date) },
              label: result.label,
            },
          };
        }
      }
    }
  }

  // "mark all [filter] as [status]"
  {
    const bulkMark = lower.match(/^(?:mark|set|change)\s+(?:all\s+)?(.+?)\s+(?:as|to)\s+(done|complete|completed|in progress|not started|to ?do|blocked|started|working)$/);
    if (bulkMark) {
      const filterStr = bulkMark[1];
      const newStatus = normaliseStatus(bulkMark[2]);
      if (newStatus) {
        const result = filterTasks(filterStr, tasks);
        if (result && result.matched.length > 1) {
          return {
            type: 'clarify',
            response: `This will mark ${result.matched.length} ${result.label} as ${newStatus}. Proceed?`,
            pendingAction: {
              action: 'bulk_update',
              taskIds: result.matched.map(t => t.id),
              fields: { status: newStatus },
              label: result.label,
            },
          };
        }
        // Single match falls through to single-task handler below
      }
    }
  }

  // "assign all [filter] to [person]"
  {
    const bulkAssign = lower.match(/^assign\s+(?:all\s+)?(.+?)\s+to\s+(.+)$/);
    if (bulkAssign) {
      const filterStr = bulkAssign[1];
      const person = bulkAssign[2].trim();
      const result = filterTasks(filterStr, tasks);
      if (result && result.matched.length > 1) {
        return {
          type: 'clarify',
          response: `This will assign ${result.matched.length} ${result.label} to ${person}. Proceed?`,
          pendingAction: {
            action: 'bulk_update',
            taskIds: result.matched.map(t => t.id),
            fields: { assigned: [person] },
            label: result.label,
          },
        };
      }
      // Single match falls through to single-task handler
    }
  }

  // "delete/remove all [filter]"
  {
    const bulkDelete = lower.match(/^(?:delete|remove|trash)\s+(?:all\s+)?(.+)$/);
    if (bulkDelete) {
      const result = filterTasks(bulkDelete[1], tasks);
      if (result && result.matched.length > 1) {
        return {
          type: 'clarify',
          response: `This will delete ${result.matched.length} ${result.label} (moved to bin). Proceed?`,
          pendingAction: {
            action: 'bulk_delete',
            taskIds: result.matched.map(t => t.id),
            label: result.label,
          },
        };
      }
      // Single match falls through to single-task handler
    }
  }

  // ─── Single-task mutations ──────────────────────────────────────

  // "mark [task] as [status]" / "complete [task]"
  const markAs = lower.match(/^(?:mark|set|change)\s+(.+?)\s+(?:as|to)\s+(done|complete|completed|in progress|not started|to ?do|blocked|started|working)$/);
  const completeTask = !markAs && lower.match(/^(?:complete|finish)\s+(.+)$/);

  if (markAs || completeTask) {
    const taskName = markAs ? markAs[1] : completeTask[1];
    const statusRaw = markAs ? markAs[2] : 'done';
    const newStatus = normaliseStatus(statusRaw);
    if (!newStatus) return null;

    const match = findTask(taskName, tasks);
    if (!match) return { type: 'clarify', response: `I couldn't find a task matching "${taskName}". Can you be more specific?` };
    if (match.confidence < 0.8) {
      return {
        type: 'clarify',
        response: `Did you mean "${match.task.task || match.task.name}"?`,
        pendingAction: {
          action: 'update',
          taskId: match.task.id,
          fields: { status: newStatus },
          taskName: match.task.task || match.task.name,
        },
      };
    }

    return {
      type: 'mutation',
      action: 'update',
      taskId: match.task.id,
      fields: { status: newStatus },
      previousFields: { status: match.task.status },
      confirmation: `${match.task.task || match.task.name} → ${newStatus}`,
    };
  }

  // "delete [task]" / "remove [task]" — always confirm via flow
  const deleteMatch = lower.match(/^(?:delete|remove|trash)\s+(.+)$/);
  if (deleteMatch) {
    const taskQuery = deleteMatch[1].replace(/\b(?:the|task)\b/gi, '').trim();
    const matches = findTasks(taskQuery, tasks);
    if (!matches.length) return { type: 'clarify', response: `I couldn't find a task matching "${deleteMatch[1]}". Can you be more specific?` };
    return {
      type: 'flow',
      flow: 'delete',
      candidates: matches,
    };
  }

  // ─── Contextual follow-ups (no task name → use last mutated task) ───
  const lastTask = context.lastTaskId ? tasks.find(t => t.id === context.lastTaskId) : null;
  if (lastTask) {
    const ltName = lastTask.task || lastTask.name;

    // "assign to [person]" / "assign it to [person]"
    const ctxAssign = lower.match(/^assign\s+(?:it\s+|that\s+)?to\s+(.+)$/);
    if (ctxAssign) {
      const person = ctxAssign[1].trim();
      return {
        type: 'mutation', action: 'update', taskId: lastTask.id,
        fields: { assigned: [person] },
        confirmation: `Assigned "${ltName}" to ${person}.`,
      };
    }

    // "move to [status]" / "set status to [status]" / "mark as [status]"
    const ctxStatus = lower.match(/^(?:move|set|change)\s+(?:it\s+|that\s+|status\s+)?to\s+(.+)$/)
      || lower.match(/^mark\s+(?:it\s+|that\s+)?(?:as\s+)?(.+)$/);
    if (ctxStatus) {
      const rawStatus = ctxStatus[1].trim();
      const statusMap = { 'todo': 'To Do', 'to do': 'To Do', 'in progress': 'In Progress', 'blocked': 'Blocked', 'done': 'Done' };
      const status = statusMap[rawStatus.toLowerCase()] || rawStatus.charAt(0).toUpperCase() + rawStatus.slice(1);
      if (['To Do', 'In Progress', 'Blocked', 'Done'].includes(status)) {
        return {
          type: 'mutation', action: 'update', taskId: lastTask.id,
          fields: { status },
          confirmation: `Moved "${ltName}" to ${status}.`,
        };
      }
    }

    // "due [date]" / "set due to [date]"
    const ctxDue = lower.match(/^(?:(?:set\s+)?due\s+(?:date\s+)?(?:to\s+)?|due\s+)(.+)$/);
    if (ctxDue) {
      const d = parseDate(ctxDue[1].trim());
      if (d) {
        return {
          type: 'mutation', action: 'update', taskId: lastTask.id,
          fields: { endDate: fmtDate(d) },
          confirmation: `Set "${ltName}" due ${d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}.`,
        };
      }
    }

    // "room [name]" / "set room to [name]"
    const ctxRoom = lower.match(/^(?:set\s+)?room\s+(?:to\s+)?(.+)$/);
    if (ctxRoom) {
      const room = ctxRoom[1].trim().replace(/^["']|["']$/g, '');
      return {
        type: 'mutation', action: 'update', taskId: lastTask.id,
        fields: { room },
        confirmation: `Set "${ltName}" room to ${room}.`,
      };
    }

    // "category [name]"
    const ctxCat = lower.match(/^(?:set\s+)?category\s+(?:to\s+)?(.+)$/);
    if (ctxCat) {
      const category = ctxCat[1].trim();
      return {
        type: 'mutation', action: 'update', taskId: lastTask.id,
        fields: { category },
        confirmation: `Set "${ltName}" category to ${category}.`,
      };
    }
  }

  // "assign [task] to [person]"
  const assignMatch = lower.match(/^assign\s+(.+?)\s+to\s+(.+)$/);
  if (assignMatch) {
    const taskName = assignMatch[1];
    const person = assignMatch[2].trim();
    const match = findTask(taskName, tasks);
    if (!match) return { type: 'clarify', response: `I couldn't find a task matching "${taskName}".` };
    if (match.confidence < 0.8) {
      return {
        type: 'clarify',
        response: `Did you mean "${match.task.task || match.task.name}"?`,
        pendingAction: {
          action: 'update',
          taskId: match.task.id,
          fields: { assigned: [person] },
          taskName: match.task.task || match.task.name,
        },
      };
    }
    return {
      type: 'mutation',
      action: 'update',
      taskId: match.task.id,
      fields: { assigned: [person] },
      previousFields: { assigned: match.task.assigned },
      confirmation: `Assigned "${match.task.task || match.task.name}" to ${person}.`,
    };
  }

  // "add/create/new task [name] [field details]" — direct add when name given, flow when not
  const addMatch = lower.match(/^(?:add|create|new)\s+(?:a\s+)?task\s*[:\-–]?\s*(.+)/i)
    || lower.match(/^(?:add|create|new)\s+(?:a\s+)?(?:task\s+)?(?:for|called|named)\s+(.+)/i);
  if (addMatch) {
    const { taskName, fields } = extractFields(addMatch[1]);
    if (taskName) {
      // Name provided — create immediately, no confirmation needed
      return {
        type: 'mutation',
        action: 'add',
        fields: { task: taskName, status: 'To Do', ...fields },
        confirmation: `Added "${taskName}".`,
      };
    }
    return {
      type: 'flow',
      flow: 'add',
      draft: { task: '', status: 'To Do', ...fields },
    };
  }

  // Bare "add a task" / "new task" / "create task" — enter flow (no name)
  if (/^(?:add|create|new)\s+(?:a\s+)?task\s*$/.test(lower)) {
    return { type: 'flow', flow: 'add', draft: { task: '', status: 'To Do' } };
  }

  // "edit/update/change [task]" — enter conversational edit flow
  const editMatch = lower.match(/^(?:edit|update|change|modify)\s+(?:the\s+)?(.+?)(?:\s+task)?$/);
  if (editMatch) {
    const taskQuery = editMatch[1].replace(/\b(?:the|task)\b/gi, '').trim();
    const matches = findTasks(taskQuery, tasks);
    if (!matches.length) return { type: 'clarify', response: `I couldn't find a task matching "${editMatch[1]}". Can you be more specific?` };
    return {
      type: 'flow',
      flow: 'edit',
      candidates: matches,
    };
  }

  // "rename [task] to [new name]"
  const renameMatch = lower.match(/^rename\s+(.+?)\s+to\s+(.+)$/);
  if (renameMatch) {
    const taskName = renameMatch[1];
    const newName = renameMatch[2].trim();
    const match = findTask(taskName, tasks);
    if (!match) return { type: 'clarify', response: `I couldn't find a task matching "${taskName}".` };
    return {
      type: 'mutation',
      action: 'update',
      taskId: match.task.id,
      fields: { task: newName },
      previousFields: { task: match.task.task || match.task.name },
      confirmation: `Renamed to "${newName}".`,
    };
  }

  // No local match
  return null;
}

/**
 * Generate a proactive briefing message (pure JS, no LLM).
 * @param {object[]} tasks - Current project tasks (with Date objects for dates)
 * @param {string} userName
 * @param {'off'|'daily'|'weekly'|'monthly'} mode
 * @returns {string|null}
 */
export function generateBriefing(tasks, userName, mode = 'daily') {
  if (mode === 'off' || !tasks.length) return null;

  const todayDate = today();
  const name = userName || 'there';

  const overdue = tasks.filter(t => {
    if (!t.endDate || t.status === 'Done') return false;
    return new Date(t.endDate) < todayDate;
  });

  const dueToday = tasks.filter(t => {
    if (!t.endDate || t.status === 'Done') return false;
    return fmtDate(new Date(t.endDate)) === fmtDate(todayDate);
  });

  let dueUpcoming = [];
  if (mode === 'weekly' || mode === 'monthly') {
    const horizon = new Date(todayDate);
    horizon.setDate(horizon.getDate() + (mode === 'monthly' ? 30 : 7));
    dueUpcoming = tasks.filter(t => {
      if (!t.endDate || t.status === 'Done') return false;
      const d = new Date(t.endDate);
      return d > todayDate && d <= horizon;
    });
  }

  const parts = [];
  const greeting = getGreeting();

  if (overdue.length > 0) {
    parts.push(`${overdue.length} overdue task${overdue.length > 1 ? 's' : ''}`);
  }
  if (dueToday.length > 0) {
    parts.push(`${dueToday.length} due today`);
  }
  if (dueUpcoming.length > 0) {
    const label = mode === 'monthly' ? 'due this month' : 'due this week';
    parts.push(`${dueUpcoming.length} ${label}`);
  }

  if (parts.length === 0) return null;

  return `${greeting} ${name} — you've got ${parts.join(', ')}. Want a rundown?`;
}

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Morning';
  if (h < 17) return 'Afternoon';
  return 'Evening';
}
