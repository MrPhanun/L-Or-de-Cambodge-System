'use strict';
/* First-run data. Development: full demo (accounts, products, orders). Production: an empty shop plus a first-run screen that creates the owner's admin account. */
(function (LB) {
  const { r2, nowIso, nextId, save, load, hashSecret } = LB;
  const SIZES = { Suits: ['46', '48', '50', '52', '54', '56'], Blazers: ['46', '48', '50', '52', '54', '56'], Trousers: ['30', '32', '34', '36', '38'], Shirts: ['S', 'M', 'L', 'XL'],
    Shoes: ['40', '41', '42', '43', '44', '45'], Ties: ['One size'], Accessories: ['One size'] };
  const PRODUCTS = [
    ['Phnom Penh Navy Two-Piece', 'Suits', 'Wool', 'Slim', 'Navy', '#1d2a52', 420, 210, 45], ['Angkor Charcoal Two-Piece', 'Suits', 'Wool', 'Regular', 'Charcoal', '#3a3f4a', 450, 225, 45],
    ['Royal Black Tuxedo', 'Suits', 'Wool', 'Slim', 'Black', '#0e1018', 590, 290, 70], ['Mekong Linen Summer Suit', 'Suits', 'Linen', 'Classic', 'Sand', '#c9b48a', 380, 180, 40],
    ['Bayon Burgundy Velvet Suit', 'Suits', 'Velvet', 'Slim', 'Burgundy', '#5a1a2b', 640, 310, 80], ['Siem Reap Grey Three-Piece', 'Suits', 'Wool', 'Classic', 'Grey', '#7b808c', 520, 255, 55],
    ['Harris Tweed Blazer', 'Blazers', 'Tweed', 'Regular', 'Brown', '#6b4a2f', 260, 120, 30], ['Midnight Velvet Blazer', 'Blazers', 'Velvet', 'Slim', 'Midnight', '#141a3a', 300, 140, 35],
    ['Cotton Navy Blazer', 'Blazers', 'Cotton', 'Classic', 'Navy', '#233a73', 220, 100, 25], ['Tailored Wool Trousers', 'Trousers', 'Wool', 'Slim', 'Charcoal', '#3a3f4a', 120, 52, 0],
    ['Linen Pleated Trousers', 'Trousers', 'Linen', 'Classic', 'Sand', '#c9b48a', 95, 40, 0], ['Classic Navy Trousers', 'Trousers', 'Cotton', 'Regular', 'Navy', '#1d2a52', 85, 36, 0],
    ['Poplin White Dress Shirt', 'Shirts', 'Cotton', 'Slim', 'White', '#f1f3f8', 65, 26, 0], ['Sky Blue Oxford Shirt', 'Shirts', 'Cotton', 'Regular', 'Sky Blue', '#9fc3ea', 70, 28, 0],
    ['Linen Ivory Shirt', 'Shirts', 'Linen', 'Classic', 'Ivory', '#ece3cf', 78, 32, 0], ['Silk Crimson Tie', 'Ties', 'Silk', 'Regular', 'Crimson', '#9d1c33', 45, 16, 0],
    ['Silk Royal Blue Tie', 'Ties', 'Silk', 'Regular', 'Royal Blue', '#2f4fa3', 45, 16, 0], ['Black Satin Bow Tie', 'Ties', 'Silk', 'Slim', 'Black', '#0e1018', 35, 12, 0],
    ['Oxford Brown Leather Shoes', 'Shoes', 'Leather', 'Classic', 'Brown', '#5b3a22', 180, 80, 0], ['Black Patent Derby Shoes', 'Shoes', 'Leather', 'Slim', 'Black', '#0b0d14', 210, 95, 0],
    ['Leather Belt', 'Accessories', 'Leather', 'Regular', 'Black', '#14161d', 55, 20, 0], ['Gold Cufflinks', 'Accessories', 'Silk', 'Regular', 'Gold', '#d4a64a', 85, 30, 0],
    ['Silk Pocket Square', 'Accessories', 'Silk', 'Regular', 'Burgundy', '#7a2236', 25, 8, 0], ['Cambodian Silk Scarf', 'Accessories', 'Silk', 'Regular', 'Gold', '#c89a3c', 60, 22, 0]];

  function emptyDb() {
    return { v: 3, seq: {}, users: [], categories: [], products: [], suppliers: [], purchases: [], promos: [], sales: [], bundles: [], orders: [], shifts: [], attendance: [], held: [], movements: [],
      alterations: [], appointments: [], notifications: [], audit: [], settings: {}, sessions: {} };
  }
  function seedCore(db) {
    for (const [name, sizes] of Object.entries(SIZES)) db.categories.push({ category_id: nextId(db, 'category'), name, sizes: sizes.join(',') });
    return Object.fromEntries(db.categories.map(c => [c.name, c.category_id]));
  }
  async function addUser(db, name, email, phone, role, password, pin, extra = {}) {
    const p = await hashSecret(password), n = pin ? await hashSecret(pin) : { salt: null, hash: null }, id = nextId(db, 'user');
    db.users.push({ user_id: id, role, name, email, phone, address: extra.address || '', pass_hash: p.hash, pass_salt: p.salt, pin_hash: n.hash, pin_salt: n.salt, active: true,
      discount_limit: extra.discountLimit ?? null, commission_pct: extra.commissionPct || 0, loyalty_points: extra.points || 0, failed_logins: 0, locked_until: null, created_at: nowIso(), overrides: [], measurements: extra.measurements || null });
    return id;
  }

  async function seedSample(db, catIds) {
    const ids = {};
    ids.admin = await addUser(db, 'Store Owner', 'admin@lordecambodge.com', '+855 12 000 001', 'admin', 'Admin@1234', '0000', { discountLimit: 100 });
    ids.manager = await addUser(db, 'Rith Manager', 'manager@lordecambodge.com', '+855 12 000 005', 'manager', 'Manager@1234', '4567', { discountLimit: 30, commissionPct: 1 });
    ids.seller = await addUser(db, 'Sophea Chan', 'seller@lordecambodge.com', '+855 12 000 002', 'seller', 'Seller@1234', '1234', { discountLimit: 15, commissionPct: 3 });
    ids.seller2 = await addUser(db, 'Dara Sok', 'seller2@lordecambodge.com', '+855 12 000 003', 'seller', 'Seller@1234', '2345', { discountLimit: 10, commissionPct: 2.5 });
    ids.tailor = await addUser(db, 'Chenda Tailor', 'tailor@lordecambodge.com', '+855 12 000 006', 'tailor', 'Tailor@1234', '3456');
    ids.client = await addUser(db, 'Vanna Kim', 'client@lordecambodge.com', '+855 12 000 004', 'client', 'Client@1234', null,
      { address: 'No. 12, St. 51, Phnom Penh', points: 620, measurements: { chest: 98, waist: 84, shoulder: 45, sleeve: 63, inseam: 80, neck: 39, updated_at: nowIso() } });
    ids.client2 = await addUser(db, 'Bopha Lim', 'client2@lordecambodge.com', '+855 12 000 007', 'client', 'Client@1234', null, { points: 1800 });
    PRODUCTS.forEach(([name, cat, fabric, fit, colorName, hex, price, cost, rent], i) => {
      const p = { product_id: nextId(db, 'product'), sku: 'LDC-' + (1001 + i), barcode: '885' + String(1000000000 + i * 7919).slice(0, 10), category_id: catIds[cat], name,
        description: `${fit} fit ${cat.toLowerCase().replace(/s$/, '')} in ${fabric.toLowerCase()}, ${colorName.toLowerCase()}. Crafted for the modern Cambodian gentleman.`, fabric, fit, color_name: colorName, color_hex: hex,
        price, cost, rent_per_day: rent, rent_deposit: rent ? rent * 4 : 0, image_url: null, tailorable: ['Suits', 'Blazers', 'Trousers', 'Shirts'].includes(cat), active: true, created_at: nowIso(), variants: [] };
      SIZES[cat].forEach((size, k) => { let stock = 3 + ((i * 7 + k * 5) % 9); if (i === 2 && k === 1) stock = 1; if (i === 4 && k === 0) stock = 0; p.variants.push({ variant_id: nextId(db, 'variant'), size, stock }); });
      db.products.push(p);
    });
    db.suppliers.push({ supplier_id: nextId(db, 'supplier'), name: 'Royal Textiles Co.', phone: '+855 23 555 100', email: 'sales@royaltextiles.example' }, { supplier_id: nextId(db, 'supplier'), name: 'Bangkok Fine Shoes', phone: '+66 2 555 0101', email: 'orders@bkkshoes.example' });
    db.promos.push({ promo_id: nextId(db, 'promo'), code: 'WELCOME10', pct: 10, active: true, note: 'New customer 10% off', expires_on: null }, { promo_id: nextId(db, 'promo'), code: 'KHMER15', pct: 15, active: true, note: 'Khmer New Year sale', expires_on: null });
    db.sales.push({ sale_id: nextId(db, 'sale'), name: 'Linen Season', pct: 10, category_id: catIds.Shirts, date_from: '2000-01-01', date_to: '2099-12-31', active: true });
    db.bundles.push({ bundle_id: nextId(db, 'bundle'), name: 'Suit + Tie combo', pct: 10, active: true, category_ids: [catIds.Suits, catIds.Ties] },
      { bundle_id: nextId(db, 'bundle'), name: 'Suit + Shirt + Shoes', pct: 12, active: true, category_ids: [catIds.Suits, catIds.Shirts, catIds.Shoes] });
    LB.notify(db, ids.client, 'Welcome to L’Or de Cambodge', 'Use code WELCOME10 for 10% off your first order.', 'promo');
    return ids;
  }

  const back = (iso, days) => new Date(new Date(iso).getTime() - days * 864e5).toISOString();
  function seedOrders(db, ids) {
    const actorOf = (id) => LB.actorOf(LB.userById(db, id));
    const prods = db.products.map(p => ({ product_id: p.product_id, category: LB.catName(db, p.category_id) }));
    const sizeOf = (pid) => db.products.find(p => p.product_id === pid).variants.find(v => v.stock > 6)?.size;
    let seed = 7; const rnd = () => (seed = (seed * 9301 + 49297) % 233280) / 233280, pick = (a) => a[Math.floor(rnd() * a.length)];
    const methods = ['Cash', 'Card', 'ABA Pay', 'KHQR'];
    for (const [sid, n] of [[ids.seller, 16], [ids.seller2, 11]]) {
      const a = actorOf(sid);
      db.attendance.unshift({ attendance_id: nextId(db, 'attendance'), user_id: sid, clock_in: back(nowIso(), 0.4), clock_out: null });
      LB.startShift(db, a, 100);
      for (let i = 0; i < n; i++) {
        const items = [];
        for (let k = 0, m = 1 + Math.floor(rnd() * 3); k < m; k++) { const p = pick(prods), size = sizeOf(p.product_id); if (size) items.push({ productId: p.product_id, size, qty: 1, kind: 'buy' }); }
        if (!items.length) continue;
        const qt = LB.quote(db, a, { items });
        const half = r2(qt.total / 2), payments = rnd() < 0.3 ? [{ method: 'Cash', amount: half }, { method: pick(methods.slice(1)), amount: r2(qt.total - half) }] : [{ method: pick(methods), amount: qt.total }];
        try {
          const o = LB.placeOrder(db, a, { items, customerId: rnd() < 0.5 ? ids.client : (rnd() < 0.5 ? ids.client2 : null), payments, discountPct: rnd() < 0.2 ? 5 : 0 });
          const age = Math.floor(rnd() * 26), ord = LB.findOrder(db, o.order_id);
          ord.created_at = back(ord.created_at, age); ord.payments.forEach(p => { p.at = back(p.at, age); }); ord.history.forEach(h => { h.at = back(h.at, age); });
        } catch { /* random pick out of stock: skip */ }
      }
    }
    for (const sid of [ids.seller, ids.seller2]) {
      const a = actorOf(sid), sh = LB.openShiftOf(db, sid), rep = LB.shiftReport(db, sh.shift_id);
      LB.closeShift(db, a, sh.shift_id, rep.expected, 'Demo shift'); LB.openAttendance(db, sid).clock_out = nowIso();
    }
    const client = actorOf(ids.client), manager = actorOf(ids.manager);
    const suit = prods.find(p => p.category === 'Suits').product_id, tie = prods.find(p => p.category === 'Ties').product_id;
    const o1 = LB.placeOrder(db, client, { items: [{ productId: suit, size: sizeOf(suit), qty: 1, kind: 'buy' }, { productId: tie, size: 'One size', qty: 1, kind: 'buy' }], payMethod: 'KHQR' });
    const o2 = LB.placeOrder(db, client, { items: [{ productId: suit, qty: 1, kind: 'tailor', tailor: { fabric: 'Wool', style: 'Two-button peak lapel', fit: 'Slim', notes: 'Slightly longer sleeves' } }], payMethod: 'Pay in store' });
    LB.setStatus(db, manager, o2.order_id, 'Tailoring'); LB.assignTailor(db, manager, o2.order_id, ids.tailor);
    LB.placeOrder(db, client, { items: [{ productId: tie, size: 'One size', qty: 2, kind: 'buy' }], payMethod: 'Pay in store' });
    LB.setStatus(db, manager, o1.order_id, 'Ready');
    const rs = actorOf(ids.seller);   // an overdue rental
    db.attendance.unshift({ attendance_id: nextId(db, 'attendance'), user_id: ids.seller, clock_in: nowIso(), clock_out: null }); LB.startShift(db, rs, 50);
    const rentable = prods.find(p => p.category === 'Suits').product_id, rsz = sizeOf(rentable), tomorrow = LB.todayStr().slice(0, 8) + '01';
    const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10), item = { productId: rentable, size: rsz, qty: 1, kind: 'rent', rentFrom: day(1), rentTo: day(3) };
    const rq = LB.quote(db, rs, { items: [item] }), ro = LB.placeOrder(db, rs, { items: [item], customerId: ids.client2, payments: [{ method: 'Cash', amount: rq.total }] });
    const rord = LB.findOrder(db, ro.order_id); rord.items[0].rent_from = day(-5); rord.items[0].rent_to = day(-2);
    const sh = LB.openShiftOf(db, ids.seller); LB.closeShift(db, rs, sh.shift_id, LB.shiftReport(db, sh.shift_id).expected, 'Demo shift'); LB.openAttendance(db, ids.seller).clock_out = nowIso();
    LB.createAlteration(db, manager, { customerId: ids.client, item: 'Navy suit jacket', work: 'Shorten sleeves 2cm, take in waist', fee: 15, due: day(2), tailorId: ids.tailor });
    LB.createAlteration(db, manager, { customerName: 'Walk-in: Mr. Heng', item: 'Trousers', work: 'Hem 3cm', fee: 8 });
    db.appointments.push({ appointment_id: nextId(db, 'appointment'), customer_id: ids.client, customer_name: 'Vanna Kim', service: 'Fitting', appt_date: day(0), appt_time: '10:00', status: 'Confirmed', note: '', assigned_to: ids.seller, reminded: false, created_at: nowIso() },
      { appointment_id: nextId(db, 'appointment'), customer_id: ids.client2, customer_name: 'Bopha Lim', service: 'Consultation', appt_date: day(1), appt_time: '14:30', status: 'Booked', note: '', assigned_to: null, reminded: false, created_at: nowIso() });
    db.audit = []; LB.audit(db, null, 'seed', 'Sample data created');
  }

  async function build() {
    const db = emptyDb(), catIds = seedCore(db);
    if (LB.env === 'development') { const ids = await seedSample(db, catIds); seedOrders(db, ids); }
    save(db);
  }
  /** Production first run: no users exist, so the sign-in page shows "Set up your shop" to create the owner. */
  LB.needsSetup = () => { const db = load(); return !!db && db.users.length === 0; };
  LB.setupOwner = async ({ name, email, password, pin }) => {
    const db = load();
    if (!db || db.users.length) throw LB.forbidden('The shop is already set up.');
    if (!String(name || '').trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || ''))) throw LB.bad('Enter your name and a valid email.');
    if (String(password || '').length < 12) throw LB.bad('Use a password of at least 12 characters for the owner account.');
    if (pin && !/^\d{4,6}$/.test(String(pin))) throw LB.bad('PIN must be 4-6 digits (or leave it empty).');
    await addUser(db, String(name).trim(), String(email).trim(), '', 'admin', password, pin || null, { discountLimit: 100 });
    LB.audit(db, { id: 1, name: String(name).trim(), role: 'admin' }, 'setup', 'Owner account created'); save(db);
  };
  /** Development only: throw everything away and load the demo data again. */
  LB.resetDemo = async () => { if (LB.env !== 'development') throw LB.forbidden('Resetting is only available in development.'); try { sessionStorage.removeItem('lodc_sid'); } catch { /* ignore */ } localStorage.removeItem(LB.KEY); await build(); };
  LB.ready = (async () => { if (!load()) await build(); })();
})(window.LB);
