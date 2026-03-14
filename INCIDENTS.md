# Quick Planner — Incident Log & Best Practices

A record of every Claude session failure that led to a new rule. Copy relevant sections into `CLAUDE.md` or session config as needed.

---

## Incident 1: Google Sheets Migration Data Loss
**Date**: March 2025
**Severity**: Critical — all user data lost
**Commits**: `509d305` → `4b8489e` → `3973713` → `8f5541c` → `d03e778` → `655d71d` → `e8cdbc5`

### What happened
When moving from Google Sheets to localStorage, Claude removed the data source before migrating the data:
1. Removed the write side (`sheet-writer.js`) first
2. Then removed the read side (`fetchSheetData`)
3. Never actually copied Sheet data into localStorage

### Impact
- False error toast on every task create/edit
- New tasks silently lost on page refresh
- All existing Renos project data permanently gone — the only copy was in the deleted Sheet connection

### Root cause
Migration steps done out of order. Teardown happened before data transfer.

### Rule added
> **Migration Discipline**: build the new thing → verify it works → rip out the old thing. All three steps, same session. Never remove a read path before confirming data exists in the new location.

### Additional rule
> **Red-team every migration**: after removing code, grep for all references to the old system across JS, HTML, and CSS. Check both read and write paths. A half-removed integration is worse than one left fully in place.

---

## Incident 2: Bug Triage on Dead Integrations
**Date**: March 2025
**Commits**: `3973713`

### What happened
Claude spent time debugging and patching the Google Sheets integration plumbing — which the user had already decided to abandon. Instead of asking whether the integration was still needed, Claude tried to fix it.

### Impact
- Wasted session time patching code that should have been deleted
- Left orphaned integration code wired into live error paths

### Rule added
> **Bug Triage — Ask Before Assuming**: When a bug involves an external integration, ask the user whether that integration is still in use before debugging it. Prefer deletion over repair when the feature is no longer needed.

---

## Incident 3: Deploy Pipeline — 13 Commits Never Merged
**Date**: March 2026
**Severity**: High — live site not updated, user blocked
**Commits**: `3665eb3`

### What happened
Claude pushed 13 commits to a `claude/` feature branch but never created a PR or merged to `main`. When the user asked to go live:
1. Attempted `git push origin main` — got 403 (branch protection)
2. Tried multiple GitHub API auth workarounds — all failed
3. Told user to "merge it yourself" without giving a link
4. User had to ask **4 times** before getting a working compare URL

### Impact
- Live site unchanged despite hours of work
- User frustrated by 4 rounds of back-and-forth for something that should be automatic

### Root cause
No documented process for the `claude/` branch constraint. Claude didn't know it couldn't push to `main` and had no fallback plan.

### Rule added
> **Deploy process**: (1) Commit to feature branch, (2) Push feature branch, (3) Rebase onto origin/main if needed, (4) Create PR immediately via API or give compare URL, (5) Never stop at "pushed to branch" and say done.

> **What NOT to do**: Don't attempt `git push origin main`. Don't try multiple auth workarounds — go straight to compare URL. Don't make the user ask twice for a PR.

---

## Incident 4: CSS Iteration Loops
**Date**: Ongoing through March 2025–2026

### What happened
Multiple sessions where Claude made CSS changes, the user reported they didn't work (dark mode, mobile, etc.), and Claude iterated fix-by-fix across many rounds. Root cause was always the same: Claude didn't read the full cascade before editing.

### Pattern
1. Claude edits a CSS rule
2. User says "it didn't work in dark mode" or "mobile is broken"
3. Claude patches the dark mode override
4. User says "now the light mode is broken"
5. Repeat 3–5 times

### Rule added
> **Read before writing**: Read the full rule + dark mode override + mobile media query before editing any CSS. For layout bugs, read body → main → container chain. Never guess at cascade.

> **One-shot CSS**: Check all override contexts (dark, mobile, responsive) and apply all changes in one round. Don't iterate with the user as debugger.

---

## Incident 5: Missing Files in Commits — Broken Live Site
**Date**: March 2025–2026
**Commits**: `1652c2e`, `8d99aea`

### What happened
On at least two occasions, Claude committed and pushed code that imported new modules but didn't include the actual module files in the commit. The live site broke immediately on deploy.

### Impact
- `app.js` missing from commit → entire app failed to load
- `projects.js` missing from commit → planner broken on live

### Rule added
> **Pre-push parity check**: Before pushing, verify that every file referenced by an import/script tag actually exists in the commit. A pre-push hook was added (`2de1f06`) to automate this.

---

## Incident 6: `version.js` Top-Level Await
**Date**: March 2025
**Commits**: `cb1c9c7`

### What happened
Claude added a `version.js` module that used top-level `await` outside a module context. This killed the entire app on the live site — no error message, just a blank page.

### Impact
- Complete app failure on production
- Required emergency revert

### Rule added
> **No top-level await**: Never use top-level await in scripts that aren't guaranteed to be loaded as ES modules. Move async init into a function.

---

## Incident 7: `parseInt` on UUID Task IDs
**Date**: March 2025
**Commits**: `df36f5d`

### What happened
Claude used `parseInt()` to parse task IDs that had been changed from sequential integers to UUIDs. `parseInt("a3f8...")` returns `NaN`, breaking all click and drag handlers.

### Impact
- No tasks could be clicked, edited, or dragged
- Silent failure — no error, just dead UI

### Rule added
> **Know your data types**: When code handles IDs, check what format they're in before applying type conversions. UUIDs are strings, not numbers.

---

## Incident 8: Restore Nuking Auth State
**Date**: March 2025–2026
**Commits**: `fd515d8`

### What happened
The backup restore feature wrote all keys to localStorage, which overwrote the auth session token. After restore, the user was logged out with no way to recover without re-authenticating.

### Impact
- Users lost their login session after restoring a backup
- Required re-login, which some users didn't expect

### Rule added
> **Preserve auth state across destructive operations**: Any feature that bulk-writes to localStorage must preserve auth keys. Save them before, restore them after.

---

## Incident 9: Auth Gate Bypass
**Date**: March 2025
**Commits**: `9a4211c`

### What happened
The auth overlay could be bypassed — the full app UI rendered briefly before the auth gate was applied, and in some cases the gate never applied at all if post-render code threw an error.

### Impact
- Flash of logged-in UI before auth check
- In error cases, full app accessible without login

### Commits that fixed
- `2933e93` — Fix flash of logged-in UI
- `2c4df6c` — Fix auth-gate stuck when post-render throws

---

## Incident 10: Mobile Login UX — Multi-Round Fix
**Date**: March 2026
**Commits**: `90c7efe` → `2120d2a` → `bb10317` → `ab3fbbd` → `155b632` → `ffc41f2` → `388ad7b` → `ccc350a`

### What happened
Mobile login required **8 separate fix commits** across multiple sessions. Issues included:
- Keyboard covering input fields
- Auto-focus triggering keyboard on load
- Password manager autofill broken
- Double-tap required on login button
- `touchstart` blur handler caused keyboard flicker loop (had to revert)

### Lesson
> Mobile input handling is a minefield. Test keyboard show/hide, autofill, and touch events together — not in isolation. A fix for one often breaks another.

---

## Incident 11: Session Context Drift — "File Doesn't Exist"
**Date**: March 2026

### What happened
A Claude CLI terminal session claimed AI chat files (`ai-chat.js`, `ai-intent.js`, etc.) had "never been implemented" and didn't exist in the repo — despite them being present on `main` and visible on the live site.

### Root cause
The session likely had stale context or was on a different branch. It searched, found nothing, and confidently declared the files never existed.

### Lesson
> **Don't trust negative search results**: If a search says a file doesn't exist but the user says it does, re-check. Run `git fetch && git checkout main && ls` before declaring something missing. Stale branch state is common.

---

## Summary of All Rules

| # | Rule | Triggered by |
|---|------|-------------|
| 1 | Migration order: build → verify → teardown | Data loss (Incident 1) |
| 2 | Red-team migrations: grep for all old refs | Half-removed code (Incident 1) |
| 3 | Ask if integration is still in use before debugging | Wasted work (Incident 2) |
| 4 | Deploy: commit → push → PR → never stop at push | 13 orphaned commits (Incident 3) |
| 5 | Never push to main directly | 403 errors (Incident 3) |
| 6 | Read full CSS cascade before editing | Multi-round CSS fixes (Incident 4) |
| 7 | One-shot CSS: all contexts in one round | Iterative debugging (Incident 4) |
| 8 | Verify all imported files are in the commit | Broken deploys (Incident 5) |
| 9 | No top-level await outside ES modules | Blank page (Incident 6) |
| 10 | Check ID data types before conversion | Dead UI (Incident 7) |
| 11 | Preserve auth keys during bulk localStorage writes | Logout on restore (Incident 8) |
| 12 | Don't trust negative searches — verify branch state | False "doesn't exist" (Incident 11) |
