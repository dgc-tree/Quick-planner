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
  _weakPassword = !validatePasswordLength(password);
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

export async function deleteProjectOnServer(projectId) {
  return apiCall(`/projects/${projectId}`, { method: 'DELETE' });
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

// ── Password strength (zxcvbn lazy-loaded) ──────────────────────────────────

let _zxcvbnLoading = null;
let _zxcvbn = null;
export function loadZxcvbn() {
  if (_zxcvbn) return Promise.resolve(_zxcvbn);
  if (window.zxcvbn) { _zxcvbn = window.zxcvbn; return Promise.resolve(_zxcvbn); }
  if (_zxcvbnLoading) return _zxcvbnLoading;
  _zxcvbnLoading = new Promise((resolve) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/zxcvbn@4.4.2/dist/zxcvbn.js';
    s.onload = () => { _zxcvbn = window.zxcvbn; resolve(_zxcvbn); };
    s.onerror = () => resolve(null);
    document.head.appendChild(s);
  });
  return _zxcvbnLoading;
}

export function validatePasswordLength(password) {
  return password.length >= 15;
}

export function getPasswordScore(password) {
  if (!password) return { score: 0, label: '', colour: '' };
  const zxcvbnFn = _zxcvbn || window.zxcvbn;
  if (zxcvbnFn) {
    const result = zxcvbnFn(password);
    const labels = ['Weak', 'Weak', 'Fair', 'Strong', 'Very strong'];
    const colours = ['#ef4444', '#ef4444', '#f59e0b', '#22c55e', '#16a34a'];
    return { score: result.score, label: labels[result.score], colour: colours[result.score] };
  }
  // Fallback if zxcvbn not loaded yet — simple length heuristic
  const len = password.length;
  if (len < 15) return { score: 0, label: 'Too short', colour: '#ef4444' };
  if (len < 20) return { score: 2, label: 'Fair', colour: '#f59e0b' };
  return { score: 3, label: 'Strong', colour: '#22c55e' };
}

export async function checkPasswordBreach(password) {
  try {
    const enc = new TextEncoder();
    const hashBuffer = await crypto.subtle.digest('SHA-1', enc.encode(password));
    const hashHex = Array.from(new Uint8Array(hashBuffer), b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
    const prefix = hashHex.slice(0, 5);
    const suffix = hashHex.slice(5);
    const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`);
    if (!res.ok) return false;
    const text = await res.text();
    return text.split('\n').some(line => line.startsWith(suffix));
  } catch {
    return false;
  }
}

// ── Auth modal UI ───────────────────────────────────────────────────────────

let _onAuthSuccess = null;

export function showAuthModal(onSuccess, { gate = false } = {}) {
  _onAuthSuccess = onSuccess;
  const overlay = document.getElementById('auth-overlay');
  if (!overlay) return;
  overlay.classList.remove('hidden');
  // Re-trigger entrance animation by removing and re-adding the class
  const page = overlay.querySelector('.landing-page');
  if (page) {
    page.classList.remove('landing-animate');
    requestAnimationFrame(() => page.classList.add('landing-animate'));
  }
  // In gate mode, hide close/skip — user must log in
  const closeBtn = document.getElementById('auth-close');
  const skipBtn = document.getElementById('auth-skip');
  if (closeBtn) closeBtn.style.display = gate ? 'none' : '';
  if (skipBtn) skipBtn.style.display = gate ? 'none' : '';
  // Don't auto-focus email — let the user see the landing page first.
  // On mobile this pulls up the keyboard immediately, hiding the mascot and context.
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
  const { score, label, colour } = getPasswordScore(password);
  const pct = Math.max(5, (score / 4) * 100);
  const fill = container.querySelector('.password-strength-fill');
  const labelEl = container.querySelector('.password-strength-label');
  if (fill) {
    fill.style.width = pct + '%';
    fill.style.backgroundColor = colour;
  }
  if (labelEl) {
    labelEl.textContent = label;
    labelEl.style.color = colour;
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

  // Password strength indicator for signup mode (lazy-load zxcvbn)
  const authPwInput = document.getElementById('auth-password');
  const authStrength = document.getElementById('auth-password-strength');
  if (authPwInput && authStrength) {
    authPwInput.addEventListener('focus', () => {
      loadZxcvbn().then(() => {
        if (authPwInput.value && _currentMode === 'signup') renderPasswordStrength(authPwInput.value, authStrength);
      });
    }, { once: true });
    authPwInput.addEventListener('input', () => {
      if (_currentMode !== 'signup') { authStrength.classList.add('hidden'); return; }
      renderPasswordStrength(authPwInput.value, authStrength);
      if (!_zxcvbn) loadZxcvbn().then(() => renderPasswordStrength(authPwInput.value, authStrength));
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
        if (!validatePasswordLength(password)) {
          throw new Error('Password must be at least 15 characters');
        }
        if (await checkPasswordBreach(password)) {
          throw new Error('This password has appeared in a data breach. Please choose a different one.');
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
