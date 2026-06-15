#!/usr/bin/env node
/**
 * PostToolUse hook: blocks CSS edits that violate project rules.
 * Exit 0 = allow, exit 2 = block with feedback.
 *
 * Checks:
 * 1. margin-left: -4px not removed from form fields
 * 2. var(--accent) not used for text colour (should be --accent-text)
 * 3. No new hardcoded rgba/hex where a token exists
 * 4. No var(--undefined-token, #hardcoded) — undefined token with hardcoded fallback
 *    silently bypasses the theme system. See INCIDENTS.md Incident 13.
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const input = JSON.parse(readFileSync('/dev/stdin', 'utf8'));
const filePath = input.tool_input?.file_path || '';

// Only check CSS files
if (!filePath.endsWith('.css')) process.exit(0);

let css;
try {
  css = readFileSync(filePath, 'utf8');
} catch {
  process.exit(0); // file doesn't exist yet — allow
}

const errors = [];

// Rule 1: margin-left: -4px must exist on form fields
if (filePath.includes('styles.css')) {
  const hasFormFieldOffset = css.includes('margin-left: -4px') || css.includes('margin-left: calc(-1 * var(--space-4))');
  if (!hasFormFieldOffset) {
    errors.push(
      'BLOCKED: margin-left: -4px removed from form fields. This is an intentional alignment pattern — see MEMORY.md "Form Field Pattern".'
    );
  }
}

// Rule 2: var(--accent) used for text colour (not background/border/accent-color)
const accentTextMatches = css.matchAll(/(?<![\w-])color\s*:\s*var\(--accent\)/g);
for (const match of accentTextMatches) {
  const before = css.slice(0, match.index);
  const line = before.split('\n').length;
  errors.push(
    `BLOCKED: Line ${line} uses var(--accent) for text colour. Use var(--accent-text) instead — var(--accent) fails WCAG AA on light backgrounds. See feedback_accent_text_wcag.md.`
  );
}

// Rule 4: var(--undefined-token, #hardcoded) — token name not defined anywhere in the design system.
// A hardcoded fallback for an undefined token silently wins in ALL contexts, bypassing dark mode
// and custom themes entirely. See INCIDENTS.md Incident 13.
(function checkUndefinedTokenFallbacks() {
  // Collect all defined token names from styles.css and tokens.css
  const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const tokenSources = [
    resolve(projectRoot, 'css', 'styles.css'),
    resolve(projectRoot, 'css', 'tokens.css'),
  ];

  const definedTokens = new Set();
  for (const src of tokenSources) {
    let content;
    try { content = readFileSync(src, 'utf8'); } catch { continue; }
    // Match --token-name: (property declarations)
    for (const m of content.matchAll(/^\s*(--[\w-]+)\s*:/gm)) {
      definedTokens.set(m[1]);
    }
  }

  if (definedTokens.size === 0) return; // couldn't read token files — don't block

  // Find var(--name, #hex) / var(--name, rgba(...)) patterns in the edited file
  const pattern = /var\(\s*(--[\w-]+)\s*,\s*(#[0-9a-fA-F]{3,8}|rgba?\([^)]+\))/g;
  for (const match of css.matchAll(pattern)) {
    const tokenName = match[1];
    const fallback = match[2];
    if (!definedTokens.has(tokenName)) {
      const before = css.slice(0, match.index);
      const line = before.split('\n').length;
      errors.push(
        `BLOCKED: Line ${line} uses var(${tokenName}, ${fallback}) but --${tokenName.slice(2)} is not a defined token.\n` +
        `  Hardcoded fallbacks for undefined tokens silently bypass the entire theme system (dark mode, custom themes).\n` +
        `  Fix: define --${tokenName.slice(2)} in styles.css :root and [data-theme="dark"], or replace with an existing token.\n` +
        `  See INCIDENTS.md Incident 13.`
      );
    }
  }
})();

if (errors.length > 0) {
  console.error(errors.join('\n\n'));
  process.exit(2);
}

process.exit(0);
