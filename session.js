/* Turn a public catalog into a search session. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.PatentSession = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const searchApi = typeof require === "function" ? require("./search.js") : root.PatentSearch;

  function concat(parts) {
    let n = 0;
    for (const p of parts) n += p.length;
    const out = new Uint8Array(n);
    let off = 0;
    for (const p of parts) {
      out.set(p, off);
      off += p.length;
    }
    return out;
  }

  function openParts(files) {
    const meta = JSON.parse(new TextDecoder().decode(files["meta.json"]));
    const vec = concat(meta.shards.map(function (name) { return files[name]; }));
    let records = [];
    for (const name of meta.records) {
      records = records.concat(JSON.parse(new TextDecoder().decode(files[name])));
    }
    const data = meta.dtype === "float16"
      ? vec
      : new Int8Array(vec.buffer, vec.byteOffset, vec.byteLength);
    return { meta: meta, data: data, records: records, files: files };
  }

  function thumbBytes(session, rec) {
    if (!rec.thumb) return null;
    const bin = session.files[rec.thumb.shard];
    return bin.slice(rec.thumb.offset, rec.thumb.offset + rec.thumb.length);
  }

  function searchSession(session, query, opts) {
    if (!session) throw new Error("目录还没有载入");
    opts = opts || {};
    return searchApi.searchInt8({
      data: session.data,
      dim: session.meta.dim,
      scale: session.meta.scale,
      dtype: session.meta.dtype || "int8",
      records: session.records,
      query: query,
      region: opts.region || "ALL",
      classification: opts.classification || "",
      topK: opts.topK || 24,
      withTotal: !!opts.withTotal,
    });
  }

  return { openParts: openParts, thumbBytes: thumbBytes, searchSession: searchSession };
});
