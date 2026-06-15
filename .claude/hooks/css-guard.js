#!/usr/bin/env node
/**
 * PreToolUse hook — blocks CSS writes that violate design system rules.
 * Exit 0 = allow, exit 2 = block (the tool call never executes).
 *
 * Rules:
 * 1. margin-left: -4px must survive any edit to styles.css
 * 2. var(--accent) must not be used as a text colour — use var(--accent-text)
 * 3. No raw hardcoded hex/rgba on colour properties — use a design token
 * 4. No var(--undefined-token, #hardcoded) — undefined token with colour fallback
 *    silently bypasses dark mode and custom themes (INCIDENTS.md Incident 13)
 */

import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const input = JSON.parse(readFileSync('/dev/stdin', 'utf8'));
const toolName = input.tool_name || '';
const filePath = input.tool_input?.file_path || '';

if (!filePath.endsWith('.css')) process.exit(0);
if (toolName !== 'Edit' && toolName !== 'Write') process.exit(0);

// ── Derive (a) what's being introduced and (b) what the full file will be ──
let newContent;  // only the changed/added text (new_string or content)
let fullResult;  // complete file after the operation — needed for whole-file checks

if (toolName === 'Edit') {
  newContent = input.tool_input?.new_string || '';
  const oldString = input.tool_input?.old_string || '';
  const replaceAll = input.tool_input?.replace_all || false;
  try {
    const current = readFileSync(filePath, 'utf8');
    fullResult = replaceAll
      ? current.split(oldString).join(newContent)
      : current.replace(oldString, newContent);
  } catch {
    fullResult = newContent; // file doesn't exist yet
  }
} else {
  newContent = input.tool_input?.content || '';
  fullResult = newContent;
}

const errors = [];

// ── Rule 1: margin-left: -4px must survive edits to styles.css ──
// This intentional alignment offset must not be accidentally removed.
if (filePath.includes('styles.css')) {
  const survives =
    fullResult.includes('margin-left: -4px') ||
    fullResult.includes('margin-left: calc(-1 * var(--space-4))');
  if (!survives) {
    errors.push(
      'BLOCKED (Rule 1): This edit removes margin-left: -4px from styles.css. ' +
      'That offset is an intentional form-field alignment fix — do not remove it.'
    );
  }
}

// ── Rule 2: var(--accent) used for text colour ──
// var(--accent) is the raw accent swatch and fails WCAG AA on light backgrounds.
for (const m of newContent.matchAll(/(?<![\w-])color\s*:\s*var\(--accent\)/g)) {
  const line = newContent.slice(0, m.index).split('\n').length;
  errors.push(
    `BLOCKED (Rule 2): line ${line} of new content uses var(--accent) for text colour. ` +
    `Use var(--accent-text) instead — it meets WCAG AA contrast in all themes.`
  );
}

// ── Rule 3: hardcoded colour value with no var() wrapper ──
// Any hex or rgba() on a colour property that has no var() at all bypasses the token system.
// Comments are stripped first to avoid false positives on commented-out values.
{
  const COLOUR_PROP = /^\s*(color|background(?:-color)?|border(?:-(?:top|right|bottom|left)-color|color)?|outline-color|fill|stroke|caret-color|text-decoration-color)\s*:\s*(.+)/;
  const HAS_COLOUR  = /#[0-9a-fA-F]{3,8}(?=[^0-9a-fA-F]|$)|rgba?\s*\(/i;
  const SAFE_VALUE  = /^(none|transparent|inherit|initial|unset|currentColor|revert|auto)[\s;]*$/i;

  const stripped = newContent.replace(/\/\*[\s\S]*?\*\//g, '');
  stripped.split('\n').forEach((line, idx) => {
    const m = line.match(COLOUR_PROP);
    if (!m) return;
    const value = m[2].replace(/;.*$/, '').trim();
    if (value.includes('var(')) return;   // has var() — either fine or caught by Rule 4
    if (SAFE_VALUE.test(value)) return;   // keyword — always fine
    if (value.startsWith('url(')) return; // url() reference — not a colour
    if (!HAS_COLOUR.test(value)) return;  // no hex or rgba — skip
    errors.push(
      `BLOCKED (Rule 3): line ${idx + 1} of new content sets "${m[1]}" to a hardcoded colour "${value.slice(0, 60)}". ` +
      `Use a design token: var(--token-name). ` +
      `Available tokens are in styles.css :root and css/tokens.css.`
    );
  });
}

// ── Rule 4: var(--undefined-token, #hardcoded) ──
// When a token name isn't defined, the browser silently uses the fallback in ALL themes.
// This bypasses dark mode and custom themes with no visible error. (INCIDENTS.md Incident 13)
{
  const projectRoot = process.cwd();
  const definedTokens = new Set();
  for (const rel of ['css/styles.css', 'css/tokens.css']) {
    const src = resolve(projectRoot, rel);
    if (!existsSync(src)) continue;
    for (const m of readFileSync(src, 'utf8').matchAll(/^\s*(--[\w-]+)\s*:/gm)) {
      definedTokens.add(m[1]);
    }
  }

  if (definedTokens.size > 0) {
    for (const m of newContent.matchAll(/var\((--[\w-]+)\s*,\s*(#[0-9a-fA-F]{3,8}|rgba?\([^)]+\))/g)) {
      const token = m[1], fallback = m[2];
      if (!definedTokens.has(token)) {
        const line = newContent.slice(0, m.index).split('\n').length;
        errors.push(
          `BLOCKED (Rule 4): line ${line} of new content — var(${token}, ${fallback}) has a hardcoded colour fallback but ${token} is not a defined token. ` +
          `The fallback silently wins in all themes, bypassing dark mode and custom themes. ` +
          `Define ${token} in styles.css :root + [data-theme="dark"], or replace with an existing token. ` +
          `See INCIDENTS.md Incident 13.`
        );
      }
    }
  }
}

if (errors.length > 0) {
  console.error(errors.join('\n\n'));
  process.exit(2);
}

process.exit(0);
