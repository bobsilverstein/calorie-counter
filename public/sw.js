// Service worker: network-first for the app shell, cache-first for immutable
// CDN libs, passthrough for everything else (Firestore/APIs manage themselves).
//
// EMERGENCY KILL SWITCH: if this SW ever misbehaves, replace this whole file
// with:  self.addEventListener('install', () => self.skipWaiting());
//        self.addEventListener('activate', e => e.waitUntil(
//          self.registration.unregister()
//            .then(() => self.clients.matchAll())
//            .then(cs => cs.forEach(c => c.navigate(c.url)))));
// deploy it, and every client unregisters on next load.

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
