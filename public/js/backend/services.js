'use strict';
/* Business rules, ported from the old Node/SQL server to plain browser JavaScript.
   Every function receives the working copy of the database (`db`) and the signed-in `actor`, validates first, then changes data. */
(function (LB) {
  const { bad, forbidden, notFound, r2, todayStr, ymd, can, getSettings, audit, notify, nextId, nowIso, userById, tierOf, discountLimitOf, num, str } = LB;
  const daysBetween = (a, b) => LB.daysBetween(a, b);
  const lineTotal = (it) => it.kind === 'rent' ? r2(it.unit_price * it.rent_days * it.qty) : r2(it.unit_price * it.qty);

  // ------------------------------------------------------------ catalogue
  const catName = (db, id) => db.categories.find(c => c.category_id === id)?.name || '';
  function activeSales(db) {
    const t = todayStr();
    return db.sales.filter(s => s.active && s.date_from <= t && s.date_to >= t).map(s => ({ ...s, category: s.category_id ? catName(db, s.category_id) : null }));
  }
  const salePct = (sales, category) => Math.max(0, ...sales.filter(s => !s.category || s.category === category).map(s => Number(s.pct)));
  function findVariant(db, variantId) {
    for (const p of db.products) { const v = p.variants.find(x => x.variant_id === Number(variantId)); if (v) return { p, v }; }
    return null;
  }
  function listProducts(db, { includeInactive = false, includeCost = false } = {}) {
    const sales = activeSales(db);
    return db.products.filter(p => includeInactive || p.active).map((p) => {
      const category = catName(db, p.category_id), pct = salePct(sales, category);
      const out = { ...p, category, variants: p.variants.map(v => ({ ...v, product_id: p.product_id })), sale_pct: pct, eff_price: r2(p.price * (1 - pct / 100)) };
      if (!includeCost) delete out.cost;
      return out;
    });
  }
  function moveStock(db, variantId, delta, type, ref, userId) {
    const f = findVariant(db, variantId);
    if (!f) throw bad('Unknown product variant.');
    if (f.v.stock + delta < 0) throw bad(`Not enough stock for ${f.p.name} (${f.v.size}).`);
    f.v.stock += delta;
    db.movements.unshift({ movement_id: nextId(db, 'movement'), variant_id: Number(variantId), qty: delta, type, ref: ref || null, user_id: userId || null, at: nowIso() });
    if (db.movements.length > 5000) db.movements.length = 5000;
  }

  // ------------------------------------------------------------ pricing
  function bundlesOf(db) { return db.bundles.filter(b => b.active).map(b => ({ ...b, cats: b.category_ids.map(id => catName(db, id)) })); }
  function findPromo(db, code) {
    if (!code || !String(code).trim()) return null;
    const c = String(code).trim().toLowerCase(), t = todayStr();
    return db.promos.find(p => p.active && p.code.toLowerCase() === c && (!p.expires_on || ymd(p.expires_on) >= t)) || null;
  }
  function resolveItems(db, rawItems, settings) {
    if (!Array.isArray(rawItems) || !rawItems.length) throw bad('Cart is empty.');
    if (rawItems.length > 50) throw bad('Too many items.');
    const sales = activeSales(db), lines = [];
    for (const raw of rawItems) {
      const qty = Math.floor(Number(raw.qty));
      if (!(qty >= 1 && qty <= 20)) throw bad('Quantity must be between 1 and 20.');
      const kind = ['buy', 'rent', 'tailor'].includes(raw.kind) ? raw.kind : 'buy';
      const p = db.products.find(x => x.product_id === Number(raw.productId) && x.active);
      if (!p) throw bad('A product in your cart is no longer available.');
      const category = catName(db, p.category_id);
      const line = { product_id: p.product_id, name: p.name, category, fabric: p.fabric, fit: p.fit, color_name: p.color_name, qty, kind, unit_cost: Number(p.cost), deposit: 0 };
      if (kind === 'tailor') {
        if (!p.tailorable) throw bad(`${p.name} cannot be made to measure.`);
        const t = raw.tailor || {};
        line.size = 'Custom'; line.variant_id = null; line.unit_price = r2(p.price * (1 + settings.tailorMarkupPct / 100));
        line.tailor_fabric = str(t.fabric || p.fabric, 30); line.tailor_style = str(t.style, 60); line.tailor_fit = str(t.fit || p.fit, 20); line.tailor_notes = str(t.notes, 500);
      } else {
        const v = p.variants.find(x => x.size === String(raw.size || ''));
        if (!v) throw bad(`Choose a valid size for ${p.name}.`);
        line.size = String(raw.size); line.variant_id = v.variant_id;
        if (kind === 'rent') {
          if (!(Number(p.rent_per_day) > 0)) throw bad(`${p.name} is not available for rent.`);
          const from = String(raw.rentFrom || ''), to = String(raw.rentTo || '');
          if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) throw bad('Choose rental dates.');
          const days = daysBetween(from, to) + 1;
          if (days < 1 || days > settings.rentalMaxDays) throw bad(`Rental must be 1-${settings.rentalMaxDays} days.`);
          if (from < todayStr()) throw bad('Rental cannot start in the past.');
          line.unit_price = Number(p.rent_per_day); line.deposit = Number(p.rent_deposit); line.rent_from = from; line.rent_to = to; line.rent_days = days;
        } else line.unit_price = r2(p.price * (1 - salePct(sales, category) / 100));
      }
      lines.push(line);
    }
    return lines;
  }
  function priceOrder(db, lines, { discountPct = 0, promoCode = '', redeemPoints = 0 }, settings) {
    const subtotal = r2(lines.reduce((s, l) => s + lineTotal(l), 0));
    const deposit = r2(lines.reduce((s, l) => s + l.deposit * l.qty, 0));
    const buys = lines.filter(l => l.kind !== 'rent');
    let bundleAmt = 0; const names = [];
    for (const b of bundlesOf(db)) {
      const picks = b.cats.map(c => buys.filter(l => l.category === c).sort((a, z) => a.unit_price - z.unit_price)[0]);
      if (b.cats.length && picks.every(Boolean)) { bundleAmt += picks.reduce((s, l) => s + l.unit_price, 0) * Number(b.pct) / 100; names.push(`${b.name} (-${b.pct}%)`); }
    }
    bundleAmt = r2(bundleAmt);
    const promo = findPromo(db, promoCode);
    const pct = Math.min(100, (promo ? Number(promo.pct) : 0) + Number(discountPct || 0));
    const discount = r2(Math.max(0, subtotal - bundleAmt) * pct / 100);
    const pointsValue = r2(Math.min(redeemPoints * settings.pointValue, subtotal - bundleAmt - discount));
    const taxable = r2(subtotal - bundleAmt - discount - pointsValue), tax = r2(taxable * settings.vatPct / 100);
    return { subtotal, bundle_discount: bundleAmt, bundle_names: names.join(', '), discount_pct: pct, discount, promo_code: promo?.code || null,
      promo_invalid: !!(promoCode && String(promoCode).trim() && !promo), points_value: pointsValue, tax, deposit, total: r2(taxable + tax + deposit) };
  }
  function quote(db, actor, body) {
    const settings = getSettings(db), lines = resolveItems(db, body.items, settings);
    const custId = actor?.role === 'client' ? actor.id : (body.customerId ? Number(body.customerId) : null);
    const pts = custId ? (userById(db, custId)?.loyalty_points || 0) : 0;
    const redeem = Math.min(Math.max(0, Math.floor(Number(body.redeemPoints) || 0)), pts);
    const manual = actor && actor.role !== 'client' ? Math.max(0, Number(body.discountPct) || 0) : 0;
    const t = priceOrder(db, lines, { discountPct: manual, promoCode: body.promoCode, redeemPoints: redeem }, settings);
    return { lines: lines.map(l => ({ ...l, line_total: lineTotal(l) })), ...t, redeemed_points: redeem };
  }

  // ------------------------------------------------------------ orders
  const openShiftOf = (db, userId) => db.shifts.find(s => s.user_id === Number(userId) && !s.closed_at) || null;
  const paidOf = (o) => r2((o.payments || []).reduce((s, p) => s + Number(p.amount), 0));
  const balanceOf = (o) => r2(Number(o.total) - paidOf(o));

  function awardPoints(db, order) {
    const c = userById(db, order.customer_id);
    if (!c || order.points_awarded !== null && order.points_awarded !== undefined) return;
    const s = getSettings(db);
    const earned = Math.max(0, Math.floor((Number(order.subtotal) - Number(order.bundle_discount) - Number(order.discount)) * s.pointsPerDollar));
    const before = c.loyalty_points; c.loyalty_points += earned; order.points_awarded = earned;
    const up = tierOf(before + earned) !== tierOf(before);
    notify(db, c.user_id, 'Loyalty points earned', `+${earned} points from ${order.order_no}.${up ? ` Congratulations, you reached ${tierOf(before + earned)}!` : ''}`, 'loyalty');
  }

  function placeOrder(db, actor, body) {
    const channel = actor.role === 'client' ? 'online' : 'pos';
    if (channel === 'pos' && !can(actor, 'pos.sell')) throw forbidden();
    const settings = getSettings(db), lines = resolveItems(db, body.items, settings);
    let customer = null;
    if (channel === 'online') customer = userById(db, actor.id);
    else if (body.customerId) { customer = userById(db, body.customerId); if (!customer || customer.role !== 'client') throw bad('Customer not found.'); }
    const manual = channel === 'pos' ? Math.max(0, Number(body.discountPct) || 0) : 0;
    if (manual > discountLimitOf(actor, settings)) throw forbidden(`Your discount limit is ${discountLimitOf(actor, settings)}%.`);
    const redeem = customer ? Math.min(Math.max(0, Math.floor(Number(body.redeemPoints) || 0)), customer.loyalty_points) : 0;
    const t = priceOrder(db, lines, { discountPct: manual, promoCode: body.promoCode, redeemPoints: redeem }, settings);
    if (body.promoCode && String(body.promoCode).trim() && t.promo_invalid) throw bad('Promo code is not valid.');
    for (const l of lines) if (l.kind !== 'tailor') { const f = findVariant(db, l.variant_id); if (!f || f.v.stock < l.qty) throw bad(`${l.name} (${l.size}) is out of stock.`); }
    // payments
    const shift = channel === 'pos' ? openShiftOf(db, actor.id) : null;
    if (channel === 'pos' && !shift) throw bad('Open your cash shift before taking payments.');
    let payments = [];
    if (channel === 'online') {
      const method = String(body.payMethod || 'Pay in store');
      if (!settings.paymentMethods.includes(method)) throw bad('Unsupported payment method.');
      if (method !== 'Pay in store') payments = [{ method, amount: t.total, kind: 'payment' }];   // online gateways are SIMULATED in this build
    } else {
      for (const p of body.payments || []) {
        if (!settings.paymentMethods.includes(p.method) || p.method === 'Pay in store') throw bad('Unsupported payment method.');
        const amt = r2(p.amount); if (!(amt > 0)) continue;
        payments.push({ method: p.method, amount: amt, kind: p.kind === 'deposit' ? 'deposit' : 'payment' });
      }
    }
    const paid = r2(payments.reduce((s, p) => s + p.amount, 0));
    if (paid > t.total + 0.005) throw bad('Payments exceed the order total.');
    const hasTailor = lines.some(l => l.kind === 'tailor'), hasRental = lines.some(l => l.kind === 'rent');
    const fulfilment = channel === 'pos' ? 'instore' : (body.fulfilment === 'delivery' ? 'delivery' : 'pickup');
    if (fulfilment === 'delivery' && !String(body.address || '').trim()) throw bad('Delivery address is required.');
    const full = Math.abs(t.total - paid) <= 0.005;
    let status = 'Pending';
    if (channel === 'pos' && !hasTailor) status = hasRental ? 'Picked Up' : (full ? 'Picked Up' : 'Ready');
    if (channel === 'pos' && hasRental && !full) throw bad('Rentals must be paid in full (including deposit) before check-out.');

    const orderId = nextId(db, 'order'), orderNo = 'LDC-' + (10000 + orderId), at = nowIso();
    const order = { order_id: orderId, order_no: orderNo, channel, customer_id: customer?.user_id || null, customer_name: customer?.name || str(body.customerName || 'Walk-in', 100),
      seller_id: channel === 'pos' ? actor.id : null, seller_name: channel === 'pos' ? actor.name : null, tailor_id: null, status, fulfilment, address: str(body.address, 250), note: str(body.note, 500),
      subtotal: t.subtotal, bundle_discount: t.bundle_discount, bundle_names: t.bundle_names, discount_pct: t.discount_pct, discount: t.discount, promo_code: t.promo_code, points_value: t.points_value,
      redeemed_points: redeem, points_awarded: null, tax: t.tax, deposit: t.deposit, total: t.total, has_tailor: hasTailor, has_rental: hasRental, reminded_at: null, created_at: at,
      items: [], payments: [], history: [{ status, by_name: actor.name, at }], refunds: [], exchanges: [], rental_return: null };
    for (const l of lines) {
      order.items.push({ item_id: nextId(db, 'item'), order_id: orderId, product_id: l.product_id, variant_id: l.variant_id, name: l.name, category: l.category, fabric: l.fabric, fit: l.fit, color_name: l.color_name,
        size: l.size, qty: l.qty, unit_price: l.unit_price, unit_cost: l.unit_cost, kind: l.kind, rent_from: l.rent_from || null, rent_to: l.rent_to || null, rent_days: l.rent_days || null, deposit: l.deposit,
        tailor_fabric: l.tailor_fabric || null, tailor_style: l.tailor_style || null, tailor_fit: l.tailor_fit || null, tailor_notes: l.tailor_notes || null });
      if (l.kind !== 'tailor') moveStock(db, l.variant_id, -l.qty, l.kind === 'rent' ? 'rental-out' : 'sale', orderNo, actor.id);
    }
    for (const p of payments) order.payments.push({ payment_id: nextId(db, 'payment'), order_id: orderId, method: p.method, amount: p.amount, kind: p.kind, shift_id: shift?.shift_id || null, user_id: actor.id, at });
    if (customer && redeem) customer.loyalty_points -= redeem;
    db.orders.unshift(order);
    if (status === 'Picked Up' && !hasRental) awardPoints(db, order);
    if (customer) notify(db, customer.user_id, `Order ${orderNo} received`, `Total $${t.total.toFixed(2)}. We will notify you as it progresses.`, 'order');
    audit(db, actor, 'order.create', `${orderNo} $${t.total.toFixed(2)} (${channel})`);
    return decorate(db, order);
  }

  function decorate(db, o) {
    const c = JSON.parse(JSON.stringify(o));
    c.tailor_name = c.tailor_id ? userById(db, c.tailor_id)?.name || null : null;
    c.paid = paidOf(c); c.balance = balanceOf(c);
    c.net_total = r2(Number(c.total) - c.refunds.reduce((s, r) => s + Number(r.amount), 0));
    c.overdue = !!(c.has_rental && c.status === 'Picked Up' && c.items.some(i => i.kind === 'rent' && ymd(i.rent_to) < todayStr()));
    return c;
  }
  function listOrders(db, filter = () => true, limit = 300) {
    return db.orders.filter(filter).sort((a, b) => (b.created_at < a.created_at ? -1 : b.created_at > a.created_at ? 1 : b.order_id - a.order_id)).slice(0, Math.min(Number(limit) || 300, 1000)).map(o => decorate(db, o));
  }
  const findOrder = (db, id) => db.orders.find(o => o.order_id === Number(id));
  const getOrder = (db, id) => { const o = findOrder(db, id); return o ? decorate(db, o) : null; };

  const STATUS_TEXT = { Tailoring: 'Your garment is now being tailored.', Ready: 'Your order is ready for pickup or delivery.', 'Picked Up': 'Thank you! Order collected.', Delivered: 'Your order has been delivered.', Returned: 'Rental returned. Thank you!', Cancelled: 'Your order was cancelled.' };
  function setStatus(db, actor, orderId, status) {
    if (!['Pending', 'Tailoring', 'Ready', 'Picked Up', 'Delivered', 'Cancelled'].includes(status)) throw bad('Invalid status.');
    const o = findOrder(db, orderId); if (!o) throw notFound('Order not found.');
    const d = decorate(db, o);
    if (actor.role === 'client') {
      if (o.customer_id !== actor.id || status !== 'Cancelled' || o.status !== 'Pending') throw forbidden('You can only cancel your own pending orders.');
      if (o.payments.length) throw forbidden('Paid orders must be cancelled in store so we can refund you.');
    } else if (!can(actor, 'orders.fulfil')) throw forbidden();
    if (o.status === status) return d;
    if (['Cancelled', 'Returned', 'Delivered'].includes(o.status) || o.status === 'Picked Up') throw bad(`Order is already ${o.status}.`);
    if (['Picked Up', 'Delivered'].includes(status) && d.balance > 0.005) throw bad(`Balance of $${d.balance.toFixed(2)} must be collected first.`);
    if (status === 'Delivered' && o.fulfilment !== 'delivery') throw bad('Only delivery orders can be marked Delivered.');
    if (status === 'Picked Up' && o.fulfilment === 'delivery') throw bad('Delivery orders are marked Delivered.');
    if (status === 'Tailoring' && !o.has_tailor) throw bad('This order has no tailoring items.');
    if (status === 'Cancelled') {
      for (const it of o.items) if (it.kind !== 'tailor' && it.variant_id) moveStock(db, it.variant_id, it.qty, 'cancel', o.order_no, actor.id);
      const c = userById(db, o.customer_id); if (c && o.redeemed_points) c.loyalty_points += o.redeemed_points;
    }
    o.status = status; o.history.push({ status, by_name: actor.name, at: nowIso() });
    if (['Picked Up', 'Delivered'].includes(status) && !o.has_rental) awardPoints(db, o);
    if (o.customer_id && STATUS_TEXT[status]) notify(db, o.customer_id, `Order ${o.order_no}: ${status}`, STATUS_TEXT[status], 'order');
    audit(db, actor, 'order.status', `${o.order_no} -> ${status}`);
    return decorate(db, o);
  }
  function addPayment(db, actor, orderId, { method, amount, kind }) {
    if (!can(actor, 'pos.sell') && !can(actor, 'orders.fulfil')) throw forbidden();
    const o = findOrder(db, orderId); if (!o) throw notFound('Order not found.');
    const settings = getSettings(db), d = decorate(db, o);
    if (!settings.paymentMethods.includes(method) || method === 'Pay in store') throw bad('Unsupported payment method.');
    const amt = r2(amount); if (!(amt > 0)) throw bad('Enter an amount.');
    if (amt > d.balance + 0.005) throw bad(`Amount exceeds balance due ($${d.balance.toFixed(2)}).`);
    if (['Cancelled', 'Returned'].includes(o.status)) throw bad(`Order is ${o.status}.`);
    const shift = openShiftOf(db, actor.id);
    if (method === 'Cash' && !shift) throw bad('Open your cash shift to take cash.');
    o.payments.push({ payment_id: nextId(db, 'payment'), order_id: o.order_id, method, amount: amt, kind: kind === 'deposit' ? 'deposit' : 'payment', shift_id: shift?.shift_id || null, user_id: actor.id, at: nowIso() });
    audit(db, actor, 'order.payment', `${o.order_no} $${amt.toFixed(2)} ${method}`);
    return decorate(db, o);
  }
  function assignTailor(db, actor, orderId, tailorId) {
    if (!can(actor, 'tailoring.manage')) throw forbidden();
    const o = findOrder(db, orderId); if (!o) throw notFound('Order not found.');
    if (tailorId) { const t = userById(db, tailorId); if (!t || !t.active || !['tailor', 'seller', 'manager', 'admin'].includes(t.role)) throw bad('Invalid tailor.'); }
    o.tailor_id = tailorId || null;
    audit(db, actor, 'tailoring.assign', `order ${o.order_no} -> user ${tailorId || 'none'}`);
    return decorate(db, o);
  }
  function refundOrder(db, actor, orderId, { lines, reason, method }) {
    if (!can(actor, 'refund.process')) throw forbidden();
    const o = findOrder(db, orderId); if (!o) throw notFound('Order not found.');
    const settings = getSettings(db), d = decorate(db, o);
    if (!String(reason || '').trim()) throw bad('A reason is required.');
    if (daysBetween(o.created_at, nowIso()) > settings.refundDays && !can(actor, 'refund.any')) throw forbidden(`Refund window (${settings.refundDays} days) has passed. Ask a manager.`);
    if (!Array.isArray(lines) || !lines.length) throw bad('Choose items to refund.');
    const factor = (1 - Number(o.bundle_discount) / Math.max(Number(o.subtotal), 1)) * (1 - Number(o.discount_pct) / 100) * (1 + settings.vatPct / 100);
    let amount = 0; const clean = [];
    for (const l of lines) {
      const it = o.items.find(i => i.item_id === Number(l.itemId)); if (!it) throw bad('Invalid item.');
      const qty = Math.floor(Number(l.qty));
      const done = o.refunds.reduce((s, r) => s + r.lines.filter(x => x.item_id === it.item_id).reduce((a, x) => a + x.qty, 0), 0);
      if (!(qty > 0) || qty + done > it.qty) throw bad(`Invalid quantity for ${it.name}.`);
      amount += lineTotal({ ...it, unit_price: Number(it.unit_price), qty }) * factor; clean.push({ it, qty });
    }
    const refundedSoFar = o.refunds.reduce((s, r) => s + Number(r.amount), 0);
    amount = r2(Math.min(amount, d.paid - refundedSoFar));
    if (amount <= 0) throw bad('Nothing has been paid on this order to refund.');
    const shift = openShiftOf(db, actor.id), m = settings.paymentMethods.includes(method) ? method : 'Cash';
    if (m === 'Cash' && !shift) throw bad('Open your cash shift to pay cash refunds.');
    o.refunds.push({ refund_id: nextId(db, 'refund'), order_id: o.order_id, amount, reason: str(reason, 250), method: m, shift_id: shift?.shift_id || null, user_id: actor.id, by_name: actor.name, at: nowIso(),
      lines: clean.map(c => ({ item_id: c.it.item_id, qty: c.qty })) });
    for (const c of clean) if (c.it.kind !== 'tailor' && c.it.variant_id) moveStock(db, c.it.variant_id, c.qty, 'refund', o.order_no, actor.id);
    audit(db, actor, 'order.refund', `${o.order_no} $${amount.toFixed(2)} - ${reason}`);
    return decorate(db, o);
  }
  function exchangeItem(db, actor, orderId, itemId, newSize) {
    if (!can(actor, 'refund.process')) throw forbidden();
    const o = findOrder(db, orderId); if (!o) throw notFound('Order not found.');
    const settings = getSettings(db), it = o.items.find(i => i.item_id === Number(itemId));
    if (!it || it.kind !== 'buy') throw bad('Only bought items can be exchanged.');
    if (['Cancelled', 'Returned'].includes(o.status)) throw bad(`Order is ${o.status}.`);
    if (daysBetween(o.created_at, nowIso()) > settings.refundDays && !can(actor, 'refund.any')) throw forbidden('Exchange window has passed.');
    if (String(newSize) === it.size) throw bad('Choose a different size.');
    const p = db.products.find(x => x.product_id === it.product_id), nv = p?.variants.find(v => v.size === String(newSize));
    if (!nv) throw bad('That size does not exist for this product.');
    moveStock(db, nv.variant_id, -it.qty, 'exchange-out', o.order_no, actor.id);
    moveStock(db, it.variant_id, it.qty, 'exchange-in', o.order_no, actor.id);
    o.exchanges.push({ item_id: it.item_id, from_size: it.size, to_size: String(newSize), by_name: actor.name, at: nowIso() });
    it.size = String(newSize); it.variant_id = nv.variant_id;
    audit(db, actor, 'order.exchange', `${o.order_no} ${it.name} -> ${newSize}`);
    return decorate(db, o);
  }
  function checkInRental(db, actor, orderId, { damageFee = 0, note = '' }) {
    if (!can(actor, 'rental.manage')) throw forbidden();
    const o = findOrder(db, orderId); if (!o) throw notFound('Order not found.');
    if (!o.has_rental || o.status !== 'Picked Up') throw bad('This rental is not checked out.');
    const settings = getSettings(db);
    let lateDays = 0, lateFee = 0;
    for (const it of o.items.filter(i => i.kind === 'rent')) {
      const late = Math.max(0, daysBetween(ymd(it.rent_to), todayStr()));
      lateDays = Math.max(lateDays, late); lateFee += late * Number(it.unit_price) * settings.lateFeePct / 100 * it.qty;
      moveStock(db, it.variant_id, it.qty, 'rental-in', o.order_no, actor.id);
    }
    lateFee = r2(lateFee); const damage = r2(Math.max(0, Number(damageFee) || 0)), charges = r2(lateFee + damage), dep = Number(o.deposit);
    o.rental_return = { order_id: o.order_id, late_days: lateDays, late_fee: lateFee, damage_fee: damage, deposit_kept: r2(Math.min(dep, charges)), deposit_refund: r2(Math.max(0, dep - charges)),
      extra_due: r2(Math.max(0, charges - dep)), note: str(note, 250), by_name: actor.name, at: nowIso() };
    o.status = 'Returned'; o.history.push({ status: 'Returned', by_name: actor.name, at: nowIso() });
    if (o.customer_id) notify(db, o.customer_id, `Rental ${o.order_no} returned`, `Deposit refund $${r2(Math.max(0, dep - charges)).toFixed(2)}${lateFee ? `, late fee $${lateFee.toFixed(2)}` : ''}.`, 'order');
    awardPoints(db, o);
    audit(db, actor, 'rental.checkin', `${o.order_no} late ${lateDays}d fee $${lateFee.toFixed(2)} damage $${damage.toFixed(2)}`);
    return decorate(db, o);
  }

  // ------------------------------------------------------------ alterations
  const decorateAlt = (db, a) => ({ ...a, tailor_name: a.tailor_id ? userById(db, a.tailor_id)?.name || null : null, history: a.history.map(h => ({ ...h })) });
  function createAlteration(db, actor, b) {
    if (!can(actor, 'alteration.manage')) throw forbidden();
    if (!String(b.item || '').trim() || !String(b.work || '').trim()) throw bad('Item and work description are required.');
    let cust = null;
    if (b.customerId) { cust = userById(db, b.customerId); if (!cust) throw bad('Customer not found.'); }
    const id = nextId(db, 'alteration'), at = nowIso();
    const a = { alteration_id: id, alt_no: 'ALT-' + (1000 + id), customer_id: cust?.user_id || null, customer_name: cust?.name || str(b.customerName || 'Walk-in', 100), order_id: b.orderId ? Number(b.orderId) : null,
      item: str(b.item, 150), work: str(b.work, 300), fee: r2(Math.max(0, Number(b.fee) || 0)), due_date: b.due || null, tailor_id: b.tailorId ? Number(b.tailorId) : null, status: 'Received',
      notes: str(b.notes, 300), created_by: actor.name, created_at: at, history: [{ status: 'Received', by_name: actor.name, at }] };
    db.alterations.unshift(a);
    audit(db, actor, 'alteration.create', `${a.alt_no} ${a.item}`);
    return decorateAlt(db, a);
  }
  function updateAlteration(db, actor, id, b) {
    if (!can(actor, 'alteration.manage')) throw forbidden();
    const a = db.alterations.find(x => x.alteration_id === Number(id)); if (!a) throw notFound();
    if (actor.role === 'tailor' && a.tailor_id !== actor.id && !(Number(b.tailorId) === actor.id && !a.tailor_id)) throw forbidden('Tailors can only update tickets assigned to them.');
    if (b.status && b.status !== a.status) {
      if (!['Received', 'In Progress', 'Ready', 'Collected'].includes(b.status)) throw bad('Invalid status.');
      a.status = b.status; a.history.push({ status: b.status, by_name: actor.name, at: nowIso() });
      if (a.customer_id && b.status === 'Ready') notify(db, a.customer_id, `Alteration ${a.alt_no} ready`, `${a.item} is ready for pickup.`, 'order');
    }
    if ('tailorId' in b) a.tailor_id = b.tailorId ? Number(b.tailorId) : null;
    audit(db, actor, 'alteration.update', `${a.alt_no} ${JSON.stringify({ status: b.status, tailorId: b.tailorId })}`);
    return decorateAlt(db, a);
  }

  // ------------------------------------------------------------ attendance & cash shifts
  const openAttendance = (db, userId) => db.attendance.find(a => a.user_id === Number(userId) && !a.clock_out) || null;
  function clockIn(db, actor) {
    if (!can(actor, 'shift.manage')) throw forbidden();
    if (openAttendance(db, actor.id)) throw bad('Already clocked in.');
    db.attendance.unshift({ attendance_id: nextId(db, 'attendance'), user_id: actor.id, clock_in: nowIso(), clock_out: null });
    audit(db, actor, 'clock.in');
  }
  function clockOut(db, actor) {
    if (openShiftOf(db, actor.id)) throw bad('Close your cash shift (end-of-shift report) before clocking out.');
    const a = openAttendance(db, actor.id); if (!a) throw bad('Not clocked in.');
    a.clock_out = nowIso(); audit(db, actor, 'clock.out');
  }
  function startShift(db, actor, float) {
    if (!can(actor, 'pos.sell')) throw forbidden('Only POS users can open a cash shift.');
    if (!openAttendance(db, actor.id)) throw bad('Clock in first.');
    if (openShiftOf(db, actor.id)) throw bad('Shift already open.');
    const f = r2(Math.max(0, Number(float) || 0));
    db.shifts.unshift({ shift_id: nextId(db, 'shift'), user_id: actor.id, opened_at: nowIso(), closed_at: null, float_amount: f, expected: null, counted: null, variance: null, note: null });
    audit(db, actor, 'shift.open', `float $${f.toFixed(2)}`);
  }
  function shiftReport(db, shiftId) {
    const s = db.shifts.find(x => x.shift_id === Number(shiftId)); if (!s) return null;
    const pays = {}, refs = {}, orderIds = new Set();
    for (const o of db.orders) {
      for (const p of o.payments) if (p.shift_id === s.shift_id) { (pays[p.method] ||= { method: p.method, total: 0, n: 0 }); pays[p.method].total += Number(p.amount); pays[p.method].n++; orderIds.add(o.order_id); }
      for (const r of o.refunds) if (r.shift_id === s.shift_id) { (refs[r.method] ||= { method: r.method, total: 0, n: 0 }); refs[r.method].total += Number(r.amount); refs[r.method].n++; }
    }
    const payments = Object.values(pays).map(x => ({ ...x, total: r2(x.total) })), refunds = Object.values(refs).map(x => ({ ...x, total: r2(x.total) }));
    const cashIn = pays.Cash?.total || 0, cashOut = refs.Cash?.total || 0;
    return { shift: { ...s, user_name: userById(db, s.user_id)?.name || '' }, payments, refunds, orders: orderIds.size, sales: r2(payments.reduce((a, p) => a + p.total, 0)),
      refunded: r2(refunds.reduce((a, p) => a + p.total, 0)), cash_in: r2(cashIn), cash_refunds: r2(cashOut), expected: r2(Number(s.float_amount) + cashIn - cashOut) };
  }
  function closeShift(db, actor, shiftId, counted, note) {
    const s = db.shifts.find(x => x.shift_id === Number(shiftId));
    if (!s || s.closed_at) throw bad('Shift is not open.');
    if (s.user_id !== actor.id && !can(actor, 'reports.view')) throw forbidden();
    const c = Number(counted); if (!Number.isFinite(c) || c < 0) throw bad('Enter the counted cash.');
    const rep = shiftReport(db, shiftId);
    s.closed_at = nowIso(); s.counted = r2(c); s.expected = rep.expected; s.variance = r2(c - rep.expected); s.note = str(note, 250);
    audit(db, actor, 'shift.close', `expected $${rep.expected.toFixed(2)} counted $${r2(c).toFixed(2)}`);
    return shiftReport(db, shiftId);
  }

  // ------------------------------------------------------------ users
  async function createUser(db, actor, b) {
    if (!can(actor, 'staff.manage')) throw forbidden();
    const role = String(b.role || 'client');
    if (!LB.ROLES.includes(role)) throw bad('Invalid role.');
    if (role === 'admin' && actor.role !== 'admin') throw forbidden('Only an admin can create admins.');
    const email = String(b.email || '').trim();
    if (!String(b.name || '').trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw bad('Name and a valid email are required.');
    if (String(b.password || '').length < 8) throw bad('Password must be at least 8 characters.');
    if (role !== 'client' && !/^\d{4,6}$/.test(String(b.pin || ''))) throw bad('Staff need a 4-6 digit PIN.');
    if (db.users.some(u => u.email.toLowerCase() === email.toLowerCase())) throw bad('Email already used.');
    const p = await LB.hashSecret(b.password), n = role !== 'client' ? await LB.hashSecret(b.pin) : { salt: null, hash: null };
    const id = nextId(db, 'user');
    db.users.push({ user_id: id, role, name: str(b.name, 100), email: email.slice(0, 150), phone: str(b.phone, 30), address: '', pass_hash: p.hash, pass_salt: p.salt, pin_hash: n.hash, pin_salt: n.salt, active: true,
      discount_limit: b.discountLimit === '' || b.discountLimit == null ? null : Math.min(100, Math.max(0, Number(b.discountLimit))), commission_pct: Math.min(50, Math.max(0, Number(b.commissionPct) || 0)),
      loyalty_points: 0, failed_logins: 0, locked_until: null, created_at: nowIso(), overrides: [], measurements: null });
    audit(db, actor, 'user.create', `${email} (${role})`);
    return id;
  }

  Object.assign(LB, { lineTotal, catName, activeSales, salePct, findVariant, listProducts, moveStock, bundlesOf, findPromo, resolveItems, priceOrder, quote, openShiftOf, paidOf, balanceOf, awardPoints,
    placeOrder, decorate, listOrders, findOrder, getOrder, setStatus, addPayment, assignTailor, refundOrder, exchangeItem, checkInRental, decorateAlt, createAlteration, updateAlteration,
    openAttendance, clockIn, clockOut, startShift, shiftReport, closeShift, createUser });
})(window.LB);
