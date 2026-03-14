/**
 * ai-context.js — Task snapshot builder for LLM context
 * Pure functions that build compressed task context for API calls.
 */

import { loadProjects, loadActiveProjectId, loadUserName } from './storage.js';

let _cachedContext = null;
let _cachedHash = null;

function hashTasks(tasks) {
  // Simple hash based on task count + latest updatedAt
  const latest = tasks.reduce((max, t) => Math.max(max, t.updatedAt || 0), 0);
  return `${tasks.length}:${latest}`;
}

/**
 * Build a compressed task snapshot for LLM context.
 * Only includes fields the LLM needs — no descriptions/notes.
 * Caps at 30 tasks, prioritising those due within 60 days + keyword matches.
 */
export function buildContext(opts = {}) {
  const projectId = opts.projectId || loadActiveProjectId();
  const projects = loadProjects();
  const project = projects.find(p => p.id === projectId);
  if (!project) return null;

  const tasks = (project.tasks || []).map(t => ({
    ...t,
    startDate: t.startDate ? new Date(t.startDate) : null,
    endDate: t.endDate ? new Date(t.endDate) : null,
  }));

  const hash = hashTasks(tasks);
  if (_cachedHash === hash && _cachedContext && _cachedContext.projectId === projectId) {
    return _cachedContext;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const sixtyDays = new Date(today);
  sixtyDays.setDate(sixtyDays.getDate() + 60);

  // Filter and prioritise
  let selected = tasks;
  if (tasks.length > 30) {
    const keywords = opts.keywords || [];
    const kwLower = keywords.map(k => k.toLowerCase());

    // Score each task
    const scored = tasks.map(t => {
      let score = 0;
      // Due within 60 days
      if (t.endDate && t.endDate >= today && t.endDate <= sixtyDays) score += 10;
      // Overdue
      if (t.endDate && t.endDate < today && t.status !== 'Done') score += 15;
      // Due today
      if (t.endDate && t.endDate.toDateString() === today.toDateString()) score += 20;
      // Keyword match
      if (kwLower.length > 0) {
        const name = (t.task || '').toLowerCase();
        const room = (t.room || '').toLowerCase();
        if (kwLower.some(k => name.includes(k) || room.includes(k))) score += 25;
      }
      // Not done tasks are more relevant
      if (t.status !== 'Done') score += 5;
      return { task: t, score };
    });

    scored.sort((a, b) => b.score - a.score);
    selected = scored.slice(0, 30).map(s => s.task);
  }

  const fmtDate = (d) => d ? d.toISOString().split('T')[0] : null;

  const context = {
    today: fmtDate(today),
    project: project.name,
    projectId: project.id,
    user: loadUserName() || 'User',
    totalTasks: tasks.length,
    shownTasks: selected.length,
    tasks: selected.map(t => ({
      id: t.id,
      name: t.task,
      status: t.status || 'To Do',
      startDate: fmtDate(t.startDate),
      dueDate: fmtDate(t.endDate),
      room: t.room || '',
      category: t.category || '',
      assigned: Array.isArray(t.assigned) ? t.assigned : (t.assigned ? [t.assigned] : []),
    })),
  };

  _cachedContext = context;
  _cachedHash = hash;
  return context;
}

/** Invalidate the cache (call after mutations). */
export function invalidateContextCache() {
  _cachedContext = null;
  _cachedHash = null;
}

/**
 * Get a formatted context string for the system prompt.
 */
export function getContextString(opts = {}) {
  const ctx = buildContext(opts);
  if (!ctx) return '';
  return JSON.stringify(ctx, null, 0);
}
