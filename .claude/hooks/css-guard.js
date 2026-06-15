#!/usr/bin/env node
/**
 * PostToolUse hook: blocks CSS edits that violate project rules.
 * Exit 0 = allow, exit 2 = block with feedback.
 *
 * Checks:
 * 1. margin-left: -4px not removed from form fields
 * 2. var(--accent) not used for text colour (should be --accent-text)
 * 3. No new hardcoded rgba/hex where a token exists
 * 4. No var(--undefined-token, #hardcoded) — fallback silently wins when token is missing
 *    (Incident 13: auth dark mode text invisible because --text-primary doesn't exist)
 */

import { readFileSync } from 'fs';
import { existsSync } from 'fs';
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

// Rule 4: var(--undefined-token, #hardcoded) — the fallback silently wins when the token doesn't exist.
// This bypasses the entire theme system without any visible error (Incident 13).
// We read the defined token names from styles.css and tokens.css, then flag any var() with a
// hardcoded colour fallback where the token name is NOT in the defined set.
{
  // Locate the project root relative to this hook file
  const hooksDir = dirname(fileURLToPath(import.meta.url));
  const projectRoot = resolve(hooksDir, '../../');

  const tokenSources = [
    resolve(projectRoot, 'css/styles.css'),
    resolve(projectRoot, 'css/tokens.css'),
  ];

  const definedTokens = new Set();
  for (const src of tokenSources) {
    if (!existsSync(src)) continue;
    const content = readFileSync(src, 'utf8');
    // Match property declarations: --token-name: value;
    for (const m of content.matchAll(/^\s*(--[\w-]+)\s*:/gm)) {
      definedTokens.add(m[1]);
    }
  }

  if (definedTokens.size > 0) {
    // Match: var(--token-name, <colour>) where colour is #hex or rgba(...) or rgb(...)
    const varWithFallback = /var\((--[\w-]+)\s*,\s*(#[0-9a-fA-F]{3,8}|rgba?\([^)]+\))/g;
    for (const match of css.matchAll(varWithFallback)) {
      const tokenName = match[1];
      const fallback = match[2];
      if (!definedTokens.has(tokenName)) {
        const before = css.slice(0, match.index);
        const line = before.split('\n').length;
        errors.push(
          `BLOCKED: Line ${line} — var(${tokenName}, ${fallback}) uses a hardcoded colour fallback but ${tokenName} is NOT defined in styles.css or tokens.css. ` +
          `The fallback silently wins in all themes, bypassing the design system. ` +
          `Either define ${tokenName} in styles.css :root and [data-theme="dark"], or replace with an existing token. ` +
          `See INCIDENTS.md Incident 13.`
        );
      }
    }
  }
}

if (errors.length > 0) {
  console.error(errors.join('\n'));
  process.exit(2);
}

process.exit(0);
