/**
 * Quick Planner API Worker
 * Auth (email/password + JWT) and CRUD for projects/tasks.
 * Bound to D1 database via wrangler.toml.
 */

// ── Helpers ─────────────────────────────────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const JWT_EXPIRY_SECONDS = 7 * 24 * 3600; // 7 days

function corsOrigin(request) {
  const origin = request.headers.get('Origin') || '';
  const allowed = [
    'https://planner.davegregurke.au',
    'https://quick-planner.pages.dev',
  ];
  // Allow localhost only in dev (non-workers.dev requests won't hit this in prod)
  if (origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:')) {
    return origin;
  }
  if (allowed.includes(origin)) return origin;
  return allowed[0];
}

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      ...extraHeaders,
    },
  });
}

function err(message, status = 400) {
  return json({ error: message }, status);
}

// ── Rate limiting (in-memory per isolate, best-effort) ──────────────────────

const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT_MAX = 10; // max attempts per window per IP

function isRateLimited(ip) {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now - entry.start > RATE_LIMIT_WINDOW_MS) {
    rateLimitMap.set(ip, { start: now, count: 1 });
    return false;
  }
  entry.count++;
  if (entry.count > RATE_LIMIT_MAX) return true;
  return false;
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
  // Constant-time comparison to prevent timing attacks
  if (hash.length !== expectedHash.length) return false;
  let diff = 0;
  for (let i = 0; i < hash.length; i++) {
    diff |= hash.charCodeAt(i) ^ expectedHash.charCodeAt(i);
  }
  return diff === 0;
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

// ── Password policy ─────────────────────────────────────────────────────────

function validatePasswordPolicy(password) {
  const errors = [];
  if (password.length < 15) errors.push('At least 15 characters');
  if (!/[A-Z]/.test(password)) errors.push('At least 1 uppercase letter');
  if (!/[a-z]/.test(password)) errors.push('At least 1 lowercase letter');
  if (!/[0-9]/.test(password)) errors.push('At least 1 number');
  if (!/[^A-Za-z0-9]/.test(password)) errors.push('At least 1 special character');
  return { valid: errors.length === 0, errors };
}

// ── Verification tokens ─────────────────────────────────────────────────────

function generateToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

async function hashToken(token) {
  const enc = new TextEncoder();
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(token));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}

// ── Email sending (Resend) ──────────────────────────────────────────────────

async function sendEmail(env, to, subject, html) {
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: env.EMAIL_FROM || 'Quick Planner <noreply@davegregurke.au>',
        to: [to],
        subject,
        html,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function verifyEmailHtml(headline, body, ctaUrl, ctaLabel) {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 20px;">
<tr><td align="center">
<table width="480" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;padding:40px;box-shadow:0 2px 8px rgba(0,0,0,0.06);">
<tr><td>
<h1 style="margin:0 0 8px;font-size:20px;color:#1a1a2e;">${headline}</h1>
<p style="margin:0 0 24px;font-size:14px;color:#6b7280;line-height:1.5;">${body}</p>
<a href="${ctaUrl}" style="display:inline-block;padding:12px 32px;background:#00E3FF;color:#1a1a2e;font-weight:600;font-size:14px;text-decoration:none;border-radius:8px;">${ctaLabel}</a>
<p style="margin:24px 0 0;font-size:12px;color:#9ca3af;line-height:1.5;">This link expires in 15 minutes.<br>If you didn't request this, you can safely ignore this email.</p>
</td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}

// ── Routes ──────────────────────────────────────────────────────────────────

async function handleSignup(request, env) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (isRateLimited(ip)) return err('Too many requests. Try again later.', 429);

  const { email, password, name } = await request.json();
  if (!email || !password) return err('Email and password required');
  if (!EMAIL_RE.test(email)) return err('Invalid email format');
  const policy = validatePasswordPolicy(password);
  if (!policy.valid) return err(policy.errors.join('. '));
  if (name && name.length > 100) return err('Name too long');

  const normalEmail = email.toLowerCase().trim();
  const existing = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(normalEmail).first();
  // Generic error to prevent email enumeration
  if (existing) return err('Unable to create account. Try logging in instead.', 409);

  const id = crypto.randomUUID();
  const passwordHash = await hashPassword(password);
  await env.DB.prepare('INSERT INTO users (id, email, password_hash, name) VALUES (?, ?, ?, ?)')
    .bind(id, normalEmail, passwordHash, (name || '').slice(0, 100))
    .run();

  const token = await signJWT({ sub: id, email: normalEmail, exp: Math.floor(Date.now() / 1000) + JWT_EXPIRY_SECONDS }, env.JWT_SECRET);
  return json({ token, user: { id, email: normalEmail, name: name || '' } }, 201);
}

async function handleLogin(request, env) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (isRateLimited(ip)) return err('Too many requests. Try again later.', 429);

  const { email, password } = await request.json();
  if (!email || !password) return err('Email and password required');

  const user = await env.DB.prepare('SELECT id, email, password_hash, name FROM users WHERE email = ?')
    .bind(email.toLowerCase().trim()).first();
  if (!user) return err('Invalid email or password', 401);

  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) return err('Invalid email or password', 401);

  const token = await signJWT({ sub: user.id, email: user.email, exp: Math.floor(Date.now() / 1000) + JWT_EXPIRY_SECONDS }, env.JWT_SECRET);
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
    .bind(projectId, user.sub, name.slice(0, 200), type || 'local').run();
  return json({ id: projectId, name, type: type || 'local' }, 201);
}

async function handleUpdateProject(request, user, env, projectId) {
  const { name, type } = await request.json();
  const existing = await env.DB.prepare('SELECT id FROM projects WHERE id = ? AND user_id = ?')
    .bind(projectId, user.sub).first();
  if (!existing) return err('Project not found', 404);
  await env.DB.prepare("UPDATE projects SET name = COALESCE(?, name), type = COALESCE(?, type), updated_at = datetime('now') WHERE id = ?")
    .bind(name ? name.slice(0, 200) : null, type || null, projectId).run();
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
  const tasks = results.map(t => ({
    ...t,
    assigned: JSON.parse(t.assigned || '[]'),
    dependencies: JSON.parse(t.dependencies || '[]'),
  }));
  return json(tasks);
}

async function handleSyncTasks(request, user, env, projectId) {
  const project = await env.DB.prepare('SELECT id FROM projects WHERE id = ? AND user_id = ?')
    .bind(projectId, user.sub).first();
  if (!project) return err('Project not found', 404);

  const { tasks } = await request.json();
  if (!Array.isArray(tasks)) return err('tasks array required');

  const stmts = [];
  const taskIds = tasks.map(t => t.id).filter(Boolean);
  if (taskIds.length > 0) {
    const placeholders = taskIds.map(() => '?').join(',');
    stmts.push(env.DB.prepare(`DELETE FROM tasks WHERE project_id = ? AND id NOT IN (${placeholders})`)
      .bind(projectId, ...taskIds));
  } else {
    stmts.push(env.DB.prepare('DELETE FROM tasks WHERE project_id = ?').bind(projectId));
  }

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
      (t.task || '').slice(0, 500), t.status || 'Not Started', (t.category || '').slice(0, 100), (t.room || '').slice(0, 100),
      JSON.stringify(t.assigned || []),
      t.start_date || t.startDate || null,
      t.end_date || t.endDate || null,
      JSON.stringify(t.dependencies || []),
      (t.notes || '').slice(0, 2000)
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

  // Delete server projects not present in the payload (handles client-side deletes)
  const pushIds = projects.map(p => p.id).filter(Boolean);
  if (pushIds.length > 0) {
    const ph = pushIds.map(() => '?').join(',');
    stmts.push(env.DB.prepare(`DELETE FROM tasks WHERE user_id = ? AND project_id NOT IN (${ph})`).bind(user.sub, ...pushIds));
    stmts.push(env.DB.prepare(`DELETE FROM projects WHERE user_id = ? AND id NOT IN (${ph})`).bind(user.sub, ...pushIds));
  } else {
    // Client has no projects — wipe all server data for this user
    stmts.push(env.DB.prepare('DELETE FROM tasks WHERE user_id = ?').bind(user.sub));
    stmts.push(env.DB.prepare('DELETE FROM projects WHERE user_id = ?').bind(user.sub));
  }

  for (const p of projects) {
    const projectId = p.id || crypto.randomUUID();
    stmts.push(env.DB.prepare(
      `INSERT INTO projects (id, user_id, name, type, updated_at)
       VALUES (?, ?, ?, ?, datetime('now'))
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, type = excluded.type, updated_at = datetime('now')`
    ).bind(projectId, user.sub, (p.name || 'Untitled').slice(0, 200), p.type || 'local'));

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
          (t.task || '').slice(0, 500), t.status || 'Not Started', (t.category || '').slice(0, 100), (t.room || '').slice(0, 100),
          JSON.stringify(t.assigned || []),
          t.start_date || t.startDate || null,
          t.end_date || t.endDate || null,
          JSON.stringify(t.dependencies || []),
          (t.notes || '').slice(0, 2000)
        ));
      }
    }
  }

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

// ── Change email / password ──────────────────────────────────────────────────

async function handleChangeEmail(request, user, env) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (isRateLimited(ip)) return err('Too many requests. Try again later.', 429);

  const { newEmail } = await request.json();
  if (!newEmail) return err('New email required');
  if (!EMAIL_RE.test(newEmail)) return err('Invalid email format');

  const normalEmail = newEmail.toLowerCase().trim();
  const u = await env.DB.prepare('SELECT email FROM users WHERE id = ?').bind(user.sub).first();
  if (normalEmail === u?.email) return err('New email must be different from current email');

  const taken = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(normalEmail).first();
  if (taken) return err('Unable to use this email');

  // Invalidate any pending email change tokens for this user
  await env.DB.prepare("UPDATE verification_tokens SET used_at = datetime('now') WHERE user_id = ? AND type = 'email_change' AND used_at IS NULL")
    .bind(user.sub).run();

  const rawToken = generateToken();
  const tokenHash = await hashToken(rawToken);
  const id = crypto.randomUUID();
  const appUrl = env.APP_URL || 'https://planner.davegregurke.au';
  const verifyUrl = `${appUrl.replace(/\/$/, '')}/?verify_token=${rawToken}&verify_type=email_change`;

  await env.DB.prepare(
    "INSERT INTO verification_tokens (id, user_id, token_hash, type, payload, expires_at) VALUES (?, ?, ?, 'email_change', ?, datetime('now', '+15 minutes'))"
  ).bind(id, user.sub, tokenHash, JSON.stringify({ newEmail: normalEmail })).run();

  const sent = await sendEmail(
    env, normalEmail,
    'Confirm your new email address',
    verifyEmailHtml(
      'Confirm your new email',
      'You requested to change your Quick Planner email address. Click below to confirm this change.',
      verifyUrl, 'Confirm email change'
    )
  );

  if (!sent) return err('Failed to send verification email. Please try again.', 500);
  return json({ ok: true, message: 'Verification email sent to your new address. Check your inbox.' });
}

async function handleChangePassword(request, user, env) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (isRateLimited(ip)) return err('Too many requests. Try again later.', 429);

  const { currentPassword, newPassword } = await request.json();
  if (!currentPassword || !newPassword) return err('Current and new password required');

  const u = await env.DB.prepare('SELECT password_hash, email FROM users WHERE id = ?').bind(user.sub).first();
  if (!u) return err('User not found', 404);

  const valid = await verifyPassword(currentPassword, u.password_hash);
  if (!valid) return err('Current password is incorrect', 401);

  const policy = validatePasswordPolicy(newPassword);
  if (!policy.valid) return err(policy.errors.join('. '));

  // Invalidate any pending password change tokens for this user
  await env.DB.prepare("UPDATE verification_tokens SET used_at = datetime('now') WHERE user_id = ? AND type = 'password_change' AND used_at IS NULL")
    .bind(user.sub).run();

  const newPasswordHash = await hashPassword(newPassword);
  const rawToken = generateToken();
  const tokenHash = await hashToken(rawToken);
  const id = crypto.randomUUID();
  const appUrl = env.APP_URL || 'https://planner.davegregurke.au';
  const verifyUrl = `${appUrl.replace(/\/$/, '')}/?verify_token=${rawToken}&verify_type=password_change`;

  await env.DB.prepare(
    "INSERT INTO verification_tokens (id, user_id, token_hash, type, payload, expires_at) VALUES (?, ?, ?, 'password_change', ?, datetime('now', '+15 minutes'))"
  ).bind(id, user.sub, tokenHash, JSON.stringify({ newPasswordHash })).run();

  const sent = await sendEmail(
    env, u.email,
    'Confirm your password change',
    verifyEmailHtml(
      'Confirm your password change',
      'You requested to change your Quick Planner password. Click below to confirm this change.',
      verifyUrl, 'Confirm password change'
    )
  );

  if (!sent) return err('Failed to send verification email. Please try again.', 500);
  return json({ ok: true, message: 'Verification email sent. Check your inbox to confirm.' });
}

async function handleVerifyToken(request, env) {
  const url = new URL(request.url);
  const rawToken = url.searchParams.get('token');
  const type = url.searchParams.get('type');
  const appUrl = env.APP_URL || 'https://planner.davegregurke.au';

  if (!rawToken || !type) return json({ error: 'invalid', verified: false }, 400);

  const tokenHash = await hashToken(rawToken);
  const row = await env.DB.prepare(
    'SELECT * FROM verification_tokens WHERE token_hash = ? AND type = ? AND used_at IS NULL'
  ).bind(tokenHash, type).first();

  if (!row) return json({ error: 'invalid', verified: false }, 400);

  // Check expiry
  const expiresAt = new Date(row.expires_at + 'Z').getTime();
  if (Date.now() > expiresAt) return json({ error: 'expired', verified: false }, 400);

  const payload = JSON.parse(row.payload);

  if (type === 'email_change') {
    // Re-check email uniqueness (race condition guard)
    const taken = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(payload.newEmail).first();
    if (taken) {
      await env.DB.prepare("UPDATE verification_tokens SET used_at = datetime('now') WHERE id = ?").bind(row.id).run();
      return json({ error: 'email_taken', verified: false }, 409);
    }
    await env.DB.prepare('UPDATE users SET email = ? WHERE id = ?').bind(payload.newEmail, row.user_id).run();
  } else if (type === 'password_change') {
    await env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(payload.newPasswordHash, row.user_id).run();
  }

  // Mark token as used
  await env.DB.prepare("UPDATE verification_tokens SET used_at = datetime('now') WHERE id = ?").bind(row.id).run();

  // Cleanup expired tokens (best-effort)
  await env.DB.prepare("DELETE FROM verification_tokens WHERE expires_at < datetime('now', '-1 day')").run();

  return json({ verified: true, type });
}

// ── Router ──────────────────────────────────────────────────────────────────

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    const origin = corsOrigin(request);

    const corsHeaders = {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    // CORS preflight
    if (method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // Wrap response with CORS + security headers
    const respond = (response) => {
      const headers = new Headers(response.headers);
      for (const [k, v] of Object.entries(corsHeaders)) headers.set(k, v);
      headers.set('X-Content-Type-Options', 'nosniff');
      headers.set('X-Frame-Options', 'DENY');
      headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
      return new Response(response.body, { status: response.status, headers });
    };

    // Health check
    if (path === '/' || path === '/health') {
      return respond(json({ status: 'ok', service: 'qp-api' }));
    }

    // Auth routes (no token needed)
    if (path === '/auth/signup' && method === 'POST') return respond(await handleSignup(request, env));
    if (path === '/auth/login' && method === 'POST') return respond(await handleLogin(request, env));
    if (path === '/auth/verify' && method === 'POST') return respond(await handleVerifyToken(request, env));

    // All other routes require auth
    const user = await authenticate(request, env);
    if (!user) return respond(err('Unauthorised', 401));

    // User info
    if (path === '/auth/me' && method === 'GET') {
      const u = await env.DB.prepare('SELECT id, email, name FROM users WHERE id = ?').bind(user.sub).first();
      return respond(u ? json(u) : err('User not found', 404));
    }

    // Account changes
    if (path === '/auth/change-email' && method === 'POST') return respond(await handleChangeEmail(request, user, env));
    if (path === '/auth/change-password' && method === 'POST') return respond(await handleChangePassword(request, user, env));

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
