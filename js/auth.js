/**
 * Auth module — email/password auth against qp-api Worker.
 * Stores JWT in localStorage. Exports reactive auth state.
 */

const API_BASE = 'https://qp-api.davegregurke.workers.dev';
const TOKEN_KEY = 'qp-auth-token';
const USER_KEY = 'qp-auth-user';
const SANDBOX_KEY = 'qp-sandbox';

// ── State ───────────────────────────────────────────────────────────────────

let _token = localStorage.getItem(TOKEN_KEY) || null;
let _user = null;
try { _user = JSON.parse(localStorage.getItem(USER_KEY)); } catch { _user = null; }
let _sandbox = localStorage.getItem(SANDBOX_KEY) === '1';

export function getToken() { return _token; }
export function getUser() { return _user; }
export function isLoggedIn() { return !!_token || _sandbox; }
export function isSandbox() { return _sandbox; }

function setAuth(token, user) {
  _token = token;
  _user = user;
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  } else {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  }
}

export function logout() {
  setAuth(null, null);
  _sandbox = false;
  localStorage.removeItem(SANDBOX_KEY);
}

// ── API calls ───────────────────────────────────────────────────────────────

async function apiCall(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  if (_token) headers['Authorization'] = `Bearer ${_token}`;
  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export async function signup(email, password, name) {
  const data = await apiCall('/auth/signup', {
    method: 'POST',
    body: JSON.stringify({ email, password, name }),
  });
  setAuth(data.token, data.user);
  return data.user;
}

let _weakPassword = false;
export function hasWeakPassword() { return _weakPassword; }

export async function login(email, password) {
  const data = await apiCall('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  setAuth(data.token, data.user);
  _weakPassword = !validatePasswordStrength(password).valid;
  return data.user;
}

export function loginSandbox() {
  _sandbox = true;
  localStorage.setItem(SANDBOX_KEY, '1');
  _user = { email: 'sandbox', name: 'Sandbox' };
  localStorage.setItem(USER_KEY, JSON.stringify(_user));
  return _user;
}

export async function verifySession() {
  if (!_token) return false;
  try {
    const user = await apiCall('/auth/me');
    _user = user;
    localStorage.setItem(USER_KEY, JSON.stringify(user));
    return true;
  } catch {
    // Token expired or invalid
    setAuth(null, null);
    return false;
  }
}

// ── Sync API ────────────────────────────────────────────────────────────────

export async function pushAllData(projects) {
  return apiCall('/sync', {
    method: 'POST',
    body: JSON.stringify({ projects }),
  });
}

export async function pullAllData() {
  return apiCall('/sync');
}

// ── Account changes ─────────────────────────────────────────────────────────

export async function requestEmailChange(newEmail) {
  return apiCall('/auth/change-email', {
    method: 'POST',
    body: JSON.stringify({ newEmail }),
  });
}

export async function requestPasswordChange(currentPassword, newPassword) {
  return apiCall('/auth/change-password', {
    method: 'POST',
    body: JSON.stringify({ currentPassword, newPassword }),
  });
}

export async function verifyToken(token, type) {
  return apiCall('/auth/verify', {
    method: 'POST',
    body: JSON.stringify({ token, type }),
  });
}

export function validatePasswordStrength(password) {
  const checks = [
    { met: password.length >= 15, label: 'At least 15 characters' },
    { met: /[A-Z]/.test(password), label: '1 uppercase letter' },
    { met: /[a-z]/.test(password), label: '1 lowercase letter' },
    { met: /[0-9]/.test(password), label: '1 number' },
    { met: /[^A-Za-z0-9]/.test(password), label: '1 special character' },
  ];
  return { valid: checks.every(c => c.met), checks };
}

// ── Auth modal UI ───────────────────────────────────────────────────────────

let _onAuthSuccess = null;

export function showAuthModal(onSuccess, { gate = false } = {}) {
  _onAuthSuccess = onSuccess;
  const overlay = document.getElementById('auth-overlay');
  if (!overlay) return;
  overlay.classList.remove('hidden');
  // In gate mode, hide close/skip — user must log in
  const closeBtn = document.getElementById('auth-close');
  const skipBtn = document.getElementById('auth-skip');
  if (closeBtn) closeBtn.style.display = gate ? 'none' : '';
  if (skipBtn) skipBtn.style.display = gate ? 'none' : '';
  overlay.querySelector('#auth-email').focus();
  // Default to login mode
  setAuthMode('login');
}

export function hideAuthModal() {
  const overlay = document.getElementById('auth-overlay');
  if (overlay) overlay.classList.add('hidden');
  const errEl = document.getElementById('auth-error');
  if (errEl) { errEl.textContent = ''; errEl.classList.add('hidden'); }
}

let _currentMode = 'login';

function setAuthMode(mode) {
  _currentMode = mode;
  const title = document.getElementById('auth-title');
  const submitBtn = document.getElementById('auth-submit');
  const toggleBtn = document.getElementById('auth-toggle-btn');
  const nameField = document.getElementById('auth-name-field');
  const strengthEl = document.getElementById('auth-password-strength');
  const pwInput = document.getElementById('auth-password');
  if (mode === 'signup') {
    title.textContent = 'Create account';
    submitBtn.textContent = 'Sign up';
    toggleBtn.textContent = 'Back to log in';
    nameField.classList.remove('hidden');
    if (pwInput) { pwInput.placeholder = 'Min 15 characters'; pwInput.minLength = 15; }
  } else {
    title.textContent = 'Welcome back';
    submitBtn.textContent = 'Log in';
    toggleBtn.textContent = 'Create account';
    nameField.classList.add('hidden');
    if (strengthEl) strengthEl.classList.add('hidden');
    if (pwInput) { pwInput.placeholder = 'Password'; pwInput.minLength = 1; }
  }
}

export function renderPasswordStrength(password, container) {
  if (!password) { container.classList.add('hidden'); return; }
  container.classList.remove('hidden');
  const { checks } = validatePasswordStrength(password);
  const metCount = checks.filter(c => c.met).length;
  const pct = (metCount / checks.length) * 100;
  const colours = ['#ef4444', '#ef4444', '#f59e0b', '#f59e0b', '#22c55e', '#16a34a'];
  const fill = container.querySelector('.password-strength-fill');
  const list = container.querySelector('.password-strength-checks');
  if (fill) {
    fill.style.width = pct + '%';
    fill.style.backgroundColor = colours[metCount];
  }
  if (list) {
    list.innerHTML = checks.map(c =>
      `<li class="${c.met ? 'met' : ''}">${c.label}</li>`
    ).join('');
  }
}

export function initAuthUI() {
  const form = document.getElementById('auth-form');
  if (!form) return;

  // Toggle between login/signup
  const toggleBtn = document.getElementById('auth-toggle-btn');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      setAuthMode(_currentMode === 'login' ? 'signup' : 'login');
    });
  }

  // Password strength indicator for signup mode
  const authPwInput = document.getElementById('auth-password');
  const authStrength = document.getElementById('auth-password-strength');
  if (authPwInput && authStrength) {
    authPwInput.addEventListener('input', () => {
      if (_currentMode !== 'signup') { authStrength.classList.add('hidden'); return; }
      renderPasswordStrength(authPwInput.value, authStrength);
    });
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('auth-email').value.trim();
    const password = document.getElementById('auth-password').value;
    const name = document.getElementById('auth-name').value.trim();
    const errEl = document.getElementById('auth-error');
    const submitBtn = document.getElementById('auth-submit');
    const isSignup = _currentMode === 'signup';

    errEl.textContent = '';
    errEl.classList.add('hidden');
    submitBtn.disabled = true;
    submitBtn.textContent = isSignup ? 'Creating...' : 'Logging in...';

    try {
      if (email.toLowerCase() === 'sandbox') {
        loginSandbox();
      } else if (isSignup) {
        const { valid, checks } = validatePasswordStrength(password);
        if (!valid) {
          const failed = checks.filter(c => !c.met).map(c => c.label);
          throw new Error('Password needs: ' + failed.join(', '));
        }
        await signup(email, password, name);
      } else {
        await login(email, password);
      }
      hideAuthModal();
      if (_onAuthSuccess) _onAuthSuccess();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove('hidden');
      submitBtn.textContent = isSignup ? 'Sign up' : 'Log in';
    } finally {
      submitBtn.disabled = false;
    }
  });

  // Close button
  const closeBtn = document.getElementById('auth-close');
  if (closeBtn) closeBtn.addEventListener('click', hideAuthModal);

  // Skip button (use app without account)
  const skipBtn = document.getElementById('auth-skip');
  if (skipBtn) skipBtn.addEventListener('click', hideAuthModal);
}
