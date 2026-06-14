# Offline mode (view + log) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the calorie counter usable with no network — open the app, see recent data, and add servings/notes that sync when back online — with a small "offline" indicator.

**Architecture:** Two independent halves. (1) Firestore offline persistence (one call) gives cached reads + queued writes. (2) A network-first service worker caches the static app shell + immutable CDN libs so the page itself loads offline. A tiny banner reflects `navigator.onLine`.

**Tech Stack:** Vanilla JS, Firebase v8 compat SDK, Tailwind (CDN), Firebase Hosting. No build step, no test framework — verification is `node --check` + Playwright against a local `python3 -m http.server`.

**Spec:** `docs/superpowers/specs/2026-06-14-offline-mode-design.md`

**Pre-req for executor:** Read `public/app.js` and `public/index.html` first to confirm the exact anchor strings below still match.

---

### Task 1: Enable Firestore offline persistence

**Files:**
- Modify: `public/app.js` (inside `DOMContentLoaded`, immediately after `const db = firebase.firestore();`)

- [ ] **Step 1: Add the persistence call**

Find the line (first statement inside the `DOMContentLoaded` handler):
```js
  const db = firebase.firestore();
```
Replace it with:
```js
  const db = firebase.firestore();

  // Offline persistence: cached reads + queued writes that sync on reconnect.
  // Must run before any query. Fails harmlessly if multiple tabs are open
  // (failed-precondition) or the browser is unsupported (unimplemented) — in
  // those cases the app simply behaves online-only, exactly as before.
  db.enablePersistence({ synchronizeTabs: true }).catch(() => {});
```

- [ ] **Step 2: Verify syntax**

Run: `node --check public/app.js`
Expected: no output (exit 0).

- [ ] **Step 3: Commit**

```bash
git add public/app.js
git commit -m "feat(offline): enable Firestore offline persistence"
```

---

### Task 2: Offline indicator banner

**Files:**
- Modify: `public/index.html` (add the banner element)
- Modify: `public/app.js` (wire it to online/offline events)

- [ ] **Step 1: Add the banner element to index.html**

Immediately after the opening `<body ...>` tag, add:
```html
<div id="offlineBanner"
     class="hidden fixed top-0 inset-x-0 z-50 text-center text-xs font-semibold bg-amber-500 text-white py-1">
  ● offline — changes will sync when you reconnect
</div>
```

- [ ] **Step 2: Wire it up in app.js**

Inside the `DOMContentLoaded` handler, near the other `init` calls at the bottom (just before the closing `});` of the handler), add:
```js
  // Offline indicator
  const offlineBanner = document.getElementById("offlineBanner");
  const updateOnlineStatus = () =>
    offlineBanner.classList.toggle("hidden", navigator.onLine);
  window.addEventListener("online", updateOnlineStatus);
  window.addEventListener("offline", updateOnlineStatus);
  updateOnlineStatus();
```

- [ ] **Step 3: Verify syntax**

Run: `node --check public/app.js`
Expected: no output (exit 0).

- [ ] **Step 4: Commit**

```bash
git add public/app.js public/index.html
git commit -m "feat(offline): add offline indicator banner"
```

---

### Task 3: Create the service worker

**Files:**
- Create: `public/sw.js`

- [ ] **Step 1: Write `public/sw.js`**

```js
// Service worker: network-first for the app shell, cache-first for immutable
// CDN libs, passthrough for everything else (Firestore/APIs manage themselves).
//
// EMERGENCY KILL SWITCH: if this SW ever misbehaves, replace this whole file
// with:  self.addEventListener('install',()=>self.skipWaiting());
//        self.addEventListener('activate',e=>e.waitUntil(self.registration.unregister().then(()=>self.clients.matchAll()).then(cs=>cs.forEach(c=>c.navigate(c.url)))));
// deploy it, and every client will unregister on next load.

const CACHE = "cc-shell-v1";

// Same-origin shell (relative to the SW scope = site root).
const SHELL = [
  "/",
  "/index.html",
  "/app.js",
  "/firebase-config.js",
  "/manifest.json",
  "/favicon.ico",
];

// Immutable, versioned cross-origin libs (URLs never change).
const LIBS = [
  "https://www.gstatic.com/firebasejs/8.10.1/firebase-app.js",
  "https://www.gstatic.com/firebasejs/8.10.1/firebase-auth.js",
  "https://www.gstatic.com/firebasejs/8.10.1/firebase-firestore.js",
  "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js",
  "https://cdn.tailwindcss.com",
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // Same-origin: addAll is fine (one failure would fail install, which is OK
    // because these MUST exist).
    await cache.addAll(SHELL);
    // CDN libs: fetch no-cors and put individually so one CORS hiccup doesn't
    // fail the whole install.
    await Promise.all(LIBS.map(async (url) => {
      try {
        const res = await fetch(url, { mode: "no-cors" });
        await cache.put(url, res);
      } catch (e) { /* tolerate */ }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

function isShellRequest(req, url) {
  if (req.mode === "navigate") return true;
  if (url.origin === self.location.origin) {
    return SHELL.includes(url.pathname) || url.pathname === "/app.js";
  }
  return false;
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return; // never touch writes
  const url = new URL(req.url);

  // App shell: network-first, fall back to cache offline.
  if (isShellRequest(req, url)) {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(CACHE);
        cache.put(req, fresh.clone());
        return fresh;
      } catch (e) {
        const cached = await caches.match(req);
        return cached || caches.match("/index.html");
      }
    })());
    return;
  }

  // Immutable CDN libs: cache-first.
  if (LIBS.includes(req.url)) {
    event.respondWith((async () => {
      const cached = await caches.match(req);
      if (cached) return cached;
      const res = await fetch(req, { mode: "no-cors" });
      const cache = await caches.open(CACHE);
      cache.put(req, res.clone());
      return res;
    })());
    return;
  }

  // Everything else (Firestore, Hebcal, OpenFoodFacts, etc.): passthrough.
});
```

- [ ] **Step 2: Verify syntax**

Run: `node --check public/sw.js`
Expected: no output (exit 0).

- [ ] **Step 3: Commit**

```bash
git add public/sw.js
git commit -m "feat(offline): add network-first service worker for the app shell"
```

---

### Task 4: Register the service worker (replace the kill block)

**Files:**
- Modify: `public/app.js` (top-level, replace the SW-unregister block)

- [ ] **Step 1: Replace the kill block with registration**

Find this top-level block (above the `DOMContentLoaded` listener):
```js
if ("serviceWorker" in navigator) {
  // Kill all existing SWs
  navigator.serviceWorker.getRegistrations().then(regs => {
    regs.forEach(reg => reg.unregister());
  });

  // Block all future SW registrations
  navigator.serviceWorker.register = () => Promise.resolve(null);
}
```
Replace it with:
```js
// Register the service worker for offline support (network-first; see sw.js).
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}
```

- [ ] **Step 2: Verify syntax**

Run: `node --check public/app.js`
Expected: no output (exit 0).

- [ ] **Step 3: Commit**

```bash
git add public/app.js
git commit -m "feat(offline): register service worker (replace the SW kill block)"
```

---

### Task 5: End-to-end offline verification (Playwright on a local server)

**Files:** none (verification only)

> A service worker needs a secure context; `http://127.0.0.1` qualifies. The app reads the public prod Firestore (open rules), so data caches normally.

- [ ] **Step 1: Serve the build**

Run (background): `cd public && python3 -m http.server 8099 --bind 127.0.0.1`
Do NOT later kill it with `pkill -f "http.server 8099"` — that pattern matches the killer shell's own argv. Use the task/job stop mechanism, or `fuser -k 8099/tcp`.

- [ ] **Step 2: First online load registers the SW and caches the shell**

Playwright: navigate to `http://127.0.0.1:8099/`, resize 390x844, then evaluate:
```js
async () => {
  const reg = await navigator.serviceWorker.ready;
  const keys = await caches.keys();
  const cache = await caches.open("cc-shell-v1");
  const cached = (await cache.keys()).map(r => new URL(r.url).pathname);
  return JSON.stringify({ active: !!reg.active, cacheNames: keys, cachedShell: cached });
}
```
Expected: `active: true`, `cacheNames` includes `"cc-shell-v1"`, `cachedShell` includes `/app.js` and `/index.html`.

- [ ] **Step 3: Go offline, reload — the shell still loads**

Playwright: set the browser context offline (`context.setOffline(true)`), then navigate to `http://127.0.0.1:8099/` again and evaluate:
```js
() => ({ hasNav: !!document.querySelector('.border-t button#navLog'),
         bannerVisible: !document.getElementById('offlineBanner').classList.contains('hidden') })
```
Expected: `hasNav: true` (app shell rendered from cache), `bannerVisible: true` (offline banner shows).

- [ ] **Step 4: Offline write queues; reconnect syncs**

Playwright (still offline): evaluate a queued write and confirm it does not throw:
```js
async () => {
  const fb = firebase.firestore();
  await fb.collection("Logs").doc("__offline_probe__").collection("breakfast")
    .add({ Food: "probe", TotalCalories: 0, Timestamp: Date.now() });
  return "queued";   // resolves locally even while offline
}
```
Expected: returns `"queued"` (Firestore accepts the write into its local queue).
Then set context online (`context.setOffline(false)`), wait ~2s, and confirm no console errors about failed sync. Clean up the probe doc afterward.

- [ ] **Step 5: Record the verification result**

There is nothing to commit. Note in the PR description that Steps 2–4 passed, with the cache-name and offline-render confirmations.

---

## Rollout (after the tasks)

- [ ] Open a PR; let `preview.yml` deploy a preview channel.
- [ ] Re-run the Step 2–4 Playwright checks against the **preview URL** (real HTTPS, real SW).
- [ ] **Confirm on a phone:** load the preview, turn on airplane mode, reopen — app loads, the offline banner shows, a logged serving persists and syncs on reconnect.
- [ ] Request a Copilot review; remediate.
- [ ] Merge; verify the live deploy; confirm the old kill-block is gone so any previously-stuck SW is replaced.
