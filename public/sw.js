// Service worker: network-first for the app shell + the (unversioned) Tailwind
// CDN, cache-first for immutable versioned libs, passthrough for everything else
// (Firestore/APIs manage their own offline behaviour).
//
// EMERGENCY KILL SWITCH: if this SW ever misbehaves, replace this whole file
// with:  self.addEventListener('install', () => self.skipWaiting());
//        self.addEventListener('activate', e => e.waitUntil(
//          self.registration.unregister()
//            .then(() => self.clients.matchAll())
//            .then(cs => cs.forEach(c => c.navigate(c.url)))));
// deploy it, and every client unregisters on next load.

const CACHE = "cc-shell-v1";

// Same-origin shell (relative to the SW scope = site root) -> network-first.
const SHELL = [
  "/",
  "/index.html",
  "/app.js",
  "/firebase-config.js",
  "/manifest.json",
  "/favicon.ico",
];

// Immutable, versioned cross-origin libs (URLs never change) -> cache-first.
const LIBS = [
  "https://www.gstatic.com/firebasejs/8.10.1/firebase-app.js",
  "https://www.gstatic.com/firebasejs/8.10.1/firebase-auth.js",
  "https://www.gstatic.com/firebasejs/8.10.1/firebase-firestore.js",
  "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js",
];

// Unversioned/mutable CDN -> network-first so a deploy is never pinned to an
// old Tailwind runtime; the cached copy is only an offline fallback.
const TAILWIND = "https://cdn.tailwindcss.com";

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(SHELL);
    // Cross-origin precache: fetch no-cors and put individually so one CORS
    // hiccup doesn't fail the whole install.
    await Promise.all([...LIBS, TAILWIND].map(async (url) => {
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

// Network-first: serve fresh when online, fall back to cache offline. The cache
// write goes through event.waitUntil so the SW stays alive until it completes
// (returning the response early would otherwise drop the update).
async function networkFirst(event, navFallback) {
  const req = event.request;
  const cache = await caches.open(CACHE);
  try {
    const fresh = await fetch(req);
    event.waitUntil(cache.put(req, fresh.clone()));
    return fresh;
  } catch (e) {
    const cached = await cache.match(req);
    if (cached) return cached;
    return navFallback ? cache.match("/index.html") : Response.error();
  }
}

async function cacheFirst(event) {
  const req = event.request;
  const cache = await caches.open(CACHE);
  const cached = await cache.match(req);
  if (cached) return cached;
  const res = await fetch(req);
  event.waitUntil(cache.put(req, res.clone()));
  return res;
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return; // never touch writes
  const url = new URL(req.url);

  if (isShellRequest(req, url)) {
    event.respondWith(networkFirst(event, true));   // index.html nav fallback
    return;
  }
  if (req.url === TAILWIND) {
    event.respondWith(networkFirst(event, false));   // fresh CSS online, cache offline
    return;
  }
  if (LIBS.includes(req.url)) {
    event.respondWith(cacheFirst(event));
    return;
  }
  // Everything else (Firestore, Hebcal, OpenFoodFacts, etc.): passthrough.
});
