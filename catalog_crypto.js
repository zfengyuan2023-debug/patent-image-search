/* WebCrypto unlock for catalog_crypto.py. No password is stored here. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.PatentCrypto = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function b64ToBytes(text) {
    const bin = atob(text);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  async function deriveKey(password, salt, iterations) {
    const base = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(password),
      "PBKDF2",
      false,
      ["deriveKey"]
    );
    return crypto.subtle.deriveKey(
      { name: "PBKDF2", salt: salt, iterations: iterations, hash: "SHA-256" },
      base,
      { name: "AES-GCM", length: 256 },
      false,
      ["decrypt"]
    );
  }

  async function decryptAll(password, header, fileMap) {
    if (!header || header.kdf !== "PBKDF2-HMAC-SHA256") {
      throw new Error("unsupported catalog");
    }
    const salt = b64ToBytes(header.salt_b64);
    const key = await deriveKey(password, salt, header.iterations);
    const out = {};
    for (const ent of header.files) {
      const nonce = b64ToBytes(ent.nonce_b64);
      const ct = fileMap[ent.file];
      if (!ct) throw new Error("missing encrypted file");
      let plain;
      try {
        plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, key, ct);
      } catch (err) {
        throw new Error("密码不正确");
      }
      out[ent.name] = new Uint8Array(plain);
    }
    return out;
  }

  return { decryptAll: decryptAll, b64ToBytes: b64ToBytes };
});
