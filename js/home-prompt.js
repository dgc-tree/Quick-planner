/**
 * Home prompt - shown once per browser session on app load.
 *
 * Layout (3-card grid, matching the mockup proportions):
 *   Go to planner (primary dismiss) | Tell me tasks | Upload tasks
 *
 * "Tell me" expands a textarea below the cards for typing or pasting.
 * "Upload tasks" opens a .csv-only file picker - no textarea, no paste path.
 *
 * Upload security: .csv extension + 1 MB size cap validated client-side
 * before reading. FileReader.readAsText produces a plain string - no eval,
 * no innerHTML injection.
 *
 * callbacks: { onAddTasks(taskNames: string[]): void, onDismiss(): void }
 */

const SESSION_KEY = 'qp-home-prompt-shown';
const MAX_UPLOAD_BYTES = 1 * 1024 * 1024; // 1 MB

export function shouldShowHomePrompt() {
  return !sessionStorage.getItem(SESSION_KEY);
}

export function showHomePrompt(callbacks = {}) {
  sessionStorage.setItem(SESSION_KEY, '1');

  const { onAddTasks, onDismiss } = callbacks;

  const overlay = document.createElement('div');
  overlay.className = 'home-prompt-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'hp-title');

  overlay.innerHTML = `
    <div class="home-prompt-dialog">

      <div class="home-prompt-greeting">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
          <circle cx="12" cy="12" r="4"/>
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>
        </svg>
        <h2 class="home-prompt-title" id="hp-title">What's on today?</h2>
      </div>
      <p class="home-prompt-sub">Pick up where you left off, or add new tasks.</p>

      <div class="home-prompt-cards">

        <!-- Card 1: Go to planner - primary dismiss, accent-tinted -->
        <button class="home-prompt-card home-prompt-card--primary" id="hp-go" type="button">
          <span class="hp-card-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z"/>
            </svg>
          </span>
          <span class="hp-card-label">Go to planner</span>
          <span class="hp-card-desc">Pick up where you left off.</span>
          <span class="hp-card-cta">
            Open
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
          </span>
        </button>

        <!-- Card 2: Tell me new tasks - expands textarea -->
        <button class="home-prompt-card" id="hp-tell" type="button" aria-expanded="false" aria-controls="hp-tell-area">
          <span class="hp-card-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M12 18.5A6.5 6.5 0 0 1 5.5 12V7a6.5 6.5 0 0 1 13 0v5a6.5 6.5 0 0 1-6.5 6.5Z"/>
              <path d="M12 18.5v3M8 21.5h8"/>
            </svg>
          </span>
          <span class="hp-card-label">Tell me new tasks</span>
          <span class="hp-card-desc">Speak or type. I'll sort them out.</span>
        </button>

        <!-- Card 3: Upload tasks - file picker only, .csv -->
        <button class="home-prompt-card" id="hp-upload-card" type="button">
          <span class="hp-card-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M4 16v1a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3v-1M16 11l-4 4m0 0-4-4m4 4V3"/>
            </svg>
          </span>
          <span class="hp-card-label">Upload tasks</span>
          <span class="hp-card-desc">Import a CSV file.</span>
          <input type="file" id="hp-file" accept=".csv" class="hp-file-input" aria-label="Upload CSV file of tasks" tabindex="-1">
        </button>

      </div>

      <!-- Tell me: textarea expands below cards when card 2 is active -->
      <div class="hp-tell-area hidden" id="hp-tell-area" role="region" aria-label="Add new tasks">
        <textarea
          id="hp-textarea"
          class="hp-textarea"
          placeholder="One task per line - type or paste&#10;e.g. Call electrician&#10;Order floor tiles&#10;Book scaffold for next week"
          rows="5"
          aria-label="New tasks, one per line"
          autocomplete="off"
        ></textarea>
        <div class="hp-tell-actions">
          <button class="hp-mic-btn" id="hp-mic" type="button" title="Voice input" aria-label="Start voice input">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M12 18.5A6.5 6.5 0 0 1 5.5 12V7a6.5 6.5 0 0 1 13 0v5a6.5 6.5 0 0 1-6.5 6.5Z"/>
              <path d="M12 18.5v3M8 21.5h8"/>
            </svg>
          </button>
          <button class="hp-add-btn" id="hp-add" type="button">Add tasks</button>
        </div>
      </div>

      <!-- Status banners -->
      <div class="hp-confirm hidden" id="hp-confirm" role="status" aria-live="polite"></div>
      <div class="hp-error hidden"   id="hp-error"   role="alert"></div>

    </div>
  `;

  document.body.appendChild(overlay);

  const tellCard    = overlay.querySelector('#hp-tell');
  const uploadCard  = overlay.querySelector('#hp-upload-card');
  const fileInput   = overlay.querySelector('#hp-file');
  const tellArea    = overlay.querySelector('#hp-tell-area');
  const textarea    = overlay.querySelector('#hp-textarea');
  const micBtn      = overlay.querySelector('#hp-mic');
  const addBtn      = overlay.querySelector('#hp-add');
  const confirm     = overlay.querySelector('#hp-confirm');
  const errorEl     = overlay.querySelector('#hp-error');

  // ── Dismiss ──
  function dismiss() {
    overlay.classList.add('home-prompt-overlay--out');
    overlay.addEventListener('animationend', () => overlay.remove(), { once: true });
    if (onDismiss) onDismiss();
  }

  function showConfirm(msg) {
    confirm.textContent = msg;
    confirm.classList.remove('hidden');
    errorEl.classList.add('hidden');
    setTimeout(dismiss, 1500);
  }

  function showError(msg) {
    errorEl.textContent = msg;
    errorEl.classList.remove('hidden');
    confirm.classList.add('hidden');
  }

  // ── Card 1: Go to planner ──
  overlay.querySelector('#hp-go').addEventListener('click', dismiss);

  // ── Card 2: Tell me - toggle textarea ──
  tellCard.addEventListener('click', () => {
    const open = tellArea.classList.contains('hidden');
    tellArea.classList.toggle('hidden', !open);
    tellCard.classList.toggle('active', open);
    tellCard.setAttribute('aria-expanded', String(open));
    if (open) setTimeout(() => textarea.focus(), 40);
  });

  // ── Card 3: Upload tasks - trigger file picker ──
  uploadCard.addEventListener('click', () => fileInput.click());

  // ── Parse raw text: handles numbered lists, dashes, plain lines ──
  function parseTaskNames(raw) {
    return raw
      .split('\n')
      .map(line => line.replace(/^[\s\-\*•\d]+\.?\s*/, '').trim())
      .filter(line => line.length > 1);
  }

  function submitTasks(names) {
    if (!names.length) { textarea.focus(); return; }
    if (onAddTasks) onAddTasks(names);
    showConfirm(`${names.length} task${names.length === 1 ? '' : 's'} added.`);
  }

  addBtn.addEventListener('click', () => submitTasks(parseTaskNames(textarea.value)));
  textarea.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') submitTasks(parseTaskNames(textarea.value));
  });

  // ── File upload: .csv only, size-capped, plain-text read ──
  fileInput.addEventListener('change', () => {
    const file = fileInput.files[0];
    if (!file) return;

    if (!file.name.toLowerCase().endsWith('.csv')) {
      showError('Only .csv files are accepted.');
      fileInput.value = '';
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      showError('File too large - must be under 1 MB.');
      fileInput.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target.result;
      const lines = text.split(/\r?\n/).filter(l => l.trim());
      if (!lines.length) { showError('No content found in file.'); return; }

      const firstCols = lines[0].split(',').map(c => c.replace(/^"|"$/g, '').toLowerCase().trim());
      const taskColIdx = firstCols.findIndex(h => ['task', 'title', 'name', 'description'].includes(h));
      const dataLines = taskColIdx >= 0 ? lines.slice(1) : lines;
      const idx = Math.max(taskColIdx, 0);

      const names = dataLines
        .map(row => (row.split(',')[idx] || '').replace(/^"|"$/g, '').trim())
        .filter(n => n.length > 1);

      if (!names.length) { showError('No task names found - check the file format.'); return; }
      if (onAddTasks) onAddTasks(names);
      showConfirm(`${names.length} task${names.length === 1 ? '' : 's'} imported.`);
    };
    reader.onerror = () => showError('Could not read the file.');
    reader.readAsText(file);
  });

  // ── Mic (Web Speech API) ──
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    micBtn.disabled = true;
    micBtn.title = 'Voice input not available in this browser';
  } else {
    let recognition = null;
    micBtn.addEventListener('click', () => {
      if (micBtn.classList.contains('recording')) {
        if (recognition) recognition.stop();
        return;
      }
      recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = false;
      recognition.lang = 'en-AU';
      recognition.onstart = () => micBtn.classList.add('recording');
      recognition.onend   = () => micBtn.classList.remove('recording');
      recognition.onresult = (evt) => {
        const t = Array.from(evt.results).map(r => r[0].transcript.trim()).join('\n');
        textarea.value = (textarea.value ? textarea.value + '\n' : '') + t;
        textarea.focus();
      };
      recognition.onerror = () => micBtn.classList.remove('recording');
      recognition.start();
    });
  }

  // ── Escape + outside-click dismiss ──
  document.addEventListener('keydown', function onKey(e) {
    if (e.key === 'Escape') { dismiss(); document.removeEventListener('keydown', onKey); }
  });
  overlay.addEventListener('click', (e) => { if (e.target === overlay) dismiss(); });
}
