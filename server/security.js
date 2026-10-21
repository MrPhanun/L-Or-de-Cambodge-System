'use strict';
const crypto = require('crypto');

// ---- password / PIN hashing: scrypt with a per-secret random salt ----
function scrypt(secret, salt) {
  return new Promise((res, rej) => crypto.scrypt(String(secret), salt, 64, { N: 16384, r: 8, p: 1 }, (e, k) => (e ? rej(e) : res(k))));
}
async function hashSecret(secret) {
  const salt = crypto.randomBytes(16).toString('hex');
  return { salt, hash: (await scrypt(secret, salt)).toString('hex') };
}
async function verifySecret(secret, salt, hash) {
  if (!salt || !hash) return false;
  const a = await scrypt(secret, salt), b = Buffer.from(hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ---- session tokens: random, only the sha256 is stored in the database ----
const newToken = () => crypto.randomBytes(32).toString('base64url');
const hashToken = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');

// ---- cookies ----
function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

// ---- tiny in-memory rate limiter ----
const buckets = new Map();
function rateLimit(key, max, windowMs) {
  const t = Date.now();
  let b = buckets.get(key);
  if (!b || b.resetAt < t) { b = { count: 0, resetAt: t + windowMs }; buckets.set(key, b); }
  b.count++;
  return b.count <= max;
}
setInterval(() => { const t = Date.now(); for (const [k, b] of buckets) if (b.resetAt < t) buckets.delete(k); }, 60000).unref();

module.exports = { hashSecret, verifySecret, newToken, hashToken, parseCookies, rateLimit };
