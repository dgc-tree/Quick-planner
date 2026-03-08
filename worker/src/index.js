/**
 * Quick Planner API Worker
 * Auth (email/password + JWT) and CRUD for projects/tasks.
 * Bound to D1 database via wrangler.toml.
 */

// ── Helpers ─────────────────────────────────────────────────────────────────

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*', // tightened in production below
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function corsOrigin(request, env) {
  const origin = request.headers.get('Origin') || '';
  const allowed = [
    'https://planner.davegregurke.au',
    'https://quick-planner.pages.dev',
    'http://localhost:8080',
    'http://localhost:3000',
    'http://127.0.0.1:8080',
  ];
  if (allowed.includes(origin)) return origin;
  return allowed[0]; // default
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

function err(message, status = 400) {
  return json({ error: message }, status);
}

// ── Password hashing (PBKDF2) ──────────────────────────────────────────────

async function hashPassword(password) {
  const enc = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100000 },
    key, 256
  );
  const hash = btoa(String.fromCharCode(...new Uint8Array(bits)));
  const saltB64 = btoa(String.fromCharCode(...salt));
  return `${saltB64}:${hash}`;
}

async function verifyPassword(password, stored) {
  const [saltB64, expectedHash] = stored.split(':');
  const salt = Uint8Array.from(atob(saltB64), c => c.charCodeAt(0));
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100000 },
    key, 256
  );
  const hash = btoa(String.fromCharCode(...new Uint8Array(bits)));
  return hash === expectedHash;
}

// ── JWT (HMAC-SHA256 via Web Crypto) ────────────────────────────────────────

async function signJWT(payload, secret) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const enc = new TextEncoder();
  const b64url = (obj) => btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const segments = `${b64url(header)}.${b64url(payload)}`;
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(segments));
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${segments}.${sigB64}`;
}

async function verifyJWT(token, secret) {
  try {
    const [headerB64, payloadB64, sigB64] = token.split('.');
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    const sig = Uint8Array.from(atob(sigB64.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
    const valid = await crypto.subtle.verify('HMAC', key, sig, enc.encode(`${headerB64}.${payloadB64}`));
    if (!valid) return null;
    const payload = JSON.parse(atob(payloadB64.replace(/-/g, '+').replace(/_/g, '/')));
    if (payload.exp && Date.now() / 1000 > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

async function authenticate(request, env) {
  const auth = request.headers.get('Authorization') || '';
  if (!auth.startsWith('Bearer ')) return null;
  const token = auth.slice(7);
  return verifyJWT(token, env.JWT_SECRET);
}

// ── Routes ──────────────────────────────────────────────────────────────────

async function handleSignup(request, env) {
  const { email, password, name } = await request.json();
  if (!email || !password) return err('Email and password required');
  if (password.length < 8) return err('Password must be at least 8 characters');

  const existing = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email.toLowerCase().trim()).first();
  if (existing) return err('Email already registered', 409);

  const id = crypto.randomUUID();
  const passwordHash = await hashPassword(password);
  await env.DB.prepare('INSERT INTO users (id, email, password_hash, name) VALUES (?, ?, ?, ?)')
    .bind(id, email.toLowerCase().trim(), passwordHash, name || '')
    .run();

  const token = await signJWT({ sub: id, email: email.toLowerCase().trim(), exp: Math.floor(Date.now() / 1000) + 30 * 24 * 3600 }, env.JWT_SECRET);
  return json({ token, user: { id, email: email.toLowerCase().trim(), name: name || '' } }, 201);
}

async function handleLogin(request, env) {
  const { email, password } = await request.json();
  if (!email || !password) return err('Email and password required');

  const user = await env.DB.prepare('SELECT id, email, password_hash, name FROM users WHERE email = ?')
    .bind(email.toLowerCase().trim()).first();
  if (!user) return err('Invalid email or password', 401);

  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) return err('Invalid email or password', 401);

  const token = await signJWT({ sub: user.id, email: user.email, exp: Math.floor(Date.now() / 1000) + 30 * 24 * 3600 }, env.JWT_SECRET);
  return json({ token, user: { id: user.id, email: user.email, name: user.name } });
}

// ── Projects CRUD ───────────────────────────────────────────────────────────

async function handleGetProjects(user, env) {
  const { results } = await env.DB.prepare('SELECT * FROM projects WHERE user_id = ? ORDER BY created_at')
    .bind(user.sub).all();
  return json(results);
}

async function handleCreateProject(request, user, env) {
  const { id, name, type } = await request.json();
  if (!name) return err('Project name required');
  const projectId = id || crypto.randomUUID();
  await env.DB.prepare('INSERT INTO projects (id, user_id, name, type) VALUES (?, ?, ?, ?)')
    .bind(projectId, user.sub, name, type || 'local').run();
  return json({ id: projectId, name, type: type || 'local' }, 201);
}

async function handleUpdateProject(request, user, env, projectId) {
  const { name, type } = await request.json();
  const existing = await env.DB.prepare('SELECT id FROM projects WHERE id = ? AND user_id = ?')
    .bind(projectId, user.sub).first();
  if (!existing) return err('Project not found', 404);
  await env.DB.prepare("UPDATE projects SET name = COALESCE(?, name), type = COALESCE(?, type), updated_at = datetime('now') WHERE id = ?")
    .bind(name || null, type || null, projectId).run();
  return json({ ok: true });
}

async function handleDeleteProject(user, env, projectId) {
  const existing = await env.DB.prepare('SELECT id FROM projects WHERE id = ? AND user_id = ?')
    .bind(projectId, user.sub).first();
  if (!existing) return err('Project not found', 404);
  await env.DB.prepare('DELETE FROM tasks WHERE project_id = ?').bind(projectId).run();
  await env.DB.prepare('DELETE FROM projects WHERE id = ?').bind(projectId).run();
  return json({ ok: true });
}

// ── Tasks CRUD ──────────────────────────────────────────────────────────────

async function handleGetTasks(user, env, projectId) {
  const project = await env.DB.prepare('SELECT id FROM projects WHERE id = ? AND user_id = ?')
    .bind(projectId, user.sub).first();
  if (!project) return err('Project not found', 404);
  const { results } = await env.DB.prepare('SELECT * FROM tasks WHERE project_id = ? ORDER BY created_at')
    .bind(projectId).all();
  // Parse JSON fields
  const tasks = results.map(t => ({
    ...t,
    assigned: JSON.parse(t.assigned || '[]'),
    dependencies: JSON.parse(t.dependencies || '[]'),
  }));
  return json(tasks);
}

async function handleSyncTasks(request, user, env, projectId) {
  // Bulk upsert: client sends all tasks for a project
  const project = await env.DB.prepare('SELECT id FROM projects WHERE id = ? AND user_id = ?')
    .bind(projectId, user.sub).first();
  if (!project) return err('Project not found', 404);

  const { tasks } = await request.json();
  if (!Array.isArray(tasks)) return err('tasks array required');

  // Use a batch for efficiency
  const stmts = [];

  // Delete tasks that are no longer in the list
  const taskIds = tasks.map(t => t.id).filter(Boolean);
  if (taskIds.length > 0) {
    const placeholders = taskIds.map(() => '?').join(',');
    stmts.push(env.DB.prepare(`DELETE FROM tasks WHERE project_id = ? AND id NOT IN (${placeholders})`)
      .bind(projectId, ...taskIds));
  } else {
    stmts.push(env.DB.prepare('DELETE FROM tasks WHERE project_id = ?').bind(projectId));
  }

  // Upsert each task
  for (const t of tasks) {
    const id = t.id || crypto.randomUUID();
    stmts.push(env.DB.prepare(
      `INSERT INTO tasks (id, project_id, user_id, task, status, category, room, assigned, start_date, end_date, dependencies, notes, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(id) DO UPDATE SET
         task = excluded.task, status = excluded.status, category = excluded.category,
         room = excluded.room, assigned = excluded.assigned, start_date = excluded.start_date,
         end_date = excluded.end_date, dependencies = excluded.dependencies, notes = excluded.notes,
         updated_at = datetime('now')`
    ).bind(
      id, projectId, user.sub,
      t.task || '', t.status || 'Not Started', t.category || '', t.room || '',
      JSON.stringify(t.assigned || []),
      t.start_date || t.startDate || null,
      t.end_date || t.endDate || null,
      JSON.stringify(t.dependencies || []),
      t.notes || ''
    ));
  }

  await env.DB.batch(stmts);
  return json({ ok: true, count: tasks.length });
}

// ── Full sync (all projects + tasks in one call) ────────────────────────────

async function handleFullSync(request, user, env) {
  const { projects } = await request.json();
  if (!Array.isArray(projects)) return err('projects array required');

  const stmts = [];

  for (const p of projects) {
    const projectId = p.id || crypto.randomUUID();
    stmts.push(env.DB.prepare(
      `INSERT INTO projects (id, user_id, name, type, updated_at)
       VALUES (?, ?, ?, ?, datetime('now'))
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, type = excluded.type, updated_at = datetime('now')`
    ).bind(projectId, user.sub, p.name || 'Untitled', p.type || 'local'));

    if (Array.isArray(p.tasks)) {
      for (const t of p.tasks) {
        const taskId = t.id || crypto.randomUUID();
        stmts.push(env.DB.prepare(
          `INSERT INTO tasks (id, project_id, user_id, task, status, category, room, assigned, start_date, end_date, dependencies, notes, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
           ON CONFLICT(id) DO UPDATE SET
             task = excluded.task, status = excluded.status, category = excluded.category,
             room = excluded.room, assigned = excluded.assigned, start_date = excluded.start_date,
             end_date = excluded.end_date, dependencies = excluded.dependencies, notes = excluded.notes,
             updated_at = datetime('now')`
        ).bind(
          taskId, projectId, user.sub,
          t.task || '', t.status || 'Not Started', t.category || '', t.room || '',
          JSON.stringify(t.assigned || []),
          t.start_date || t.startDate || null,
          t.end_date || t.endDate || null,
          JSON.stringify(t.dependencies || []),
          t.notes || ''
        ));
      }
    }
  }

  // D1 batch limit is 100 statements; chunk if needed
  for (let i = 0; i < stmts.length; i += 100) {
    await env.DB.batch(stmts.slice(i, i + 100));
  }

  return json({ ok: true, projects: projects.length });
}

async function handleFullPull(user, env) {
  const { results: projects } = await env.DB.prepare('SELECT * FROM projects WHERE user_id = ? ORDER BY created_at')
    .bind(user.sub).all();
  const { results: tasks } = await env.DB.prepare('SELECT * FROM tasks WHERE user_id = ? ORDER BY created_at')
    .bind(user.sub).all();

  // Group tasks by project
  const tasksByProject = {};
  for (const t of tasks) {
    if (!tasksByProject[t.project_id]) tasksByProject[t.project_id] = [];
    tasksByProject[t.project_id].push({
      ...t,
      assigned: JSON.parse(t.assigned || '[]'),
      dependencies: JSON.parse(t.dependencies || '[]'),
    });
  }

  const result = projects.map(p => ({
    ...p,
    tasks: tasksByProject[p.id] || [],
  }));

  return json(result);
}

// ── Router ──────────────────────────────────────────────────────────────────

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // CORS preflight
    if (method === 'OPTIONS') {
      return new Response(null, {
        headers: { ...CORS_HEADERS, 'Access-Control-Allow-Origin': corsOrigin(request, env) },
      });
    }

    // Override CORS origin for all responses
    const respond = (response) => {
      const headers = new Headers(response.headers);
      headers.set('Access-Control-Allow-Origin', corsOrigin(request, env));
      return new Response(response.body, { status: response.status, headers });
    };

    // Health check
    if (path === '/' || path === '/health') {
      return respond(json({ status: 'ok', service: 'qp-api' }));
    }

    // Auth routes (no token needed)
    if (path === '/auth/signup' && method === 'POST') return respond(await handleSignup(request, env));
    if (path === '/auth/login' && method === 'POST') return respond(await handleLogin(request, env));

    // All other routes require auth
    const user = await authenticate(request, env);
    if (!user) return respond(err('Unauthorised', 401));

    // User info
    if (path === '/auth/me' && method === 'GET') {
      const u = await env.DB.prepare('SELECT id, email, name FROM users WHERE id = ?').bind(user.sub).first();
      return respond(u ? json(u) : err('User not found', 404));
    }

    // Full sync
    if (path === '/sync' && method === 'POST') return respond(await handleFullSync(request, user, env));
    if (path === '/sync' && method === 'GET') return respond(await handleFullPull(user, env));

    // Projects
    if (path === '/projects' && method === 'GET') return respond(await handleGetProjects(user, env));
    if (path === '/projects' && method === 'POST') return respond(await handleCreateProject(request, user, env));

    const projectMatch = path.match(/^\/projects\/([^/]+)$/);
    if (projectMatch) {
      const pid = projectMatch[1];
      if (method === 'PUT') return respond(await handleUpdateProject(request, user, env, pid));
      if (method === 'DELETE') return respond(await handleDeleteProject(user, env, pid));
    }

    // Tasks
    const tasksMatch = path.match(/^\/projects\/([^/]+)\/tasks$/);
    if (tasksMatch) {
      const pid = tasksMatch[1];
      if (method === 'GET') return respond(await handleGetTasks(user, env, pid));
      if (method === 'POST') return respond(await handleSyncTasks(request, user, env, pid));
    }

    return respond(err('Not found', 404));
  },
};
