# Quick Planner — Project Rules

## CSS Workflow
- **Read before writing**: Read the full rule + dark mode override + mobile media query before editing any CSS. For layout bugs, read body → main → container chain. Never guess at cascade.
- **One-shot CSS**: Check all override contexts (dark, mobile, responsive) and apply all changes in one round. Don't iterate with the user as debugger.

## Commit & Deploy
This repo deploys directly via Cloudflare Pages. No separate deploy repo.
When user says "commit and push":
1. Commit and push this repo (`Quick planner/`). That's it.
- **Live URL**: `planner.davegregurke.au` (Cloudflare Pages project: `quick-planner`)
- **Old URL**: `davegregurke.au/pd2/` redirects via 301 to the new subdomain
- Cloudflare auto-deploys from `main` branch within ~1 minute

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
