'use strict';
const express = require('express');
const crypto = require('crypto');
const config = require('../config');
const { q, one, tx } = require('../db');
const { hashSecret, verifySecret, newToken, hashToken } = require('../security');
const S = require('../services');
const { ROLES, VIEW_OF, HOME_OF, ROLE_PERMS } = require('../perms');
const M = require('../middleware');

const router = express.Router();
const { wrap, requireAuth, requirePerm, requireRoles } = M;
const TAB_ROLES = { client: ['client'], seller: ['seller', 'tailor'], admin: ['admin', 'manager'] };
const MAX_FAILS = 5, LOCK_MINUTES = 15;
const tierOf = (p) => p >= 3000 ? 'VIP' : p >= 1500 ? 'Gold' : p >= 500 ? 'Silver' : 'Member';
const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email, phone: u.phone, address: u.address, role: u.role, view: VIEW_OF[u.role],
  home: HOME_OF[VIEW_OF[u.role]], points: u.loyalty_points, tier: tierOf(u.loyalty_points), perms: [...u.perms], discountLimit: u.role === 'admin' ? 100 : u.discountLimit,
  commissionPct: u.commissionPct });

// ================================================================ auth
async function startSession(req, res, userId) {
  const token = newToken();
  const maxAge = config.sessionHours * 3600;
  await q(`INSERT INTO Sessions (token_hash, user_id, expires_at, ip, user_agent) VALUES (@h, @u, DATEADD(SECOND, @s, SYSUTCDATETIME()), @ip, @ua)`,
    { h: hashToken(token), u: userId, s: maxAge, ip: req.ip, ua: String(req.headers['user-agent'] || '').slice(0, 200) });
  await q('DELETE FROM Sessions WHERE expires_at < SYSUTCDATETIME()');
  M.setSessionCookie(res, token, maxAge);
}

router.post('/auth/login', M.limit('login', 20, 60000), wrap(async (req, res) => {
  const { identifier, secret, tab, mode } = req.body || {};
  if (!identifier || !secret) throw S.bad('Enter your email/phone and password.');
  const id = String(identifier).trim().toLowerCase(), phone = id.replace(/[\s-]/g, '');
  const u = await one(`SELECT u.*, r.name AS role FROM Users u JOIN Roles r ON r.role_id = u.role_id
                       WHERE LOWER(u.email) = @e OR REPLACE(REPLACE(u.phone, ' ', ''), '-', '') = @p`, { e: id, p: phone });
  const generic = new S.HttpError(401, 'Invalid credentials.');
  if (!u || !u.active) throw generic;
  if (u.locked_until && new Date(u.locked_until) > new Date()) throw new S.HttpError(423, `Account locked after too many failed attempts. Try again in ${Math.ceil((new Date(u.locked_until) - Date.now()) / 60000)} min.`);
  const usePin = mode === 'pin';
  if (usePin && u.role === 'client') throw new S.HttpError(401, 'PIN login is for staff accounts only.');
  const ok = usePin ? await verifySecret(String(secret), u.pin_salt, u.pin_hash) : await verifySecret(String(secret), u.pass_salt, u.pass_hash);
  if (!ok) {
    const fails = u.failed_logins + 1;
    await q('UPDATE Users SET failed_logins = @f, locked_until = CASE WHEN @f >= @m THEN DATEADD(MINUTE, @l, SYSUTCDATETIME()) ELSE NULL END WHERE user_id = @id', { f: fails, m: MAX_FAILS, l: LOCK_MINUTES, id: u.user_id });
    await S.audit({ id: u.user_id, name: u.name, role: u.role }, 'login.failed', usePin ? 'PIN' : 'password', req.ip);
    throw generic;
  }
  if (tab && !(TAB_ROLES[tab] || []).includes(u.role)) {
    const right = Object.keys(TAB_ROLES).find(t => TAB_ROLES[t].includes(u.role));
    throw new S.HttpError(403, `This is a ${u.role} account. Use the "${right}" tab to sign in.`);
  }
  await q('UPDATE Users SET failed_logins = 0, locked_until = NULL WHERE user_id = @id', { id: u.user_id });
  await startSession(req, res, u.user_id);
  const actor = { id: u.user_id, name: u.name, role: u.role };
  await S.audit(actor, 'login', usePin ? 'PIN' : 'password', req.ip);
  res.json({ ok: true, home: HOME_OF[VIEW_OF[u.role]], role: u.role });
}));

router.post('/auth/register', M.limit('register', 10, 60000), wrap(async (req, res) => {
  const { name, email, phone, password } = req.body || {};
  if (!String(name || '').trim()) throw S.bad('Name is required.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || ''))) throw S.bad('Enter a valid email.');
  if (String(password || '').length < 8) throw S.bad('Password must be at least 8 characters.');
  const ph = String(phone || '').replace(/[\s-]/g, '');
  if (await one('SELECT 1 AS x FROM Users WHERE LOWER(email) = @e', { e: String(email).trim().toLowerCase() })) throw S.bad('That email is already registered.');
  if (ph && await one("SELECT 1 AS x FROM Users WHERE REPLACE(REPLACE(phone, ' ', ''), '-', '') = @p", { p: ph })) throw S.bad('That phone number is already registered.');
  const p = await hashSecret(password);
  const u = await one(`INSERT INTO Users (role_id, name, email, phone, pass_hash, pass_salt) OUTPUT inserted.user_id AS id VALUES (@r, @n, @e, @p, @h, @s)`,
    { r: ROLES.client, n: String(name).trim().slice(0, 100), e: String(email).trim().slice(0, 150), p: String(phone || '').trim().slice(0, 30), h: p.hash, s: p.salt });
  await S.notify(u.id, 'Welcome to L’Or de Cambodge', 'Use code WELCOME10 for 10% off your first order.', 'promo');
  await S.audit({ id: u.id, name: String(name).trim(), role: 'client' }, 'register', email, req.ip);
  await startSession(req, res, u.id);
  res.json({ ok: true, home: HOME_OF.client, role: 'client' });
}));

router.post('/auth/logout', wrap(async (req, res) => {
  if (req.sessionHash) await q('DELETE FROM Sessions WHERE token_hash = @h', { h: req.sessionHash });
  if (req.user) await S.audit(req.user, 'logout', '', req.ip);
  M.clearSessionCookie(res);
  res.json({ ok: true });
}));

router.get('/auth/me', requireAuth, wrap(async (req, res) => {
  const unread = await one('SELECT COUNT(*) AS n FROM Notifications WHERE user_id = @u AND is_read = 0', { u: req.user.id });
  res.json({ user: publicUser(req.user), unread: unread.n, today: S.todayStr() });
}));

router.post('/auth/password', requireAuth, wrap(async (req, res) => {
  const { current, next } = req.body || {};
  if (String(next || '').length < 8) throw S.bad('New password must be at least 8 characters.');
  const u = await one('SELECT pass_hash, pass_salt FROM Users WHERE user_id = @id', { id: req.user.id });
  if (!(await verifySecret(String(current || ''), u.pass_salt, u.pass_hash))) throw new S.HttpError(401, 'Current password is wrong.');
  const p = await hashSecret(next);
  await q('UPDATE Users SET pass_hash = @h, pass_salt = @s WHERE user_id = @id', { h: p.hash, s: p.salt, id: req.user.id });
  await q('DELETE FROM Sessions WHERE user_id = @id AND token_hash <> @h', { id: req.user.id, h: req.sessionHash });   // sign out other devices
  await S.audit(req.user, 'password.change', '', req.ip);
  res.json({ ok: true });
}));

router.post('/auth/pin', requireAuth, requireRoles('seller', 'tailor', 'manager', 'admin'), wrap(async (req, res) => {
  const { current, pin } = req.body || {};
  if (!/^\d{4,6}$/.test(String(pin || ''))) throw S.bad('PIN must be 4-6 digits.');
  const u = await one('SELECT pass_hash, pass_salt FROM Users WHERE user_id = @id', { id: req.user.id });
  if (!(await verifySecret(String(current || ''), u.pass_salt, u.pass_hash))) throw new S.HttpError(401, 'Current password is wrong.');
  const p = await hashSecret(pin);
  await q('UPDATE Users SET pin_hash = @h, pin_salt = @s WHERE user_id = @id', { h: p.hash, s: p.salt, id: req.user.id });
  await S.audit(req.user, 'pin.change', '', req.ip);
  res.json({ ok: true });
}));

// ================================================================ public shop data
router.get('/settings', wrap(async (req, res) => {
  const s = await S.getSettings();
  res.json({ storeName: s.storeName, address: s.address, phone: s.phone, logo: s.logo, vatPct: s.vatPct, currency: s.currency, khrRate: s.khrRate,
    paymentMethods: s.paymentMethods, lowStock: s.lowStock, rentalMaxDays: s.rentalMaxDays, lateFeePct: s.lateFeePct, refundDays: s.refundDays,
    receiptHeader: s.receiptHeader, receiptFooter: s.receiptFooter, pointValue: s.pointValue, pointsPerDollar: s.pointsPerDollar, tailorMarkupPct: s.tailorMarkupPct,
    maxSellerDiscount: s.maxSellerDiscount });
}));

router.get('/catalog', requireAuth, wrap(async (req, res) => {
  const withCost = S.can(req.user, 'products.edit') || S.can(req.user, 'reports.view');
  const [products, cats, bundles, sales] = [
    await S.listProducts({ includeCost: withCost }),
    await q('SELECT name, sizes FROM Categories ORDER BY category_id'),
    await q(`SELECT b.bundle_id, b.name, b.pct FROM Bundles b WHERE b.active = 1`),
    await S.activeSales()];
  res.json({ products, categories: cats.map(c => ({ name: c.name, sizes: c.sizes.split(',') })), bundles, sales });
}));

router.post('/quote', requireAuth, wrap(async (req, res) => res.json(await S.quote(req.user, req.body || {}))));

// ================================================================ orders
router.post('/orders', requireAuth, wrap(async (req, res) => {
  if (req.user.role === 'client' || S.can(req.user, 'pos.sell')) return res.json(await S.placeOrder(req.user, req.body || {}, req.ip));
  throw S.forbidden();
}));

router.get('/orders', requireAuth, wrap(async (req, res) => {
  const where = [], params = {};
  if (req.user.role === 'client') { where.push('o.customer_id = @me'); params.me = req.user.id; }
  else if (!S.can(req.user, 'orders.view')) throw S.forbidden();
  const { status, channel, search, from, to, kind, mine, customerId } = req.query;
  if (status) { where.push('o.status = @st'); params.st = String(status); }
  if (channel) { where.push('o.channel = @ch'); params.ch = String(channel); }
  if (from) { where.push('o.created_at >= @from'); params.from = String(from); }
  if (to) { where.push('o.created_at < DATEADD(DAY, 1, CAST(@to AS DATE))'); params.to = String(to); }
  if (search) { where.push('(o.order_no LIKE @s OR o.customer_name LIKE @s)'); params.s = `%${String(search).slice(0, 50)}%`; }
  if (kind === 'tailor') where.push('o.has_tailor = 1');
  if (kind === 'rental') where.push('o.has_rental = 1');
  if (mine === '1' && req.user.role !== 'client') { where.push('o.seller_id = @me'); params.me = req.user.id; }
  if (customerId && req.user.role !== 'client') { where.push('o.customer_id = @cid'); params.cid = Number(customerId); }
  if (kind === 'overdue') { where.push("o.has_rental = 1 AND o.status = 'Picked Up' AND EXISTS (SELECT 1 FROM OrderItems i WHERE i.order_id = o.order_id AND i.kind = 'rent' AND i.rent_to < CAST(SYSUTCDATETIME() AS DATE))"); }
  res.json(await S.getOrders(where.join(' AND ') || '1=1', params, { limit: req.query.limit || 300 }));
}));

router.get('/orders/:id', requireAuth, wrap(async (req, res) => {
  const o = await S.getOrder(Number(req.params.id));
  if (!o) throw S.notFound('Order not found.');
  if (req.user.role === 'client' ? o.customer_id !== req.user.id : !S.can(req.user, 'orders.view')) throw S.forbidden();
  res.json(o);
}));
router.post('/orders/:id/status', requireAuth, wrap(async (req, res) => res.json(await S.setStatus(req.user, Number(req.params.id), String(req.body.status), req.ip))));
router.post('/orders/:id/payments', requireAuth, wrap(async (req, res) => res.json(await S.addPayment(req.user, Number(req.params.id), req.body || {}, req.ip))));
router.post('/orders/:id/refund', requireAuth, wrap(async (req, res) => res.json(await S.refundOrder(req.user, Number(req.params.id), req.body || {}, req.ip))));
router.post('/orders/:id/exchange', requireAuth, wrap(async (req, res) => res.json(await S.exchangeItem(req.user, Number(req.params.id), req.body.itemId, req.body.newSize, req.ip))));
router.post('/orders/:id/rental-checkin', requireAuth, wrap(async (req, res) => res.json(await S.checkInRental(req.user, Number(req.params.id), req.body || {}, req.ip))));
router.post('/orders/:id/assign-tailor', requireAuth, wrap(async (req, res) => res.json(await S.assignTailor(req.user, Number(req.params.id), req.body.tailorId ? Number(req.body.tailorId) : null, req.ip))));

// ================================================================ my account (client)
router.get('/me/profile', requireAuth, wrap(async (req, res) => {
  const m = await one('SELECT chest, waist, shoulder, sleeve, inseam, neck, updated_at FROM Measurements WHERE user_id = @id', { id: req.user.id });
  const u = await one('SELECT name, email, phone, address, loyalty_points, created_at FROM Users WHERE user_id = @id', { id: req.user.id });
  const pts = u.loyalty_points, next = [500, 1500, 3000].find(t => t > pts) || null;
  res.json({ ...u, measurements: m || {}, tier: tierOf(pts), next_tier_at: next, next_tier: next ? tierOf(next) : null });
}));
router.put('/me/profile', requireAuth, wrap(async (req, res) => {
  const { name, phone, address } = req.body || {};
  if (!String(name || '').trim()) throw S.bad('Name is required.');
  const ph = String(phone || '').replace(/[\s-]/g, '');
  if (ph && await one("SELECT 1 AS x FROM Users WHERE REPLACE(REPLACE(phone, ' ', ''), '-', '') = @p AND user_id <> @id", { p: ph, id: req.user.id })) throw S.bad('That phone number is already used.');
  await q('UPDATE Users SET name = @n, phone = @p, address = @a WHERE user_id = @id', { n: String(name).trim().slice(0, 100), p: String(phone || '').slice(0, 30), a: String(address || '').slice(0, 250), id: req.user.id });
  res.json({ ok: true });
}));
router.put('/me/measurements', requireAuth, requireRoles('client'), wrap(async (req, res) => {
  const v = {};
  for (const k of ['chest', 'waist', 'shoulder', 'sleeve', 'inseam', 'neck']) {
    const raw = req.body?.[k];
    if (raw === '' || raw == null) { v[k] = null; continue; }
    const n = Number(raw);
    if (!(n >= 10 && n <= 250)) throw S.bad(`${k} must be between 10 and 250 cm.`);
    v[k] = Math.round(n * 10) / 10;
  }
  await q(`MERGE Measurements AS t USING (SELECT @id AS user_id) AS s ON t.user_id = s.user_id
    WHEN MATCHED THEN UPDATE SET chest=@chest, waist=@waist, shoulder=@shoulder, sleeve=@sleeve, inseam=@inseam, neck=@neck, updated_at=SYSUTCDATETIME()
    WHEN NOT MATCHED THEN INSERT (user_id, chest, waist, shoulder, sleeve, inseam, neck) VALUES (@id, @chest, @waist, @shoulder, @sleeve, @inseam, @neck);`, { id: req.user.id, ...v });
  res.json({ ok: true });
}));

router.get('/me/notifications', requireAuth, wrap(async (req, res) => {
  if (req.user.role === 'client') await runReminders(req.user.id);
  res.json(await q('SELECT TOP 100 * FROM Notifications WHERE user_id = @u ORDER BY at DESC, notification_id DESC', { u: req.user.id }));
}));
router.post('/me/notifications/read', requireAuth, wrap(async (req, res) => {
  await q('UPDATE Notifications SET is_read = 1 WHERE user_id = @u', { u: req.user.id });
  res.json({ ok: true });
}));
/** Pickup reminders (Ready for 2+ days) and fitting reminders (today/tomorrow), each sent once. */
async function runReminders(userId) {
  const ready = await q(`SELECT o.order_id, o.order_no FROM Orders o WHERE o.customer_id = @u AND o.status = 'Ready' AND o.reminded_at IS NULL
    AND EXISTS (SELECT 1 FROM OrderStatusHistory h WHERE h.order_id = o.order_id AND h.status = 'Ready' AND h.at < DATEADD(DAY, -2, SYSUTCDATETIME()))`, { u: userId });
  for (const o of ready) {
    await q('UPDATE Orders SET reminded_at = SYSUTCDATETIME() WHERE order_id = @id', { id: o.order_id });
    await S.notify(userId, `Reminder: ${o.order_no} is waiting`, 'Your order is ready for pickup.', 'order');
  }
  const appts = await q(`SELECT appointment_id, service, appt_date, appt_time FROM Appointments WHERE customer_id = @u AND reminded = 0 AND status IN ('Booked','Confirmed')
    AND appt_date BETWEEN CAST(SYSUTCDATETIME() AS DATE) AND DATEADD(DAY, 1, CAST(SYSUTCDATETIME() AS DATE))`, { u: userId });
  for (const a of appts) {
    await q('UPDATE Appointments SET reminded = 1 WHERE appointment_id = @id', { id: a.appointment_id });
    await S.notify(userId, 'Fitting reminder', `${a.service} on ${S.ymd(a.appt_date)} at ${a.appt_time}.`, 'appointment');
  }
}

// ================================================================ appointments
router.get('/appointments', requireAuth, wrap(async (req, res) => {
  const params = {}; let where = '1=1';
  if (req.user.role === 'client') { where = 'a.customer_id = @me'; params.me = req.user.id; }
  else if (!S.can(req.user, 'appointments.manage')) throw S.forbidden();
  if (req.query.date) { where += ' AND a.appt_date = @d'; params.d = String(req.query.date); }
  res.json(await q(`SELECT a.*, u.name AS assigned_name FROM Appointments a LEFT JOIN Users u ON u.user_id = a.assigned_to WHERE ${where} ORDER BY a.appt_date DESC, a.appt_time`, params));
}));
router.post('/appointments', requireAuth, wrap(async (req, res) => {
  const b = req.body || {};
  const services = ['Fitting', 'Consultation', 'Alteration pickup', 'Rental fitting'];
  if (!services.includes(b.service)) throw S.bad('Choose a service.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(b.date)) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(String(b.time))) throw S.bad('Choose a date and time.');
  if (b.date < S.todayStr()) throw S.bad('Choose a future date.');
  if (b.time < '09:00' || b.time > '18:00') throw S.bad('We are open 09:00-18:00.');
  let cust = req.user;
  if (req.user.role !== 'client') { if (!S.can(req.user, 'appointments.manage')) throw S.forbidden(); cust = await one('SELECT user_id AS id, name FROM Users WHERE user_id = @id', { id: Number(b.customerId) }); if (!cust) throw S.bad('Choose a customer.'); }
  const clash = await one(`SELECT COUNT(*) AS n FROM Appointments WHERE appt_date = @d AND appt_time = @t AND status IN ('Booked','Confirmed')`, { d: b.date, t: b.time });
  if (clash.n >= 2) throw S.bad('That time slot is full. Please choose another.');
  const a = await one(`INSERT INTO Appointments (customer_id, customer_name, service, appt_date, appt_time, note, status) OUTPUT inserted.appointment_id AS id
    VALUES (@c, @n, @s, @d, @t, @no, @st)`, { c: cust.id, n: cust.name, s: b.service, d: b.date, t: b.time, no: String(b.note || '').slice(0, 250), st: req.user.role === 'client' ? 'Booked' : 'Confirmed' });
  await S.notify(cust.id, 'Appointment booked', `${b.service} on ${b.date} at ${b.time}.`, 'appointment');
  await S.audit(req.user, 'appointment.create', `${cust.name} ${b.date} ${b.time}`, req.ip);
  res.json({ ok: true, id: a.id });
}));
router.patch('/appointments/:id', requireAuth, wrap(async (req, res) => {
  const a = await one('SELECT * FROM Appointments WHERE appointment_id = @id', { id: Number(req.params.id) });
  if (!a) throw S.notFound();
  const status = String(req.body.status || '');
  if (!['Booked', 'Confirmed', 'Completed', 'Cancelled', 'No-show'].includes(status)) throw S.bad('Invalid status.');
  if (req.user.role === 'client') { if (a.customer_id !== req.user.id || status !== 'Cancelled') throw S.forbidden(); }
  else if (!S.can(req.user, 'appointments.manage')) throw S.forbidden();
  await q('UPDATE Appointments SET status = @s, assigned_to = COALESCE(@as, assigned_to) WHERE appointment_id = @id', { s: status, as: req.body.assignedTo ? Number(req.body.assignedTo) : null, id: a.appointment_id });
  if (req.user.role !== 'client') await S.notify(a.customer_id, `Appointment ${status.toLowerCase()}`, `${a.service} on ${S.ymd(a.appt_date)} at ${a.appt_time}.`, 'appointment');
  await S.audit(req.user, 'appointment.update', `#${a.appointment_id} -> ${status}`, req.ip);
  res.json({ ok: true });
}));

// ================================================================ staff: customers
router.get('/customers', requirePerm('customers.manage'), wrap(async (req, res) => {
  const s = `%${String(req.query.search || '').slice(0, 50)}%`;
  res.json(await q(`SELECT TOP 200 u.user_id, u.name, u.email, u.phone, u.address, u.loyalty_points, u.active, u.created_at,
      (SELECT COUNT(*) FROM Orders o WHERE o.customer_id = u.user_id AND o.status <> 'Cancelled') AS orders,
      (SELECT COALESCE(SUM(o.total), 0) FROM Orders o WHERE o.customer_id = u.user_id AND o.status <> 'Cancelled') AS spent
    FROM Users u JOIN Roles r ON r.role_id = u.role_id WHERE r.name = 'client' AND (u.name LIKE @s OR u.email LIKE @s OR u.phone LIKE @s) ORDER BY u.name`, { s }));
}));
router.get('/customers/:id', requirePerm('customers.manage'), wrap(async (req, res) => {
  const id = Number(req.params.id);
  const u = await one(`SELECT u.user_id, u.name, u.email, u.phone, u.address, u.loyalty_points, u.created_at FROM Users u JOIN Roles r ON r.role_id = u.role_id WHERE u.user_id = @id AND r.name = 'client'`, { id });
  if (!u) throw S.notFound('Customer not found.');
  res.json({ ...u, tier: tierOf(u.loyalty_points), measurements: (await one('SELECT chest, waist, shoulder, sleeve, inseam, neck, updated_at FROM Measurements WHERE user_id = @id', { id })) || {},
    orders: await S.getOrders('o.customer_id = @id', { id }, { limit: 100 }), alterations: await S.listAlterations('a.customer_id = @id', { id }),
    appointments: await q('SELECT * FROM Appointments WHERE customer_id = @id ORDER BY appt_date DESC', { id }) });
}));
router.post('/customers', requirePerm('customers.manage'), wrap(async (req, res) => {
  const b = req.body || {};
  const email = String(b.email || '').trim();
  if (!String(b.name || '').trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw S.bad('Name and a valid email are required.');
  if (await one('SELECT 1 AS x FROM Users WHERE LOWER(email) = @e', { e: email.toLowerCase() })) throw S.bad('Email already used.');
  // the customer can later set a password with "forgot password" at the counter; until then the random one cannot be guessed
  const p = await hashSecret(crypto.randomBytes(24).toString('hex'));
  const u = await one(`INSERT INTO Users (role_id, name, email, phone, address, pass_hash, pass_salt) OUTPUT inserted.user_id AS id VALUES (@r, @n, @e, @p, @a, @h, @s)`,
    { r: ROLES.client, n: String(b.name).trim().slice(0, 100), e: email.slice(0, 150), p: String(b.phone || '').slice(0, 30), a: String(b.address || '').slice(0, 250), h: p.hash, s: p.salt });
  await S.audit(req.user, 'customer.create', email, req.ip);
  res.json({ ok: true, id: u.id });
}));
router.put('/customers/:id/measurements', requirePerm('customers.manage'), wrap(async (req, res) => {
  const id = Number(req.params.id), v = {};
  for (const k of ['chest', 'waist', 'shoulder', 'sleeve', 'inseam', 'neck']) { const n = req.body?.[k]; v[k] = n === '' || n == null ? null : Math.round(Number(n) * 10) / 10; if (v[k] !== null && !(v[k] >= 10 && v[k] <= 250)) throw S.bad(`${k} must be 10-250 cm.`); }
  await q(`MERGE Measurements AS t USING (SELECT @id AS user_id) AS s ON t.user_id = s.user_id
    WHEN MATCHED THEN UPDATE SET chest=@chest, waist=@waist, shoulder=@shoulder, sleeve=@sleeve, inseam=@inseam, neck=@neck, updated_at=SYSUTCDATETIME()
    WHEN NOT MATCHED THEN INSERT (user_id, chest, waist, shoulder, sleeve, inseam, neck) VALUES (@id, @chest, @waist, @shoulder, @sleeve, @inseam, @neck);`, { id, ...v });
  await S.audit(req.user, 'customer.measurements', `#${id}`, req.ip);
  res.json({ ok: true });
}));

// ================================================================ staff: clock-in, cash shift, held orders
router.get('/shift/status', requirePerm('shift.manage'), wrap(async (req, res) => {
  const att = await one('SELECT * FROM Attendance WHERE user_id = @u AND clock_out IS NULL', { u: req.user.id });
  const sh = await S.openShiftOf(req.user.id);
  res.json({ clockedIn: att, shift: sh, report: sh ? await S.shiftReport(sh.shift_id) : null });
}));
router.post('/shift/clock-in', requirePerm('shift.manage'), wrap(async (req, res) => { await S.clockIn(req.user); res.json({ ok: true }); }));
router.post('/shift/clock-out', requirePerm('shift.manage'), wrap(async (req, res) => { await S.clockOut(req.user); res.json({ ok: true }); }));
router.post('/shift/open', requirePerm('shift.manage'), wrap(async (req, res) => { await S.startShift(req.user, req.body.float); res.json({ ok: true }); }));
router.post('/shift/close', requirePerm('shift.manage'), wrap(async (req, res) => {
  const sh = await S.openShiftOf(req.user.id); if (!sh) throw S.bad('No open shift.');
  res.json(await S.closeShift(req.user, sh.shift_id, req.body.counted, req.body.note));
}));
router.get('/shift/history', requirePerm('shift.manage'), wrap(async (req, res) => {
  res.json(await q(`SELECT TOP 30 * FROM CashShifts WHERE user_id = @u ORDER BY opened_at DESC`, { u: req.user.id }));
}));
router.get('/shift/report/:id', requirePerm('shift.manage'), wrap(async (req, res) => {
  const rep = await S.shiftReport(Number(req.params.id));
  if (!rep) throw S.notFound();
  if (rep.shift.user_id !== req.user.id && !S.can(req.user, 'reports.view')) throw S.forbidden();
  res.json(rep);
}));

router.get('/held', requirePerm('pos.sell'), wrap(async (req, res) => res.json(await q('SELECT * FROM HeldOrders WHERE user_id = @u ORDER BY created_at DESC', { u: req.user.id }))));
router.post('/held', requirePerm('pos.sell'), wrap(async (req, res) => {
  const cart = req.body?.cart;
  if (!cart || !Array.isArray(cart.items) || !cart.items.length) throw S.bad('Cart is empty.');
  const json = JSON.stringify(cart);
  if (json.length > 100000) throw S.bad('Cart too large.');
  await q('INSERT INTO HeldOrders (user_id, customer_id, label, cart_json) VALUES (@u, @c, @l, @j)',
    { u: req.user.id, c: cart.customerId ? Number(cart.customerId) : null, l: String(req.body.label || '').slice(0, 80), j: json });
  res.json({ ok: true });
}));
router.delete('/held/:id', requirePerm('pos.sell'), wrap(async (req, res) => {
  await q('DELETE FROM HeldOrders WHERE held_id = @id AND user_id = @u', { id: Number(req.params.id), u: req.user.id });
  res.json({ ok: true });
}));

// ================================================================ staff: alterations, rentals, performance, team
router.get('/alterations', requirePerm('alteration.manage'), wrap(async (req, res) => {
  const mine = req.user.role === 'tailor';
  res.json(await S.listAlterations(mine ? '(a.tailor_id = @me OR a.tailor_id IS NULL)' : '1=1', { me: req.user.id }));
}));
router.post('/alterations', requirePerm('alteration.manage'), wrap(async (req, res) => res.json(await S.createAlteration(req.user, req.body || {}, req.ip))));
router.patch('/alterations/:id', requirePerm('alteration.manage'), wrap(async (req, res) => res.json(await S.updateAlteration(req.user, Number(req.params.id), req.body || {}, req.ip))));

router.get('/team', requireAuth, wrap(async (req, res) => {
  if (req.user.role === 'client') throw S.forbidden();
  res.json(await q(`SELECT u.user_id, u.name, r.name AS role FROM Users u JOIN Roles r ON r.role_id = u.role_id WHERE r.name <> 'client' AND u.active = 1 ORDER BY u.name`));
}));

router.get('/performance', requirePerm('performance.view'), wrap(async (req, res) => {
  const me = req.user.id;
  const sums = await one(`SELECT
      COALESCE(SUM(CASE WHEN CAST(o.created_at AS DATE) = CAST(SYSUTCDATETIME() AS DATE) THEN o.total END), 0) AS today,
      COALESCE(SUM(CASE WHEN o.created_at >= DATEADD(DAY, -6, CAST(SYSUTCDATETIME() AS DATE)) THEN o.total END), 0) AS week,
      COALESCE(SUM(CASE WHEN o.created_at >= DATEADD(DAY, -29, CAST(SYSUTCDATETIME() AS DATE)) THEN o.total END), 0) AS month,
      COUNT(CASE WHEN o.created_at >= DATEADD(DAY, -29, CAST(SYSUTCDATETIME() AS DATE)) THEN 1 END) AS orders_month
    FROM Orders o WHERE o.seller_id = @me AND o.status <> 'Cancelled'`, { me });
  const refunds = await one(`SELECT COALESCE(SUM(r.amount), 0) AS amt FROM OrderRefunds r JOIN Orders o ON o.order_id = r.order_id WHERE o.seller_id = @me AND r.at >= DATEADD(DAY, -29, CAST(SYSUTCDATETIME() AS DATE))`, { me });
  const daily = await q(`SELECT CAST(created_at AS DATE) AS day, SUM(total) AS total, COUNT(*) AS n FROM Orders WHERE seller_id = @me AND status <> 'Cancelled' AND created_at >= DATEADD(DAY, -13, CAST(SYSUTCDATETIME() AS DATE)) GROUP BY CAST(created_at AS DATE) ORDER BY day`, { me });
  const pct = Number(req.user.commissionPct || 0);
  const net = Number(sums.month) - Number(refunds.amt);
  res.json({ ...sums, refunds_month: refunds.amt, net_month: net, commission_pct: pct, commission_month: Math.round(net * pct) / 100, daily });
}));

router.get('/rentals', requireAuth, wrap(async (req, res) => {
  if (!S.can(req.user, 'rental.manage') && !S.can(req.user, 'orders.view')) throw S.forbidden();
  res.json(await S.getOrders("o.has_rental = 1 AND o.status NOT IN ('Cancelled')", {}, { limit: 300 }));
}));

module.exports = router;
