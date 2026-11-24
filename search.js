/* Browser-side ranking for the int8 catalog produced by tools/export_pages_index.py.
   One query vector, cosine via dequantized dots. Same record keeps its best image.
   This file does not embed a photo and does not invent rows. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.PatentSearch = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function float16(bytes, index) {
    const off = index * 2;
    const h = bytes[off] | (bytes[off + 1] << 8);
    const sign = (h & 0x8000) ? -1 : 1;
    const exp = (h >> 10) & 0x1f;
    const frac = h & 0x3ff;
    if (exp === 0) return sign * Math.pow(2, -14) * (frac / 1024);
    if (exp === 31) return frac ? NaN : sign * Infinity;
    return sign * Math.pow(2, exp - 15) * (1 + frac / 1024);
  }

  function valueAt(data, dtype, scale, index) {
    if (dtype === "float16") return float16(data, index);
    return data[index] / scale;
  }

  function searchInt8(opts) {
    const data = opts.data;
    const dim = opts.dim | 0;
    const scale = opts.scale || 1;
    const dtype = opts.dtype || "int8";
    const records = opts.records;
    const query = opts.query;
    const region = opts.region || "ALL";
    const classification = opts.classification || "";
    const withTotal = !!opts.withTotal;
    const topK = opts.topK || 24;
    if (!data || !records || !query) throw new Error("catalog and query are required");
    if (dim < 1) throw new Error("dim must be positive");
    if (dtype === "int8" && !(scale > 0)) throw new Error("scale must be positive");
    const n = records.length;
    const width = dtype === "float16" ? data.length / 2 : data.length;
    if (width !== n * dim) throw new Error("vector bytes do not match record count");
    if (query.length !== dim) throw new Error("query length does not match dim");
    const scores = new Array(n);
    for (let i = 0; i < n; i++) {
      let dot = 0;
      const base = i * dim;
      for (let d = 0; d < dim; d++) dot += valueAt(data, dtype, scale, base + d) * query[d];
      scores[i] = dot;
    }
    const order = new Array(n);
    for (let i = 0; i < n; i++) order[i] = i;
    order.sort(function (a, b) { return scores[b] - scores[a]; });
    const best = new Map();
    const seen = new Set();
    let total = 0;
    for (let k = 0; k < order.length; k++) {
      const i = order[k];
      const rec = records[i];
      if (region !== "ALL" && rec.region !== region) continue;
      if (classification && classToken(rec.classification) !== classification) continue;
      if (!rec.id || seen.has(rec.id)) continue;
      seen.add(rec.id);
      total += 1;
      if (best.size >= topK) {
        if (!withTotal) break;
        continue;
      }
      best.set(rec.id, {
        id: rec.id,
        region: rec.region,
        number: rec.number,
        title: rec.title,
        holder: rec.holder,
        date: rec.date,
        classification: rec.classification,
        status: rec.status,
        page_url: rec.page_url,
        image_url: rec.image_url || null,
        thumb: rec.thumb || null,
        score: scores[i],
      });
    }
    const rows = Array.from(best.values());
    if (withTotal) return { rows: rows, total: total };
    return rows;
  }

  function classToken(text) {
    const s = String(text || "");
    const locarno = s.match(/(\d{2}\.\d{2})/);
    if (locarno) return locarno[1];
    const us = s.match(/\bD\s*(\d{1,2})\b/i);
    if (us) return "D" + ("0" + us[1]).slice(-2);
    return "";
  }

  function escapeAttr(value) {
    return String(value == null ? "" : value).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  function cardsHtml(results) {
    return results.map(function (r) {
      const img = r.image_url
        ? '<img alt="" src="' + escapeAttr(r.image_url) + '">'
        : '<span class="no-img">无图</span>';
      const page = r.page_url
        ? '<a href="' + escapeAttr(r.page_url) + '">官方记录</a>'
        : "";
      const score = typeof r.score === "number" ? r.score.toFixed(3) : "";
      const token = classToken(r.classification);
      return '<article class="card" data-id="' + escapeAttr(r.id) + '"><div class="im">' + img +
        '</div><div class="bd"><div class="meta"><span class="pill">' + escapeAttr(r.region) +
        "</span><span class=\"num\">" + escapeAttr(r.number) + "</span></div>" +
        '<div class="score">相似度 ' + escapeAttr(score) + "</div>" +
        (token ? '<div class="cls">' + escapeAttr(token) + "</div>" : "") +
        '<div class="title">' + escapeAttr(r.title) + "</div>" + page + "</div></article>";
    }).join("");
  }

  return { searchInt8: searchInt8, cardsHtml: cardsHtml, float16: float16, classToken: classToken };
});
