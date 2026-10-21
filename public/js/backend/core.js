'use strict';
/* Browser-only "backend" for L'Or de Cambodge (HTML + CSS + JavaScript, no server, no database server).
   All data lives in this browser's localStorage. The screens talk to it through the same /api/... calls they always used,
   but those calls are answered here instead of by a server (see routes.js).
   HONEST NOTE: because everything runs in the visitor's browser, permission checks and password hashing protect against
   honest mistakes, not against someone who opens the browser's developer tools. */
window.LB = window.LB || {};
(function (LB) {
  const KEY = 'lodc_db_v3';
  const cfg = window.APP_CONFIG || { ENV: 'development' };
  LB.env = cfg.ENV === 'production' ? 'production' : 'development';

  class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
  const bad = (m) => new HttpError(400, m);
  const forbidden = (m = 'You do not have permission to do that.') => new HttpError(403, m);
  const notFound = (m = 'Not found.') => new HttpError(404, m);
  const unauthorized = (m = 'Please sign in.') => new HttpError(401, m);

  const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
  const nowIso = () => new Date().toISOString();
  const todayStr = () => new Date().toISOString().slice(0, 10);
  const ymd = (d) => String(d || '').slice(0, 10);
  const str = (v, n) => String(v ?? '').trim().slice(0, n);
  const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

  // ------------------------------------------------------------ permissions
  const PERMISSIONS = {
    'pos.sell': 'Use POS checkout', 'orders.view': 'View orders', 'orders.fulfil': 'Update order status',
    'refund.process': 'Refunds & exchanges', 'refund.any': 'Refund beyond the window',
    'inventory.view': 'View stock', 'inventory.edit': 'Adjust stock & purchasing',
    'customers.manage': 'Manage customers', 'appointments.manage': 'Manage appointments',
    'alteration.manage': 'Alteration tickets', 'rental.manage': 'Rental check-out / check-in',
    'tailoring.manage': 'Tailoring management', 'shift.manage': 'Clock-in & cash shifts',
    'performance.view': 'Own performance', 'products.edit': 'Edit products & categories',
    'promos.manage': 'Promotions', 'reports.view': 'Reports', 'audit.view': 'Activity log',
    'staff.manage': 'Manage staff & roles', 'settings.edit': 'Edit settings'
  };
  const ROLE_PERMS = {
    client: [],
    seller: ['pos.sell', 'orders.view', 'orders.fulfil', 'refund.process', 'inventory.view', 'customers.manage', 'appointments.manage', 'alteration.manage', 'rental.manage', 'shift.manage', 'performance.view'],
    tailor: ['alteration.manage', 'inventory.view', 'appointments.manage', 'orders.view', 'shift.manage', 'performance.view'],
    manager: ['pos.sell', 'orders.view', 'orders.fulfil', 'refund.process', 'refund.any', 'inventory.view', 'inventory.edit', 'customers.manage', 'appointments.manage', 'alteration.manage',
      'rental.manage', 'tailoring.manage', 'products.edit', 'promos.manage', 'reports.view', 'audit.view', 'shift.manage', 'performance.view'],
    admin: Object.keys(PERMISSIONS)
  };
  const ROLES = ['client', 'seller', 'tailor', 'manager', 'admin'];
  const VIEW_OF = { client: 'client', seller: 'seller', tailor: 'seller', manager: 'admin', admin: 'admin' };
  const HOME_OF = { client: 'client.html', seller: 'seller.html', admin: 'admin.html' };

  // ------------------------------------------------------------ storage (every request works on a fresh copy and commits only on success)
  const load = () => { try { const raw = localStorage.getItem(KEY); return raw ? JSON.parse(raw) : null; } catch { return null; } };
  const save = (db) => {
    try { localStorage.setItem(KEY, JSON.stringify(db)); }
    catch { throw new HttpError(507, 'The browser storage is full. Export a backup (Admin > Settings) and remove old data.'); }
  };
  const nextId = (db, name) => { db.seq[name] = (db.seq[name] || 0) + 1; return db.seq[name]; };

  // ------------------------------------------------------------ passwords: PBKDF2-SHA256 with a random salt (Web Crypto)
  const hex = (buf) => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
  const randomHex = (n = 16) => hex(crypto.getRandomValues(new Uint8Array(n)));
  async function derive(secret, salt) {
    if (!(window.crypto && crypto.subtle)) {   // very old / insecure context: weak fallback so the demo still runs
      let h = 5381; for (const c of salt + String(secret)) h = ((h << 5) + h + c.charCodeAt(0)) >>> 0; return 'weak' + h.toString(16);
    }
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(String(secret)), 'PBKDF2', false, ['deriveBits']);
    return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(salt), iterations: 120000 }, key, 256));
  }
  async function hashSecret(secret) { const salt = randomHex(16); return { salt, hash: await derive(secret, salt) }; }
  async function verifySecret(secret, salt, hash) { if (!salt || !hash) return false; return (await derive(secret, salt)) === hash; }
  async function sha256(text) {
    if (window.crypto && crypto.subtle) return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
    let h = 5381; for (const c of text) h = ((h << 5) + h + c.charCodeAt(0)) >>> 0; return 'w' + h.toString(16);
  }

  // ------------------------------------------------------------ settings, audit, notifications
  const SETTING_DEFAULTS = {
    storeName: "L'Or de Cambodge", address: 'No. 88, Norodom Blvd, Phnom Penh', phone: '+855 23 000 000', logo: '',
    vatPct: 10, currency: 'USD', khrRate: 4100, lowStock: 3, maxSellerDiscount: 15, pointsPerDollar: 1, pointValue: 0.01,
    paymentMethods: ['Cash', 'Card', 'ABA Pay', 'KHQR', 'Pay in store'], refundDays: 7, rentalMaxDays: 14, lateFeePct: 50,
    tailorMarkupPct: 25, receiptHeader: 'TAX INVOICE', receiptFooter: 'Thank you for shopping with us. Exchange within 7 days with receipt.'
  };
  const getSettings = (db) => ({ ...SETTING_DEFAULTS, ...(db.settings || {}) });

  function audit(db, actor, action, detail = '') {
    db.audit.unshift({ audit_id: nextId(db, 'audit'), at: nowIso(), user_id: actor?.id || null, user_name: actor?.name || 'system', role: actor?.role || '-', action, detail: String(detail).slice(0, 400), ip: 'this browser' });
    if (db.audit.length > 1500) db.audit.length = 1500;
  }
  function notify(db, userId, title, body, type = 'info') {
    if (!userId) return;
    db.notifications.unshift({ notification_id: nextId(db, 'notification'), user_id: userId, title, body, type, is_read: false, at: nowIso() });
    if (db.notifications.length > 3000) db.notifications.length = 3000;
  }

  // ------------------------------------------------------------ users / actors
  const userById = (db, id) => db.users.find(u => u.user_id === Number(id));
  function effectivePerms(user) {
    if (user.role === 'admin') return new Set(['*']);
    const set = new Set(ROLE_PERMS[user.role] || []);
    for (const o of user.overrides || []) { if (o.granted) set.add(o.code); else set.delete(o.code); }
    return set;
  }
  const can = (actor, perm) => !!actor && (actor.perms.has('*') || actor.perms.has(perm));
  const tierOf = (p) => p >= 3000 ? 'VIP' : p >= 1500 ? 'Gold' : p >= 500 ? 'Silver' : 'Member';
  const discountLimitOf = (actor, settings) => actor.role === 'admin' ? 100 : (actor.discountLimit ?? settings.maxSellerDiscount);
  const actorOf = (u) => ({ id: u.user_id, name: u.name, email: u.email, phone: u.phone, address: u.address, role: u.role, loyalty_points: u.loyalty_points,
    discountLimit: u.discount_limit, commissionPct: u.commission_pct, perms: effectivePerms(u) });

  Object.assign(LB, { KEY, HttpError, bad, forbidden, notFound, unauthorized, r2, nowIso, todayStr, ymd, str, num, PERMISSIONS, ROLE_PERMS, ROLES, VIEW_OF, HOME_OF,
    load, save, nextId, randomHex, hashSecret, verifySecret, sha256, SETTING_DEFAULTS, getSettings, audit, notify, userById, effectivePerms, can, tierOf, discountLimitOf, actorOf });

  // Whole days from date a to date b (both 'YYYY-MM-DD' or ISO timestamps). Positive when b is later.
  LB.daysBetween = (a, b) => { const t = (x) => new Date(String(x).length === 10 ? x + 'T00:00:00Z' : x).getTime(); return Math.round((t(b) - t(a)) / 864e5); };
})(window.LB);
