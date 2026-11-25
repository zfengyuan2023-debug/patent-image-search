/* Shared helpers for content-addressed catalog/model caching.
   Used by the page and by sw.js. Small UI files stay network-first. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PatentAssetCache = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const VERSION = "v1";
  const PREFIX = "patent-search-";
  const BODIES_CACHE = PREFIX + "bodies-" + VERSION;
  const META_CACHE = PREFIX + "meta-" + VERSION;
  const CACHE_HEADER = "X-Patent-Cache";
  const KEY_PREFIX = "__sha256__/";

  function isHashAddressed(rel) {
    rel = normalizeRel(rel);
    if (rel === "catalog/header.json" || rel === "model/manifest.json") return false;
    if (/^catalog\/(shard-\d{4}\.bin|records-\d{4}\.json|thumbs-\d{4}\.bin|meta\.json)$/.test(rel)) {
      return true;
    }
    if (/^model\/.+\.(bin|onnx)$/.test(rel)) return true;
    if (/^vendor\/ort\/.+\.(wasm|mjs)$/.test(rel)) return true;
    return false;
  }

  function isNetworkFirst(rel) {
    return !isHashAddressed(rel);
  }

  function normalizeRel(rel) {
    rel = String(rel || "");
    try { rel = decodeURIComponent(rel); } catch (e) {}
    rel = rel.replace(/\\/g, "/");
    while (rel.charAt(0) === "/") rel = rel.slice(1);
    if (rel.slice(0, 2) === "./") rel = rel.slice(2);
    return rel;
  }

  function relativePath(url, base) {
    const resolved = new URL(url, base);
    const root = new URL("./", base);
    let rootPath = root.pathname;
    if (rootPath.charAt(rootPath.length - 1) !== "/") rootPath += "/";
    let rel = resolved.pathname;
    if (rel.indexOf(rootPath) === 0) rel = rel.slice(rootPath.length);
    return normalizeRel(rel);
  }

  function parseSha256Sums(text) {
    const map = {};
    const lines = String(text || "").split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const parts = line.split(/\s+/);
      if (parts.length < 2) continue;
      const digest = parts[0];
      const rel = normalizeRel(parts.slice(1).join(" "));
      if (digest && rel) map[rel] = digest;
    }
    return map;
  }

  function resolveSource(rel, hash, cachedHash) {
    if (!isHashAddressed(rel)) return "network";
    if (hash && cachedHash && hash === cachedHash) return "cache";
    return "network";
  }

  function guessType(rel) {
    rel = normalizeRel(rel);
    if (rel.slice(-5) === ".wasm") return "application/wasm";
    if (rel.slice(-5) === ".json") return "application/json";
    if (rel.slice(-4) === ".mjs" || rel.slice(-3) === ".js") return "text/javascript";
    return "application/octet-stream";
  }

  function scopeHref(scope) {
    const href = typeof scope === "string" ? scope : (scope && scope.href) || "./";
    const url = new URL("./", href);
    let out = url.href;
    if (out.charAt(out.length - 1) !== "/") out += "/";
    return out;
  }

  function cacheRequest(rel, hash, scope) {
    rel = normalizeRel(rel);
    return new Request(scopeHref(scope) + KEY_PREFIX + hash + "/" + rel);
  }

  function hashFromCacheUrl(url, scope) {
    const path = new URL(url, scopeHref(scope || "/")).pathname;
    const marker = "/" + KEY_PREFIX;
    const at = path.indexOf(marker);
    if (at < 0) return "";
    return path.slice(at + marker.length).split("/")[0] || "";
  }

  function coverage(hashes, cachedByRel) {
    let total = 0;
    let hit = 0;
    hashes = hashes || {};
    cachedByRel = cachedByRel || {};
    const rels = Object.keys(hashes);
    for (let i = 0; i < rels.length; i++) {
      const rel = rels[i];
      if (!isHashAddressed(rel)) continue;
      total += 1;
      if (cachedByRel[rel] && cachedByRel[rel] === hashes[rel]) hit += 1;
    }
    return { total: total, hit: hit, missing: total - hit };
  }

  async function loadAsset(rel, hash, store, fetchFn) {
    rel = normalizeRel(rel);
    if (isHashAddressed(rel) && hash && store && typeof store.match === "function") {
      const hit = await store.match(rel, hash);
      if (hit != null) return { source: "local", body: hit, fetched: false };
    }
    const body = await fetchFn(rel);
    if (isHashAddressed(rel) && hash && store && typeof store.put === "function") {
      await store.put(rel, hash, body);
    }
    return { source: "network", body: body, fetched: true };
  }

  async function pruneStore(store, hashes) {
    if (!store) return 0;
    const keep = new Set(Object.values(hashes || {}));
    let removed = 0;
    if (typeof store.keys === "function") {
      const entries = await store.keys();
      for (let i = 0; i < entries.length; i++) {
        const ent = entries[i];
        const hash = ent.hash || ent;
        if (!keep.has(hash)) {
          if (typeof store.delete === "function") await store.delete(ent.rel, ent.hash);
          removed += 1;
        }
      }
      return removed;
    }
    if (typeof store.pruneTo === "function") {
      return store.pruneTo(hashes);
    }
    return 0;
  }

  async function matchBody(rel, hash, scope) {
    if (typeof caches === "undefined" || !hash) return null;
    const cache = await caches.open(BODIES_CACHE);
    return cache.match(cacheRequest(rel, hash, scope));
  }

  async function putBody(rel, hash, data, scope) {
    if (typeof caches === "undefined" || !hash) return;
    const cache = await caches.open(BODIES_CACHE);
    let resp;
    if (typeof Response !== "undefined" && data instanceof Response) {
      resp = data;
    } else {
      resp = new Response(data, { headers: { "Content-Type": guessType(rel) } });
    }
    await cache.put(cacheRequest(rel, hash, scope), resp);
  }

  async function coverageInCache(hashes, scope) {
    const empty = coverage(hashes, {});
    if (typeof caches === "undefined") return empty;
    const cache = await caches.open(BODIES_CACHE);
    const cachedByRel = {};
    const rels = Object.keys(hashes || {});
    for (let i = 0; i < rels.length; i++) {
      const rel = rels[i];
      if (!isHashAddressed(rel)) continue;
      const hit = await cache.match(cacheRequest(rel, hashes[rel], scope));
      if (hit) cachedByRel[rel] = hashes[rel];
    }
    return coverage(hashes, cachedByRel);
  }

  async function pruneBodies(hashes, scope) {
    if (typeof caches === "undefined") return 0;
    const keep = new Set(Object.values(hashes || {}));
    const cache = await caches.open(BODIES_CACHE);
    const keys = await cache.keys();
    let removed = 0;
    for (let i = 0; i < keys.length; i++) {
      const hash = hashFromCacheUrl(keys[i].url, scope);
      if (hash && !keep.has(hash)) {
        await cache.delete(keys[i]);
        removed += 1;
      }
    }
    return removed;
  }

  async function pruneOldCaches() {
    if (typeof caches === "undefined") return 0;
    const keep = {};
    keep[BODIES_CACHE] = true;
    keep[META_CACHE] = true;
    const names = await caches.keys();
    let removed = 0;
    for (let i = 0; i < names.length; i++) {
      const name = names[i];
      if (name.indexOf(PREFIX) === 0 && !keep[name]) {
        await caches.delete(name);
        removed += 1;
      }
    }
    return removed;
  }

  function withCacheHeader(resp, source) {
    if (typeof Response === "undefined" || !resp) return resp;
    const headers = new Headers(resp.headers);
    headers.set(CACHE_HEADER, source);
    return new Response(resp.body, {
      status: resp.status,
      statusText: resp.statusText,
      headers: headers,
    });
  }

  return {
    VERSION: VERSION,
    PREFIX: PREFIX,
    BODIES_CACHE: BODIES_CACHE,
    META_CACHE: META_CACHE,
    CACHE_HEADER: CACHE_HEADER,
    isHashAddressed: isHashAddressed,
    isNetworkFirst: isNetworkFirst,
    relativePath: relativePath,
    parseSha256Sums: parseSha256Sums,
    resolveSource: resolveSource,
    loadAsset: loadAsset,
    pruneStore: pruneStore,
    coverage: coverage,
    matchBody: matchBody,
    putBody: putBody,
    coverageInCache: coverageInCache,
    pruneBodies: pruneBodies,
    pruneOldCaches: pruneOldCaches,
    cacheRequest: cacheRequest,
    hashFromCacheUrl: hashFromCacheUrl,
    withCacheHeader: withCacheHeader,
    guessType: guessType,
    normalizeRel: normalizeRel,
  };
});
