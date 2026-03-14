# Quick Planner — Project Rules

## CSS Workflow
- **Read before writing**: Read the full rule + dark mode override + mobile media query before editing any CSS. For layout bugs, read body → main → container chain. Never guess at cascade.
- **One-shot CSS**: Check all override contexts (dark, mobile, responsive) and apply all changes in one round. Don't iterate with the user as debugger.

## Commit & Deploy
This repo deploys directly via Cloudflare Pages from the `main` branch (~1 minute auto-deploy).
- **Live URL**: `planner.davegregurke.au` (Cloudflare Pages project: `quick-planner`)
- **Old URL**: `davegregurke.au/pd2/` redirects via 301 to the new subdomain

### Branch naming — one branch per task
Each task gets its own branch and PR. Never reuse a branch for unrelated work. This keeps the merged PR list readable as a project changelog.

- **Format**: `claude/<category>/<short-description>-<sessionId>`
- **Categories**: `fix/`, `feat/`, `refactor/`, `docs/`, `style/`
- **Examples**:
  - `claude/fix/mobile-overflow-sWJa4`
  - `claude/feat/export-csv-xK9m2`
  - `claude/style/dark-mode-cards-pQ3r1`
- **PR title** = plain English summary of the task (under 70 chars)
- **Result**: merged PR history reads like a done column on a kanban board

### Deploy process (follow every time)
The environment restricts pushes to `claude/` branches only. You **cannot** push to `main` directly. When the user says "commit and push" or expects changes to go live:

1. **Commit** to the current `claude/` feature branch
2. **Push** the feature branch: `git push -u origin claude/<branch-name>`
3. **Rebase** onto `origin/main` first if the branch was previously merged (otherwise GitHub shows "nothing to compare"): `git fetch origin main && git rebase origin/main && git push --force-with-lease`
4. **Create a PR** immediately — do not stop at "pushed to branch" and wait for the user to ask. Use the GitHub API via `curl`:
   ```
   curl -s -X POST https://api.github.com/repos/dgc-tree/Quick-planner/pulls \
     -H "Accept: application/vnd.github+json" \
     -H "Authorization: Bearer $GITHUB_TOKEN" \
     -d '{"title":"<title>","head":"claude/<branch>","base":"main","body":"<summary>"}'
   ```
   If no API token is available, give the user the compare URL and explicitly tell them to create and merge the PR: `https://github.com/dgc-tree/Quick-planner/compare/main...claude/<branch>`
5. **Never** stop at step 2 and say "done". The user expects live deployment. Pushing to a feature branch alone does nothing.

### What NOT to do
- Don't attempt `git push origin main` — it will 403 every time
- Don't try multiple auth workarounds when the first one fails — go straight to giving the user the compare URL
- Don't tell the user "you'll need to merge yourself" without giving the direct link
- Don't make the user ask twice for a PR — offer it immediately after the push is blocked

### Incident (March 2026)
Session pushed 13 commits to the feature branch but never merged to `main` or created a PR. When asked to go live, attempted to push to `main` (403), then spent multiple rounds trying different auth methods for the GitHub API, asking the user to do it manually, and giving broken instructions. The user had to ask 4 times before getting a working link. Root cause: no documented process for the `claude/` branch constraint. All of this should have been one smooth step.

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

## 5. Migration Discipline
- When replacing a system (e.g. swapping a data source, removing an integration), **tear down the old system in the same step** — delete dead code, remove imports, clean up call sites
- Never leave orphaned integration code wired into live error paths; it will break
- Treat migration as: build the new thing → verify it works → rip out the old thing. All three steps, same session
- **Red-team every migration**: after removing code, grep for all references to the old system across JS, HTML, and CSS. Check both read and write paths. A half-removed integration is worse than one left fully in place
- **Data migration rule**: when moving data from an external source to local storage, the migration order is: (1) fetch and write all data to the new store, (2) verify the new store loads correctly, (3) only then remove the old data source. Never remove a read path before confirming the data exists in the new location
- **Incident (March 2025)**: When the project moved off Google Sheets to localStorage, the data was never actually cloned to localStorage first. The sheet write side (`sheet-writer.js`) was removed, then the read side (`fetchSheetData`) was removed, without ever persisting the sheet data locally. This caused: (1) false error toast on every create/edit, (2) new tasks silently lost on refresh, (3) all existing Renos project data disappeared because the only data source was deleted without migrating. Root cause: migration steps were done out of order — teardown happened before data transfer.

## 6. Bug Triage — Ask Before Assuming
- When a bug involves an external integration (API, sheet sync, third-party service), **ask the user whether that integration is still in use** before debugging it
- Don't patch plumbing the user has already abandoned — remove dead code instead
- Prefer deletion over repair when the feature is no longer needed

# ── END: Claude Guidelines ──
