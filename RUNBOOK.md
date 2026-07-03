# Quick Planner - Runbook

## Ownership

| Layer | Owner | Notes |
|-------|-------|-------|
| Frontend (Cloudflare Pages) | Dave | Auto-deploys from `main` |
| API Worker (Cloudflare Workers) | Dave | `qp-api` worker, manual deploy via wrangler |
| Database (Cloudflare D1) | Dave | `quick-planner-db` |
| DNS | Dave | Cloudflare - `planner.davegregurke.au` |
| Auth | Worker | JWT, bcrypt, HIBP breach check |
| CI/CD | GitHub Actions | See `.github/workflows/` |

---

## Deploy

### Frontend
Push to `main`. Cloudflare Pages auto-deploys in ~60 seconds.
Post-deploy verification runs automatically via `.github/workflows/post-deploy.yml`.

### Worker API
```bash
cd worker
wrangler deploy
```
Requires Cloudflare login (`wrangler login`). Apply pending DB migrations first (see below).

### DB migrations
```bash
cd worker
wrangler d1 migrations apply quick-planner-db --remote
```
Always run migrations before deploying Worker code that depends on new columns.

---

## Rollback

### Frontend rollback
Cloudflare Pages keeps deployment history. Go to:
Cloudflare Dashboard > Pages > quick-planner > Deployments > select previous > Rollback

### Worker rollback
Cloudflare Workers keeps previous versions. Go to:
Cloudflare Dashboard > Workers > qp-api > Deployments > Rollback

### DB rollback
D1 has no automatic rollback. Write a compensating migration and apply it.
Before any destructive migration, export a snapshot:
```bash
wrangler d1 export quick-planner-db --remote --output backup-$(date +%Y%m%d).sql
```

---

## Monitoring

| Check | Where | Frequency |
|-------|-------|-----------|
| Uptime + smoke test + headers | `.github/workflows/monitor.yml` | Daily 08:00 AEST |
| Dependency vulnerabilities | `.github/workflows/security-audit.yml` | Weekly Monday |
| Post-deploy verification | `.github/workflows/post-deploy.yml` | Every push to main |

If a monitor run fails, GitHub sends an email to the repo owner.

---

## Incident response

### Site is down
1. Check Cloudflare Pages status: https://www.cloudflarestatus.com
2. Check last deployment succeeded in GitHub Actions (post-deploy workflow)
3. Roll back to previous Cloudflare Pages deployment if new deploy is the cause
4. Check Worker logs: Cloudflare Dashboard > Workers > qp-api > Logs

### Data loss reported
1. Check the user's localStorage backup (Settings > Backup all data)
2. Check D1 for the record: `wrangler d1 execute quick-planner-db --remote --command "SELECT * FROM tasks WHERE id = '<id>'"`
3. If data was deleted server-side with no backup: no automated recovery - explain to user

### Security incident (credential exposure)
1. Rotate the JWT secret immediately (update Worker secret via Cloudflare dashboard)
2. All existing sessions are invalidated on next request (tokens signed with old secret will fail)
3. If DB credentials exposed: Cloudflare D1 credentials are managed by Cloudflare - rotate via dashboard
4. Document in INCIDENTS.md

### Dependency vulnerability
The weekly security audit opens a PR automatically with the fix. Review and merge it.
If critical (CVSS 9+), fix manually: `npm audit fix`, commit, push.

---

## Local development

```bash
npm run dev          # serves on :8000
npm run smoke        # smoke test against localhost:8000
npm run smoke:live   # smoke test against production
bash scripts/verify-headers.sh  # check security headers on production
```

---

## Key URLs

| Resource | URL |
|----------|-----|
| Live site | https://planner.davegregurke.au |
| Cloudflare dashboard | https://dash.cloudflare.com |
| GitHub repo | https://github.com/dgc-tree/Quick-planner |
| Worker API | https://qp-api.davegregurke.workers.dev |
