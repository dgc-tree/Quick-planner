/**
 * ai-llm.js — Anthropic API client (Haiku + Sonnet tiering)
 * Direct browser-to-API calls. No backend required.
 */

const API_URL = 'https://api.anthropic.com/v1/messages';
const HAIKU_MODEL = 'claude-haiku-4-5-20251001';
const SONNET_MODEL = 'claude-sonnet-4-5-20250514';

function getApiKey() {
  return localStorage.getItem('qp-ai-key') || '';
}

/**
 * Build the system prompt for the LLM.
 */
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

/**
 * Call the Anthropic API.
 * @param {object} opts
 * @param {string} opts.message - User message
 * @param {object} opts.context - Task context from ai-context.js
 * @param {'haiku'|'sonnet'} opts.tier - Model tier
 * @param {object[]} [opts.history] - Previous messages for conversational follow-up
 * @returns {Promise<{ text: string, action: object|null }>}
 */
export async function callLLM({ message, context, tier = 'haiku', history = [] }) {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error('NO_API_KEY');
  }

  const model = tier === 'sonnet' ? SONNET_MODEL : HAIKU_MODEL;
  const systemPrompt = buildSystemPrompt(context);

  // Build messages array (include history for conversational follow-up)
  const messages = [];
  for (const h of history.slice(-6)) { // Keep last 3 exchanges max
    messages.push({ role: h.role, content: h.content });
  }
  messages.push({ role: 'user', content: message });

  const body = {
    model,
    max_tokens: 1024,
    system: systemPrompt,
    messages,
  };

  const response = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    if (response.status === 401) throw new Error('INVALID_API_KEY');
    if (response.status === 429) throw new Error('RATE_LIMITED');
    throw new Error(err.error?.message || `API error (${response.status})`);
  }

  const data = await response.json();
  const text = data.content?.[0]?.text || '';

  // Parse action block if present
  const action = parseActionBlock(text);
  const cleanText = text.replace(/```json\n?\{[\s\S]*?\}\n?```\n?/, '').trim();

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
 * @param {string} message
 * @param {boolean} hasHistory - Whether there's conversational context
 * @returns {'haiku'|'sonnet'}
 */
export function chooseTier(message, hasHistory = false) {
  const lower = message.toLowerCase();

  // Sonnet triggers: compound commands, relative scheduling, conversational follow-up
  if (hasHistory) return 'sonnet';
  if (/\b(and|then|also|plus)\b/.test(lower) && /\b(move|change|update|set|assign|mark)\b/.test(lower)) return 'sonnet';
  if (/\b(push|move|shift|delay|bring forward|reschedule)\b.*\b(back|forward|later|earlier)\b/i.test(lower)) return 'sonnet';
  if (/\b(everything|all tasks?|every)\b/i.test(lower) && /\b(in|for|that|which)\b/i.test(lower)) return 'sonnet';

  // Default: Haiku for simple extraction
  return 'haiku';
}

/**
 * Check if an API key is configured.
 */
export function hasApiKey() {
  return !!getApiKey();
}
