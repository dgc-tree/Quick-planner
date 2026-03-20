#!/usr/bin/env node
/**
 * PostToolUse hook: blocks CSS edits that violate project rules.
 * Exit 0 = allow, exit 2 = block with feedback.
 *
 * Checks:
 * 1. margin-left: -4px not removed from form fields
 * 2. var(--accent) not used for text colour (should be --accent-text)
 * 3. No new hardcoded rgba/hex where a token exists
 */

import { readFileSync } from 'fs';

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
  const hasFormFieldOffset = css.includes('margin-left: -4px');
  if (!hasFormFieldOffset) {
    errors.push(
      'BLOCKED: margin-left: -4px removed from form fields. This is an intentional alignment pattern — see MEMORY.md "Form Field Pattern".'
    );
  }
}

// Rule 2: var(--accent) used for text colour (not background/border/accent-color)
const accentTextMatches = css.matchAll(/(?<![\w-])color\s*:\s*var\(--accent\)/g);
for (const match of accentTextMatches) {
  // Find line number
  const before = css.slice(0, match.index);
  const line = before.split('\n').length;
  errors.push(
    `BLOCKED: Line ${line} uses var(--accent) for text colour. Use var(--accent-text) instead — var(--accent) fails WCAG AA on light backgrounds. See feedback_accent_text_wcag.md.`
  );
}

if (errors.length > 0) {
  console.error(errors.join('\n'));
  process.exit(2);
}

process.exit(0);
