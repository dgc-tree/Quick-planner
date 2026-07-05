# Quick Planner — Backlog

## PWA: Install Locally with Cloud Upgrade Path

**Goal**: Ship Quick Planner as installable "local-first" software via Progressive Web App, with the existing cloud sync as an optional paid upgrade.

**Why PWA**: The app is already fully client-side with localStorage as the source of truth. Cloud sync (`auth.js` / `sync.js`) is already gated behind `isLoggedIn()`. A PWA adds installability and offline support with minimal new infrastructure — no Electron/Tauri build pipeline, no app store submissions, no native packaging.

**Scope**:

1. **Web App Manifest** (`manifest.json`)
   - App name, icons (192px + 512px), theme colour, display: standalone
   - Start URL, scope, background colour
   - Screenshots for install prompt (optional, improves mobile install UX)

2. **Service Worker** (`sw.js`)
   - Cache-first strategy for app shell (HTML, CSS, JS, icons)
   - Network-first for API calls (sync endpoints)
   - Versioned cache with stale-cache cleanup on activate
   - Offline fallback — app works fully without network

3. **Install Prompt UX**
   - Intercept `beforeinstallprompt` event
   - Show a subtle in-app banner or menu item: "Install Quick Planner"
   - Dismiss permanently once installed or declined

4. **Cloud Upgrade Nudge**
   - For non-logged-in users, periodic prompt: "Sync across devices — sign up for cloud"
   - Gate behind a reasonable trigger (e.g. after 7 days of use or 3+ projects)
   - Non-intrusive — dismissible, not blocking

5. **Auto-Update**
   - Service worker lifecycle handles updates automatically
   - Optional "New version available — refresh" toast on `controllerchange`

**What we don't need**:
- Electron/Tauri — adds build complexity for no benefit here (no system tray, global hotkeys, or OS integration needed)
- App store listings — PWA install covers desktop + mobile
- Separate offline data layer — localStorage already works offline

**Effort estimate**: Small. Manifest + service worker + install prompt = ~half a session. Cloud nudge UX = separate small task.
