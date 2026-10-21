'use strict';
/* The "API": the screens call api.get('/api/...') as before; here those calls are answered from localStorage. */
(function (LB) {
  const { bad, forbidden, notFound, unauthorized, HttpError, r2, nowIso, todayStr, ymd, str, num, can, getSettings, audit, notify, nextId, userById, tierOf, load, save } = LB;
  const SESSION = 'lodc_sid', SESSION_HOURS = 8, MAX_FAILS = 5, LOCK_MIN = 15;
  const daysBetween = (a, b) => LB.daysBetween(a, b);
  const HEX = /^#[0-9a-fA-F]{6}$/;
  const catByName = (db, n) => db.categories.find(c => c.name === n);
  const addDaysStr = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

  const publicUser = (db, a) => ({ id: a.id, name: a.name, email: a.email, phone: a.phone, address: a.address, role: a.role, view: LB.VIEW_OF[a.role], home: LB.HOME_OF[LB.VIEW_OF[a.role]],
    points: a.loyalty_points, tier: tierOf(a.loyalty_points), perms: [...a.perms], discountLimit: a.role === 'admin' ? 100 : a.discountLimit, commissionPct: a.commissionPct });
  const stripSecrets = (u) => ({ user_id: u.user_id, name: u.name, email: u.email, phone: u.phone, role: u.role, active: u.active, discount_limit: u.discount_limit, commission_pct: u.commission_pct,
    loyalty_points: u.loyalty_points, created_at: u.created_at, failed_logins: u.failed_logins, locked_until: u.locked_until });

  // ------------------------------------------------------------ sessions
  const sessionToken = () => { try { return sessionStorage.getItem(SESSION); } catch { return null; } };
  async function startSession(db, userId) {
    const token = LB.randomHex(32), h = await LB.sha256(token);
    const now = Date.now(); db.sessions ||= {};
    for (const [k, s] of Object.entries(db.sessions)) if (s.exp < now) delete db.sessions[k];
    db.sessions[h] = { uid: userId, exp: now + SESSION_HOURS * 3600e3 };
    try { sessionStorage.setItem(SESSION, token); } catch { /* storage blocked */ }
    return token;
  }
  async function actorFor(db, token) {
    if (!token) return null;
    const h = await LB.sha256(token), s = db.sessions?.[h];
    if (!s || s.exp < Date.now()) return null;
    const u = userById(db, s.uid); if (!u || !u.active) return null;
    return { ...LB.actorOf(u), sessionHash: h };
  }
  const revokeSessions = (db, uid, exceptHash) => { for (const [k, s] of Object.entries(db.sessions || {})) if (s.uid === Number(uid) && k !== exceptHash) delete db.sessions[k]; };

  // ------------------------------------------------------------ route table
  const routes = [];
  const add = (method, path, opts, fn) => { if (typeof opts === 'function') { fn = opts; opts = {}; } routes.push({ method, re: new RegExp('^' + path.replace(/:[a-z]+/gi, '([^/]+)') + '$'), names: (path.match(/:[a-z]+/gi) || []).map(s => s.slice(1)), opts, fn }); };
  const need = (perm) => ({ perm });
  const needRole = (...roles) => ({ roles });

  // ============================ auth
  add('POST', '/auth/login', { public: true }, async (c) => {
    const { identifier, secret, mode } = c.body || {};
    if (!identifier || !secret) throw bad('Enter your email/phone and password.');
    const id = String(identifier).trim().toLowerCase(), phone = id.replace(/[\s-]/g, '');
    const u = c.db.users.find(x => x.email.toLowerCase() === id || (x.phone || '').replace(/[\s-]/g, '') === phone);
    const generic = new HttpError(401, 'Invalid credentials.');
    if (!u || !u.active) throw generic;
    if (u.locked_until && new Date(u.locked_until) > new Date()) throw new HttpError(423, `Account locked after too many failed attempts. Try again in ${Math.ceil((new Date(u.locked_until) - Date.now()) / 60000)} min.`);
    const usePin = mode === 'pin';
    if (usePin && u.role === 'client') throw new HttpError(401, 'PIN login is for staff accounts only.');
    const ok = usePin ? await LB.verifySecret(String(secret), u.pin_salt, u.pin_hash) : await LB.verifySecret(String(secret), u.pass_salt, u.pass_hash);
    if (!ok) {
      u.failed_logins++; if (u.failed_logins >= MAX_FAILS) u.locked_until = new Date(Date.now() + LOCK_MIN * 60000).toISOString();
      audit(c.db, { id: u.user_id, name: u.name, role: u.role }, 'login.failed', usePin ? 'PIN' : 'password');
      save(c.db); throw generic;
    }
    u.failed_logins = 0; u.locked_until = null;
    await startSession(c.db, u.user_id);
    audit(c.db, { id: u.user_id, name: u.name, role: u.role }, 'login', usePin ? 'PIN' : 'password');
    return { ok: true, home: LB.HOME_OF[LB.VIEW_OF[u.role]], role: u.role };
  });
  add('POST', '/auth/register', { public: true }, async (c) => {
    const { name, email, phone, password } = c.body || {};
    if (!str(name, 100)) throw bad('Name is required.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || ''))) throw bad('Enter a valid email.');
    if (String(password || '').length < 8) throw bad('Password must be at least 8 characters.');
    const ph = String(phone || '').replace(/[\s-]/g, '');
    if (c.db.users.some(u => u.email.toLowerCase() === String(email).trim().toLowerCase())) throw bad('That email is already registered.');
    if (ph && c.db.users.some(u => (u.phone || '').replace(/[\s-]/g, '') === ph)) throw bad('That phone number is already registered.');
    const p = await LB.hashSecret(password), id = nextId(c.db, 'user');
    c.db.users.push({ user_id: id, role: 'client', name: str(name, 100), email: str(email, 150), phone: str(phone, 30), address: '', pass_hash: p.hash, pass_salt: p.salt, pin_hash: null, pin_salt: null, active: true,
      discount_limit: null, commission_pct: 0, loyalty_points: 0, failed_logins: 0, locked_until: null, created_at: nowIso(), overrides: [], measurements: null });
    notify(c.db, id, 'Welcome to L’Or de Cambodge', 'Use code WELCOME10 for 10% off your first order.', 'promo');
    audit(c.db, { id, name: str(name, 100), role: 'client' }, 'register', email);
    await startSession(c.db, id);
    return { ok: true, home: LB.HOME_OF.client, role: 'client' };
  });
  add('POST', '/auth/logout', { public: true }, (c) => { if (c.actor) { delete c.db.sessions?.[c.actor.sessionHash]; audit(c.db, c.actor, 'logout'); } try { sessionStorage.removeItem(SESSION); } catch { /* ignore */ } return { ok: true }; });
  add('GET', '/auth/me', (c) => ({ user: publicUser(c.db, c.actor), unread: c.db.notifications.filter(n => n.user_id === c.actor.id && !n.is_read).length, today: todayStr() }));
  add('POST', '/auth/password', async (c) => {
    const { current, next } = c.body || {};
    if (String(next || '').length < 8) throw bad('New password must be at least 8 characters.');
    const u = userById(c.db, c.actor.id);
    if (!(await LB.verifySecret(String(current || ''), u.pass_salt, u.pass_hash))) throw new HttpError(401, 'Current password is wrong.');
    const p = await LB.hashSecret(next); u.pass_hash = p.hash; u.pass_salt = p.salt;
    revokeSessions(c.db, u.user_id, c.actor.sessionHash); audit(c.db, c.actor, 'password.change');
    return { ok: true };
  });
  add('POST', '/auth/pin', needRole('seller', 'tailor', 'manager', 'admin'), async (c) => {
    const { current, pin } = c.body || {};
    if (!/^\d{4,6}$/.test(String(pin || ''))) throw bad('PIN must be 4-6 digits.');
    const u = userById(c.db, c.actor.id);
    if (!(await LB.verifySecret(String(current || ''), u.pass_salt, u.pass_hash))) throw new HttpError(401, 'Current password is wrong.');
    const p = await LB.hashSecret(pin); u.pin_hash = p.hash; u.pin_salt = p.salt; audit(c.db, c.actor, 'pin.change');
    return { ok: true };
  });

  // ============================ public shop data
  add('GET', '/settings', { public: true }, (c) => {
    const s = getSettings(c.db);
    return { env: LB.env, storeName: s.storeName, address: s.address, phone: s.phone, logo: s.logo, vatPct: s.vatPct, currency: s.currency, khrRate: s.khrRate, paymentMethods: s.paymentMethods, lowStock: s.lowStock,
      rentalMaxDays: s.rentalMaxDays, lateFeePct: s.lateFeePct, refundDays: s.refundDays, receiptHeader: s.receiptHeader, receiptFooter: s.receiptFooter, pointValue: s.pointValue, pointsPerDollar: s.pointsPerDollar,
      tailorMarkupPct: s.tailorMarkupPct, maxSellerDiscount: s.maxSellerDiscount };
  });
  add('GET', '/catalog', (c) => {
    const withCost = can(c.actor, 'products.edit') || can(c.actor, 'reports.view');
    return { products: LB.listProducts(c.db, { includeCost: withCost }), categories: c.db.categories.map(x => ({ name: x.name, sizes: x.sizes.split(',') })),
      bundles: c.db.bundles.filter(b => b.active).map(b => ({ bundle_id: b.bundle_id, name: b.name, pct: b.pct })), sales: LB.activeSales(c.db) };
  });
  add('POST', '/quote', (c) => LB.quote(c.db, c.actor, c.body || {}));

  // ============================ orders
  add('POST', '/orders', (c) => { if (c.actor.role === 'client' || can(c.actor, 'pos.sell')) return LB.placeOrder(c.db, c.actor, c.body || {}); throw forbidden(); });
  add('GET', '/orders', (c) => {
    const q = c.query; let f;
    if (c.actor.role === 'client') f = (o) => o.customer_id === c.actor.id;
    else if (!can(c.actor, 'orders.view')) throw forbidden();
    else f = () => true;
    const today = todayStr();
    return LB.listOrders(c.db, (o) => f(o) && (!q.status || o.status === q.status) && (!q.channel || o.channel === q.channel) && (!q.from || ymd(o.created_at) >= q.from) && (!q.to || ymd(o.created_at) <= q.to)
      && (!q.search || `${o.order_no} ${o.customer_name}`.toLowerCase().includes(String(q.search).toLowerCase())) && (q.kind !== 'tailor' || o.has_tailor) && (q.kind !== 'rental' || o.has_rental)
      && (!(q.mine === '1' && c.actor.role !== 'client') || o.seller_id === c.actor.id) && (!(q.customerId && c.actor.role !== 'client') || o.customer_id === Number(q.customerId))
      && (q.kind !== 'overdue' || (o.has_rental && o.status === 'Picked Up' && o.items.some(i => i.kind === 'rent' && ymd(i.rent_to) < today))), q.limit);
  });
  add('GET', '/orders/:id', (c) => {
    const o = LB.getOrder(c.db, c.params.id); if (!o) throw notFound('Order not found.');
    if (c.actor.role === 'client' ? o.customer_id !== c.actor.id : !can(c.actor, 'orders.view')) throw forbidden();
    return o;
  });
  add('POST', '/orders/:id/status', (c) => LB.setStatus(c.db, c.actor, c.params.id, String(c.body.status)));
  add('POST', '/orders/:id/payments', (c) => LB.addPayment(c.db, c.actor, c.params.id, c.body || {}));
  add('POST', '/orders/:id/refund', (c) => LB.refundOrder(c.db, c.actor, c.params.id, c.body || {}));
  add('POST', '/orders/:id/exchange', (c) => LB.exchangeItem(c.db, c.actor, c.params.id, c.body.itemId, c.body.newSize));
  add('POST', '/orders/:id/rental-checkin', (c) => LB.checkInRental(c.db, c.actor, c.params.id, c.body || {}));
  add('POST', '/orders/:id/assign-tailor', (c) => LB.assignTailor(c.db, c.actor, c.params.id, c.body.tailorId ? Number(c.body.tailorId) : null));

  // ============================ my account
  const measurementsOf = (u) => u.measurements || {};
  add('GET', '/me/profile', (c) => {
    const u = userById(c.db, c.actor.id), pts = u.loyalty_points, next = [500, 1500, 3000].find(t => t > pts) || null;
    return { name: u.name, email: u.email, phone: u.phone, address: u.address, loyalty_points: pts, created_at: u.created_at, measurements: measurementsOf(u), tier: tierOf(pts), next_tier_at: next, next_tier: next ? tierOf(next) : null };
  });
  add('PUT', '/me/profile', (c) => {
    const { name, phone, address } = c.body || {}; if (!str(name, 100)) throw bad('Name is required.');
    const ph = String(phone || '').replace(/[\s-]/g, '');
    if (ph && c.db.users.some(u => u.user_id !== c.actor.id && (u.phone || '').replace(/[\s-]/g, '') === ph)) throw bad('That phone number is already used.');
    const u = userById(c.db, c.actor.id); u.name = str(name, 100); u.phone = str(phone, 30); u.address = str(address, 250);
    return { ok: true };
  });
  const MEAS = ['chest', 'waist', 'shoulder', 'sleeve', 'inseam', 'neck'];
  function readMeasurements(body) {
    const v = {};
    for (const k of MEAS) { const raw = body?.[k]; if (raw === '' || raw == null) { v[k] = null; continue; } const n = Number(raw); if (!(n >= 10 && n <= 250)) throw bad(`${k} must be between 10 and 250 cm.`); v[k] = Math.round(n * 10) / 10; }
    return { ...v, updated_at: nowIso() };
  }
  add('PUT', '/me/measurements', needRole('client'), (c) => { userById(c.db, c.actor.id).measurements = readMeasurements(c.body); return { ok: true }; });
  function runReminders(db, userId) {
    for (const o of db.orders.filter(x => x.customer_id === userId && x.status === 'Ready' && !x.reminded_at)) {
      const h = o.history.filter(x => x.status === 'Ready').pop();
      if (h && Date.now() - new Date(h.at) > 2 * 864e5) { o.reminded_at = nowIso(); notify(db, userId, `Reminder: ${o.order_no} is waiting`, 'Your order is ready for pickup.', 'order'); }
    }
    const t = todayStr(), tomorrow = addDaysStr(1);
    for (const a of db.appointments.filter(x => x.customer_id === userId && !x.reminded && ['Booked', 'Confirmed'].includes(x.status) && ymd(x.appt_date) >= t && ymd(x.appt_date) <= tomorrow)) {
      a.reminded = true; notify(db, userId, 'Fitting reminder', `${a.service} on ${ymd(a.appt_date)} at ${a.appt_time}.`, 'appointment');
    }
  }
  add('GET', '/me/notifications', (c) => { if (c.actor.role === 'client') { runReminders(c.db, c.actor.id); c.dirty = true; } return c.db.notifications.filter(n => n.user_id === c.actor.id).slice(0, 100); });
  add('POST', '/me/notifications/read', (c) => { c.db.notifications.forEach(n => { if (n.user_id === c.actor.id) n.is_read = true; }); return { ok: true }; });

  // ============================ appointments
  add('GET', '/appointments', (c) => {
    let f;
    if (c.actor.role === 'client') f = (a) => a.customer_id === c.actor.id; else if (!can(c.actor, 'appointments.manage')) throw forbidden(); else f = () => true;
    return c.db.appointments.filter(a => f(a) && (!c.query.date || ymd(a.appt_date) === c.query.date)).map(a => ({ ...a, assigned_name: a.assigned_to ? userById(c.db, a.assigned_to)?.name || null : null }))
      .sort((a, b) => (b.appt_date > a.appt_date ? 1 : b.appt_date < a.appt_date ? -1 : a.appt_time < b.appt_time ? -1 : 1));
  });
  add('POST', '/appointments', (c) => {
    const b = c.body || {};
    if (!['Fitting', 'Consultation', 'Alteration pickup', 'Rental fitting'].includes(b.service)) throw bad('Choose a service.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(b.date)) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(String(b.time))) throw bad('Choose a date and time.');
    if (b.date < todayStr()) throw bad('Choose a future date.');
    if (b.time < '09:00' || b.time > '18:00') throw bad('We are open 09:00-18:00.');
    let cust = c.actor;
    if (c.actor.role !== 'client') { if (!can(c.actor, 'appointments.manage')) throw forbidden(); const u = userById(c.db, b.customerId); if (!u) throw bad('Choose a customer.'); cust = { id: u.user_id, name: u.name }; }
    if (c.db.appointments.filter(a => ymd(a.appt_date) === b.date && a.appt_time === b.time && ['Booked', 'Confirmed'].includes(a.status)).length >= 2) throw bad('That time slot is full. Please choose another.');
    const id = nextId(c.db, 'appointment');
    c.db.appointments.push({ appointment_id: id, customer_id: cust.id, customer_name: cust.name, service: b.service, appt_date: b.date, appt_time: b.time, status: c.actor.role === 'client' ? 'Booked' : 'Confirmed', note: str(b.note, 250), assigned_to: null, reminded: false, created_at: nowIso() });
    notify(c.db, cust.id, 'Appointment booked', `${b.service} on ${b.date} at ${b.time}.`, 'appointment'); audit(c.db, c.actor, 'appointment.create', `${cust.name} ${b.date} ${b.time}`);
    return { ok: true, id };
  });
  add('PATCH', '/appointments/:id', (c) => {
    const a = c.db.appointments.find(x => x.appointment_id === Number(c.params.id)); if (!a) throw notFound();
    const status = String(c.body.status || ''); if (!['Booked', 'Confirmed', 'Completed', 'Cancelled', 'No-show'].includes(status)) throw bad('Invalid status.');
    if (c.actor.role === 'client') { if (a.customer_id !== c.actor.id || status !== 'Cancelled') throw forbidden(); } else if (!can(c.actor, 'appointments.manage')) throw forbidden();
    a.status = status; if (c.body.assignedTo) a.assigned_to = Number(c.body.assignedTo);
    if (c.actor.role !== 'client') notify(c.db, a.customer_id, `Appointment ${status.toLowerCase()}`, `${a.service} on ${ymd(a.appt_date)} at ${a.appt_time}.`, 'appointment');
    audit(c.db, c.actor, 'appointment.update', `#${a.appointment_id} -> ${status}`);
    return { ok: true };
  });

  // ============================ customers (staff)
  add('GET', '/customers', need('customers.manage'), (c) => {
    const s = String(c.query.search || '').toLowerCase();
    return c.db.users.filter(u => u.role === 'client' && (!s || `${u.name} ${u.email} ${u.phone}`.toLowerCase().includes(s))).sort((a, b) => a.name.localeCompare(b.name)).slice(0, 200).map(u => {
      const os = c.db.orders.filter(o => o.customer_id === u.user_id && o.status !== 'Cancelled');
      return { user_id: u.user_id, name: u.name, email: u.email, phone: u.phone, address: u.address, loyalty_points: u.loyalty_points, active: u.active, created_at: u.created_at, orders: os.length, spent: r2(os.reduce((a, o) => a + o.total, 0)) };
    });
  });
  add('GET', '/customers/:id', need('customers.manage'), (c) => {
    const u = userById(c.db, c.params.id); if (!u || u.role !== 'client') throw notFound('Customer not found.');
    return { user_id: u.user_id, name: u.name, email: u.email, phone: u.phone, address: u.address, loyalty_points: u.loyalty_points, created_at: u.created_at, tier: tierOf(u.loyalty_points), measurements: measurementsOf(u),
      orders: LB.listOrders(c.db, (o) => o.customer_id === u.user_id, 100), alterations: c.db.alterations.filter(a => a.customer_id === u.user_id).map(a => LB.decorateAlt(c.db, a)),
      appointments: c.db.appointments.filter(a => a.customer_id === u.user_id).sort((a, b) => (b.appt_date > a.appt_date ? 1 : -1)) };
  });
  add('POST', '/customers', need('customers.manage'), async (c) => {
    const b = c.body || {}, email = str(b.email, 150);
    if (!str(b.name, 100) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw bad('Name and a valid email are required.');
    if (c.db.users.some(u => u.email.toLowerCase() === email.toLowerCase())) throw bad('Email already used.');
    const p = await LB.hashSecret(LB.randomHex(24)), id = nextId(c.db, 'user');   // random password: the customer cannot sign in until an admin sets one
    c.db.users.push({ user_id: id, role: 'client', name: str(b.name, 100), email, phone: str(b.phone, 30), address: str(b.address, 250), pass_hash: p.hash, pass_salt: p.salt, pin_hash: null, pin_salt: null, active: true,
      discount_limit: null, commission_pct: 0, loyalty_points: 0, failed_logins: 0, locked_until: null, created_at: nowIso(), overrides: [], measurements: null });
    audit(c.db, c.actor, 'customer.create', email); return { ok: true, id };
  });
  add('PUT', '/customers/:id/measurements', need('customers.manage'), (c) => {
    const u = userById(c.db, c.params.id); if (!u || u.role !== 'client') throw notFound('Customer not found.');
    u.measurements = readMeasurements(c.body); audit(c.db, c.actor, 'customer.measurements', `#${u.user_id}`); return { ok: true };
  });

  // ============================ clock-in, cash shifts, held orders
  add('GET', '/shift/status', need('shift.manage'), (c) => {
    const att = LB.openAttendance(c.db, c.actor.id), sh = LB.openShiftOf(c.db, c.actor.id);
    return { clockedIn: att ? { ...att, clock_in: att.clock_in } : null, shift: sh, report: sh ? LB.shiftReport(c.db, sh.shift_id) : null };
  });
  add('POST', '/shift/clock-in', need('shift.manage'), (c) => { LB.clockIn(c.db, c.actor); return { ok: true }; });
  add('POST', '/shift/clock-out', need('shift.manage'), (c) => { LB.clockOut(c.db, c.actor); return { ok: true }; });
  add('POST', '/shift/open', need('shift.manage'), (c) => { LB.startShift(c.db, c.actor, c.body.float); return { ok: true }; });
  add('POST', '/shift/close', need('shift.manage'), (c) => { const sh = LB.openShiftOf(c.db, c.actor.id); if (!sh) throw bad('No open shift.'); return LB.closeShift(c.db, c.actor, sh.shift_id, c.body.counted, c.body.note); });
  add('GET', '/shift/history', need('shift.manage'), (c) => c.db.shifts.filter(s => s.user_id === c.actor.id).slice(0, 30));
  add('GET', '/shift/report/:id', need('shift.manage'), (c) => {
    const r = LB.shiftReport(c.db, c.params.id); if (!r) throw notFound();
    if (r.shift.user_id !== c.actor.id && !can(c.actor, 'reports.view')) throw forbidden(); return r;
  });
  add('GET', '/held', need('pos.sell'), (c) => c.db.held.filter(h => h.user_id === c.actor.id));
  add('POST', '/held', need('pos.sell'), (c) => {
    const cart = c.body?.cart; if (!cart || !Array.isArray(cart.items) || !cart.items.length) throw bad('Cart is empty.');
    const json = JSON.stringify(cart); if (json.length > 100000) throw bad('Cart too large.');
    c.db.held.unshift({ held_id: nextId(c.db, 'held'), user_id: c.actor.id, customer_id: cart.customerId ? Number(cart.customerId) : null, label: str(c.body.label, 80), cart_json: json, created_at: nowIso() });
    return { ok: true };
  });
  add('DELETE', '/held/:id', need('pos.sell'), (c) => { c.db.held = c.db.held.filter(h => !(h.held_id === Number(c.params.id) && h.user_id === c.actor.id)); return { ok: true }; });

  // ============================ alterations, team, performance, rentals
  add('GET', '/alterations', need('alteration.manage'), (c) => c.db.alterations.filter(a => c.actor.role !== 'tailor' || a.tailor_id === c.actor.id || !a.tailor_id).map(a => LB.decorateAlt(c.db, a)));
  add('POST', '/alterations', need('alteration.manage'), (c) => LB.createAlteration(c.db, c.actor, c.body || {}));
  add('PATCH', '/alterations/:id', need('alteration.manage'), (c) => LB.updateAlteration(c.db, c.actor, c.params.id, c.body || {}));
  add('GET', '/team', (c) => { if (c.actor.role === 'client') throw forbidden(); return c.db.users.filter(u => u.role !== 'client' && u.active).map(u => ({ user_id: u.user_id, name: u.name, role: u.role })).sort((a, b) => a.name.localeCompare(b.name)); });
  add('GET', '/performance', need('performance.view'), (c) => {
    const mine = c.db.orders.filter(o => o.seller_id === c.actor.id && o.status !== 'Cancelled'), t = todayStr(), d7 = addDaysStr(-6), d30 = addDaysStr(-29), d14 = addDaysStr(-13);
    const sum = (f) => r2(mine.filter(f).reduce((s, o) => s + o.total, 0));
    const refunds = r2(c.db.orders.filter(o => o.seller_id === c.actor.id).flatMap(o => o.refunds).filter(r => ymd(r.at) >= d30).reduce((s, r) => s + Number(r.amount), 0));
    const month = sum(o => ymd(o.created_at) >= d30), pct = Number(c.actor.commissionPct || 0), net = r2(month - refunds);
    const dayMap = {}; for (const o of mine.filter(o => ymd(o.created_at) >= d14)) { const k = ymd(o.created_at); (dayMap[k] ||= { day: k, total: 0, n: 0 }); dayMap[k].total += o.total; dayMap[k].n++; }
    return { today: sum(o => ymd(o.created_at) === t), week: sum(o => ymd(o.created_at) >= d7), month, orders_month: mine.filter(o => ymd(o.created_at) >= d30).length, refunds_month: refunds, net_month: net,
      commission_pct: pct, commission_month: r2(net * pct / 100), daily: Object.values(dayMap).sort((a, b) => a.day.localeCompare(b.day)).map(x => ({ ...x, total: r2(x.total) })) };
  });
  add('GET', '/rentals', (c) => { if (!can(c.actor, 'rental.manage') && !can(c.actor, 'orders.view')) throw forbidden(); return LB.listOrders(c.db, (o) => o.has_rental && o.status !== 'Cancelled', 300); });

  // ============================ admin: dashboard + reports
  const isoWeek = (d) => { const t = new Date(d + 'T00:00:00Z'); const day = (t.getUTCDay() + 6) % 7; t.setUTCDate(t.getUTCDate() - day + 3); const first = new Date(Date.UTC(t.getUTCFullYear(), 0, 4)); return 1 + Math.round(((t - first) / 864e5 - 3 + ((first.getUTCDay() + 6) % 7)) / 7); };
  const groupBy = (arr, keyFn, init, add2) => { const m = new Map(); for (const x of arr) { const k = keyFn(x); if (!m.has(k)) m.set(k, init(k)); add2(m.get(k), x); } return [...m.values()]; };
  add('GET', '/admin/dashboard', need('reports.view'), (c) => {
    const s = getSettings(c.db), live = c.db.orders.filter(o => o.status !== 'Cancelled'), t = todayStr(), d7 = addDaysStr(-6), d30 = addDaysStr(-29);
    const sum = (f) => r2(live.filter(f).reduce((a, o) => a + o.total, 0));
    const daily = []; for (let n = 13; n >= 0; n--) { const day = addDaysStr(-n), os = live.filter(o => ymd(o.created_at) === day); daily.push({ day, total: r2(os.reduce((a, o) => a + o.total, 0)), orders: os.length }); }
    const top = groupBy(live.flatMap(o => o.items.filter(i => i.kind !== 'rent')), i => i.name, k => ({ name: k, qty: 0, revenue: 0 }), (g, i) => { g.qty += i.qty; g.revenue += i.qty * i.unit_price; }).sort((a, b) => b.qty - a.qty || b.revenue - a.revenue).slice(0, 5);
    const low = c.db.products.filter(p => p.active).flatMap(p => p.variants.filter(v => v.stock <= s.lowStock).map(v => ({ name: p.name, size: v.size, stock: v.stock }))).sort((a, b) => a.stock - b.stock || a.name.localeCompare(b.name)).slice(0, 12);
    return { revenue_today: sum(o => ymd(o.created_at) === t), orders_today: live.filter(o => ymd(o.created_at) === t).length, revenue_week: sum(o => ymd(o.created_at) >= d7), revenue_month: sum(o => ymd(o.created_at) >= d30),
      open_orders: live.filter(o => ['Pending', 'Tailoring', 'Ready'].includes(o.status)).length, customers: c.db.users.filter(u => u.role === 'client').length,
      overdue_rentals: live.filter(o => o.has_rental && o.status === 'Picked Up' && o.items.some(i => i.kind === 'rent' && ymd(i.rent_to) < t)).length,
      open_alterations: c.db.alterations.filter(a => ['Received', 'In Progress'].includes(a.status)).length,
      appointments_today: c.db.appointments.filter(a => ymd(a.appt_date) === t && ['Booked', 'Confirmed'].includes(a.status)).length, daily, top, low };
  });
  add('GET', '/admin/reports', need('reports.view'), (c) => {
    const re = /^\d{4}-\d{2}-\d{2}$/, from = re.test(String(c.query.from)) ? c.query.from : todayStr(), to = re.test(String(c.query.to)) ? c.query.to : todayStr();
    const inR = (iso) => ymd(iso) >= from && ymd(iso) <= to, os = c.db.orders.filter(o => o.status !== 'Cancelled' && inR(o.created_at));
    const S = (arr, f) => arr.reduce((a, x) => a + f(x), 0);
    const items = os.flatMap(o => o.items.map(i => ({ ...i, __o: o }))), buy = items.filter(i => i.kind !== 'rent'), rent = items.filter(i => i.kind === 'rent');
    const refunds = S(c.db.orders.flatMap(o => o.refunds).filter(r => inR(r.at)), r => Number(r.amount));
    const totals = { orders: os.length, gross: r2(S(os, o => o.subtotal)), discounts: r2(S(os, o => o.bundle_discount + o.discount + o.points_value)), tax: r2(S(os, o => o.tax)), deposits: r2(S(os, o => o.deposit)), total: r2(S(os, o => o.total)) };
    const cogs = r2(S(buy, i => i.qty * i.unit_cost)), itemSales = S(buy, i => i.qty * i.unit_price);
    const dayRows = groupBy(os, o => ymd(o.created_at), k => ({ day: k, orders: 0, total: 0 }), (g, o) => { g.orders++; g.total += o.total; }).sort((a, b) => a.day.localeCompare(b.day));
    const week = groupBy(dayRows, d => isoWeek(d.day), k => ({ week: k, start: null, orders: 0, total: 0 }), (g, d) => { g.start = g.start && g.start < d.day ? g.start : d.day; g.orders += d.orders; g.total += d.total; });
    const month = groupBy(dayRows, d => d.day.slice(0, 7), k => ({ month: k, orders: 0, total: 0 }), (g, d) => { g.orders += d.orders; g.total += d.total; });
    const top = (arr, n) => arr.slice(0, n);
    const bySeller = groupBy(os, o => o.seller_name || 'Online', k => ({ seller: k, orders: 0, total: 0, commission_pct: null, commission: 0 }), (g, o) => { g.orders++; g.total += o.total; if (o.seller_id) g.commission_pct = userById(c.db, o.seller_id)?.commission_pct ?? 0; })
      .map(g => ({ ...g, total: r2(g.total), commission: r2(g.total * (g.commission_pct || 0) / 100) })).sort((a, b) => b.total - a.total);
    const payments = c.db.orders.flatMap(o => o.payments).filter(p => inR(p.at));
    const variants = c.db.products.filter(p => p.active).flatMap(p => p.variants.map(v => ({ stock: v.stock, cost: p.cost, price: p.price })));
    return { from, to, totals: { ...totals, refunds: r2(refunds), net: r2(totals.total - refunds), cogs, rental_revenue: r2(S(rent, i => i.unit_price * i.rent_days * i.qty)), gross_profit: r2(itemSales - cogs) },
      byDay: dayRows.map(d => ({ ...d, total: r2(d.total) })), byWeek: week.map(w => ({ ...w, total: r2(w.total) })), byMonth: month.map(m => ({ ...m, total: r2(m.total) })),
      byCategory: groupBy(buy, i => i.category || '-', k => ({ category: k, qty: 0, revenue: 0 }), (g, i) => { g.qty += i.qty; g.revenue += i.qty * i.unit_price; }).map(g => ({ ...g, revenue: r2(g.revenue) })).sort((a, b) => b.revenue - a.revenue),
      bySize: top(groupBy(items, i => i.size, k => ({ size: k, qty: 0 }), (g, i) => { g.qty += i.qty; }).sort((a, b) => b.qty - a.qty), 12),
      byColor: top(groupBy(items, i => i.color_name || '-', k => ({ color: k, qty: 0 }), (g, i) => { g.qty += i.qty; }).sort((a, b) => b.qty - a.qty), 12),
      byStyle: groupBy(items, i => `${i.fit || '-'}|${i.fabric || '-'}`, k => ({ fit: k.split('|')[0], fabric: k.split('|')[1], qty: 0 }), (g, i) => { g.qty += i.qty; }).sort((a, b) => b.qty - a.qty),
      bestItems: top(groupBy(items, i => i.name, k => ({ name: k, qty: 0, revenue: 0 }), (g, i) => { g.qty += i.qty; g.revenue += i.qty * i.unit_price; }).map(g => ({ ...g, revenue: r2(g.revenue) })).sort((a, b) => b.qty - a.qty), 10),
      bySeller, byMethod: groupBy(payments, p => p.method, k => ({ method: k, payments: 0, total: 0 }), (g, p) => { g.payments++; g.total += p.amount; }).map(g => ({ ...g, total: r2(g.total) })).sort((a, b) => b.total - a.total),
      inventory: { cost_value: r2(S(variants, v => v.stock * v.cost)), retail_value: r2(S(variants, v => v.stock * v.price)), units: S(variants, v => v.stock) },
      shifts: c.db.shifts.filter(s => inR(s.opened_at)).sort((a, b) => (b.opened_at > a.opened_at ? 1 : -1)).map(s => ({ ...s, user_name: userById(c.db, s.user_id)?.name || '' })) };
  });

  // ============================ admin: products & categories
  function writeProduct(db, existing, b) {
    const name = str(b.name, 150); if (!name) throw bad('Product name is required.');
    const cat = catByName(db, str(b.category, 50)); if (!cat) throw bad('Choose a category.');
    const price = num(b.price, -1), cost = num(b.cost, 0);
    if (!(price >= 0)) throw bad('Price must be 0 or more.'); if (cost < 0 || cost > price * 5 + 1) throw bad('Cost looks invalid.');
    if (!HEX.test(String(b.color_hex || '#1d2a52'))) throw bad('Color must be a hex value like #1d2a52.');
    if (b.image_url && (!String(b.image_url).startsWith('data:image/') || String(b.image_url).length > 700000)) throw bad('Image must be a small picture (under ~500 KB).');
    const sku = str(b.sku, 30); if (!sku) throw bad('SKU is required.');
    if (db.products.some(p => p.sku === sku && p !== existing)) throw bad('SKU already exists.');
    const f = { name, sku, barcode: str(b.barcode, 30) || null, category_id: cat.category_id, description: str(b.description, 600), fabric: str(b.fabric, 30), fit: str(b.fit, 20), color_name: str(b.color_name, 40),
      color_hex: b.color_hex || '#1d2a52', price: r2(price), cost: r2(cost), rent_per_day: r2(Math.max(0, num(b.rent_per_day))), rent_deposit: r2(Math.max(0, num(b.rent_deposit))), tailorable: !!b.tailorable, active: b.active !== false };
    if (existing) { Object.assign(existing, f); if (b.image_url) existing.image_url = b.image_url; return existing; }
    const p = { product_id: nextId(db, 'product'), ...f, image_url: b.image_url || null, created_at: nowIso(), variants: [] }; db.products.push(p); return p;
  }
  function syncVariants(db, actor, p, variants) {
    if (!Array.isArray(variants)) return;
    const wanted = new Set();
    for (const v of variants) {
      const size = str(v.size, 20); if (!size) continue; wanted.add(size);
      if (!p.variants.find(e => e.size === size)) {
        const stock = Math.max(0, Math.floor(num(v.stock))), nv = { variant_id: nextId(db, 'variant'), size, stock };
        p.variants.push(nv);
        if (stock) db.movements.unshift({ movement_id: nextId(db, 'movement'), variant_id: nv.variant_id, qty: stock, type: 'adjust', ref: 'initial stock', user_id: actor.id, at: nowIso() });
      }
    }
    for (const e of [...p.variants].filter(e => !wanted.has(e.size))) {
      if (db.orders.some(o => o.items.some(i => i.variant_id === e.variant_id))) throw bad(`Size ${e.size} has sales history and cannot be removed (set stock to 0 instead).`);
      p.variants = p.variants.filter(x => x !== e); db.movements = db.movements.filter(m => m.variant_id !== e.variant_id);
    }
  }
  add('GET', '/admin/products', need('products.edit'), (c) => LB.listProducts(c.db, { includeInactive: true, includeCost: true }));
  add('POST', '/admin/products', need('products.edit'), (c) => { const p = writeProduct(c.db, null, c.body || {}); syncVariants(c.db, c.actor, p, c.body.variants); audit(c.db, c.actor, 'product.create', p.name); return { ok: true, id: p.product_id }; });
  add('PUT', '/admin/products/:id', need('products.edit'), (c) => {
    const p = c.db.products.find(x => x.product_id === Number(c.params.id)); if (!p) throw notFound();
    writeProduct(c.db, p, c.body || {}); syncVariants(c.db, c.actor, p, c.body.variants); audit(c.db, c.actor, 'product.update', `#${p.product_id} ${p.name}`); return { ok: true };
  });
  add('DELETE', '/admin/products/:id', need('products.edit'), (c) => {
    const p = c.db.products.find(x => x.product_id === Number(c.params.id)); if (!p) throw notFound();
    if (c.db.orders.some(o => o.items.some(i => i.product_id === p.product_id))) { p.active = false; audit(c.db, c.actor, 'product.archive', p.name); return { ok: true, archived: true }; }
    const vids = new Set(p.variants.map(v => v.variant_id));
    c.db.movements = c.db.movements.filter(m => !vids.has(m.variant_id)); c.db.purchases.forEach(po => { po.items = po.items.filter(i => !vids.has(i.variant_id)); });
    c.db.products = c.db.products.filter(x => x !== p); audit(c.db, c.actor, 'product.delete', p.name); return { ok: true, archived: false };
  });
  const sizesCsv = (v) => String(v || 'One size').split(',').map(s => s.trim()).filter(Boolean).join(',').slice(0, 200) || 'One size';
  add('GET', '/admin/categories', need('products.edit'), (c) => c.db.categories.map(x => ({ ...x, products: c.db.products.filter(p => p.category_id === x.category_id).length })));
  add('POST', '/admin/categories', need('products.edit'), (c) => {
    const name = str(c.body.name, 50); if (!name) throw bad('Category name is required.'); if (catByName(c.db, name)) throw bad('Category already exists.');
    c.db.categories.push({ category_id: nextId(c.db, 'category'), name, sizes: sizesCsv(c.body.sizes) }); audit(c.db, c.actor, 'category.create', name); return { ok: true };
  });
  add('PUT', '/admin/categories/:id', need('products.edit'), (c) => {
    const x = c.db.categories.find(k => k.category_id === Number(c.params.id)); if (!x) throw notFound();
    const name = str(c.body.name, 50); if (!name) throw bad('Category name is required.'); if (c.db.categories.some(k => k.name === name && k !== x)) throw bad('Category already exists.');
    x.name = name; x.sizes = sizesCsv(c.body.sizes); audit(c.db, c.actor, 'category.update', name); return { ok: true };
  });
  add('DELETE', '/admin/categories/:id', need('products.edit'), (c) => {
    const id = Number(c.params.id); if (c.db.products.some(p => p.category_id === id)) throw bad('Move or delete the products in this category first.');
    c.db.bundles.forEach(b => { b.category_ids = b.category_ids.filter(k => k !== id); }); c.db.sales.forEach(s => { if (s.category_id === id) s.active = false; });
    c.db.categories = c.db.categories.filter(k => k.category_id !== id); audit(c.db, c.actor, 'category.delete', `#${id}`); return { ok: true };
  });

  // ============================ admin: inventory, suppliers, purchase orders
  add('GET', '/admin/inventory', need('inventory.view'), (c) => {
    const withCost = can(c.actor, 'inventory.edit') || can(c.actor, 'reports.view');
    return c.db.products.filter(p => p.active).sort((a, b) => a.name.localeCompare(b.name)).flatMap(p => p.variants.map(v => { const r = { variant_id: v.variant_id, product_id: p.product_id, name: p.name, sku: p.sku, barcode: p.barcode, category: catByName2(c.db, p.category_id), color_name: p.color_name, color_hex: p.color_hex, fabric: p.fabric, fit: p.fit, size: v.size, stock: v.stock, price: p.price }; if (withCost) r.cost = p.cost; return r; }));
  });
  const catByName2 = (db, id) => db.categories.find(k => k.category_id === id)?.name || '';
  add('POST', '/admin/inventory/adjust', need('inventory.edit'), (c) => {
    const delta = Math.trunc(num(c.body.delta)), reason = str(c.body.reason, 40);
    if (!delta) throw bad('Enter a quantity (use a negative number to remove stock).'); if (!reason) throw bad('A reason is required.');
    LB.moveStock(c.db, Number(c.body.variantId), delta, 'adjust', reason, c.actor.id); audit(c.db, c.actor, 'stock.adjust', `variant ${c.body.variantId} ${delta > 0 ? '+' : ''}${delta} (${reason})`); return { ok: true };
  });
  add('GET', '/admin/movements', need('inventory.view'), (c) => c.db.movements.slice(0, 200).map(m => { const f = LB.findVariant(c.db, m.variant_id); return { ...m, name: f?.p.name || '(deleted)', size: f?.v.size || '', user_name: m.user_id ? userById(c.db, m.user_id)?.name || '' : '' }; }));
  add('GET', '/admin/suppliers', need('inventory.edit'), (c) => [...c.db.suppliers].sort((a, b) => a.name.localeCompare(b.name)));
  add('POST', '/admin/suppliers', need('inventory.edit'), (c) => {
    if (!str(c.body.name, 120)) throw bad('Supplier name is required.');
    c.db.suppliers.push({ supplier_id: nextId(c.db, 'supplier'), name: str(c.body.name, 120), phone: str(c.body.phone, 30), email: str(c.body.email, 150) }); audit(c.db, c.actor, 'supplier.create', c.body.name); return { ok: true };
  });
  add('PUT', '/admin/suppliers/:id', need('inventory.edit'), (c) => { const s = c.db.suppliers.find(x => x.supplier_id === Number(c.params.id)); if (!s) throw notFound(); Object.assign(s, { name: str(c.body.name, 120), phone: str(c.body.phone, 30), email: str(c.body.email, 150) }); return { ok: true }; });
  add('DELETE', '/admin/suppliers/:id', need('inventory.edit'), (c) => {
    const id = Number(c.params.id); if (c.db.purchases.some(p => p.supplier_id === id)) throw bad('This supplier has purchase orders and cannot be deleted.');
    c.db.suppliers = c.db.suppliers.filter(s => s.supplier_id !== id); return { ok: true };
  });
  add('GET', '/admin/purchases', need('inventory.edit'), (c) => c.db.purchases.map(po => {
    const items = po.items.map(i => { const f = LB.findVariant(c.db, i.variant_id); return { ...i, name: f?.p.name || '(deleted)', size: f?.v.size || '' }; });
    return { ...po, supplier_name: c.db.suppliers.find(s => s.supplier_id === po.supplier_id)?.name || '', by_name: userById(c.db, po.created_by)?.name || '', items, total: r2(items.reduce((s, i) => s + i.qty * Number(i.unit_cost), 0)) };
  }).sort((a, b) => (b.created_at > a.created_at ? 1 : -1)));
  add('POST', '/admin/purchases', need('inventory.edit'), (c) => {
    const items = (c.body.items || []).map(i => ({ variant_id: Number(i.variantId), qty: Math.floor(num(i.qty)), unit_cost: num(i.unitCost, -1) }));
    if (!items.length || items.some(i => !(i.qty > 0) || !(i.unit_cost >= 0))) throw bad('Add at least one item with a quantity and unit cost.');
    if (!c.db.suppliers.some(s => s.supplier_id === Number(c.body.supplierId))) throw bad('Choose a supplier.');
    for (const i of items) if (!LB.findVariant(c.db, i.variant_id)) throw bad('Unknown item in purchase order.');
    const id = nextId(c.db, 'po');
    c.db.purchases.unshift({ po_id: id, po_no: 'PO-' + (1000 + id), supplier_id: Number(c.body.supplierId), status: 'Ordered', note: str(c.body.note, 250), created_by: c.actor.id, created_at: nowIso(), received_at: null,
      items: items.map(i => ({ po_item_id: nextId(c.db, 'poitem'), po_id: id, ...i })) });
    audit(c.db, c.actor, 'purchase.create', `PO-${1000 + id}`); return { ok: true, id };
  });
  add('POST', '/admin/purchases/:id/receive', need('inventory.edit'), (c) => {
    const po = c.db.purchases.find(p => p.po_id === Number(c.params.id)); if (!po) throw notFound();
    if (po.status !== 'Ordered') throw bad(`Purchase order is already ${po.status}.`);
    for (const i of po.items) { LB.moveStock(c.db, i.variant_id, i.qty, 'purchase', po.po_no, c.actor.id); const f = LB.findVariant(c.db, i.variant_id); if (f) f.p.cost = i.unit_cost; }
    po.status = 'Received'; po.received_at = nowIso(); audit(c.db, c.actor, 'purchase.receive', po.po_no); return { ok: true };
  });
  add('POST', '/admin/purchases/:id/cancel', need('inventory.edit'), (c) => {
    const po = c.db.purchases.find(p => p.po_id === Number(c.params.id) && p.status === 'Ordered'); if (!po) throw bad('Only open purchase orders can be cancelled.');
    po.status = 'Cancelled'; audit(c.db, c.actor, 'purchase.cancel', po.po_no); return { ok: true };
  });

  // ============================ admin: staff
  add('GET', '/admin/permissions', need('staff.manage'), () => ({ permissions: LB.PERMISSIONS, roles: LB.ROLE_PERMS }));
  add('GET', '/admin/users', need('staff.manage'), (c) => {
    const rank = { admin: 0, manager: 1, seller: 2, tailor: 3, client: 4 }, d30 = addDaysStr(-29);
    return [...c.db.users].sort((a, b) => rank[a.role] - rank[b.role] || a.name.localeCompare(b.name)).map(u => {
      const mine = c.db.orders.filter(o => o.seller_id === u.user_id && o.status !== 'Cancelled'), sales = r2(mine.filter(o => ymd(o.created_at) >= d30).reduce((s, o) => s + o.total, 0)), att = LB.openAttendance(c.db, u.user_id);
      return { ...stripSecrets(u), orders: mine.length, sales_month: sales, clocked_in: att ? att.clock_in : null, overrides: (u.overrides || []).map(o => ({ user_id: u.user_id, ...o })), commission_month: r2(sales * u.commission_pct / 100) };
    });
  });
  add('POST', '/admin/users', need('staff.manage'), async (c) => ({ ok: true, id: await LB.createUser(c.db, c.actor, c.body || {}) }));
  add('PUT', '/admin/users/:id', need('staff.manage'), (c) => {
    const id = Number(c.params.id), b = c.body || {}, t = userById(c.db, id); if (!t) throw notFound();
    const role = b.role ?? t.role; if (!LB.ROLES.includes(role)) throw bad('Invalid role.');
    if (c.actor.role !== 'admin' && (t.role === 'admin' || role === 'admin')) throw forbidden('Only an admin can change admin accounts or grant the admin role.');
    if (id === c.actor.id && (role !== t.role || b.active === false)) throw bad('You cannot change your own role or deactivate yourself.');
    if (t.role === 'admin' && (role !== 'admin' || b.active === false) && !c.db.users.some(u => u.role === 'admin' && u.active && u.user_id !== id)) throw bad('There must be at least one active admin.');
    if (b.active === false && t.role !== 'client') revokeSessions(c.db, id);
    if (b.name) t.name = str(b.name, 100); if (b.phone != null) t.phone = str(b.phone, 30); t.role = role; if (b.active != null) t.active = !!b.active;
    t.discount_limit = b.discountLimit === '' || b.discountLimit == null ? null : Math.min(100, Math.max(0, num(b.discountLimit))); t.commission_pct = Math.min(50, Math.max(0, num(b.commissionPct)));
    if (Array.isArray(b.overrides) && c.actor.role === 'admin') t.overrides = b.overrides.filter(o => LB.PERMISSIONS[o.code]).map(o => ({ code: o.code, granted: !!o.granted }));
    if (role !== t.role) revokeSessions(c.db, id);
    audit(c.db, c.actor, 'user.update', `${t.email} role=${role} active=${b.active}`); return { ok: true };
  });
  add('POST', '/admin/users/:id/reset', need('staff.manage'), async (c) => {
    const u = userById(c.db, c.params.id); if (!u) throw notFound();
    if (u.role === 'admin' && c.actor.role !== 'admin') throw forbidden();
    const { password, pin } = c.body || {};
    if (password) { if (String(password).length < 8) throw bad('Password must be at least 8 characters.'); const p = await LB.hashSecret(password); u.pass_hash = p.hash; u.pass_salt = p.salt; u.failed_logins = 0; u.locked_until = null; }
    if (pin) { if (!/^\d{4,6}$/.test(String(pin))) throw bad('PIN must be 4-6 digits.'); const p = await LB.hashSecret(pin); u.pin_hash = p.hash; u.pin_salt = p.salt; }
    if (!password && !pin) throw bad('Enter a new password or PIN.');
    revokeSessions(c.db, u.user_id); audit(c.db, c.actor, 'user.reset', u.email); return { ok: true };
  });
  add('GET', '/admin/attendance', need('staff.manage'), (c) => c.db.attendance.slice(0, 200).map(a => ({ ...a, name: userById(c.db, a.user_id)?.name || '' })));

  // ============================ admin: promotions
  add('GET', '/admin/promos', need('promos.manage'), (c) => ({ codes: c.db.promos, sales: c.db.sales.map(s => ({ ...s, category: s.category_id ? catByName2(c.db, s.category_id) : null })),
    bundles: c.db.bundles.map(b => ({ ...b, cats: b.category_ids.map(id => catByName2(c.db, id)) })) }));
  const pctOf = (v) => { const n = num(v); if (!(n > 0 && n <= 100)) throw bad('Discount % must be between 0 and 100.'); return n; };
  add('POST', '/admin/promos/code', need('promos.manage'), (c) => {
    const code = str(c.body.code, 30).toUpperCase().replace(/[^A-Z0-9_-]/g, ''); if (!code) throw bad('Enter a code (letters and numbers).');
    if (c.db.promos.some(p => p.code === code)) throw bad('Code already exists.');
    c.db.promos.push({ promo_id: nextId(c.db, 'promo'), code, pct: pctOf(c.body.pct), active: true, note: str(c.body.note, 120), expires_on: c.body.expires_on || null }); audit(c.db, c.actor, 'promo.create', code); return { ok: true };
  });
  add('PUT', '/admin/promos/code/:id', need('promos.manage'), (c) => { const p = c.db.promos.find(x => x.promo_id === Number(c.params.id)); if (!p) throw notFound(); Object.assign(p, { pct: pctOf(c.body.pct), note: str(c.body.note, 120), active: !!c.body.active, expires_on: c.body.expires_on || null }); audit(c.db, c.actor, 'promo.update', `#${p.promo_id}`); return { ok: true }; });
  add('DELETE', '/admin/promos/code/:id', need('promos.manage'), (c) => { c.db.promos = c.db.promos.filter(p => p.promo_id !== Number(c.params.id)); audit(c.db, c.actor, 'promo.delete', `#${c.params.id}`); return { ok: true }; });
  add('POST', '/admin/promos/sale', need('promos.manage'), (c) => {
    const b = c.body || {};
    if (!str(b.name, 80) || !/^\d{4}-\d{2}-\d{2}$/.test(String(b.date_from)) || !/^\d{4}-\d{2}-\d{2}$/.test(String(b.date_to)) || b.date_to < b.date_from) throw bad('Name and a valid date range are required.');
    const cat = b.category && b.category !== 'All' ? catByName(c.db, String(b.category)) : null;
    c.db.sales.push({ sale_id: nextId(c.db, 'sale'), name: str(b.name, 80), pct: pctOf(b.pct), category_id: cat?.category_id || null, date_from: b.date_from, date_to: b.date_to, active: true }); audit(c.db, c.actor, 'sale.create', b.name); return { ok: true };
  });
  add('PUT', '/admin/promos/sale/:id', need('promos.manage'), (c) => { const s = c.db.sales.find(x => x.sale_id === Number(c.params.id)); if (!s) throw notFound(); s.active = !!c.body.active; return { ok: true }; });
  add('DELETE', '/admin/promos/sale/:id', need('promos.manage'), (c) => { c.db.sales = c.db.sales.filter(s => s.sale_id !== Number(c.params.id)); return { ok: true }; });
  add('POST', '/admin/promos/bundle', need('promos.manage'), (c) => {
    const b = c.body || {}, cats = [...new Set(Array.isArray(b.cats) ? b.cats : [])];
    if (!str(b.name, 80) || cats.length < 2) throw bad('Name and at least two categories are required.');
    const ids = cats.map(n => { const k = catByName(c.db, String(n)); if (!k) throw bad(`Unknown category ${n}.`); return k.category_id; });
    c.db.bundles.push({ bundle_id: nextId(c.db, 'bundle'), name: str(b.name, 80), pct: pctOf(b.pct), active: true, category_ids: ids }); audit(c.db, c.actor, 'bundle.create', b.name); return { ok: true };
  });
  add('PUT', '/admin/promos/bundle/:id', need('promos.manage'), (c) => { const b = c.db.bundles.find(x => x.bundle_id === Number(c.params.id)); if (!b) throw notFound(); b.active = !!c.body.active; return { ok: true }; });
  add('DELETE', '/admin/promos/bundle/:id', need('promos.manage'), (c) => { c.db.bundles = c.db.bundles.filter(b => b.bundle_id !== Number(c.params.id)); return { ok: true }; });
  add('POST', '/admin/promos/broadcast', need('promos.manage'), (c) => {
    const title = str(c.body.title, 120), body = str(c.body.body, 300), tier = str(c.body.tier, 10);
    if (!title || !body) throw bad('Enter a title and a message.');
    const min = { Silver: 500, Gold: 1500, VIP: 3000 }[tier] || 0; let n = 0;
    for (const u of c.db.users.filter(x => x.role === 'client' && x.active && x.loyalty_points >= min)) { notify(c.db, u.user_id, title, body, 'promo'); n++; }
    audit(c.db, c.actor, 'promo.broadcast', `${title} (${tier || 'all customers'}) -> ${n}`); return { ok: true, sent: n };
  });

  // ============================ admin: settings, audit, backup
  add('GET', '/admin/settings', need('settings.edit'), (c) => getSettings(c.db));
  add('PUT', '/admin/settings', need('settings.edit'), (c) => {
    const b = c.body || {}, patch = {};
    for (const [k, n] of [['storeName', 80], ['address', 200], ['phone', 30], ['receiptHeader', 60], ['receiptFooter', 250]]) if (k in b) patch[k] = str(b[k], n);
    const nums = { vatPct: [0, 50], khrRate: [1, 100000], lowStock: [0, 1000], maxSellerDiscount: [0, 100], pointsPerDollar: [0, 100], pointValue: [0, 10], refundDays: [0, 365], rentalMaxDays: [1, 60], lateFeePct: [0, 500], tailorMarkupPct: [0, 300] };
    for (const [k, [lo, hi]] of Object.entries(nums)) if (k in b) { const n = num(b[k], NaN); if (!(n >= lo && n <= hi)) throw bad(`${k} must be between ${lo} and ${hi}.`); patch[k] = n; }
    if ('currency' in b) { if (!['USD', 'KHR'].includes(b.currency)) throw bad('Currency must be USD or KHR.'); patch.currency = b.currency; }
    if ('paymentMethods' in b) {
      const m = [...new Set((Array.isArray(b.paymentMethods) ? b.paymentMethods : []).map(x => str(x, 20)).filter(Boolean))];
      if (!m.includes('Cash') || !m.includes('Pay in store')) throw bad('Cash and "Pay in store" must stay enabled.'); patch.paymentMethods = m;
    }
    if ('logo' in b) { if (b.logo && (!String(b.logo).startsWith('data:image/') || String(b.logo).length > 400000)) throw bad('Logo must be a small image (under ~250 KB).'); patch.logo = b.logo || ''; }
    c.db.settings = { ...(c.db.settings || {}), ...patch }; audit(c.db, c.actor, 'settings.update', Object.keys(patch).join(', ')); return { ok: true };
  });
  add('GET', '/admin/audit', need('audit.view'), (c) => {
    const q = c.query;
    return c.db.audit.filter(a => (!q.user || a.user_name.toLowerCase().includes(String(q.user).toLowerCase())) && (!q.action || a.action.toLowerCase().includes(String(q.action).toLowerCase())) && (!q.from || ymd(a.at) >= q.from) && (!q.to || ymd(a.at) <= q.to)).slice(0, 500);
  });
  add('GET', '/admin/backup', need('settings.edit'), (c) => { const d = JSON.parse(JSON.stringify(c.db)); delete d.sessions; return { app: 'lodc', version: 3, exported_at: nowIso(), data: d }; });
  add('POST', '/admin/restore', need('settings.edit'), (c) => {
    const d = c.body?.data; if (!d || !Array.isArray(d.users) || !Array.isArray(d.products) || !d.seq) throw bad('That file is not a valid backup.');
    if (!d.users.some(u => u.role === 'admin' && u.active)) throw bad('The backup has no active admin, so you could not sign in afterwards.');
    d.sessions = {}; c.replaceDb = d; audit(d, c.actor, 'backup.restore', `${d.users.length} users, ${d.orders.length} orders`); return { ok: true };
  });

  // ------------------------------------------------------------ dispatcher
  async function request(method, url, body, opts = {}) {
    if (LB.ready) await LB.ready;
    const [path, qs = ''] = String(url).replace(/^\/api/, '').split('?');
    const query = Object.fromEntries(new URLSearchParams(qs));
    let db = load();
    if (!db) throw new HttpError(503, 'The shop has not been set up yet.');
    for (const r of routes) {
      if (r.method !== method) continue;
      const m = r.re.exec(path); if (!m) continue;
      const params = {}; r.names.forEach((n, i) => { params[n] = decodeURIComponent(m[i + 1]); });
      const token = opts.token !== undefined ? opts.token : sessionToken();
      const actor = await actorFor(db, token);
      if (!r.opts.public && !actor) throw unauthorized();
      if (r.opts.perm && !can(actor, r.opts.perm)) throw forbidden();
      if (r.opts.roles && !r.opts.roles.includes(actor.role)) throw forbidden();
      const c = { db, actor, params, query, body: body || {}, dirty: method !== 'GET' };
      const result = await r.fn(c);
      if (c.replaceDb) { save(c.replaceDb); return result; }
      if (c.dirty) save(c.db);
      return result === undefined ? { ok: true } : JSON.parse(JSON.stringify(result));
    }
    throw notFound('Not found.');
  }
  LB.request = request; LB.routes = routes;
})(window.LB);
