'use strict';
const config = require('./config');
const { q, one } = require('./db');
const { hashToken, parseCookies, rateLimit } = require('./security');
const S = require('./services');
const { VIEW_OF, HOME_OF } = require('./perms');

const COOKIE = 'lodc_sid';

function setSessionCookie(res, token, maxAgeSec) {
  const parts = [`${COOKIE}=${encodeURIComponent(token)}`, 'Path=/', 'HttpOnly', 'SameSite=Strict', `Max-Age=${maxAgeSec}`];
  if (config.secureCookies) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}
const clearSessionCookie = (res) => setSessionCookie(res, '', 0);

/** Loads the signed-in user (if any) from the session cookie onto req.user. */
async function attachUser(req, res, next) {
  try {
    const token = parseCookies(req.headers.cookie)[COOKIE];
    if (token) {
      const row = await one(`SELECT s.token_hash, u.user_id AS id, u.name, u.email, u.phone, u.address, u.loyalty_points, u.discount_limit AS discountLimit,
                                    u.commission_pct AS commissionPct, r.name AS role
                             FROM Sessions s JOIN Users u ON u.user_id = s.user_id JOIN Roles r ON r.role_id = u.role_id
                             WHERE s.token_hash = @h AND s.expires_at > SYSUTCDATETIME() AND u.active = 1`, { h: hashToken(token) });
      if (row) { req.user = { ...row, perms: await S.effectivePerms(row.id, row.role) }; req.sessionHash = row.token_hash; }
    }
    next();
  } catch (e) { next(e); }
}

const requireAuth = (req, res, next) => req.user ? next() : res.status(401).json({ error: 'Please sign in.' });
const requirePerm = (perm) => (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Please sign in.' });
  if (!S.can(req.user, perm)) return res.status(403).json({ error: 'You do not have permission to do that.' });
  next();
};
const requireRoles = (...roles) => (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Please sign in.' });
  if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'You do not have permission to do that.' });
  next();
};

/** CSRF defence in depth: cookies are SameSite=Strict and every state change must carry this header
    (a cross-site page cannot add it without a CORS preflight, which this server never allows). */
function csrfGuard(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.headers['x-requested-with'] !== 'fetch') return res.status(403).json({ error: 'Bad request origin.' });
  next();
}
function limit(name, max, windowMs) {
  return (req, res, next) => rateLimit(`${name}:${req.ip}`, max, windowMs) ? next() : res.status(429).json({ error: 'Too many attempts. Try again in a minute.' });
}
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/** Serves a role's page only to signed-in users of that view; everyone else goes to the login page. */
const pageGuard = (view) => (req, res, next) => {
  if (!req.user || VIEW_OF[req.user.role] !== view) return res.redirect('/login.html');
  next();
};

module.exports = { COOKIE, setSessionCookie, clearSessionCookie, attachUser, requireAuth, requirePerm, requireRoles, csrfGuard, limit, wrap, pageGuard, HOME_OF };
