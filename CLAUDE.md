# Quick Planner — Project Rules

## CSS Workflow
- **Read before writing**: Read the full rule + dark mode override + mobile media query before editing any CSS. For layout bugs, read body → main → container chain. Never guess at cascade.
- **One-shot CSS**: Check all override contexts (dark, mobile, responsive) and apply all changes in one round. Don't iterate with the user as debugger.

## Commit & Deploy
When user says "commit and push":
1. Commit source repo (`Quick planner/`)
2. **Pre-deploy parity check**: Diff file lists between source and deploy (`ls js/` both sides). Any file in source must exist in deploy. A single missing ES module = blank page, no partial load.
3. Copy ALL sync-eligible files to deploy repo — not just files changed in this commit
4. Commit + push deploy repo
- **Sync**: `css/styles.css`, `css/tokens.css`, `index.html`, `js/*.js`, `shared/ramp-generator.js`, `preview/`, `robots.txt`
- **Never sync**: `Code.gs`, `CLAUDE.md`, `memory/`, `_claude-instructions/`, `tokens/`, `themes/`, `contrast/`, `scripts/`, `node_modules/`, `package.json`, `package-lock.json`, `Archive/`

## Communication
- Be concise. Don't restate changes back. Don't explain CSS theory.
- Don't pad responses with summaries of what was done — the diff speaks for itself.

---

# ── BEGIN: Claude Guidelines ──

## 1. Think First
- Understand the goal before writing code
- Read relevant existing code before modifying
- Consider edge cases and implications

## 2. Simplicity
- Write the simplest code that solves the problem
- Avoid premature abstraction
- Don't add features that weren't requested
- Prefer readable code over clever code

## 3. Surgical Changes
- Make minimal, focused changes
- Don't refactor surrounding code unless asked
- Don't add comments, types, or docs to unchanged code
- One concern per change

## 4. Goal-Driven
- Stay focused on the user's actual request
- Don't expand scope beyond what was asked
- Verify the change achieves the goal before moving on
- If blocked, ask rather than guess

# ── END: Claude Guidelines ──
