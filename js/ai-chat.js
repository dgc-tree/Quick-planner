/**
 * ai-chat.js — QP Chat orchestrator & UI controller
 * The only AI module that touches the DOM.
 * Decision tree: local intent → Haiku → Sonnet
 */

import { resolveIntent, findTask, generateBriefing, parseDate } from './ai-intent.js';
import { buildContext, invalidateContextCache } from './ai-context.js';
import { callLLM, chooseTier, hasApiKey } from './ai-llm.js';
import { createRecogniser, speak, stopSpeaking, isSTTSupported, isTTSSupported } from './ai-voice.js';
import { loadUserName } from './storage.js';

// ─── State ────────────────────────────────────────────────────────────────────

let _panel = null;
let _messageList = null;
let _input = null;
let _micBtn = null;
let _isOpen = false;
let _messages = [];           // { role: 'user'|'assistant', content: string }
let _pendingAction = null;    // Pending clarification action
let _recogniser = null;
let _ttsEnabled = true;
let _briefingMode = 'week';   // 'off' | 'today' | 'week'
let _chatBubble = null;
let _hasPendingBriefing = false;

// Callbacks to app.js
let _onUpdateTask = null;
let _onAddTask = null;
let _onDeleteTask = null;
let _onGetTasks = null;
let _onProjectSwitch = null;

// ─── Initialise ───────────────────────────────────────────────────────────────

/**
 * Initialise the QP Chat system.
 * @param {object} callbacks
 * @param {function} callbacks.onUpdateTask - (taskId, fields) => void
 * @param {function} callbacks.onAddTask - (fields) => newTask
 * @param {function} callbacks.onDeleteTask - (taskId) => void
 * @param {function} callbacks.getTasks - () => Task[]
 */
export function initChat(callbacks) {
  _onUpdateTask = callbacks.onUpdateTask;
  _onAddTask = callbacks.onAddTask;
  _onDeleteTask = callbacks.onDeleteTask;
  _onGetTasks = callbacks.getTasks;
  _onProjectSwitch = callbacks.onProjectSwitch;

  // Load settings
  _ttsEnabled = localStorage.getItem('qp-ai-tts') !== '0';
  _briefingMode = localStorage.getItem('qp-ai-briefing') || 'week';

  injectUI();
  loadConversation();

  // Proactive briefing on load
  setTimeout(() => triggerBriefing(), 500);
}

/**
 * Called when the active project changes — re-trigger briefing.
 */
export function onProjectSwitch() {
  invalidateContextCache();
  _messages = [];
  saveConversation();
  if (_messageList) _messageList.innerHTML = '';
  triggerBriefing();
}

/**
 * Clear the conversation.
 */
export function clearConversation() {
  _messages = [];
  _pendingAction = null;
  saveConversation();
  if (_messageList) {
    _messageList.innerHTML = '';
    renderEmptyState();
  }
}

// ─── UI Injection ─────────────────────────────────────────────────────────────

function injectUI() {
  // Chat bubble button
  _chatBubble = document.createElement('button');
  _chatBubble.id = 'qp-chat-bubble';
  _chatBubble.className = 'qp-chat-bubble';
  _chatBubble.title = 'Open QP Chat';
  _chatBubble.setAttribute('aria-label', 'Open AI assistant');
  _chatBubble.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg><span class="qp-chat-bubble-dot hidden"></span>`;
  _chatBubble.addEventListener('click', togglePanel);
  document.body.appendChild(_chatBubble);

  // Chat panel
  _panel = document.createElement('div');
  _panel.id = 'qp-chat-panel';
  _panel.className = 'qp-chat-panel';
  _panel.innerHTML = `
    <div class="qp-chat-header">
      <div class="qp-chat-header-left">
        <span class="qp-chat-avatar">Qp</span>
        <span class="qp-chat-title">QP Chat</span>
      </div>
      <button class="qp-chat-close" title="Close" aria-label="Close chat">&times;</button>
    </div>
    <div class="qp-chat-messages" id="qp-chat-messages"></div>
    <div class="qp-chat-input-bar">
      <input type="text" class="qp-chat-input" id="qp-chat-input" placeholder="Ask QP anything…" autocomplete="off">
      ${isSTTSupported() ? `<button class="qp-chat-mic" id="qp-chat-mic" title="Voice input" aria-label="Voice input">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="22"/></svg>
      </button>` : ''}
      <button class="qp-chat-send" id="qp-chat-send" title="Send" aria-label="Send message">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
      </button>
    </div>
  `;
  document.body.appendChild(_panel);

  _messageList = _panel.querySelector('#qp-chat-messages');
  _input = _panel.querySelector('#qp-chat-input');
  _micBtn = _panel.querySelector('#qp-chat-mic');
  const sendBtn = _panel.querySelector('#qp-chat-send');
  const closeBtn = _panel.querySelector('.qp-chat-close');

  closeBtn.addEventListener('click', togglePanel);
  sendBtn.addEventListener('click', sendMessage);
  _input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  if (_micBtn) {
    setupVoice();
  }

  renderEmptyState();

  // Re-render any saved messages
  for (const msg of _messages) {
    appendBubble(msg.role, msg.content, { skipSave: true, undoData: msg.undoData });
  }
}

function renderEmptyState() {
  if (_messages.length > 0) return;
  const empty = document.createElement('div');
  empty.className = 'qp-chat-empty';
  empty.innerHTML = `<span class="qp-chat-empty-avatar">Qp</span>
    <p>I'm QP, your task assistant. Ask me anything or tell me what to do.</p>
    <div class="qp-chat-suggestions">
      <button class="qp-chat-suggestion" data-msg="What's due this week?">What's due this week?</button>
      <button class="qp-chat-suggestion" data-msg="What's overdue?">What's overdue?</button>
      <button class="qp-chat-suggestion" data-msg="How many tasks?">How many tasks?</button>
    </div>`;
  _messageList.appendChild(empty);

  empty.querySelectorAll('.qp-chat-suggestion').forEach(btn => {
    btn.addEventListener('click', () => {
      _input.value = btn.dataset.msg;
      sendMessage();
    });
  });
}

// ─── Panel toggle ─────────────────────────────────────────────────────────────

function togglePanel() {
  _isOpen = !_isOpen;
  _panel.classList.toggle('open', _isOpen);
  _chatBubble.classList.toggle('open', _isOpen);

  if (_isOpen) {
    _input.focus();
    _chatBubble.querySelector('.qp-chat-bubble-dot')?.classList.add('hidden');
    _hasPendingBriefing = false;
    scrollToBottom();
  }
}

export function openPanel() {
  if (!_isOpen) togglePanel();
}

// ─── Message handling ─────────────────────────────────────────────────────────

async function sendMessage() {
  const text = _input.value.trim();
  if (!text) return;
  _input.value = '';

  // Remove empty state
  const empty = _messageList.querySelector('.qp-chat-empty');
  if (empty) empty.remove();

  appendBubble('user', text);

  await processMessage(text);
}

async function processMessage(text) {
  const lower = text.toLowerCase().trim();

  // Handle pending clarification ("yes" confirms)
  if (_pendingAction && (lower === 'yes' || lower === 'y' || lower === 'yeah' || lower === 'yep')) {
    const result = executeMutation(_pendingAction);
    _pendingAction = null;
    appendBubble('assistant', result.confirmation, { undoData: result.undoData });
    return;
  }
  if (_pendingAction && (lower === 'no' || lower === 'n' || lower === 'nah' || lower === 'nope' || lower === 'cancel')) {
    _pendingAction = null;
    appendBubble('assistant', 'Cancelled.');
    return;
  }
  _pendingAction = null;

  // Step 1: Try local intent resolution
  const tasks = _onGetTasks ? _onGetTasks() : [];
  const context = { tasks, project: '', user: loadUserName(), today: new Date() };
  const intent = resolveIntent(text, context);

  if (intent) {
    if (intent.type === 'read') {
      appendBubble('assistant', intent.response);
      return;
    }
    if (intent.type === 'clarify') {
      if (intent.pendingAction) _pendingAction = intent.pendingAction;
      appendBubble('assistant', intent.response);
      return;
    }
    if (intent.type === 'mutation') {
      const result = executeMutation(intent);
      appendBubble('assistant', result.confirmation, { undoData: result.undoData });
      return;
    }
  }

  // Step 2: Need LLM — check for API key
  if (!hasApiKey()) {
    appendBubble('assistant', "I can't figure that one out locally. Add a Claude API key in Settings to unlock AI-powered replies.");
    return;
  }

  // Step 3: Call LLM
  const thinkingEl = showThinking();
  try {
    const ctxData = buildContext({ keywords: text.split(/\s+/) });
    if (!ctxData) {
      removeThinking(thinkingEl);
      appendBubble('assistant', "I couldn't load the project data.");
      return;
    }

    // Build history from recent messages
    const history = _messages
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .slice(-6)
      .map(m => ({ role: m.role, content: m.content }));

    const tier = chooseTier(text, history.length > 2);
    const response = await callLLM({ message: text, context: ctxData, tier, history });

    removeThinking(thinkingEl);

    if (response.action) {
      const result = executeMutation(response.action);
      const msg = response.text || result.confirmation;
      appendBubble('assistant', msg, { undoData: result.undoData });
    } else {
      appendBubble('assistant', response.text || "I'm not sure how to help with that.");
    }
  } catch (err) {
    removeThinking(thinkingEl);
    if (err.message === 'NO_API_KEY') {
      appendBubble('assistant', 'Add a Claude API key in Settings to use AI features.');
    } else if (err.message === 'INVALID_API_KEY') {
      appendBubble('assistant', 'Your API key is invalid. Check it in Settings.');
    } else if (err.message === 'RATE_LIMITED') {
      appendBubble('assistant', "You've hit the API rate limit. Try again in a moment.");
    } else {
      appendBubble('assistant', `Something went wrong: ${err.message}`);
    }
  }
}

// ─── Mutation execution ───────────────────────────────────────────────────────

function executeMutation(action) {
  invalidateContextCache();
  let undoData = null;

  if (action.action === 'update' && action.taskId) {
    const tasks = _onGetTasks ? _onGetTasks() : [];
    const task = tasks.find(t => t.id === action.taskId);
    if (!task) return { confirmation: "Couldn't find that task.", undoData: null };

    // Save previous state for undo
    const prevFields = {};
    for (const key of Object.keys(action.fields)) {
      prevFields[key] = key === 'assigned' ? [...(task.assigned || [])]
        : key === 'startDate' || key === 'endDate' ? (task[key] ? task[key].toISOString().split('T')[0] : null)
        : task[key];
    }
    undoData = { action: 'update', taskId: action.taskId, fields: prevFields };

    if (_onUpdateTask) _onUpdateTask(action.taskId, action.fields);
    const taskName = action.taskName || task.task || task.name || 'Task';
    return {
      confirmation: action.confirmation || `Updated "${taskName}".`,
      undoData,
    };
  }

  if (action.action === 'add') {
    if (_onAddTask) _onAddTask(action.fields);
    return {
      confirmation: action.confirmation || `Created "${action.fields.task || 'New task'}".`,
      undoData: null, // Can't easily undo an add without knowing the new ID
    };
  }

  if (action.action === 'delete' && action.taskId) {
    if (_onDeleteTask) _onDeleteTask(action.taskId);
    return {
      confirmation: action.confirmation || 'Task deleted (moved to bin).',
      undoData: null, // Task is in bin, can be restored manually
    };
  }

  return { confirmation: 'Done.', undoData: null };
}

// ─── UI helpers ───────────────────────────────────────────────────────────────

function appendBubble(role, content, opts = {}) {
  const { skipSave = false, undoData = null } = opts;

  const bubble = document.createElement('div');
  bubble.className = `qp-chat-bubble qp-chat-bubble-${role}`;

  if (role === 'assistant') {
    bubble.innerHTML = `<span class="qp-chat-msg-avatar">Qp</span><div class="qp-chat-msg-content"></div>`;
    const contentEl = bubble.querySelector('.qp-chat-msg-content');
    contentEl.textContent = content;

    // Add undo chip if we have undo data
    if (undoData) {
      const chip = document.createElement('button');
      chip.className = 'qp-chat-undo';
      chip.textContent = 'Undo';
      chip.addEventListener('click', () => {
        executeMutation({ action: undoData.action, taskId: undoData.taskId, fields: undoData.fields });
        chip.textContent = 'Undone';
        chip.disabled = true;
        chip.classList.add('qp-chat-undo-done');
      });
      contentEl.appendChild(chip);
    }

    // TTS for short responses
    if (_ttsEnabled && isTTSSupported() && !skipSave && content.length < 200) {
      speak(content);
    }
  } else {
    bubble.innerHTML = `<div class="qp-chat-msg-content"></div>`;
    bubble.querySelector('.qp-chat-msg-content').textContent = content;
  }

  _messageList.appendChild(bubble);
  scrollToBottom();

  if (!skipSave) {
    _messages.push({ role, content, undoData: undoData || undefined });
    saveConversation();
  }
}

function showThinking() {
  const el = document.createElement('div');
  el.className = 'qp-chat-bubble qp-chat-bubble-assistant qp-chat-thinking';
  el.innerHTML = `<span class="qp-chat-msg-avatar">Qp</span><div class="qp-chat-msg-content"><span class="qp-chat-dots"><span></span><span></span><span></span></span></div>`;
  _messageList.appendChild(el);
  scrollToBottom();
  return el;
}

function removeThinking(el) {
  if (el && el.parentNode) el.remove();
}

function scrollToBottom() {
  if (_messageList) {
    _messageList.scrollTop = _messageList.scrollHeight;
  }
}

// ─── Voice ────────────────────────────────────────────────────────────────────

function setupVoice() {
  _recogniser = createRecogniser({
    onInterim(text) {
      _input.value = text;
    },
    onResult(text) {
      _input.value = text;
      _micBtn.classList.remove('qp-chat-mic-active');
      // Auto-send after voice input
      setTimeout(() => sendMessage(), 200);
    },
    onError(err) {
      _micBtn.classList.remove('qp-chat-mic-active');
      console.warn('Speech recognition error:', err);
    },
    onEnd() {
      _micBtn.classList.remove('qp-chat-mic-active');
    },
  });

  _micBtn.addEventListener('click', () => {
    if (_recogniser.isListening) {
      _recogniser.stop();
      _micBtn.classList.remove('qp-chat-mic-active');
    } else {
      stopSpeaking();
      _recogniser.start();
      _micBtn.classList.add('qp-chat-mic-active');
    }
  });
}

// ─── Proactive briefing ───────────────────────────────────────────────────────

function triggerBriefing() {
  if (_briefingMode === 'off') return;

  const tasks = _onGetTasks ? _onGetTasks() : [];
  const userName = loadUserName();
  const briefing = generateBriefing(tasks, userName, _briefingMode);

  if (briefing) {
    if (_isOpen) {
      // Remove empty state and show briefing immediately
      const empty = _messageList?.querySelector('.qp-chat-empty');
      if (empty) empty.remove();
      appendBubble('assistant', briefing);
    } else {
      // Show dot indicator on bubble
      _hasPendingBriefing = true;
      _chatBubble?.querySelector('.qp-chat-bubble-dot')?.classList.remove('hidden');
      // Queue briefing for when panel opens
      _messages.push({ role: 'assistant', content: briefing });
      saveConversation();
    }
  }
}

// ─── Settings ─────────────────────────────────────────────────────────────────

export function setTTSEnabled(enabled) {
  _ttsEnabled = enabled;
  localStorage.setItem('qp-ai-tts', enabled ? '1' : '0');
  if (!enabled) stopSpeaking();
}

export function setBriefingMode(mode) {
  _briefingMode = mode;
  localStorage.setItem('qp-ai-briefing', mode);
}

export function getTTSEnabled() { return _ttsEnabled; }
export function getBriefingMode() { return _briefingMode; }

// ─── Persistence ──────────────────────────────────────────────────────────────

function saveConversation() {
  try {
    // Only keep last 50 messages
    const toSave = _messages.slice(-50);
    sessionStorage.setItem('qp-ai-chat', JSON.stringify(toSave));
  } catch { /* quota exceeded — ignore */ }
}

function loadConversation() {
  try {
    const raw = sessionStorage.getItem('qp-ai-chat');
    if (raw) _messages = JSON.parse(raw);
  } catch { _messages = []; }
}

// ─── Visibility ───────────────────────────────────────────────────────────────

/** Hide the chat bubble (when settings are open, etc.) */
export function hideBubble() {
  if (_chatBubble) _chatBubble.style.display = 'none';
  if (_isOpen) togglePanel();
}

/** Show the chat bubble */
export function showBubble() {
  if (_chatBubble) _chatBubble.style.display = '';
}
