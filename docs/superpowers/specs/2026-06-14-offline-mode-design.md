# Offline mode (view + log) — design spec

- Date: 2026-06-14
- Issue: #10
- Status: approved (design); pending implementation plan

## Goal

Make the calorie counter usable with no network: open the app, see recent
data, and add servings/notes that sync automatically when back online. A small
indicator tells you when you're offline so you trust that a queued entry saved.

## Two independent halves

### Half 1 — Data offline (Firestore persistence)

Enable Firestore's built-in offline cache **once, before any other Firestore
call**:

```js
firebase.firestore().enablePersistence({ synchronizeTabs: true })
  .catch(() => { /* multi-tab or unsupported browser: stay online-only */ });
```

- Reads (`loadLog`, `loadNotes`, the `Foods` `onSnapshot`) serve from the local
  IndexedDB cache when offline. `.get()` returns cached docs offline once
  persistence is on.
- Writes (`addSave` → `.add()`, `saveNotes` → `.set(merge)`, entry deletes,
  `autoBackup`) **queue locally and auto-sync** when connectivity returns.
  Firestore owns the sync and conflict resolution — no custom code.
- Error handling: `enablePersistence` rejects with `failed-precondition`
  (multiple tabs) or `unimplemented` (browser unsupported). Both are caught and
  ignored — the app simply runs online-only, exactly as today. Persistence must
  be enabled before the first Firestore use, so it goes at the very top of the
  `DOMContentLoaded` handler.

### Half 2 — App shell offline (service worker)

Replace the current "unregister + block all service workers" block in `app.js`
with a real `public/sw.js` and a registration call.

**Fetch strategies:**
- **App shell** (same-origin navigations, `index.html`, `app.js`,
  `firebase-config.js`, `manifest.json`, favicon): **network-first, cache
  fallback.** Online always fetches the latest from the network (so new deploys
  apply immediately — this is the deliberate fix for prior stale-deploy pain);
  each successful fetch refreshes the cache; offline serves the last-known-good
  copy.
- **Versioned CDN libs** (Firebase 8.10.1 from gstatic, Tailwind CDN, xlsx CDN):
  **cache-first.** Their URLs are immutable, so cache-first is safe and makes
  offline loads reliable. Precached on `install`.
- **Everything else** (Firestore/Hostname API calls, Hebcal, OpenFoodFacts):
  pass through to the network untouched — never cached. Firestore's own
  persistence handles data offline.

**Lifecycle:** versioned cache name; `install` precaches the shell + libs and
`skipWaiting()`; `activate` deletes old caches and `clients.claim()`. Because
the shell is network-first, a bad `sw.js` is self-healing — the next online load
fetches a corrected one; an emergency unregister snippet is documented in
`sw.js` as a comment.

### Offline indicator ("offline dot")

A small fixed bar/dot, hidden by default, shown via `navigator.onLine` plus
`window` `online`/`offline` events: `● offline — changes will sync`. Pure
client state; no effect on data flow.

## Files changed

- `public/sw.js` — new. Precache list, fetch router, lifecycle.
- `public/app.js` — remove the SW kill block; add `enablePersistence` (top of
  `DOMContentLoaded`); register `/sw.js`; wire the offline-dot to online/offline
  events.
- `public/index.html` — add the hidden offline-dot element.

No CI change: network-first means the cache name does not need version-stamping
for freshness.

## Non-goals (YAGNI)

- No conflict/merge UI — Firestore owns it.
- No "update available" toast — network-first makes it moot.
- No SW caching of Firestore data — persistence owns data; SW owns the static
  shell only. The two never overlap.
- Installability/manifest unchanged (already wired).

## Verification

On the PR's preview channel, with Playwright offline mode:
1. Load online; confirm SW registers and precaches.
2. Go offline, reload → app shell loads (no blank page).
3. A previously-viewed day's log renders from cache.
4. Add a serving offline → it appears locally and the offline dot shows.
5. Go back online → the queued write syncs to Firestore.

Plus a manual check that the live version label updates after deploy.

## Risk / rollback

Network-first keeps stale-deploy risk minimal. If a SW misbehaves: deploy a
corrected `sw.js` (picked up on the next online load) or use the documented
unregister path. Firestore persistence is independently safe — failure degrades
to today's online-only behavior.
