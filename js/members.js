/**
 * Project members — canonical roster.
 *
 * Members are first-class entities living on the project. Tasks reference
 * members by canonical name (the stable identifier in our domain). The
 * canonicaliser prevents case/whitespace duplicates from ever entering
 * `task.assigned`.
 *
 * Shape: project.members = [{ name, email?, role? }]
 *   - name is the trimmed, canonical-casing string
 *   - email/role are optional (used by future invite flow)
 */

function foldKey(name) {
  return String(name == null ? '' : name).trim().toLowerCase();
}

export function findMember(project, name) {
  if (!project || !Array.isArray(project.members)) return null;
  const key = foldKey(name);
  if (!key) return null;
  return project.members.find(m => foldKey(m.name) === key) || null;
}

/**
 * Resolve `name` to its canonical form on this project. If a member already
 * exists (case-insensitively, trimmed) returns the existing canonical name.
 * Otherwise creates a new member entry and returns the new canonical name.
 *
 * Pass `mutate: false` to do a non-mutating lookup (returns null if no match).
 */
export function canonicaliseMember(project, name, opts = {}) {
  const trimmed = String(name == null ? '' : name).trim();
  if (!trimmed) return null;
  const existing = findMember(project, trimmed);
  if (existing) return existing.name;
  if (opts.mutate === false) return null;
  if (!Array.isArray(project.members)) project.members = [];
  project.members.push({ name: trimmed });
  return trimmed;
}

/**
 * Canonicalise a list of names. Drops empties, dedupes case-insensitively,
 * preserves first-seen order, creates members on the project as needed.
 */
export function canonicaliseAssigned(project, names, opts = {}) {
  const arr = Array.isArray(names) ? names : (names ? [names] : []);
  const seen = new Set();
  const out = [];
  for (const raw of arr) {
    const canonical = canonicaliseMember(project, raw, opts);
    if (!canonical) continue;
    const key = foldKey(canonical);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(canonical);
  }
  return out;
}

/**
 * Rename a member across the project: updates the member entry AND rewrites
 * every task's `assigned` array (live + archived) to use the new name.
 * Returns true on success, false if oldName not found or newName already exists.
 */
export function renameMember(project, oldName, newName) {
  if (!project) return false;
  const existing = findMember(project, oldName);
  if (!existing) return false;
  const trimmed = String(newName || '').trim();
  if (!trimmed) return false;
  // Block if the new name collides with a different existing member.
  const collision = findMember(project, trimmed);
  if (collision && collision !== existing) return false;
  const oldCanonical = existing.name;
  existing.name = trimmed;
  for (const task of (project.tasks || [])) {
    if (!Array.isArray(task.assigned)) continue;
    let changed = false;
    task.assigned = task.assigned.map(n => {
      if (foldKey(n) === foldKey(oldCanonical)) { changed = true; return trimmed; }
      return n;
    });
    if (changed) task.updatedAt = Date.now();
  }
  return true;
}

/**
 * Remove a member from the project: drops the member entry AND strips the
 * name from every task's `assigned` array. Returns true on success.
 */
export function removeMember(project, name) {
  if (!project || !Array.isArray(project.members)) return false;
  const key = foldKey(name);
  const idx = project.members.findIndex(m => foldKey(m.name) === key);
  if (idx === -1) return false;
  const canonical = project.members[idx].name;
  project.members.splice(idx, 1);
  for (const task of (project.tasks || [])) {
    if (!Array.isArray(task.assigned)) continue;
    const before = task.assigned.length;
    task.assigned = task.assigned.filter(n => foldKey(n) !== foldKey(canonical));
    if (task.assigned.length !== before) task.updatedAt = Date.now();
  }
  return true;
}

/**
 * Rebuild `project.members` from the names found across `project.tasks`.
 * Used at migration time and on pull from a server that doesn't round-trip
 * the members array. Picks canonical casing as the first-seen non-empty
 * variant (sorted by frequency, ties broken by first appearance).
 */
export function rebuildMembersFromTasks(project) {
  if (!project) return;
  const counts = new Map();
  const firstSeen = new Map();
  let order = 0;
  const visit = (name) => {
    const trimmed = String(name == null ? '' : name).trim();
    if (!trimmed) return;
    const key = foldKey(trimmed);
    counts.set(key, (counts.get(key) || 0) + 1);
    if (!firstSeen.has(key)) firstSeen.set(key, { name: trimmed, order: order++ });
  };
  for (const task of (project.tasks || [])) {
    const arr = Array.isArray(task.assigned) ? task.assigned : (task.assigned ? [task.assigned] : []);
    for (const n of arr) visit(n);
  }
  // Existing members preserved (their casing wins as canonical), order maintained.
  const existing = Array.isArray(project.members) ? project.members : [];
  const existingByKey = new Map(existing.map(m => [foldKey(m.name), m]));
  const members = [];
  // Existing first, in current order
  for (const m of existing) {
    const key = foldKey(m.name);
    if (counts.has(key) || true) members.push(m); // keep all existing entries
  }
  // Add any names found in tasks that aren't yet in members
  const sortedKeys = [...counts.keys()].sort((a, b) => firstSeen.get(a).order - firstSeen.get(b).order);
  for (const key of sortedKeys) {
    if (existingByKey.has(key)) continue;
    members.push({ name: firstSeen.get(key).name });
  }
  project.members = members;
}

/**
 * One-shot: build the members roster from tasks, then rewrite every task's
 * assigned array to canonical casing. Use after bulk-loading tasks (CSV
 * import, template instantiation, server pull).
 */
export function canonicaliseProject(project) {
  rebuildMembersFromTasks(project);
  recanonicaliseTaskAssignments(project);
}

/**
 * Walk every task on the project (live + bin entries provided) and rewrite
 * `task.assigned` to use canonical casing. Mutates in place. Returns the
 * count of modified tasks for logging.
 */
export function recanonicaliseTaskAssignments(project, extraTaskLists = []) {
  if (!project) return 0;
  let changed = 0;
  const lists = [project.tasks || [], ...extraTaskLists];
  for (const list of lists) {
    for (const task of list) {
      if (!task) continue;
      const arr = Array.isArray(task.assigned) ? task.assigned : (task.assigned ? [task.assigned] : []);
      const next = canonicaliseAssigned(project, arr, { mutate: false });
      const before = JSON.stringify(arr);
      const after = JSON.stringify(next);
      if (before !== after) {
        task.assigned = next;
        changed++;
      }
    }
  }
  return changed;
}
