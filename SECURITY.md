# Security & Data Integrity

This file tracks security-relevant decisions, dependency posture, and data integrity changes across the planner client (this repo) and the qp-api Worker.

Pair with [INCIDENTS.md](INCIDENTS.md) (engineering post mortems) and [CLAUDE.md](CLAUDE.md) (session rules).

## Best practices (review monthly)

Tick through this list on the first of each month and after any release that touches auth, sync, or storage.

### Dependencies
- [ ] Run `npm run audit` and resolve any high or critical advisories.
- [ ] Review Dependabot PRs (`.github/dependabot.yml`). Merge patch and minor bumps; vet major ones.
- [ ] Confirm `package-lock.json` is committed.

### Secrets
- [ ] Grep tracked files for `API_KEY`, `SECRET`, `TOKEN`, `Bearer ` (with quotes) before pushing.
- [ ] Confirm the qp-api Worker `wrangler.toml` only references secrets, not literals.
- [ ] Rotate the JWT signing secret if any worker source has been shared externally.

### Auth and session
- [ ] Verify `js/auth.js` still uses `verifySession()` on app load.
- [ ] Confirm sandbox mode never writes to the real backend.
- [ ] Confirm logout clears all `qp-*` localStorage keys.

### Sync and data integrity
- [ ] Confirm every task/project field saved in `js/storage.js` is either pushed by `js/sync.js` OR explicitly preserved on pull. Schema drift between client and worker silently loses data (see Changelog 2026-04-27).
- [ ] After any worker schema migration: walk the JSON shape end to end (client save → push → DB → pull → client load) and confirm every field round trips.

### Backups
- [ ] Settings → Backup all data still exports a complete JSON snapshot.
- [ ] Trash and Archive views still show the expected lifetimes (30 day trash, indefinite archive).

## Changelog

Most recent first. Each entry: date, summary, action taken, follow up.

### 2026-04-27 - Baseline npm audit + first fix
**Summary:** `npm audit` reported 1 high advisory in `basic-ftp` (transitive via `puppeteer`). `npm audit fix` applied a non-breaking bump (basic-ftp 5.2.0 -> 5.3.0). Audit now clean (0 vulnerabilities).

**Action:** lock committed; the security-audit GitHub Action should now pass on this branch.

**Follow up:** none. Audit re runs weekly via the workflow + on every package.json/lock PR.

### 2026-04-27 - Archive state lost on refresh (data integrity, not security)
**Summary:** the qp-api D1 `tasks` table had no columns for `archived`, `archived_at`, `archive_reason`. `syncFromServer()` ran on every refresh and replaced localStorage with the server response, wiping the local archive flag.

**Action (client):** `js/sync.js` now indexes the local copy by task id on pull and overlays local-only fields onto the merged result. Push payload includes archive fields. On pull, if the response carries an `archived` property the server is authoritative; otherwise local is preserved. This makes the client tolerant of both pre-migration and post-migration worker states.

**Action (worker):** added `worker/migrations/0002_add_task_archive.sql` (adds the three columns) and updated `INSERT/UPDATE` in `worker/src/index.js` (both `handleProjectSave` and `handleFullSync`) to write them. `SELECT *` in `handleFullPull` returns them automatically.

**Deploy steps:** run the D1 migration (`npx wrangler d1 migrations apply quick-planner-db --remote`), redeploy the worker, then archive state round trips cross-device.

**Follow up:** none after worker deploy. Until the worker is redeployed, archive remains per-device but no longer wipes on refresh.

**Lesson recorded:** never add a client-only field on a model the sync pipeline overwrites without first extending the server schema or marking the field as local-only with a defensive merge in `syncFromServer`. Schema drift between client and worker silently loses data.

### 2026-04-26 - Public Google Sheet migration removed
**Summary:** earlier sessions migrated personal renovation data from a public Google Sheet on every fresh visit (data leak risk and bypass of onboarding).

**Action:** `migrateRenosFromSheet()`, `RENOS_SHEET_CSV` constant, and `normaliseRows` import removed from `js/app.js`.

**Follow up:** none. Existing users keep data via `qp-projects` localStorage. The sheet remains accessible if anyone needs to re-import via the CSV import modal.

## Audit and update automation

- `.github/workflows/security-audit.yml` runs `npm audit --audit-level=moderate` weekly and on every PR.
- `.github/dependabot.yml` opens PRs for npm dep updates weekly (grouped by patch/minor/major).

If either is removed or stops running, manual review reverts to "weekly during the monthly checklist above".

## Reporting a vulnerability

Email davegregurke@gmail.com with subject `[Quick Planner Security]`. No public issues for security reports.
