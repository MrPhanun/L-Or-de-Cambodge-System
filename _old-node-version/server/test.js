'use strict';
/* End-to-end API checks against the running server (npm start in another terminal, then npm test).
   Uses the sample accounts from the seed data and leaves a few extra orders behind. */
const BASE = process.env.BASE || 'http://localhost:5500';
let passed = 0, failed = 0;

function client() {
  let cookie = '';
  const call = async (method, url, body, headers = {}) => {
    const res = await fetch(BASE + url, { method, headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch', ...(cookie ? { Cookie: cookie } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
    const sc = res.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    let json = null; try { json = await res.json(); } catch { /* not json */ }
    return { status: res.status, body: json, headers: res.headers };
  };
  return { get: (u) => call('GET', u), post: (u, b) => call('POST', u, b ?? {}), put: (u, b) => call('PUT', u, b ?? {}), del: (u) => call('DELETE', u), raw: call };
}
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log('  ok   ' + name); } else { failed++; console.log('  FAIL ' + name + (extra ? '  -> ' + extra : '')); }
}
const section = (t) => console.log('\n' + t);
const j = (r) => JSON.stringify(r.body).slice(0, 160);

async function login(email, secret, tab, mode) {
  const c = client(); const r = await c.post('/api/auth/login', { identifier: email, secret, tab, mode });
  if (r.status !== 200) throw new Error(`login ${email} failed: ${j(r)}`);
  return c;
}

(async () => {
  const envInfo = await fetch(BASE + '/api/settings').then(r => r.json()).catch(() => null);
  if (!envInfo) { console.error('Cannot reach ' + BASE + '. Start the DEV server first:  npm run dev'); process.exit(2); }
  if (envInfo.env !== 'development') { console.error('REFUSING to run: ' + BASE + ' is a ' + envInfo.env.toUpperCase() + ' server. The tests create orders and users - run them against the DEV server only.'); process.exit(2); }
  section('Security basics');
  const anon = client();
  check('anonymous catalog is 401', (await anon.get('/api/catalog')).status === 401);
  check('state change without X-Requested-With is 403', (await anon.raw('POST', '/api/auth/login', { identifier: 'a', secret: 'b' }, { 'X-Requested-With': '' })).status === 403);
  check('wrong password is 401', (await anon.post('/api/auth/login', { identifier: 'client@lordecambodge.com', secret: 'nope-nope', tab: 'client' })).status === 401);
  const wrongTab = await anon.post('/api/auth/login', { identifier: 'admin@lordecambodge.com', secret: 'Admin@1234', tab: 'client' });
  check('admin cannot sign in on the client tab', wrongTab.status === 403, j(wrongTab));
  check('page guard redirects anonymous users', (await anon.raw('GET', '/admin.html')).status === 302);
  const pwdInDb = await anon.post('/api/auth/login', { identifier: "' OR 1=1 --", secret: 'x' });
  check('SQL injection attempt is just a failed login', pwdInDb.status === 401);

  for (const [em, pw, home] of [['client@lordecambodge.com', 'Client@1234', '/client.html'], ['seller@lordecambodge.com', 'Seller@1234', '/seller.html'], ['tailor@lordecambodge.com', 'Tailor@1234', '/seller.html'], ['manager@lordecambodge.com', 'Manager@1234', '/admin.html'], ['admin@lordecambodge.com', 'Admin@1234', '/admin.html']]) {
    const r = await client().post('/api/auth/login', { identifier: em, secret: pw });
    check(`sign-in with just email + password sends ${em.split('@')[0]} to ${home}`, r.status === 200 && r.body.home === home, j(r));
  }

  section('Client');
  const cl = await login('client@lordecambodge.com', 'Client@1234', 'client');
  check('client page is served to a client', (await cl.raw('GET', '/client.html')).status === 200);
  check('client cannot open the admin page', (await cl.raw('GET', '/admin.html')).status === 302);
  check('client cannot read the dashboard', (await cl.get('/api/admin/dashboard')).status === 403);
  check('client cannot list users', (await cl.get('/api/admin/users')).status === 403);
  check('client cannot see customers', (await cl.get('/api/customers')).status === 403);
  const cat = (await cl.get('/api/catalog')).body;
  check('catalog loads and hides cost for clients', cat.products.length > 10 && !('cost' in cat.products[0]));
  const suit = cat.products.find(p => p.category === 'Suits' && p.variants.some(v => v.stock > 4));
  const tie = cat.products.find(p => p.category === 'Ties');
  const size = suit.variants.find(v => v.stock > 4).size;
  const stockBefore = suit.variants.find(v => v.size === size).stock;
  const q1 = await cl.post('/api/quote', { items: [{ productId: suit.product_id, size, qty: 1, kind: 'buy', unit_price: 0.01 }, { productId: tie.product_id, size: 'One size', qty: 1, kind: 'buy' }], promoCode: 'WELCOME10' });
  check('quote ignores client-sent prices and applies bundle + promo', q1.status === 200 && q1.body.bundle_discount > 0 && q1.body.promo_code === 'WELCOME10' && q1.body.total > 300, j(q1));
  const bad = await cl.post('/api/orders', { items: [{ productId: suit.product_id, size, qty: 1, kind: 'buy' }], discountPct: 90, payMethod: 'KHQR' });
  check('client cannot give themselves a manual discount', bad.status === 200 && bad.body.discount_pct === 0, j(bad));
  const ord = await cl.post('/api/orders', { items: [{ productId: suit.product_id, size, qty: 1, kind: 'buy' }, { productId: tie.product_id, size: 'One size', qty: 1, kind: 'buy' }], promoCode: 'WELCOME10', payMethod: 'ABA Pay' });
  check('online order placed and paid', ord.status === 200 && ord.body.status === 'Pending' && ord.body.balance === 0, j(ord));
  const stockAfter = (await cl.get('/api/catalog')).body.products.find(p => p.product_id === suit.product_id).variants.find(v => v.size === size).stock;
  check('stock decreased by the 2 orders above', stockAfter === stockBefore - 2, `${stockBefore} -> ${stockAfter}`);
  const tailor = await cl.post('/api/orders', { items: [{ productId: suit.product_id, qty: 1, kind: 'tailor', tailor: { fabric: 'Wool', style: 'Peak lapel', fit: 'Slim', notes: 'test' } }], payMethod: 'Pay in store' });
  check('custom tailoring request creates a Pending order', tailor.status === 200 && tailor.body.has_tailor && tailor.body.items[0].size === 'Custom', j(tailor));
  const cancel = await cl.post(`/api/orders/${tailor.body.order_id}/status`, { status: 'Cancelled' });
  check('client can cancel an unpaid pending order', cancel.status === 200 && cancel.body.status === 'Cancelled', j(cancel));
  const noAdv = await cl.post(`/api/orders/${ord.body.order_id}/status`, { status: 'Ready' });
  check('client cannot advance order status', noAdv.status === 403, j(noAdv));
  const m = await cl.put('/api/me/measurements', { chest: 99, waist: 85, shoulder: 45, sleeve: 63, inseam: 80, neck: 39 });
  check('measurements saved', m.status === 200);
  check('absurd measurements rejected', (await cl.put('/api/me/measurements', { chest: 999 })).status === 400);
  const day = new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10);
  check('appointment booked', (await cl.post('/api/appointments', { service: 'Fitting', date: day, time: '11:30' })).status === 200);
  check('appointment outside opening hours rejected', (await cl.post('/api/appointments', { service: 'Fitting', date: day, time: '23:00' })).status === 400);
  const rentDay = new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10), rentTo = new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10);
  const rent = await cl.post('/api/quote', { items: [{ productId: suit.product_id, size, qty: 1, kind: 'rent', rentFrom: rentDay, rentTo }] });
  check('rental quote includes deposit and 3 days', rent.status === 200 && rent.body.deposit > 0 && rent.body.lines[0].rent_days === 3, j(rent));
  const myOrders = (await cl.get('/api/orders')).body;
  check('client sees only their own orders', myOrders.length > 0 && myOrders.every(o => o.customer_name === 'Vanna Kim'));
  const notes = (await cl.get('/api/me/notifications')).body;
  check('notifications exist', notes.length > 0);

  section('Seller (PIN login, POS)');
  const bad2 = await anon.post('/api/auth/login', { identifier: 'seller@lordecambodge.com', secret: '0000', tab: 'seller', mode: 'pin' });
  check('wrong PIN rejected', bad2.status === 401);
  const se = await login('seller@lordecambodge.com', '1234', 'seller', 'pin');
  check('seller cannot open the admin page', (await se.raw('GET', '/admin.html')).status === 302);
  check('seller cannot create products', (await se.post('/api/admin/products', { name: 'x' })).status === 403);
  check('seller cannot read reports', (await se.get('/api/admin/reports')).status === 403);
  check('seller cannot manage staff', (await se.get('/api/admin/users')).status === 403);
  const pcat = (await se.get('/api/catalog')).body;
  check('seller catalog hides cost', !('cost' in pcat.products[0]));
  const noShift = await se.post('/api/orders', { items: [{ productId: tie.product_id, size: 'One size', qty: 1, kind: 'buy' }], payments: [{ method: 'Cash', amount: 50 }] });
  check('POS sale blocked until a cash shift is open', noShift.status === 400, j(noShift));
  check('cannot open shift before clocking in', (await se.post('/api/shift/open', { float: 100 })).status === 400);
  check('clock in', (await se.post('/api/shift/clock-in')).status === 200);
  check('open shift with float', (await se.post('/api/shift/open', { float: 100 })).status === 200);
  const over = await se.post('/api/orders', { items: [{ productId: tie.product_id, size: 'One size', qty: 1, kind: 'buy' }], discountPct: 20, payments: [{ method: 'Cash', amount: 10 }] });
  check('discount above seller limit (15%) rejected', over.status === 403, j(over));
  const sale = await se.post('/api/orders', { items: [{ productId: suit.product_id, size, qty: 1, kind: 'buy' }, { productId: tie.product_id, size: 'One size', qty: 2, kind: 'buy' }], customerId: 7, discountPct: 10,
    payments: [{ method: 'Cash', amount: 100 }, { method: 'Card', amount: 0.01 }] });
  check('partial payment leaves a balance and status Ready', sale.status === 200 && sale.body.balance > 0 && sale.body.status === 'Ready', j(sale));
  const early = await se.post(`/api/orders/${sale.body.order_id}/status`, { status: 'Picked Up' });
  check('cannot hand over goods while a balance is due', early.status === 400, j(early));
  const paid = await se.post(`/api/orders/${sale.body.order_id}/payments`, { method: 'KHQR', amount: sale.body.balance });
  check('collect the balance', paid.status === 200 && paid.body.balance === 0, j(paid));
  const over2 = await se.post(`/api/orders/${sale.body.order_id}/payments`, { method: 'Cash', amount: 5 });
  check('overpayment rejected', over2.status === 400);
  const pu = await se.post(`/api/orders/${sale.body.order_id}/status`, { status: 'Picked Up' });
  check('mark picked up once paid', pu.status === 200 && pu.body.status === 'Picked Up' && pu.body.points_awarded >= 0, j(pu));
  const item = sale.body.items.find(i => i.kind === 'buy' && i.name === tie.name);
  const rf = await se.post(`/api/orders/${sale.body.order_id}/refund`, { lines: [{ itemId: item.item_id, qty: 1 }], reason: 'Customer changed mind', method: 'Cash' });
  check('partial refund works and restocks', rf.status === 200 && rf.body.refunds.length === 1 && rf.body.refunds[0].amount > 0, j(rf));
  const rf2 = await se.post(`/api/orders/${sale.body.order_id}/refund`, { lines: [{ itemId: item.item_id, qty: 5 }], reason: 'x', method: 'Cash' });
  check('cannot refund more than was bought', rf2.status === 400, j(rf2));
  const sItem = sale.body.items.find(i => i.name === suit.name);
  const other = suit.variants.find(v => v.size !== size && v.stock > 0).size;
  const ex = await se.post(`/api/orders/${sale.body.order_id}/exchange`, { itemId: sItem.item_id, newSize: other });
  check('size exchange works', ex.status === 200 && ex.body.items.find(i => i.item_id === sItem.item_id).size === other && ex.body.exchanges.length === 1, j(ex));
  const alt = await se.post('/api/alterations', { customerId: 7, item: 'Jacket', work: 'Shorten sleeves', fee: 10 });
  check('alteration ticket created', alt.status === 200 && alt.body.alt_no, j(alt));
  const upd = await client().raw('PATCH', '/api/alterations/1', { status: 'Ready' });
  check('anonymous cannot update alteration', upd.status === 401);
  const held = await se.post('/api/held', { cart: { items: [{ productId: tie.product_id, size: 'One size', qty: 1, kind: 'buy' }], customerId: 7 }, label: 'test hold' });
  check('hold an order', held.status === 200);
  const hl = (await se.get('/api/held')).body;
  check('held orders listed and deletable', hl.length > 0 && (await se.del('/api/held/' + hl[0].held_id)).status === 200);
  const perf = await se.get('/api/performance');
  check('performance shows commission', perf.status === 200 && perf.body.commission_pct === 3 && perf.body.month > 0, j(perf));
  const rentOrder = await se.post('/api/orders', { items: [{ productId: suit.product_id, size: other, qty: 1, kind: 'rent', rentFrom: new Date().toISOString().slice(0, 10), rentTo: new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10) }], customerId: 7, payments: [{ method: 'Cash', amount: 1 }] });
  check('rental must be paid in full at check-out', rentOrder.status === 400, j(rentOrder));
  const q2 = await se.post('/api/quote', { items: [{ productId: suit.product_id, size: other, qty: 1, kind: 'rent', rentFrom: new Date().toISOString().slice(0, 10), rentTo: new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10) }] });
  const rentOk = await se.post('/api/orders', { items: [{ productId: suit.product_id, size: other, qty: 1, kind: 'rent', rentFrom: new Date().toISOString().slice(0, 10), rentTo: new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10) }], customerId: 7, payments: [{ method: 'Cash', amount: q2.body.total }] });
  check('rental checked out with deposit', rentOk.status === 200 && rentOk.body.status === 'Picked Up' && rentOk.body.deposit > 0, j(rentOk));
  const ci = await se.post(`/api/orders/${rentOk.body.order_id}/rental-checkin`, { damageFee: 5, note: 'minor stain' });
  check('rental check-in returns deposit minus damage', ci.status === 200 && ci.body.status === 'Returned' && ci.body.rental_return.deposit_refund === ci.body.deposit - 5, j(ci));
  const rep = await se.get('/api/shift/status');
  check('shift report totals', rep.status === 200 && rep.body.report.sales > 0 && rep.body.report.expected > 100, j(rep));
  const closeBad = await se.post('/api/shift/clock-out');
  check('cannot clock out with an open cash shift', closeBad.status === 400);
  const close = await se.post('/api/shift/close', { counted: rep.body.report.expected - 2, note: 'test' });
  check('close shift records variance', close.status === 200 && close.body.shift.variance === -2, j(close));
  check('clock out', (await se.post('/api/shift/clock-out')).status === 200);

  section('Tailor');
  const ta = await login('tailor@lordecambodge.com', '3456', 'seller', 'pin');
  check('tailor cannot use POS', (await ta.post('/api/orders', { items: [{ productId: tie.product_id, size: 'One size', qty: 1, kind: 'buy' }], payments: [] })).status === 403);
  check('tailor can read alterations', (await ta.get('/api/alterations')).status === 200);
  check('tailor cannot read customers list', (await ta.get('/api/customers')).status === 403);

  section('Admin / manager');
  const ad = await login('admin@lordecambodge.com', 'Admin@1234', 'admin');
  const dash = await ad.get('/api/admin/dashboard');
  check('dashboard loads', dash.status === 200 && dash.body.daily.length === 14 && dash.body.revenue_month > 0, j(dash));
  const today = new Date().toISOString().slice(0, 10), from = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  const rp = await ad.get(`/api/admin/reports?from=${from}&to=${today}`);
  check('report loads with totals and breakdowns', rp.status === 200 && rp.body.totals.orders > 0 && rp.body.byCategory.length > 0 && rp.body.bySeller.length > 0 && rp.body.inventory.units > 0, j(rp));
  const np = await ad.post('/api/admin/products', { name: 'Test Tux', sku: 'TST-' + Date.now(), category: 'Suits', price: 100, cost: 40, fabric: 'Wool', fit: 'Slim', color_name: 'Black', color_hex: '#000000', variants: [{ size: '50', stock: 5 }] });
  check('admin creates a product', np.status === 200 && np.body.id, j(np));
  check('negative price rejected', (await ad.post('/api/admin/products', { name: 'Bad', sku: 'BAD' + Date.now(), category: 'Suits', price: -5, variants: [] })).status === 400);
  const inv = (await ad.get('/api/admin/inventory')).body.find(v => v.product_id === np.body.id);
  check('new product has stock', inv && inv.stock === 5);
  check('stock adjustment', (await ad.post('/api/admin/inventory/adjust', { variantId: inv.variant_id, delta: -2, reason: 'damaged' })).status === 200);
  check('cannot adjust below zero', (await ad.post('/api/admin/inventory/adjust', { variantId: inv.variant_id, delta: -99, reason: 'oops' })).status === 400);
  const po = await ad.post('/api/admin/purchases', { supplierId: 1, items: [{ variantId: inv.variant_id, qty: 10, unitCost: 41 }] });
  check('purchase order created', po.status === 200, j(po));
  check('purchase order received adds stock', (await ad.post(`/api/admin/purchases/${po.body.id}/receive`)).status === 200 && (await ad.get('/api/admin/inventory')).body.find(v => v.variant_id === inv.variant_id).stock === 13);
  check('cannot receive twice', (await ad.post(`/api/admin/purchases/${po.body.id}/receive`)).status === 400);
  const del = await ad.del('/api/admin/products/' + np.body.id);
  check('unsold product can be deleted', del.status === 200 && del.body.archived === false, j(del));
  const email = `t${Date.now()}@example.com`;
  const nu = await ad.post('/api/admin/users', { name: 'Temp Seller', email, role: 'seller', password: 'TempPass#1', pin: '9876', discountLimit: 5, commissionPct: 2 });
  check('admin creates a seller', nu.status === 200, j(nu));
  check('weak password rejected', (await ad.post('/api/admin/users', { name: 'W', email: 'w' + email, role: 'client', password: '123' })).status === 400);
  const permsOf = (await (await login(email, 'TempPass#1', 'seller')).get('/api/auth/me')).body.user;
  check('new seller has seller permissions only', permsOf.perms.includes('pos.sell') && !permsOf.perms.includes('staff.manage'));
  const ovr = await ad.put('/api/admin/users/' + nu.body.id, { name: 'Temp Seller', role: 'seller', active: true, discountLimit: 5, commissionPct: 2, overrides: [{ code: 'pos.sell', granted: false }, { code: 'reports.view', granted: true }] });
  check('per-user permission override saved', ovr.status === 200);
  const tmp = await login(email, 'TempPass#1', 'seller');
  const tp = (await tmp.get('/api/auth/me')).body.user.perms;
  check('override revokes POS and grants reports', !tp.includes('pos.sell') && tp.includes('reports.view'));
  check('revoked POS blocks selling', (await tmp.post('/api/orders', { items: [], payments: [] })).status === 403);
  await new Promise((r) => setTimeout(r, 61000));   // let the per-IP login rate limit (20/min) reset so we test the account lockout itself
  for (let i = 0; i < 5; i++) await anon.post('/api/auth/login', { identifier: email, secret: 'wrong-pass-' + i, tab: 'seller' });
  const locked = await anon.post('/api/auth/login', { identifier: email, secret: 'TempPass#1', tab: 'seller' });
  check('account locks after 5 failed attempts', locked.status === 423, j(locked));
  const reset = await ad.post(`/api/admin/users/${nu.body.id}/reset`, { password: 'NewPass#12' });
  check('admin reset unlocks the account', reset.status === 200 && (await anon.post('/api/auth/login', { identifier: email, secret: 'NewPass#12', tab: 'seller' })).status === 200);
  check('admin cannot deactivate self', (await ad.put('/api/admin/users/1', { role: 'admin', active: false })).status === 400);
  const mg = await login('manager@lordecambodge.com', 'Manager@1234', 'admin');
  check('manager can read reports', (await mg.get(`/api/admin/reports?from=${from}&to=${today}`)).status === 200);
  check('manager cannot edit settings', (await mg.put('/api/admin/settings', { vatPct: 0 })).status === 403);
  check('manager cannot manage staff', (await mg.get('/api/admin/users')).status === 403);
  const st = await ad.put('/api/admin/settings', { vatPct: 10, paymentMethods: ['Cash', 'Pay in store'] });
  check('cannot disable Cash/Pay in store only partially', st.status === 200);
  check('payment methods must keep Cash', (await ad.put('/api/admin/settings', { paymentMethods: ['Card'] })).status === 400);
  await ad.put('/api/admin/settings', { paymentMethods: ['Cash', 'Card', 'ABA Pay', 'KHQR', 'Pay in store'] });
  const bc = await ad.post('/api/admin/promos/broadcast', { title: 'Test promo', body: 'Use code KHMER15', tier: 'VIP' });
  check('promotion broadcast reaches customers', bc.status === 200 && bc.body.sent >= 0, j(bc));
  check('seller cannot broadcast promotions', (await se.post('/api/admin/promos/broadcast', { title: 'x', body: 'y' })).status === 403);
  const hdr = await anon.raw('POST', '/api/auth/login', { identifier: 'client@lordecambodge.com', secret: 'Client@1234', tab: 'client' });
  const ck = hdr.headers.get('set-cookie') || '';
  check('session cookie is HttpOnly + SameSite=Strict', /HttpOnly/i.test(ck) && /SameSite=Strict/i.test(ck), ck);
  check('security headers are set (CSP, nosniff, frame deny)', /default-src 'self'/.test(hdr.headers.get('content-security-policy') || '') && hdr.headers.get('x-content-type-options') === 'nosniff' && hdr.headers.get('x-frame-options') === 'DENY');
  check('passwords are never returned by the API', !JSON.stringify((await ad.get('/api/admin/users')).body).match(/pass_hash|pin_hash|salt/i));
  const audit = await ad.get('/api/admin/audit?action=order');
  check('activity log records actions', audit.status === 200 && audit.body.length > 3);
  check('logout invalidates the session', (await cl.post('/api/auth/logout')).status === 200 && (await cl.get('/api/auth/me')).status === 401);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('TEST CRASH:', e); process.exit(2); });
