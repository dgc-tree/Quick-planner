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

function validatePasswordLength(password) {
  if (password.length < 15) return { valid: false, error: 'Password must be at least 15 characters' };
  return { valid: true };
}

async function isPasswordBreached(password) {
  try {
    const enc = new TextEncoder();
    const hashBuffer = await crypto.subtle.digest('SHA-1', enc.encode(password));
    const hashHex = Array.from(new Uint8Array(hashBuffer), b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
    const prefix = hashHex.slice(0, 5);
    const suffix = hashHex.slice(5);
    const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      headers: { 'Add-Padding': 'true' },
    });
    if (!res.ok) return false; // fail open — don't block user if API is down
    const text = await res.text();
    return text.split('\n').some(line => line.startsWith(suffix));
  } catch {
    return false; // fail open
  }
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

// ── Invite auto-accept ──────────────────────────────────────────────────────

const INVITE_EXPIRY_DAYS = 7;

/**
 * Auto-accept any pending invites for this email.
 * Called after signup and login. Adds user to project_members, marks invite accepted.
 * Returns array of accepted project IDs.
 */
async function autoAcceptInvites(userId, email, env) {
  const { results: invites } = await env.DB.prepare(
    `SELECT id, project_id, role, created_at FROM project_invites
     WHERE email = ? AND accepted_at IS NULL AND revoked_at IS NULL`
  ).bind(email).all();

  const accepted = [];
  const now = new Date();

  for (const inv of invites) {
    // Check expiry
    const created = new Date(inv.created_at);
    const ageMs = now - created;
    if (ageMs > INVITE_EXPIRY_DAYS * 24 * 3600 * 1000) {
      // Mark expired invites as revoked so they don't show in the UI
      await env.DB.prepare(
        "UPDATE project_invites SET revoked_at = datetime('now') WHERE id = ?"
      ).bind(inv.id).run();
      continue;
    }

    // Check not already a member
    const existing = await env.DB.prepare(
      'SELECT id FROM project_members WHERE project_id = ? AND user_id = ?'
    ).bind(inv.project_id, userId).first();
    if (existing) {
      // Already a member, just mark invite accepted
      await env.DB.prepare(
        "UPDATE project_invites SET accepted_at = datetime('now') WHERE id = ?"
      ).bind(inv.id).run();
      continue;
    }

    // Add to project_members
    const memberId = crypto.randomUUID();
    await env.DB.prepare(
      'INSERT INTO project_members (id, project_id, user_id, role) VALUES (?, ?, ?, ?)'
    ).bind(memberId, inv.project_id, userId, inv.role).run();

    // Mark invite accepted
    await env.DB.prepare(
      "UPDATE project_invites SET accepted_at = datetime('now') WHERE id = ?"
    ).bind(inv.id).run();

    accepted.push(inv.project_id);
  }

  return accepted;
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
  const lenCheck = validatePasswordLength(password);
  if (!lenCheck.valid) return err(lenCheck.error);
  if (await isPasswordBreached(password)) return err('This password has appeared in a data breach. Please choose a different one.');
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

  // Auto-accept any pending invites for this email
  const acceptedProjects = await autoAcceptInvites(id, normalEmail, env);

  const token = await signJWT({ sub: id, email: normalEmail, exp: Math.floor(Date.now() / 1000) + JWT_EXPIRY_SECONDS }, env.JWT_SECRET);
  return json({ token, user: { id, email: normalEmail, name: name || '' }, acceptedProjects }, 201);
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

  // Auto-accept any pending invites for this email
  const acceptedProjects = await autoAcceptInvites(user.id, user.email, env);

  const token = await signJWT({ sub: user.id, email: user.email, exp: Math.floor(Date.now() / 1000) + JWT_EXPIRY_SECONDS }, env.JWT_SECRET);
  return json({ token, user: { id: user.id, email: user.email, name: user.name }, acceptedProjects });
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

  // Upsert only — do NOT delete server projects missing from the payload.
  // Project deletion is handled by DELETE /projects/:id to avoid wiping
  // server data the client doesn't know about (e.g. data from other devices).

  for (const p of projects) {
    const projectId = p.id || crypto.randomUUID();
    stmts.push(env.DB.prepare(
      `INSERT INTO projects (id, user_id, name, type, updated_at)
       VALUES (?, ?, ?, ?, datetime('now'))
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, type = excluded.type, updated_at = datetime('now')`
    ).bind(projectId, user.sub, (p.name || 'Untitled').slice(0, 200), p.type || 'local'));

    if (Array.isArray(p.tasks)) {
      // Remove tasks within this project that the client deleted
      const taskIds = p.tasks.map(t => t.id).filter(Boolean);
      if (taskIds.length > 0) {
        const ph = taskIds.map(() => '?').join(',');
        stmts.push(env.DB.prepare(`DELETE FROM tasks WHERE project_id = ? AND id NOT IN (${ph})`).bind(projectId, ...taskIds));
      } else {
        stmts.push(env.DB.prepare('DELETE FROM tasks WHERE project_id = ?').bind(projectId));
      }

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

  const lenCheck = validatePasswordLength(newPassword);
  if (!lenCheck.valid) return err(lenCheck.error);
  if (await isPasswordBreached(newPassword)) return err('This password has appeared in a data breach. Please choose a different one.');

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
  const { token: rawToken, type } = await request.json();

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

// ── Project Members & Invites ────────────────────────────────────────────

async function requireProjectAdmin(user, env, projectId) {
  // Owner (legacy: project.user_id) is always admin
  const project = await env.DB.prepare('SELECT user_id FROM projects WHERE id = ?').bind(projectId).first();
  if (!project) return { error: 'Project not found', status: 404 };
  if (project.user_id === user.sub) return { role: 'owner', project };

  const membership = await env.DB.prepare(
    'SELECT role FROM project_members WHERE project_id = ? AND user_id = ?'
  ).bind(projectId, user.sub).first();
  if (!membership) return { error: 'Not a member of this project', status: 403 };
  if (membership.role !== 'admin' && membership.role !== 'owner') {
    return { error: 'Admin access required', status: 403 };
  }
  return { role: membership.role, project };
}

async function handleListMembers(user, env, projectId) {
  const access = await requireProjectAdmin(user, env, projectId);
  if (access.error) return err(access.error, access.status);

  // Active members
  const { results: members } = await env.DB.prepare(`
    SELECT pm.id, pm.user_id, pm.role, pm.created_at,
           u.email, u.name
    FROM project_members pm
    JOIN users u ON u.id = pm.user_id
    WHERE pm.project_id = ?
    ORDER BY pm.created_at
  `).bind(projectId).all();

  // Include owner (from projects.user_id) if not already in members table
  const ownerInMembers = members.some(m => m.user_id === access.project.user_id);
  if (!ownerInMembers) {
    const owner = await env.DB.prepare('SELECT id, email, name FROM users WHERE id = ?')
      .bind(access.project.user_id).first();
    if (owner) {
      members.unshift({
        id: 'owner',
        user_id: owner.id,
        role: 'owner',
        email: owner.email,
        name: owner.name,
        created_at: null,
      });
    }
  }

  // Pending invites (exclude expired)
  const { results: invites } = await env.DB.prepare(`
    SELECT pi.id, pi.email, pi.role, pi.created_at, pi.invited_by,
           u.email AS invited_by_email
    FROM project_invites pi
    LEFT JOIN users u ON u.id = pi.invited_by
    WHERE pi.project_id = ? AND pi.accepted_at IS NULL AND pi.revoked_at IS NULL
      AND pi.created_at > datetime('now', '-${INVITE_EXPIRY_DAYS} days')
    ORDER BY pi.created_at
  `).bind(projectId).all();

  return json({ members, invites });
}

async function handleInviteMember(request, user, env, projectId) {
  const access = await requireProjectAdmin(user, env, projectId);
  if (access.error) return err(access.error, access.status);

  const { email, role } = await request.json();
  if (!email) return err('Email required');
  if (!EMAIL_RE.test(email)) return err('Invalid email format');
  const normalEmail = email.toLowerCase().trim();
  const validRoles = ['admin', 'member', 'viewer'];
  const assignRole = validRoles.includes(role) ? role : 'member';

  // Can't invite the owner
  const owner = await env.DB.prepare('SELECT email FROM users WHERE id = ?')
    .bind(access.project.user_id).first();
  if (owner && owner.email === normalEmail) return err('Cannot invite the project owner');

  // Check if already a member
  const existingUser = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(normalEmail).first();
  if (existingUser) {
    const existingMember = await env.DB.prepare(
      'SELECT id FROM project_members WHERE project_id = ? AND user_id = ?'
    ).bind(projectId, existingUser.id).first();
    if (existingMember) return err('Already a member of this project');
  }

  // Check for existing pending invite
  const existingInvite = await env.DB.prepare(
    'SELECT id FROM project_invites WHERE project_id = ? AND email = ? AND accepted_at IS NULL AND revoked_at IS NULL'
  ).bind(projectId, normalEmail).first();
  if (existingInvite) return err('Invitation already pending for this email');

  const id = crypto.randomUUID();
  await env.DB.prepare(
    'INSERT INTO project_invites (id, project_id, email, role, invited_by) VALUES (?, ?, ?, ?, ?)'
  ).bind(id, projectId, normalEmail, assignRole, user.sub).run();

  // Send invite email — link includes invite context for UX copy
  const project = await env.DB.prepare('SELECT name FROM projects WHERE id = ?').bind(projectId).first();
  const appUrl = env.APP_URL || 'https://planner.davegregurke.au';
  const inviteUrl = `${appUrl}?invite=${id}&project=${encodeURIComponent(project?.name || '')}`;
  // Check if user already has an account (for UX copy)
  const knownUser = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(normalEmail).first();
  const ctaLabel = knownUser ? 'Log in to join' : 'Create your account';
  await sendEmail(
    env, normalEmail,
    `You've been invited to "${project?.name || 'a project'}" on Quick Planner`,
    verifyEmailHtml(
      'You\'re invited!',
      `You've been invited to collaborate on <strong>${project?.name || 'a project'}</strong> as a <strong>${assignRole}</strong>. ${knownUser ? 'Log in' : 'Create an account'} to get started.`,
      inviteUrl, ctaLabel
    )
  );

  return json({ id, email: normalEmail, role: assignRole, created_at: new Date().toISOString() }, 201);
}

async function handleUpdateMemberRole(request, user, env, projectId, memberId) {
  const access = await requireProjectAdmin(user, env, projectId);
  if (access.error) return err(access.error, access.status);

  const { role } = await request.json();
  const validRoles = ['admin', 'member', 'viewer'];
  if (!validRoles.includes(role)) return err('Invalid role. Must be admin, member, or viewer.');

  // Cannot change owner role
  const member = await env.DB.prepare(
    'SELECT user_id, role FROM project_members WHERE id = ? AND project_id = ?'
  ).bind(memberId, projectId).first();
  if (!member) return err('Member not found', 404);
  if (member.user_id === access.project.user_id) return err('Cannot change the owner\'s role');

  await env.DB.prepare('UPDATE project_members SET role = ? WHERE id = ?').bind(role, memberId).run();
  return json({ ok: true, role });
}

async function handleRevokeMember(user, env, projectId, memberId) {
  const access = await requireProjectAdmin(user, env, projectId);
  if (access.error) return err(access.error, access.status);

  const member = await env.DB.prepare(
    'SELECT user_id FROM project_members WHERE id = ? AND project_id = ?'
  ).bind(memberId, projectId).first();
  if (!member) return err('Member not found', 404);
  if (member.user_id === access.project.user_id) return err('Cannot remove the project owner');

  await env.DB.prepare('DELETE FROM project_members WHERE id = ?').bind(memberId).run();
  return json({ ok: true });
}

async function handleRevokeInvite(user, env, projectId, inviteId) {
  const access = await requireProjectAdmin(user, env, projectId);
  if (access.error) return err(access.error, access.status);

  const invite = await env.DB.prepare(
    'SELECT id FROM project_invites WHERE id = ? AND project_id = ? AND accepted_at IS NULL AND revoked_at IS NULL'
  ).bind(inviteId, projectId).first();
  if (!invite) return err('Invite not found', 404);

  await env.DB.prepare("UPDATE project_invites SET revoked_at = datetime('now') WHERE id = ?").bind(inviteId).run();
  return json({ ok: true });
}

async function handleResendInvite(user, env, projectId, inviteId) {
  const access = await requireProjectAdmin(user, env, projectId);
  if (access.error) return err(access.error, access.status);

  const invite = await env.DB.prepare(
    'SELECT email, role FROM project_invites WHERE id = ? AND project_id = ? AND accepted_at IS NULL AND revoked_at IS NULL'
  ).bind(inviteId, projectId).first();
  if (!invite) return err('Invite not found', 404);

  const project = await env.DB.prepare('SELECT name FROM projects WHERE id = ?').bind(projectId).first();
  const appUrl = env.APP_URL || 'https://planner.davegregurke.au';
  const sent = await sendEmail(
    env, invite.email,
    `Reminder: You've been invited to "${project?.name || 'a project'}" on Quick Planner`,
    verifyEmailHtml(
      'You\'re invited!',
      `Reminder: You've been invited to collaborate on <strong>${project?.name || 'a project'}</strong> as a <strong>${invite.role}</strong>.`,
      appUrl, 'Open Quick Planner'
    )
  );

  if (!sent) return err('Failed to send email', 500);
  // Update created_at to reset staleness
  await env.DB.prepare("UPDATE project_invites SET created_at = datetime('now') WHERE id = ?").bind(inviteId).run();
  return json({ ok: true });
}

// ── Chat (proxied Claude) ────────────────────────────────────────────────────

const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';
const CLAUDE_HAIKU = 'claude-haiku-4-5-20251001';
const CHAT_RATE_LIMIT = 50; // max queries per day per user

// Simple daily rate limit using D1 (survives isolate restarts)
async function checkChatRateLimit(userId, env) {
  const todayStr = new Date().toISOString().split('T')[0];
  const row = await env.DB.prepare(
    'SELECT count FROM chat_usage WHERE user_id = ? AND date = ?'
  ).bind(userId, todayStr).first();
  const count = row?.count || 0;
  if (count >= CHAT_RATE_LIMIT) return { allowed: false, remaining: 0 };
  // Upsert usage
  await env.DB.prepare(
    `INSERT INTO chat_usage (user_id, date, count) VALUES (?, ?, 1)
     ON CONFLICT (user_id, date) DO UPDATE SET count = count + 1`
  ).bind(userId, todayStr).run();
  return { allowed: true, remaining: CHAT_RATE_LIMIT - count - 1 };
}

async function handleChat(request, user, env) {
  if (!user) return err('Unauthorised', 401);
  if (!env.ANTHROPIC_API_KEY) return err('AI not configured on server', 503);

  const body = await request.json().catch(() => null);
  if (!body?.message) return err('Missing message');
  if (body.message.length > 2000) return err('Message too long (max 2000 chars)');

  // Rate limit
  const limit = await checkChatRateLimit(user.sub, env);
  if (!limit.allowed) return err('Daily AI limit reached (50/day). Try again tomorrow.', 429);

  // Build messages array from history
  const messages = [];
  if (Array.isArray(body.history)) {
    for (const h of body.history.slice(-6)) {
      if (h.role === 'user' || h.role === 'assistant') {
        messages.push({ role: h.role, content: String(h.content).slice(0, 2000) });
      }
    }
  }
  messages.push({ role: 'user', content: body.message });

  try {
    const response = await fetch(CLAUDE_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: CLAUDE_HAIKU,
        max_tokens: 1024,
        system: body.systemPrompt || '',
        messages,
      }),
    });

    if (!response.ok) {
      const errBody = await response.json().catch(() => ({}));
      if (response.status === 429) return err('AI rate limited - try again shortly', 429);
      return err(errBody.error?.message || `AI error (${response.status})`, 502);
    }

    const data = await response.json();
    const text = data.content?.[0]?.text || '';
    return json({ text, remaining: limit.remaining });
  } catch (e) {
    return err('Failed to reach AI service', 502);
  }
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

    // Members
    const membersMatch = path.match(/^\/projects\/([^/]+)\/members$/);
    if (membersMatch) {
      const pid = membersMatch[1];
      if (method === 'GET') return respond(await handleListMembers(user, env, pid));
      if (method === 'POST') return respond(await handleInviteMember(request, user, env, pid));
    }

    const memberMatch = path.match(/^\/projects\/([^/]+)\/members\/([^/]+)$/);
    if (memberMatch) {
      const [, pid, mid] = memberMatch;
      if (method === 'PUT') return respond(await handleUpdateMemberRole(request, user, env, pid, mid));
      if (method === 'DELETE') return respond(await handleRevokeMember(user, env, pid, mid));
    }

    // Invites
    const inviteRevokeMatch = path.match(/^\/projects\/([^/]+)\/invites\/([^/]+)$/);
    if (inviteRevokeMatch) {
      const [, pid, iid] = inviteRevokeMatch;
      if (method === 'DELETE') return respond(await handleRevokeInvite(user, env, pid, iid));
    }

    const inviteResendMatch = path.match(/^\/projects\/([^/]+)\/invites\/([^/]+)\/resend$/);
    if (inviteResendMatch) {
      const [, pid, iid] = inviteResendMatch;
      if (method === 'POST') return respond(await handleResendInvite(user, env, pid, iid));
    }

    // Chat (proxied Claude)
    if (path === '/chat' && method === 'POST') return respond(await handleChat(request, user, env));

    return respond(err('Not found', 404));
  },
};
