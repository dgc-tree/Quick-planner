/**
 * ai-llm.js — Multi-provider LLM client (Claude API + OpenAI-compatible local)
 * Supports Anthropic direct API and any OpenAI-compatible endpoint (Ollama, LM Studio, llama.cpp, vLLM).
 */

// ─── Provider config ─────────────────────────────────────────────────────────

const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';
const CLAUDE_HAIKU = 'claude-haiku-4-5-20251001';
const CLAUDE_SONNET = 'claude-sonnet-4-5-20250514';

const DEFAULT_LOCAL_URL = 'http://127.0.0.1:1234/v1/chat/completions';
const DEFAULT_LOCAL_MODEL = 'qwen3.5-9b';

/**
 * Get current provider config from localStorage.
 * @returns {{ provider: 'claude'|'local', apiKey: string, endpoint: string, model: string, localKey: string }}
 */
export function getProviderConfig() {
  return {
    provider: localStorage.getItem('qp-ai-provider') || 'claude',
    apiKey: localStorage.getItem('qp-ai-key') || '',
    endpoint: localStorage.getItem('qp-ai-endpoint') || DEFAULT_LOCAL_URL,
    model: localStorage.getItem('qp-ai-model') || DEFAULT_LOCAL_MODEL,
    localKey: localStorage.getItem('qp-ai-local-key') || '',
  };
}

/**
 * Save provider choice.
 */
export function setProvider(provider) {
  localStorage.setItem('qp-ai-provider', provider);
}

/**
 * Save local LLM settings.
 */
export function setLocalConfig({ endpoint, model, localKey }) {
  if (endpoint) localStorage.setItem('qp-ai-endpoint', endpoint);
  if (model) localStorage.setItem('qp-ai-model', model);
  if (localKey !== undefined) {
    if (localKey) localStorage.setItem('qp-ai-local-key', localKey);
    else localStorage.removeItem('qp-ai-local-key');
  }
}

// ─── System prompt (shared across providers) ─────────────────────────────────

function buildSystemPrompt(contextJson) {
  return `You are QP, the built-in assistant for Quick Planner. Today is ${contextJson.today}. The user's name is ${contextJson.user}.

You help users manage tasks using natural language. You can:
- Answer questions about tasks (read-only queries)
- Update task fields: name (field key: "task"), dueDate (field key: "endDate"), startDate, status, room, category, assigned
- Add new tasks
- Delete tasks (moves to trash)

Status values: "To Do", "In Progress", "Blocked", "Done"
Assigned is always an array of strings.
Dates use ISO format (YYYY-MM-DD).

When performing a mutation, respond with ONLY a JSON block in this exact format, followed by a newline and a short confirmation message:
\`\`\`json
{"action":"update","taskId":"<id>","fields":{"<key>":"<value>"}}
\`\`\`
Done — Task Name updated.

For adding tasks:
\`\`\`json
{"action":"add","fields":{"task":"<name>","endDate":"<date>","status":"To Do"}}
\`\`\`
Created "Task Name".

For deleting tasks:
\`\`\`json
{"action":"delete","taskId":"<id>"}
\`\`\`
Deleted "Task Name".

If you are not confident which task the user means, ask for clarification before acting. Never guess.
For read-only questions, just answer in plain text — no JSON block needed.
Keep responses short and direct.

Current project: ${contextJson.project}
Tasks (${contextJson.shownTasks} of ${contextJson.totalTasks}):
${JSON.stringify(contextJson.tasks)}`;
}

// ─── Claude API ──────────────────────────────────────────────────────────────

async function callClaude({ message, context, tier, history }) {
  const { apiKey } = getProviderConfig();
  if (!apiKey) throw new Error('NO_API_KEY');

  const model = tier === 'sonnet' ? CLAUDE_SONNET : CLAUDE_HAIKU;
  const systemPrompt = buildSystemPrompt(context);

  const messages = [];
  for (const h of history.slice(-6)) {
    messages.push({ role: h.role, content: h.content });
  }
  messages.push({ role: 'user', content: message });

  const response = await fetch(CLAUDE_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({ model, max_tokens: 1024, system: systemPrompt, messages }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    if (response.status === 401) throw new Error('INVALID_API_KEY');
    if (response.status === 429) throw new Error('RATE_LIMITED');
    throw new Error(err.error?.message || `API error (${response.status})`);
  }

  const data = await response.json();
  return data.content?.[0]?.text || '';
}

// ─── Local LLM (OpenAI-compatible) ──────────────────────────────────────────

async function callLocal({ message, context, history }) {
  const { endpoint, model, localKey } = getProviderConfig();
  if (!endpoint) throw new Error('NO_ENDPOINT');

  const systemPrompt = buildSystemPrompt(context);

  const messages = [{ role: 'system', content: systemPrompt }];
  for (const h of history.slice(-6)) {
    messages.push({ role: h.role, content: h.content });
  }
  messages.push({ role: 'user', content: message });

  const headers = { 'Content-Type': 'application/json' };
  if (localKey) headers['Authorization'] = `Bearer ${localKey}`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({ model, messages, max_tokens: 1024, temperature: 0.7 }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    if (response.status === 401) throw new Error('INVALID_API_KEY');
    if (response.status === 429) throw new Error('RATE_LIMITED');
    throw new Error(err.error?.message || `Local LLM error (${response.status})`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || '';
}

// ─── Unified entry point ─────────────────────────────────────────────────────

/**
 * Call the configured LLM provider.
 * @param {object} opts
 * @param {string} opts.message
 * @param {object} opts.context
 * @param {'haiku'|'sonnet'} opts.tier
 * @param {object[]} [opts.history]
 * @returns {Promise<{ text: string, action: object|null }>}
 */
export async function callLLM({ message, context, tier = 'haiku', history = [] }) {
  const { provider } = getProviderConfig();

  let rawText = provider === 'local'
    ? await callLocal({ message, context, history })
    : await callClaude({ message, context, tier, history });

  // Strip thinking blocks (Qwen 3.5, DeepSeek, etc.)
  rawText = rawText.replace(/<think>[\s\S]*?<\/think>\s*/g, '');
  // Also strip loose "Thinking Process:" preamble some models emit
  rawText = rawText.replace(/^Thinking Process:[\s\S]*?\n\n/i, '');

  const action = parseActionBlock(rawText);
  const cleanText = rawText.replace(/```json\n?\{[\s\S]*?\}\n?```\n?/, '').trim();

  return { text: cleanText, action };
}

/**
 * Parse a JSON action block from LLM response.
 */
function parseActionBlock(text) {
  const match = text.match(/```json\n?(\{[\s\S]*?\})\n?```/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[1]);
    if (parsed.action && (parsed.action === 'update' || parsed.action === 'add' || parsed.action === 'delete')) {
      return parsed;
    }
  } catch {
    // Invalid JSON — ignore
  }
  return null;
}

/**
 * Determine which tier to use based on message complexity.
 */
export function chooseTier(message, hasHistory = false) {
  // Local LLM has no tiering — always returns the configured model
  const { provider } = getProviderConfig();
  if (provider === 'local') return 'haiku'; // tier is ignored for local

  const lower = message.toLowerCase();
  if (hasHistory) return 'sonnet';
  if (/\b(and|then|also|plus)\b/.test(lower) && /\b(move|change|update|set|assign|mark)\b/.test(lower)) return 'sonnet';
  if (/\b(push|move|shift|delay|bring forward|reschedule)\b.*\b(back|forward|later|earlier)\b/i.test(lower)) return 'sonnet';
  if (/\b(everything|all tasks?|every)\b/i.test(lower) && /\b(in|for|that|which)\b/i.test(lower)) return 'sonnet';
  return 'haiku';
}

/**
 * Check if an API key or endpoint is configured for the active provider.
 */
export function hasApiKey() {
  const cfg = getProviderConfig();
  if (cfg.provider === 'local') return !!cfg.endpoint;
  return !!cfg.apiKey;
}

// ─── Connection testing ──────────────────────────────────────────────────────

/**
 * Test the Claude API connection.
 * @returns {Promise<{ ok: boolean, message: string, models: string }>}
 */
export async function testClaudeConnection() {
  const { apiKey } = getProviderConfig();
  if (!apiKey) return { ok: false, message: 'No API key entered' };
  if (!apiKey.startsWith('sk-ant-')) return { ok: false, message: 'Key should start with sk-ant-' };

  try {
    const response = await fetch(CLAUDE_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: CLAUDE_HAIKU,
        max_tokens: 8,
        messages: [{ role: 'user', content: 'Hi' }],
      }),
    });

    if (response.status === 401) return { ok: false, message: 'Invalid API key' };
    if (response.status === 429) return { ok: true, message: 'Connected (rate limited — try again shortly)', models: 'Haiku + Sonnet' };
    if (!response.ok) return { ok: false, message: `API error (${response.status})` };

    return { ok: true, message: 'Connected', models: 'Haiku + Sonnet' };
  } catch (err) {
    return { ok: false, message: `Cannot reach API: ${err.message}` };
  }
}

/**
 * Test the local LLM connection.
 * @returns {Promise<{ ok: boolean, message: string, models: string }>}
 */
export async function testLocalConnection() {
  const { endpoint, model, localKey } = getProviderConfig();
  if (!endpoint) return { ok: false, message: 'No endpoint URL entered' };

  try {
    const headers = { 'Content-Type': 'application/json' };
    if (localKey) headers['Authorization'] = `Bearer ${localKey}`;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'Hi' }],
        max_tokens: 8,
      }),
    });

    if (response.status === 401) return { ok: false, message: 'Unauthorised — check API key' };
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      return { ok: false, message: err.error?.message || `Error (${response.status})` };
    }

    const data = await response.json();
    const usedModel = data.model || model;
    return { ok: true, message: 'Connected', models: usedModel };
  } catch (err) {
    if (err.name === 'TypeError' && err.message.includes('fetch')) {
      return { ok: false, message: 'Cannot reach endpoint — is Ollama/LM Studio running?' };
    }
    return { ok: false, message: `Connection failed: ${err.message}` };
  }
}
