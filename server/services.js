'use strict';
/* Business logic. Every function that changes data runs in a transaction and
   recomputes prices on the server - the browser is never trusted for money. */
const { q, one, tx } = require('./db');
const { PERMISSIONS, ROLE_PERMS, ROLES } = require('./perms');
const { hashSecret } = require('./security');

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const bad = (m) => new HttpError(400, m);
const forbidden = (m = 'You do not have permission to do that.') => new HttpError(403, m);
const notFound = (m = 'Not found.') => new HttpError(404, m);

const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const todayStr = () => new Date().toISOString().slice(0, 10);
const ymd = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));   // SQL DATE columns arrive as Date objects
const daysBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / 864e5);
const can = (actor, perm) => !!actor && (actor.perms.has('*') || actor.perms.has(perm));

// ---------------------------------------------------------------- settings
const SETTING_DEFAULTS = {
  storeName: "L'Or de Cambodge", address: 'No. 88, Norodom Blvd, Phnom Penh', phone: '+855 23 000 000', logo: '',
  vatPct: 10, currency: 'USD', khrRate: 4100, lowStock: 3, maxSellerDiscount: 15, pointsPerDollar: 1, pointValue: 0.01,
  paymentMethods: ['Cash', 'Card', 'ABA Pay', 'KHQR', 'Pay in store'], refundDays: 7, rentalMaxDays: 14, lateFeePct: 50,
  tailorMarkupPct: 25, receiptHeader: 'TAX INVOICE', receiptFooter: 'Thank you for shopping with us. Exchange within 7 days with receipt.'
};
async function getSettings(conn) {
  const rows = await q('SELECT [key] AS k, [value] AS v FROM Settings', {}, conn);
  const out = { ...SETTING_DEFAULTS };
  for (const r of rows) { try { out[r.k] = JSON.parse(r.v); } catch { out[r.k] = r.v; } }
  return out;
}
async function saveSettings(patch, conn) {
  for (const [k, v] of Object.entries(patch)) {
    if (!(k in SETTING_DEFAULTS)) continue;
    await q(`MERGE Settings AS t USING (SELECT @k AS k) AS s ON t.[key] = s.k
             WHEN MATCHED THEN UPDATE SET [value] = @v WHEN NOT MATCHED THEN INSERT ([key], [value]) VALUES (@k, @v);`,
      { k, v: JSON.stringify(v) }, conn);
  }
}

// ---------------------------------------------------------------- audit / notify
async function audit(actor, action, detail = '', ip, conn) {
  await q('INSERT INTO AuditLog (user_id, user_name, role, action, detail, ip) VALUES (@u, @n, @r, @a, @d, @ip)',
    { u: actor?.id || null, n: actor?.name || 'system', r: actor?.role || '-', a: action, d: String(detail).slice(0, 400), ip: ip || null }, conn);
}
async function notify(userId, title, body, type = 'info', conn) {
  if (!userId) return;
  await q('INSERT INTO Notifications (user_id, title, body, type) VALUES (@u, @t, @b, @ty)', { u: userId, t: title, b: body, ty: type }, conn);
}

// ---------------------------------------------------------------- permissions
async function effectivePerms(userId, roleName) {
  if (roleName === 'admin') return new Set(['*']);
  const set = new Set(ROLE_PERMS[roleName] || []);
  for (const o of await q('SELECT code, granted FROM UserPermissions WHERE user_id = @id', { id: userId })) {
    if (o.granted) set.add(o.code); else set.delete(o.code);
  }
  return set;
}
const discountLimitOf = (actor, settings) => actor.role === 'admin' ? 100 : (actor.discountLimit ?? settings.maxSellerDiscount);

// ---------------------------------------------------------------- catalogue
async function activeSales(conn) {
  return q(`SELECT s.sale_id, s.name, s.pct, c.name AS category FROM SeasonalSales s LEFT JOIN Categories c ON c.category_id = s.category_id
            WHERE s.active = 1 AND s.date_from <= CAST(SYSUTCDATETIME() AS DATE) AND s.date_to >= CAST(SYSUTCDATETIME() AS DATE)`, {}, conn);
}
const salePct = (sales, category) => Math.max(0, ...sales.filter(s => !s.category || s.category === category).map(s => Number(s.pct)));

async function listProducts({ includeInactive = false, includeCost = false, includeImages = true } = {}) {
  const sales = await activeSales();
  const prods = await q(`SELECT p.*, c.name AS category FROM Products p JOIN Categories c ON c.category_id = p.category_id
                         ${includeInactive ? '' : 'WHERE p.active = 1'} ORDER BY p.product_id`);
  const vars = await q('SELECT variant_id, product_id, size, stock FROM ProductVariants ORDER BY variant_id');
  const by = {}; for (const v of vars) (by[v.product_id] ||= []).push(v);
  return prods.map((p) => {
    const pct = salePct(sales, p.category);
    const out = { ...p, variants: by[p.product_id] || [], sale_pct: pct, eff_price: r2(p.price * (1 - pct / 100)) };
    if (!includeCost) delete out.cost;
    if (!includeImages) delete out.image_url;
    return out;
  });
}

async function moveStock(conn, variantId, delta, type, ref, userId) {
  const r = await q(`UPDATE ProductVariants SET stock = stock + @d OUTPUT inserted.stock AS stock, inserted.product_id AS pid, inserted.size AS size
                     WHERE variant_id = @v AND stock + @d >= 0`, { d: delta, v: variantId }, conn);
  if (!r.length) {
    const info = await one('SELECT p.name, v.size FROM ProductVariants v JOIN Products p ON p.product_id = v.product_id WHERE v.variant_id = @v', { v: variantId }, conn);
    throw bad(info ? `Not enough stock for ${info.name} (${info.size}).` : 'Unknown product variant.');
  }
  await q('INSERT INTO StockMovements (variant_id, qty, type, ref, user_id) VALUES (@v, @d, @t, @r, @u)', { v: variantId, d: delta, t: type, r: ref || null, u: userId || null }, conn);
}

// ---------------------------------------------------------------- pricing
async function loadBundles(conn) {
  const bs = await q('SELECT * FROM Bundles WHERE active = 1', {}, conn);
  const cats = await q('SELECT bc.bundle_id, c.name FROM BundleCategories bc JOIN Categories c ON c.category_id = bc.category_id', {}, conn);
  return bs.map(b => ({ ...b, cats: cats.filter(c => c.bundle_id === b.bundle_id).map(c => c.name) }));
}
async function findPromo(code, conn) {
  if (!code || !String(code).trim()) return null;
  return one(`SELECT * FROM PromoCodes WHERE active = 1 AND code = @c AND (expires_on IS NULL OR expires_on >= CAST(SYSUTCDATETIME() AS DATE))`, { c: String(code).trim() }, conn);
}
const lineTotal = (it) => it.kind === 'rent' ? r2(it.unit_price * it.rent_days * it.qty) : r2(it.unit_price * it.qty);

/** Turns the browser's cart ({productId,size,qty,kind,...}) into trusted priced lines. */
async function resolveItems(rawItems, settings, conn) {
  if (!Array.isArray(rawItems) || !rawItems.length) throw bad('Cart is empty.');
  if (rawItems.length > 50) throw bad('Too many items.');
  const sales = await activeSales(conn);
  const lines = [];
  for (const raw of rawItems) {
    const qty = Math.floor(Number(raw.qty));
    if (!(qty >= 1 && qty <= 20)) throw bad('Quantity must be between 1 and 20.');
    const kind = ['buy', 'rent', 'tailor'].includes(raw.kind) ? raw.kind : 'buy';
    const p = await one(`SELECT p.*, c.name AS category FROM Products p JOIN Categories c ON c.category_id = p.category_id WHERE p.product_id = @id AND p.active = 1`, { id: Number(raw.productId) }, conn);
    if (!p) throw bad('A product in your cart is no longer available.');
    const line = { product_id: p.product_id, name: p.name, category: p.category, fabric: p.fabric, fit: p.fit, color_name: p.color_name,
      qty, kind, unit_cost: Number(p.cost), deposit: 0 };
    if (kind === 'tailor') {
      if (!p.tailorable) throw bad(`${p.name} cannot be made to measure.`);
      const t = raw.tailor || {};
      line.size = 'Custom'; line.variant_id = null;
      line.unit_price = r2(p.price * (1 + settings.tailorMarkupPct / 100));
      line.tailor_fabric = String(t.fabric || p.fabric || '').slice(0, 30); line.tailor_style = String(t.style || '').slice(0, 60);
      line.tailor_fit = String(t.fit || p.fit || '').slice(0, 20); line.tailor_notes = String(t.notes || '').slice(0, 500);
    } else {
      const v = await one('SELECT variant_id, stock FROM ProductVariants WHERE product_id = @p AND size = @s', { p: p.product_id, s: String(raw.size || '') }, conn);
      if (!v) throw bad(`Choose a valid size for ${p.name}.`);
      line.size = String(raw.size); line.variant_id = v.variant_id;
      if (kind === 'rent') {
        if (!(Number(p.rent_per_day) > 0)) throw bad(`${p.name} is not available for rent.`);
        const from = String(raw.rentFrom || ''), to = String(raw.rentTo || '');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) throw bad('Choose rental dates.');
        const days = daysBetween(from, to) + 1;
        if (days < 1 || days > settings.rentalMaxDays) throw bad(`Rental must be 1-${settings.rentalMaxDays} days.`);
        if (from < todayStr()) throw bad('Rental cannot start in the past.');
        line.unit_price = Number(p.rent_per_day); line.deposit = Number(p.rent_deposit);
        line.rent_from = from; line.rent_to = to; line.rent_days = days;
      } else {
        line.unit_price = r2(p.price * (1 - salePct(sales, p.category) / 100));
      }
    }
    lines.push(line);
  }
  return lines;
}

async function priceOrder(lines, { discountPct = 0, promoCode = '', redeemPoints = 0 }, settings, conn) {
  const subtotal = r2(lines.reduce((s, l) => s + lineTotal(l), 0));
  const deposit = r2(lines.reduce((s, l) => s + l.deposit * l.qty, 0));
  const bundles = await loadBundles(conn);
  const buys = lines.filter(l => l.kind !== 'rent');
  let bundleAmt = 0; const names = [];
  for (const b of bundles) {
    const picks = b.cats.map(c => buys.filter(l => l.category === c).sort((a, z) => a.unit_price - z.unit_price)[0]);
    if (b.cats.length && picks.every(Boolean)) { bundleAmt += picks.reduce((s, l) => s + l.unit_price, 0) * Number(b.pct) / 100; names.push(`${b.name} (-${b.pct}%)`); }
  }
  bundleAmt = r2(bundleAmt);
  const promo = await findPromo(promoCode, conn);
  const pct = Math.min(100, (promo ? Number(promo.pct) : 0) + Number(discountPct || 0));
  const discount = r2(Math.max(0, subtotal - bundleAmt) * pct / 100);
  const pointsValue = r2(Math.min(redeemPoints * settings.pointValue, subtotal - bundleAmt - discount));
  const taxable = r2(subtotal - bundleAmt - discount - pointsValue);
  const tax = r2(taxable * settings.vatPct / 100);
  return { subtotal, bundle_discount: bundleAmt, bundle_names: names.join(', '), discount_pct: pct, discount, promo_code: promo?.code || null,
    promo_invalid: !!(promoCode && !promo), points_value: pointsValue, tax, deposit, total: r2(taxable + tax + deposit) };
}

async function quote(actor, body) {
  const settings = await getSettings();
  const lines = await resolveItems(body.items, settings);
  const custId = actor?.role === 'client' ? actor.id : (body.customerId ? Number(body.customerId) : null);
  const pts = custId ? (await one('SELECT loyalty_points AS p FROM Users WHERE user_id = @id', { id: custId }))?.p || 0 : 0;
  const redeem = Math.min(Math.max(0, Math.floor(Number(body.redeemPoints) || 0)), pts);
  const manual = actor && actor.role !== 'client' ? Math.max(0, Number(body.discountPct) || 0) : 0;
  const t = await priceOrder(lines, { discountPct: manual, promoCode: body.promoCode, redeemPoints: redeem }, settings);
  return { lines: lines.map(l => ({ ...l, line_total: lineTotal(l) })), ...t, redeemed_points: redeem };
}

// ---------------------------------------------------------------- orders
async function openShiftOf(userId, conn) { return one('SELECT * FROM CashShifts WHERE user_id = @u AND closed_at IS NULL', { u: userId }, conn); }
const paidOf = (o) => r2((o.payments || []).reduce((s, p) => s + Number(p.amount), 0));
const balanceOf = (o) => r2(Number(o.total) - paidOf(o));

async function awardPoints(conn, orderId) {
  const o = await one('SELECT * FROM Orders WHERE order_id = @id', { id: orderId }, conn);
  if (!o || !o.customer_id || o.points_awarded !== null) return;
  const settings = await getSettings(conn);
  const earned = Math.max(0, Math.floor((Number(o.subtotal) - Number(o.bundle_discount) - Number(o.discount)) * settings.pointsPerDollar));
  const before = Number((await one('SELECT loyalty_points AS p FROM Users WHERE user_id = @id', { id: o.customer_id }, conn)).p);
  await q('UPDATE Users SET loyalty_points = loyalty_points + @e WHERE user_id = @id', { e: earned, id: o.customer_id }, conn);
  await q('UPDATE Orders SET points_awarded = @e WHERE order_id = @id', { e: earned, id: orderId }, conn);
  const tier = (pts) => pts >= 3000 ? 'VIP' : pts >= 1500 ? 'Gold' : pts >= 500 ? 'Silver' : 'Member';
  const up = tier(before + earned) !== tier(before);
  await notify(o.customer_id, 'Loyalty points earned', `+${earned} points from ${o.order_no}.${up ? ` Congratulations, you reached ${tier(before + earned)}!` : ''}`, 'loyalty', conn);
}

async function placeOrder(actor, body, ip) {
  const channel = actor.role === 'client' ? 'online' : 'pos';
  if (channel === 'pos' && !can(actor, 'pos.sell')) throw forbidden();
  return tx(async (conn) => {
    const settings = await getSettings(conn);
    const lines = await resolveItems(body.items, settings, conn);
    // customer
    let customer = null;
    if (channel === 'online') customer = await one('SELECT user_id, name, loyalty_points FROM Users WHERE user_id = @id', { id: actor.id }, conn);
    else if (body.customerId) {
      customer = await one(`SELECT u.user_id, u.name, u.loyalty_points FROM Users u JOIN Roles r ON r.role_id = u.role_id WHERE u.user_id = @id AND r.name = 'client'`, { id: Number(body.customerId) }, conn);
      if (!customer) throw bad('Customer not found.');
    }
    const manual = channel === 'pos' ? Math.max(0, Number(body.discountPct) || 0) : 0;
    if (manual > discountLimitOf(actor, settings)) throw forbidden(`Your discount limit is ${discountLimitOf(actor, settings)}%.`);
    const redeem = customer ? Math.min(Math.max(0, Math.floor(Number(body.redeemPoints) || 0)), customer.loyalty_points) : 0;
    const t = await priceOrder(lines, { discountPct: manual, promoCode: body.promoCode, redeemPoints: redeem }, settings, conn);
    if (body.promoCode && t.promo_invalid) throw bad('Promo code is not valid.');

    // payments
    const shift = channel === 'pos' ? await openShiftOf(actor.id, conn) : null;
    if (channel === 'pos' && !shift) throw bad('Open your cash shift before taking payments.');
    let payments = [];
    if (channel === 'online') {
      const method = String(body.payMethod || 'Pay in store');
      if (!settings.paymentMethods.includes(method)) throw bad('Unsupported payment method.');
      // Online gateways (KHQR / ABA / card) are SIMULATED in this build: the payment is recorded as received.
      if (method !== 'Pay in store') payments = [{ method, amount: t.total, kind: 'payment' }];
    } else {
      for (const p of body.payments || []) {
        if (!settings.paymentMethods.includes(p.method) || p.method === 'Pay in store') throw bad('Unsupported payment method.');
        const amt = r2(p.amount);
        if (!(amt > 0)) continue;
        payments.push({ method: p.method, amount: amt, kind: p.kind === 'deposit' ? 'deposit' : 'payment' });
      }
    }
    const paid = r2(payments.reduce((s, p) => s + p.amount, 0));
    if (paid > t.total + 0.005) throw bad('Payments exceed the order total.');

    const hasTailor = lines.some(l => l.kind === 'tailor'), hasRental = lines.some(l => l.kind === 'rent');
    const fulfilment = channel === 'pos' ? 'instore' : (body.fulfilment === 'delivery' ? 'delivery' : 'pickup');
    if (fulfilment === 'delivery' && !String(body.address || '').trim()) throw bad('Delivery address is required.');
    let status = 'Pending';
    const full = Math.abs(t.total - paid) <= 0.005;
    if (channel === 'pos' && !hasTailor) status = hasRental ? 'Picked Up' : (full ? 'Picked Up' : 'Ready');
    if (channel === 'pos' && hasRental && !full) throw bad('Rentals must be paid in full (including deposit) before check-out.');

    const o = await one(`INSERT INTO Orders (channel, customer_id, customer_name, seller_id, status, fulfilment, address, note, subtotal, bundle_discount, bundle_names,
        discount_pct, discount, promo_code, points_value, redeemed_points, tax, deposit, total, has_tailor, has_rental)
      OUTPUT inserted.order_id AS id
      VALUES (@ch, @cid, @cn, @sid, @st, @f, @ad, @nt, @sub, @bd, @bn, @dp, @di, @pc, @pv, @rp, @tx, @dep, @tot, @ht, @hr)`,
      { ch: channel, cid: customer?.user_id || null, cn: customer?.name || String(body.customerName || 'Walk-in').slice(0, 100), sid: channel === 'pos' ? actor.id : null,
        st: status, f: fulfilment, ad: String(body.address || '').slice(0, 250), nt: String(body.note || '').slice(0, 500), sub: t.subtotal, bd: t.bundle_discount,
        bn: t.bundle_names, dp: t.discount_pct, di: t.discount, pc: t.promo_code, pv: t.points_value, rp: redeem, tx: t.tax, dep: t.deposit, tot: t.total, ht: hasTailor, hr: hasRental }, conn);
    const orderId = o.id, orderNo = 'LDC-' + (10000 + orderId);
    await q('UPDATE Orders SET order_no = @n WHERE order_id = @id', { n: orderNo, id: orderId }, conn);
    for (const l of lines) {
      await q(`INSERT INTO OrderItems (order_id, product_id, variant_id, name, category, fabric, fit, color_name, size, qty, unit_price, unit_cost, kind, rent_from, rent_to, rent_days, deposit,
               tailor_fabric, tailor_style, tailor_fit, tailor_notes)
               VALUES (@o, @p, @v, @n, @c, @fa, @fi, @co, @s, @q, @up, @uc, @k, @rf, @rt, @rd, @d, @tf, @ts, @tfi, @tn)`,
        { o: orderId, p: l.product_id, v: l.variant_id, n: l.name, c: l.category, fa: l.fabric, fi: l.fit, co: l.color_name, s: l.size, q: l.qty, up: l.unit_price, uc: l.unit_cost, k: l.kind,
          rf: l.rent_from || null, rt: l.rent_to || null, rd: l.rent_days || null, d: l.deposit, tf: l.tailor_fabric || null, ts: l.tailor_style || null, tfi: l.tailor_fit || null, tn: l.tailor_notes || null }, conn);
      if (l.kind !== 'tailor') await moveStock(conn, l.variant_id, -l.qty, l.kind === 'rent' ? 'rental-out' : 'sale', orderNo, actor.id);
    }
    for (const p of payments) await q('INSERT INTO OrderPayments (order_id, method, amount, kind, shift_id, user_id) VALUES (@o, @m, @a, @k, @s, @u)',
      { o: orderId, m: p.method, a: p.amount, k: p.kind, s: shift?.shift_id || null, u: actor.id }, conn);
    await q('INSERT INTO OrderStatusHistory (order_id, status, by_name) VALUES (@o, @s, @b)', { o: orderId, s: status, b: actor.name }, conn);
    if (customer && redeem) await q('UPDATE Users SET loyalty_points = loyalty_points - @r WHERE user_id = @id', { r: redeem, id: customer.user_id }, conn);
    if (status === 'Picked Up' && !hasRental) await awardPoints(conn, orderId);
    if (customer) await notify(customer.user_id, `Order ${orderNo} received`, `Total $${t.total.toFixed(2)}. We will notify you as it progresses.`, 'order', conn);
    await audit(actor, 'order.create', `${orderNo} $${t.total.toFixed(2)} (${channel})`, ip, conn);
    return getOrder(orderId, conn);
  });
}

async function getOrders(where = '1=1', params = {}, { limit = 200, conn } = {}) {
  const orders = await q(`SELECT TOP (${Math.min(Number(limit) || 200, 1000)}) o.*, s.name AS seller_name, t.name AS tailor_name
    FROM Orders o LEFT JOIN Users s ON s.user_id = o.seller_id LEFT JOIN Users t ON t.user_id = o.tailor_id
    WHERE ${where} ORDER BY o.created_at DESC, o.order_id DESC`, params, conn);
  if (!orders.length) return [];
  const ids = JSON.stringify(orders.map(o => o.order_id));
  const sub = (table, order = 'id') => q(`SELECT * FROM ${table} WHERE order_id IN (SELECT CAST(value AS INT) FROM OPENJSON(@ids)) ORDER BY ${order}`, { ids }, conn);
  // sequential on purpose: a transaction connection cannot run queries in parallel
  const items = await sub('OrderItems', 'item_id'), pays = await sub('OrderPayments', 'payment_id'), hist = await sub('OrderStatusHistory'),
    refunds = await sub('OrderRefunds', 'refund_id'), exch = await sub('OrderExchanges'), rets = await sub('RentalReturns', 'order_id');
  const lines = refunds.length ? await q('SELECT * FROM OrderRefundLines WHERE refund_id IN (SELECT CAST(value AS INT) FROM OPENJSON(@ids))', { ids: JSON.stringify(refunds.map(r => r.refund_id)) }, conn) : [];
  const grp = (arr, key = 'order_id') => arr.reduce((m, x) => ((m[x[key]] ||= []).push(x), m), {});
  const gi = grp(items), gp = grp(pays), gh = grp(hist), gr = grp(refunds), ge = grp(exch), gl = grp(lines, 'refund_id');
  for (const o of orders) {
    o.items = gi[o.order_id] || []; o.payments = gp[o.order_id] || []; o.history = gh[o.order_id] || [];
    o.refunds = (gr[o.order_id] || []).map(r => ({ ...r, lines: gl[r.refund_id] || [] }));
    o.exchanges = ge[o.order_id] || []; o.rental_return = rets.find(r => r.order_id === o.order_id) || null;
    o.paid = paidOf(o); o.balance = balanceOf(o);
    o.net_total = r2(Number(o.total) - o.refunds.reduce((s, r) => s + Number(r.amount), 0));
    o.overdue = !!(o.has_rental && o.status === 'Picked Up' && o.items.some(i => i.kind === 'rent' && ymd(i.rent_to) < todayStr()));
  }
  return orders;
}
async function getOrder(id, conn) { return (await getOrders('o.order_id = @id', { id }, { conn }))[0] || null; }

const STATUS_TEXT = { Tailoring: 'Your garment is now being tailored.', Ready: 'Your order is ready for pickup or delivery.', 'Picked Up': 'Thank you! Order collected.',
  Delivered: 'Your order has been delivered.', Returned: 'Rental returned. Thank you!', Cancelled: 'Your order was cancelled.' };

async function setStatus(actor, orderId, status, ip) {
  const allowed = ['Pending', 'Tailoring', 'Ready', 'Picked Up', 'Delivered', 'Cancelled'];
  if (!allowed.includes(status)) throw bad('Invalid status.');
  return tx(async (conn) => {
    const o = await getOrder(orderId, conn);
    if (!o) throw notFound('Order not found.');
    const isOwner = actor.role === 'client' && o.customer_id === actor.id;
    if (actor.role === 'client') {
      if (!isOwner || status !== 'Cancelled' || o.status !== 'Pending') throw forbidden('You can only cancel your own pending orders.');
      if (o.payments.length) throw forbidden('Paid orders must be cancelled in store so we can refund you.');
    } else if (!can(actor, 'orders.fulfil')) throw forbidden();
    if (o.status === status) return o;
    if (['Cancelled', 'Returned', 'Delivered'].includes(o.status) || o.status === 'Picked Up') throw bad(`Order is already ${o.status}.`);
    if (['Picked Up', 'Delivered'].includes(status) && o.balance > 0.005) throw bad(`Balance of $${o.balance.toFixed(2)} must be collected first.`);
    if (status === 'Delivered' && o.fulfilment !== 'delivery') throw bad('Only delivery orders can be marked Delivered.');
    if (status === 'Picked Up' && o.fulfilment === 'delivery') throw bad('Delivery orders are marked Delivered.');
    if (status === 'Tailoring' && !o.has_tailor) throw bad('This order has no tailoring items.');
    if (status === 'Cancelled') {
      for (const it of o.items) if (it.kind !== 'tailor' && it.variant_id) await moveStock(conn, it.variant_id, it.qty, 'cancel', o.order_no, actor.id);
      if (o.customer_id && o.redeemed_points) await q('UPDATE Users SET loyalty_points = loyalty_points + @r WHERE user_id = @id', { r: o.redeemed_points, id: o.customer_id }, conn);
    }
    await q('UPDATE Orders SET status = @s WHERE order_id = @id', { s: status, id: orderId }, conn);
    await q('INSERT INTO OrderStatusHistory (order_id, status, by_name) VALUES (@o, @s, @b)', { o: orderId, s: status, b: actor.name }, conn);
    if (['Picked Up', 'Delivered'].includes(status) && !o.has_rental) await awardPoints(conn, orderId);
    if (o.customer_id && STATUS_TEXT[status]) await notify(o.customer_id, `Order ${o.order_no}: ${status}`, STATUS_TEXT[status], 'order', conn);
    await audit(actor, 'order.status', `${o.order_no} -> ${status}`, ip, conn);
    return getOrder(orderId, conn);
  });
}

async function addPayment(actor, orderId, { method, amount, kind }, ip) {
  if (!can(actor, 'pos.sell') && !can(actor, 'orders.fulfil')) throw forbidden();
  return tx(async (conn) => {
    const o = await getOrder(orderId, conn); if (!o) throw notFound('Order not found.');
    const settings = await getSettings(conn);
    if (!settings.paymentMethods.includes(method) || method === 'Pay in store') throw bad('Unsupported payment method.');
    const amt = r2(amount);
    if (!(amt > 0)) throw bad('Enter an amount.');
    if (amt > o.balance + 0.005) throw bad(`Amount exceeds balance due ($${o.balance.toFixed(2)}).`);
    if (['Cancelled', 'Returned'].includes(o.status)) throw bad(`Order is ${o.status}.`);
    const shift = await openShiftOf(actor.id, conn);
    if (method === 'Cash' && !shift) throw bad('Open your cash shift to take cash.');
    await q('INSERT INTO OrderPayments (order_id, method, amount, kind, shift_id, user_id) VALUES (@o, @m, @a, @k, @s, @u)',
      { o: orderId, m: method, a: amt, k: kind === 'deposit' ? 'deposit' : 'payment', s: shift?.shift_id || null, u: actor.id }, conn);
    await audit(actor, 'order.payment', `${o.order_no} $${amt.toFixed(2)} ${method}`, ip, conn);
    return getOrder(orderId, conn);
  });
}

async function assignTailor(actor, orderId, tailorId, ip) {
  if (!can(actor, 'tailoring.manage')) throw forbidden();
  return tx(async (conn) => {
    if (tailorId) { const t = await one(`SELECT 1 AS ok FROM Users u JOIN Roles r ON r.role_id = u.role_id WHERE u.user_id = @id AND r.name IN ('tailor','seller','manager','admin') AND u.active = 1`, { id: tailorId }, conn); if (!t) throw bad('Invalid tailor.'); }
    await q('UPDATE Orders SET tailor_id = @t WHERE order_id = @id', { t: tailorId || null, id: orderId }, conn);
    await audit(actor, 'tailoring.assign', `order ${orderId} -> user ${tailorId || 'none'}`, ip, conn);
    return getOrder(orderId, conn);
  });
}

async function refundOrder(actor, orderId, { lines, reason, method }, ip) {
  if (!can(actor, 'refund.process')) throw forbidden();
  return tx(async (conn) => {
    const o = await getOrder(orderId, conn); if (!o) throw notFound('Order not found.');
    const settings = await getSettings(conn);
    if (!String(reason || '').trim()) throw bad('A reason is required.');
    if (daysBetween(o.created_at, new Date()) > settings.refundDays && !can(actor, 'refund.any')) throw forbidden(`Refund window (${settings.refundDays} days) has passed. Ask a manager.`);
    if (!Array.isArray(lines) || !lines.length) throw bad('Choose items to refund.');
    const factor = (1 - Number(o.bundle_discount) / Math.max(Number(o.subtotal), 1)) * (1 - Number(o.discount_pct) / 100) * (1 + settings.vatPct / 100);
    let amount = 0; const clean = [];
    for (const l of lines) {
      const it = o.items.find(i => i.item_id === Number(l.itemId)); if (!it) throw bad('Invalid item.');
      const qty = Math.floor(Number(l.qty));
      const done = o.refunds.reduce((s, r) => s + r.lines.filter(x => x.item_id === it.item_id).reduce((a, x) => a + x.qty, 0), 0);
      if (!(qty > 0) || qty + done > it.qty) throw bad(`Invalid quantity for ${it.name}.`);
      amount += lineTotal({ ...it, unit_price: Number(it.unit_price), qty }) * factor;
      clean.push({ it, qty });
    }
    const refundedSoFar = o.refunds.reduce((s, r) => s + Number(r.amount), 0);
    amount = r2(Math.min(amount, o.paid - refundedSoFar));
    if (amount <= 0) throw bad('Nothing has been paid on this order to refund.');
    const shift = await openShiftOf(actor.id, conn);
    const m = settings.paymentMethods.includes(method) ? method : 'Cash';
    if (m === 'Cash' && !shift) throw bad('Open your cash shift to pay cash refunds.');
    const rf = await one('INSERT INTO OrderRefunds (order_id, amount, reason, method, shift_id, user_id, by_name) OUTPUT inserted.refund_id AS id VALUES (@o, @a, @r, @m, @s, @u, @b)',
      { o: orderId, a: amount, r: String(reason).slice(0, 250), m, s: shift?.shift_id || null, u: actor.id, b: actor.name }, conn);
    for (const c of clean) {
      await q('INSERT INTO OrderRefundLines (refund_id, item_id, qty) VALUES (@r, @i, @q)', { r: rf.id, i: c.it.item_id, q: c.qty }, conn);
      if (c.it.kind !== 'tailor' && c.it.variant_id) await moveStock(conn, c.it.variant_id, c.qty, 'refund', o.order_no, actor.id);
    }
    await audit(actor, 'order.refund', `${o.order_no} $${amount.toFixed(2)} - ${reason}`, ip, conn);
    return getOrder(orderId, conn);
  });
}

async function exchangeItem(actor, orderId, itemId, newSize, ip) {
  if (!can(actor, 'refund.process')) throw forbidden();
  return tx(async (conn) => {
    const o = await getOrder(orderId, conn); if (!o) throw notFound('Order not found.');
    const settings = await getSettings(conn);
    const it = o.items.find(i => i.item_id === Number(itemId));
    if (!it || it.kind !== 'buy') throw bad('Only bought items can be exchanged.');
    if (['Cancelled', 'Returned'].includes(o.status)) throw bad(`Order is ${o.status}.`);
    if (daysBetween(o.created_at, new Date()) > settings.refundDays && !can(actor, 'refund.any')) throw forbidden('Exchange window has passed.');
    if (String(newSize) === it.size) throw bad('Choose a different size.');
    const nv = await one('SELECT variant_id FROM ProductVariants WHERE product_id = @p AND size = @s', { p: it.product_id, s: String(newSize) }, conn);
    if (!nv) throw bad('That size does not exist for this product.');
    await moveStock(conn, nv.variant_id, -it.qty, 'exchange-out', o.order_no, actor.id);
    await moveStock(conn, it.variant_id, it.qty, 'exchange-in', o.order_no, actor.id);
    await q('UPDATE OrderItems SET size = @s, variant_id = @v WHERE item_id = @i', { s: String(newSize), v: nv.variant_id, i: it.item_id }, conn);
    await q('INSERT INTO OrderExchanges (order_id, item_id, from_size, to_size, by_name) VALUES (@o, @i, @f, @t, @b)', { o: orderId, i: it.item_id, f: it.size, t: String(newSize), b: actor.name }, conn);
    await audit(actor, 'order.exchange', `${o.order_no} ${it.name} ${it.size} -> ${newSize}`, ip, conn);
    return getOrder(orderId, conn);
  });
}

async function checkInRental(actor, orderId, { damageFee = 0, note = '' }, ip) {
  if (!can(actor, 'rental.manage')) throw forbidden();
  return tx(async (conn) => {
    const o = await getOrder(orderId, conn); if (!o) throw notFound('Order not found.');
    if (!o.has_rental || o.status !== 'Picked Up') throw bad('This rental is not checked out.');
    const settings = await getSettings(conn);
    let lateDays = 0, lateFee = 0;
    for (const it of o.items.filter(i => i.kind === 'rent')) {
      const late = Math.max(0, daysBetween(ymd(it.rent_to), todayStr()));
      lateDays = Math.max(lateDays, late);
      lateFee += late * Number(it.unit_price) * settings.lateFeePct / 100 * it.qty;
      await moveStock(conn, it.variant_id, it.qty, 'rental-in', o.order_no, actor.id);
    }
    lateFee = r2(lateFee); const damage = r2(Math.max(0, Number(damageFee) || 0));
    const charges = r2(lateFee + damage), dep = Number(o.deposit);
    await q(`INSERT INTO RentalReturns (order_id, late_days, late_fee, damage_fee, deposit_kept, deposit_refund, extra_due, note, by_name)
             VALUES (@o, @ld, @lf, @df, @dk, @dr, @ed, @n, @b)`,
      { o: orderId, ld: lateDays, lf: lateFee, df: damage, dk: r2(Math.min(dep, charges)), dr: r2(Math.max(0, dep - charges)), ed: r2(Math.max(0, charges - dep)), n: String(note).slice(0, 250), b: actor.name }, conn);
    await q("UPDATE Orders SET status = 'Returned' WHERE order_id = @id", { id: orderId }, conn);
    await q("INSERT INTO OrderStatusHistory (order_id, status, by_name) VALUES (@o, 'Returned', @b)", { o: orderId, b: actor.name }, conn);
    if (o.customer_id) await notify(o.customer_id, `Rental ${o.order_no} returned`, `Deposit refund $${r2(Math.max(0, dep - charges)).toFixed(2)}${lateFee ? `, late fee $${lateFee.toFixed(2)}` : ''}.`, 'order', conn);
    await awardPoints(conn, orderId);
    await audit(actor, 'rental.checkin', `${o.order_no} late ${lateDays}d fee $${lateFee.toFixed(2)} damage $${damage.toFixed(2)}`, ip, conn);
    return getOrder(orderId, conn);
  });
}

// ---------------------------------------------------------------- alterations
async function listAlterations(where = '1=1', params = {}, conn) {
  const rows = await q(`SELECT a.*, t.name AS tailor_name FROM Alterations a LEFT JOIN Users t ON t.user_id = a.tailor_id WHERE ${where} ORDER BY a.created_at DESC`, params, conn);
  if (!rows.length) return [];
  const hist = await q('SELECT * FROM AlterationHistory WHERE alteration_id IN (SELECT CAST(value AS INT) FROM OPENJSON(@ids)) ORDER BY id', { ids: JSON.stringify(rows.map(r => r.alteration_id)) }, conn);
  for (const r of rows) r.history = hist.filter(h => h.alteration_id === r.alteration_id);
  return rows;
}
async function createAlteration(actor, b, ip) {
  if (!can(actor, 'alteration.manage')) throw forbidden();
  if (!String(b.item || '').trim() || !String(b.work || '').trim()) throw bad('Item and work description are required.');
  return tx(async (conn) => {
    let cust = null;
    if (b.customerId) { cust = await one('SELECT user_id, name FROM Users WHERE user_id = @id', { id: Number(b.customerId) }, conn); if (!cust) throw bad('Customer not found.'); }
    const r = await one(`INSERT INTO Alterations (customer_id, customer_name, order_id, item, work, fee, due_date, tailor_id, notes, created_by)
      OUTPUT inserted.alteration_id AS id VALUES (@c, @cn, @o, @i, @w, @f, @d, @t, @n, @by)`,
      { c: cust?.user_id || null, cn: cust?.name || String(b.customerName || 'Walk-in').slice(0, 100), o: b.orderId ? Number(b.orderId) : null, i: String(b.item).slice(0, 150),
        w: String(b.work).slice(0, 300), f: r2(Math.max(0, Number(b.fee) || 0)), d: b.due || null, t: b.tailorId ? Number(b.tailorId) : null, n: String(b.notes || '').slice(0, 300), by: actor.name }, conn);
    await q('UPDATE Alterations SET alt_no = @n WHERE alteration_id = @id', { n: 'ALT-' + (1000 + r.id), id: r.id }, conn);
    await q("INSERT INTO AlterationHistory (alteration_id, status, by_name) VALUES (@a, 'Received', @b)", { a: r.id, b: actor.name }, conn);
    await audit(actor, 'alteration.create', `ALT-${1000 + r.id} ${b.item}`, ip, conn);
    return (await listAlterations('a.alteration_id = @id', { id: r.id }, conn))[0];
  });
}
async function updateAlteration(actor, id, b, ip) {
  if (!can(actor, 'alteration.manage')) throw forbidden();
  return tx(async (conn) => {
    const a = await one('SELECT * FROM Alterations WHERE alteration_id = @id', { id }, conn);
    if (!a) throw notFound();
    if (actor.role === 'tailor' && a.tailor_id !== actor.id && !(b.tailorId === actor.id && !a.tailor_id)) throw forbidden('Tailors can only update tickets assigned to them.');
    if (b.status && b.status !== a.status) {
      if (!['Received', 'In Progress', 'Ready', 'Collected'].includes(b.status)) throw bad('Invalid status.');
      await q('UPDATE Alterations SET status = @s WHERE alteration_id = @id', { s: b.status, id }, conn);
      await q('INSERT INTO AlterationHistory (alteration_id, status, by_name) VALUES (@a, @s, @b)', { a: id, s: b.status, b: actor.name }, conn);
      if (a.customer_id && b.status === 'Ready') await notify(a.customer_id, `Alteration ${a.alt_no} ready`, `${a.item} is ready for pickup.`, 'order', conn);
    }
    if ('tailorId' in b) await q('UPDATE Alterations SET tailor_id = @t WHERE alteration_id = @id', { t: b.tailorId ? Number(b.tailorId) : null, id }, conn);
    await audit(actor, 'alteration.update', `${a.alt_no} ${JSON.stringify({ status: b.status, tailorId: b.tailorId })}`, ip, conn);
    return (await listAlterations('a.alteration_id = @id', { id }, conn))[0];
  });
}

// ---------------------------------------------------------------- shifts / attendance
async function clockIn(actor) {
  if (!can(actor, 'shift.manage')) throw forbidden();
  const open = await one('SELECT 1 AS x FROM Attendance WHERE user_id = @u AND clock_out IS NULL', { u: actor.id });
  if (open) throw bad('Already clocked in.');
  await q('INSERT INTO Attendance (user_id) VALUES (@u)', { u: actor.id });
  await audit(actor, 'clock.in');
}
async function clockOut(actor) {
  if (await openShiftOf(actor.id)) throw bad('Close your cash shift (end-of-shift report) before clocking out.');
  const r = await q('UPDATE Attendance SET clock_out = SYSUTCDATETIME() OUTPUT inserted.attendance_id WHERE user_id = @u AND clock_out IS NULL', { u: actor.id });
  if (!r.length) throw bad('Not clocked in.');
  await audit(actor, 'clock.out');
}
async function startShift(actor, float) {
  if (!can(actor, 'pos.sell')) throw forbidden('Only POS users can open a cash shift.');
  if (!(await one('SELECT 1 AS x FROM Attendance WHERE user_id = @u AND clock_out IS NULL', { u: actor.id }))) throw bad('Clock in first.');
  if (await openShiftOf(actor.id)) throw bad('Shift already open.');
  const f = r2(Math.max(0, Number(float) || 0));
  await q('INSERT INTO CashShifts (user_id, float_amount) VALUES (@u, @f)', { u: actor.id, f });
  await audit(actor, 'shift.open', `float $${f.toFixed(2)}`);
}
async function shiftReport(shiftId) {
  const s = await one('SELECT cs.*, u.name AS user_name FROM CashShifts cs JOIN Users u ON u.user_id = cs.user_id WHERE cs.shift_id = @id', { id: shiftId });
  if (!s) return null;
  const pays = await q('SELECT method, SUM(amount) AS total, COUNT(*) AS n FROM OrderPayments WHERE shift_id = @id GROUP BY method', { id: shiftId });
  const refs = await q('SELECT method, SUM(amount) AS total, COUNT(*) AS n FROM OrderRefunds WHERE shift_id = @id GROUP BY method', { id: shiftId });
  const cashIn = Number(pays.find(p => p.method === 'Cash')?.total || 0), cashOut = Number(refs.find(p => p.method === 'Cash')?.total || 0);
  const orders = await one('SELECT COUNT(DISTINCT order_id) AS n FROM OrderPayments WHERE shift_id = @id', { id: shiftId });
  return { shift: s, payments: pays, refunds: refs, orders: orders.n, sales: r2(pays.reduce((a, p) => a + Number(p.total), 0)),
    refunded: r2(refs.reduce((a, p) => a + Number(p.total), 0)), cash_in: r2(cashIn), cash_refunds: r2(cashOut), expected: r2(Number(s.float_amount) + cashIn - cashOut) };
}
async function closeShift(actor, shiftId, counted, note) {
  const s = await one('SELECT * FROM CashShifts WHERE shift_id = @id', { id: shiftId });
  if (!s || s.closed_at) throw bad('Shift is not open.');
  if (s.user_id !== actor.id && !can(actor, 'reports.view')) throw forbidden();
  const c = Number(counted);
  if (!Number.isFinite(c) || c < 0) throw bad('Enter the counted cash.');
  const rep = await shiftReport(shiftId);
  await q('UPDATE CashShifts SET closed_at = SYSUTCDATETIME(), counted = @c, expected = @e, variance = @v, note = @n WHERE shift_id = @id',
    { c: r2(c), e: rep.expected, v: r2(c - rep.expected), n: String(note || '').slice(0, 250), id: shiftId });
  await audit(actor, 'shift.close', `expected $${rep.expected.toFixed(2)} counted $${r2(c).toFixed(2)}`);
  return shiftReport(shiftId);
}

// ---------------------------------------------------------------- users
async function createUser(actor, b, ip) {
  if (!can(actor, 'staff.manage')) throw forbidden();
  const role = String(b.role || 'client');
  if (!ROLES[role]) throw bad('Invalid role.');
  if (role === 'admin' && actor.role !== 'admin') throw forbidden('Only an admin can create admins.');
  const email = String(b.email || '').trim();
  if (!String(b.name || '').trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw bad('Name and a valid email are required.');
  if (String(b.password || '').length < 8) throw bad('Password must be at least 8 characters.');
  if (role !== 'client' && !/^\d{4,6}$/.test(String(b.pin || ''))) throw bad('Staff need a 4-6 digit PIN.');
  if (await one('SELECT 1 AS x FROM Users WHERE email = @e', { e: email })) throw bad('Email already used.');
  const p = await hashSecret(b.password), n = role !== 'client' ? await hashSecret(b.pin) : { salt: null, hash: null };
  const u = await one(`INSERT INTO Users (role_id, name, email, phone, pass_hash, pass_salt, pin_hash, pin_salt, discount_limit, commission_pct)
    OUTPUT inserted.user_id AS id VALUES (@r, @n, @e, @p, @ph, @ps, @nh, @ns, @dl, @cp)`,
    { r: ROLES[role], n: String(b.name).trim().slice(0, 100), e: email.slice(0, 150), p: String(b.phone || '').slice(0, 30), ph: p.hash, ps: p.salt, nh: n.hash, ns: n.salt,
      dl: b.discountLimit === '' || b.discountLimit == null ? null : Math.min(100, Math.max(0, Number(b.discountLimit))), cp: Math.min(50, Math.max(0, Number(b.commissionPct) || 0)) });
  await audit(actor, 'user.create', `${email} (${role})`, ip);
  return u.id;
}

module.exports = {
  HttpError, bad, forbidden, notFound, r2, todayStr, ymd, daysBetween, can, getSettings, saveSettings, SETTING_DEFAULTS, audit, notify, effectivePerms, discountLimitOf,
  activeSales, listProducts, moveStock, resolveItems, priceOrder, quote, placeOrder, getOrders, getOrder, setStatus, addPayment, assignTailor, refundOrder,
  exchangeItem, checkInRental, listAlterations, createAlteration, updateAlteration, clockIn, clockOut, startShift, shiftReport, closeShift, openShiftOf,
  createUser, awardPoints, lineTotal, PERMISSIONS
};
