/* Cache large content-addressed assets across visits.
   SHA256SUMS, catalog header, model manifest, and UI files stay network-first. */
importScripts("./asset-cache.js");

const api = self.PatentAssetCache;
let hashesPromise = null;
let hashesAt = 0;

self.addEventListener("install", function () {
  self.skipWaiting();
});

self.addEventListener("activate", function (event) {
  event.waitUntil((async function () {
    if (api && api.pruneOldCaches) await api.pruneOldCaches();
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", function (event) {
  const request = event.request;
  if (request.method !== "GET") return;
  let url;
  try { url = new URL(request.url); } catch (e) { return; }
  if (url.origin !== self.location.origin) return;
  if (!api) return;
  const rel = api.relativePath(url, self.registration.scope);
  if (!rel || rel.indexOf("__sha256__/") === 0) return;
  event.respondWith(handleFetch(request, rel));
});

async function currentHashes() {
  const now = Date.now();
  if (hashesPromise && now - hashesAt < 30000) return hashesPromise;
  hashesAt = now;
  hashesPromise = loadHashes();
  try {
    return await hashesPromise;
  } catch (err) {
    hashesPromise = null;
    return {};
  }
}

async function loadHashes() {
  const url = new URL("SHA256SUMS", self.registration.scope);
  try {
    const resp = await fetch(url, { cache: "no-store" });
    if (resp.ok) {
      const text = await resp.text();
      const hashes = api.parseSha256Sums(text);
      try {
        const cache = await caches.open(api.META_CACHE);
        await cache.put(url, new Response(text, { headers: { "Content-Type": "text/plain" } }));
      } catch (e) {}
      try { await api.pruneBodies(hashes, self.registration.scope); } catch (e) {}
      return hashes;
    }
  } catch (e) {}
  try {
    const cache = await caches.open(api.META_CACHE);
    const hit = await cache.match(url);
    if (hit) return api.parseSha256Sums(await hit.text());
  } catch (e) {}
  return {};
}

async function handleFetch(request, rel) {
  if (api.isHashAddressed(rel)) {
    const hashes = await currentHashes();
    const hash = hashes[rel];
    if (hash) {
      try {
        const hit = await api.matchBody(rel, hash, self.registration.scope);
        if (hit) return api.withCacheHeader(hit, "local");
      } catch (e) {}
    }
    const resp = await fetch(request, { cache: "no-store" });
    if (resp.ok && hash) {
      try { await api.putBody(rel, hash, resp.clone(), self.registration.scope); } catch (e) {}
    }
    return api.withCacheHeader(resp, "network");
  }
  const cache = await caches.open(api.META_CACHE);
  try {
    const resp = await fetch(request, { cache: "no-store" });
    if (resp.ok) {
      try { await cache.put(request, resp.clone()); } catch (e) {}
    }
    return api.withCacheHeader(resp, "network");
  } catch (err) {
    const hit = await cache.match(request);
    if (hit) return api.withCacheHeader(hit, "local");
    throw err;
  }
}
