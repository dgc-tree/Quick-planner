# Incident: Universal Refresh-to-Home + Data Loss
**Date:** 2026-05-27  
**PR:** #90  
**Severity:** High — data loss on every cold-start or flaky network

---

## What happened

Users reported the app "refreshing back to the Home Screen" after ~30 seconds, with changes lost. It happened universally across every view (planner, to-do list, chat).

The root cause was three latent design decisions that combined into a production bug once the app had real daily usage:

1. **Broad catch in `verifySession()`** — the catch block called `setAuth(null, null)` on *any* exception: token invalid, network down, server timeout, 5xx error. The intent was "if we can't confirm the session, log them out." That's reasonable on a reliable desktop connection, catastrophic on mobile.

2. **Cloudflare Worker cold starts** — the API Worker at `qp-api.davegregurke.workers.dev` takes 20–30 seconds to respond when it hasn't been hit recently. `verifySession()` runs a network request on every page load. On a cold start, the fetch would hang ~30 seconds, then either time out or throw — triggering the broad catch, which wiped the token and showed the auth gate.

3. **`syncFromServer()` overwrites on re-auth** — when the user re-authenticated, `initApp()` called `syncFromServer()` which replaced all localStorage with the server's last known state. Any local changes made between the previous sync and the auth-gate moment were gone.

The chat panel restore was also broken: `restoreOverlayOnLoad()` ran before `initChat()` created the panel DOM, so `window._openChatPanel` was never available.

---

## The fix

```js
// auth.js — apiCall now stamps err.status so callers can distinguish HTTP vs network
if (!res.ok) {
  const err = new Error(data.error || `Request failed (${res.status})`);
  err.status = res.status;
  throw err;
}

// verifySession — only wipe the token for confirmed 401/403
} catch (err) {
  if (err.status === 401 || err.status === 403) {
    setAuth(null, null);
  }
  return false;
}

// initApp — only show auth gate when the token was actually cleared
if (!valid) {
  if (!isLoggedIn()) {
    // server confirmed invalid — gate
  }
  // else network error — render from localStorage, skip sync
}
```

Chat panel restore was split into `restoreChatPanelOnLoad()` and moved to after `initChat()`.

---

## Lessons

### 1. Never conflate network errors with auth failures

A catch-all that treats "can't reach server" the same as "server rejected my token" will log users out on any connectivity hiccup. Always check `err.status` (or `err instanceof TypeError` for network failures) before taking destructive auth actions.

**Rule:** Only call `logout()` / `setAuth(null, null)` when you have a confirmed 4xx from the server. Not on network errors, not on 5xx, not on timeouts.

### 2. Infrastructure cold starts are real latency in your app

Serverless platforms (Cloudflare Workers, Lambda, etc.) have cold-start periods. If your app makes a blocking network call on startup before rendering anything, users will stare at a loading screen during every cold start. Plan for this:

- Use a startup timeout: if verification takes > N seconds, proceed with cached credentials and retry in the background
- OR: render from localStorage immediately and verify in the background, gating only sync (not rendering) on auth confirmation
- OR: keep the Worker warm with a scheduled ping

### 3. Offline-first means localStorage is the source of truth

`syncFromServer()` replacing all localStorage data is a sync pattern suited for the *initial* app install, not for every re-authentication. A safe merge would compare `updatedAt` timestamps and take the newer record. As-is, any local change that hasn't synced yet is permanently lost if the user is forced to re-authenticate.

**Rule:** Before overwriting local data with remote data, check which is newer. Don't let a sync wipe unsaved work.

### 4. Restore sequences must respect init order

`restoreOverlayOnLoad()` tried to re-open the chat panel before `initChat()` had injected the panel into the DOM. The fix check (`typeof window._openChatPanel === 'function'`) silently no-ops instead of surfacing the timing bug. Restoring any UI state requires the UI to actually exist first.

**Rule:** Call restore functions *after* the thing being restored has been created, not just guarded with a typeof check that hides the ordering error.

### 5. Symptom descriptions are often one step removed from root cause

"Refreshes back to home screen after 30 seconds" sounded like a timer or a reload. There was no timer. The 30 seconds was Cloudflare Worker cold-start latency, and the "home screen" was the auth gate. Chasing the described symptom (looking for `setTimeout`, `location.reload`, service workers) added investigation time. 

The actual question to ask first: *what state change would produce this visual outcome?* Auth gate showing = token cleared = `setAuth(null, null)` was called. Work backwards from state, not forwards from symptoms.

---

## Checklist additions for future auth + sync work

- [ ] Does this catch block distinguish HTTP errors from network errors?
- [ ] Does any `logout()` / `setAuth(null, null)` call have a confirmed 4xx before it runs?
- [ ] If the server is slow or down, can the user still see and interact with their data?
- [ ] Does any sync-from-server call overwrite local data that might be newer?
- [ ] Is each restore/re-open call placed *after* the target UI has been created?
