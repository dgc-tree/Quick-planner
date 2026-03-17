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

  return null;
}

function fmtDate(d) {
  return d ? d.toISOString().split('T')[0] : null;
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

/**
 * Find the best matching task by name. Returns { task, confidence } or null.
 */
export function findTask(query, tasks) {
  if (!query || !tasks.length) return null;
  const q = query.toLowerCase().trim();

  // Exact match first
  const exact = tasks.find(t => t.task.toLowerCase() === q || t.name?.toLowerCase() === q);
  if (exact) return { task: exact, confidence: 1.0 };

  // Substring match
  const substringMatches = tasks.filter(t => {
    const name = (t.task || t.name || '').toLowerCase();
    return name.includes(q) || q.includes(name);
  });
  if (substringMatches.length === 1) {
    return { task: substringMatches[0], confidence: 0.95 };
  }

  // Fuzzy match via Levenshtein
  let best = null, bestScore = Infinity;
  for (const t of tasks) {
    const name = (t.task || t.name || '').toLowerCase();
    const dist = levenshtein(q, name);
    const maxLen = Math.max(q.length, name.length);
    if (dist < bestScore) {
      bestScore = dist;
      best = t;
    }
  }
  if (best) {
    const maxLen = Math.max(q.length, (best.task || best.name || '').length);
    const confidence = 1 - bestScore / maxLen;
    if (confidence >= 0.4) return { task: best, confidence };
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

  // "how many tasks" / "how many tasks in [project]"
  if (/^how\s+many\s+tasks/i.test(msg)) {
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

  // "show me tasks in [room]" / "show me [room] tasks"
  const roomQuery = lower.match(/show\s+(?:me\s+)?(?:all\s+)?(?:tasks?\s+)?(?:in|for)\s+(?:the\s+)?(.+?)(?:\s+room)?$/);
  if (roomQuery) {
    const roomName = roomQuery[1].trim();
    const matching = tasks.filter(t => (t.room || '').toLowerCase().includes(roomName));
    if (matching.length > 0) {
      const list = matching.map(t => `- ${t.task || t.name} (${t.status})`).join('\n');
      return { type: 'read', response: `Tasks in "${matching[0].room}" (${matching.length}):\n${list}` };
    }
  }

  // ─── Mutations ────────────────────────────────────────────────────

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

  // "delete [task]" / "remove [task]"
  const deleteMatch = lower.match(/^(?:delete|remove|trash)\s+(.+)$/);
  if (deleteMatch) {
    const taskName = deleteMatch[1];
    const match = findTask(taskName, tasks);
    if (!match) return { type: 'clarify', response: `I couldn't find a task matching "${taskName}".` };
    if (match.confidence < 0.8) {
      return {
        type: 'clarify',
        response: `Did you mean "${match.task.task || match.task.name}"? Say "yes" to delete it.`,
        pendingAction: { action: 'delete', taskId: match.task.id, taskName: match.task.task || match.task.name },
      };
    }
    return {
      type: 'mutation',
      action: 'delete',
      taskId: match.task.id,
      confirmation: `Deleted "${match.task.task || match.task.name}" (moved to bin).`,
    };
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

  // "add task [name] due [date]"
  const addTask = lower.match(/^(?:add|create|new)\s+(?:a\s+)?task\s+(.+?)(?:\s+due\s+(.+))?$/);
  if (addTask) {
    const name = addTask[1].replace(/^["']|["']$/g, '');
    const dueDateStr = addTask[2] || null;
    const dueDate = dueDateStr ? parseDate(dueDateStr) : null;

    return {
      type: 'mutation',
      action: 'add',
      fields: {
        task: name,
        endDate: fmtDate(dueDate),
      },
      confirmation: `Created "${name}"${dueDate ? ` due ${fmtDateHuman(dueDate)}` : ''}.`,
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
