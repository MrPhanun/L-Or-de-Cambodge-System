'use strict';
/* Creates the tables and loads sample data.
     npm run setup-db            create tables + sample data if the database is empty
     npm run setup-db -- --reset drop everything first (DESTROYS ALL DATA in LorDeCambodgeDB)   */
const fs = require('fs');
const path = require('path');
const { q, one, getPool, sql } = require('./db');
const { PERMISSIONS, ROLE_PERMS, ROLES } = require('./perms');
const { hashSecret } = require('./security');
const S = require('./services');
const config = require('./config');

const SIZES = {
  Suits: ['46', '48', '50', '52', '54', '56'], Blazers: ['46', '48', '50', '52', '54', '56'], Trousers: ['30', '32', '34', '36', '38'],
  Shirts: ['S', 'M', 'L', 'XL'], Shoes: ['40', '41', '42', '43', '44', '45'], Ties: ['One size'], Accessories: ['One size']
};
// name, category, fabric, fit, colorName, hex, price, cost, rentPerDay
const PRODUCTS = [
  ['Phnom Penh Navy Two-Piece', 'Suits', 'Wool', 'Slim', 'Navy', '#1d2a52', 420, 210, 45],
  ['Angkor Charcoal Two-Piece', 'Suits', 'Wool', 'Regular', 'Charcoal', '#3a3f4a', 450, 225, 45],
  ['Royal Black Tuxedo', 'Suits', 'Wool', 'Slim', 'Black', '#0e1018', 590, 290, 70],
  ['Mekong Linen Summer Suit', 'Suits', 'Linen', 'Classic', 'Sand', '#c9b48a', 380, 180, 40],
  ['Bayon Burgundy Velvet Suit', 'Suits', 'Velvet', 'Slim', 'Burgundy', '#5a1a2b', 640, 310, 80],
  ['Siem Reap Grey Three-Piece', 'Suits', 'Wool', 'Classic', 'Grey', '#7b808c', 520, 255, 55],
  ['Harris Tweed Blazer', 'Blazers', 'Tweed', 'Regular', 'Brown', '#6b4a2f', 260, 120, 30],
  ['Midnight Velvet Blazer', 'Blazers', 'Velvet', 'Slim', 'Midnight', '#141a3a', 300, 140, 35],
  ['Cotton Navy Blazer', 'Blazers', 'Cotton', 'Classic', 'Navy', '#233a73', 220, 100, 25],
  ['Tailored Wool Trousers', 'Trousers', 'Wool', 'Slim', 'Charcoal', '#3a3f4a', 120, 52, 0],
  ['Linen Pleated Trousers', 'Trousers', 'Linen', 'Classic', 'Sand', '#c9b48a', 95, 40, 0],
  ['Classic Navy Trousers', 'Trousers', 'Cotton', 'Regular', 'Navy', '#1d2a52', 85, 36, 0],
  ['Poplin White Dress Shirt', 'Shirts', 'Cotton', 'Slim', 'White', '#f1f3f8', 65, 26, 0],
  ['Sky Blue Oxford Shirt', 'Shirts', 'Cotton', 'Regular', 'Sky Blue', '#9fc3ea', 70, 28, 0],
  ['Linen Ivory Shirt', 'Shirts', 'Linen', 'Classic', 'Ivory', '#ece3cf', 78, 32, 0],
  ['Silk Crimson Tie', 'Ties', 'Silk', 'Regular', 'Crimson', '#9d1c33', 45, 16, 0],
  ['Silk Royal Blue Tie', 'Ties', 'Silk', 'Regular', 'Royal Blue', '#2f4fa3', 45, 16, 0],
  ['Black Satin Bow Tie', 'Ties', 'Silk', 'Slim', 'Black', '#0e1018', 35, 12, 0],
  ['Oxford Brown Leather Shoes', 'Shoes', 'Leather', 'Classic', 'Brown', '#5b3a22', 180, 80, 0],
  ['Black Patent Derby Shoes', 'Shoes', 'Leather', 'Slim', 'Black', '#0b0d14', 210, 95, 0],
  ['Leather Belt', 'Accessories', 'Leather', 'Regular', 'Black', '#14161d', 55, 20, 0],
  ['Gold Cufflinks', 'Accessories', 'Silk', 'Regular', 'Gold', '#d4a64a', 85, 30, 0],
  ['Silk Pocket Square', 'Accessories', 'Silk', 'Regular', 'Burgundy', '#7a2236', 25, 8, 0],
  ['Cambodian Silk Scarf', 'Accessories', 'Silk', 'Regular', 'Gold', '#c89a3c', 60, 22, 0]
];

async function dropAll() {
  await q(`
    DECLARE @s NVARCHAR(MAX) = N'';
    SELECT @s += 'ALTER TABLE [' + OBJECT_SCHEMA_NAME(parent_object_id) + '].[' + OBJECT_NAME(parent_object_id) + '] DROP CONSTRAINT [' + name + '];' FROM sys.foreign_keys;
    EXEC sp_executesql @s;
    SET @s = N'';
    SELECT @s += 'DROP TABLE [' + SCHEMA_NAME(schema_id) + '].[' + name + '];' FROM sys.tables;
    EXEC sp_executesql @s;`);
}

async function createSchema() {
  const text = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  const pool = await getPool();
  for (const batch of text.split(/^\s*GO\s*$/mi).map(s => s.trim()).filter(Boolean)) await pool.request().batch(batch);
}

async function mkUser(name, email, phone, role, password, pin, extra = {}) {
  const p = await hashSecret(password), n = pin ? await hashSecret(pin) : { salt: null, hash: null };
  const r = await one(`INSERT INTO Users (role_id, name, email, phone, address, pass_hash, pass_salt, pin_hash, pin_salt, discount_limit, commission_pct, loyalty_points)
    OUTPUT inserted.user_id AS id VALUES (@r, @n, @e, @p, @a, @ph, @ps, @nh, @ns, @dl, @cp, @lp)`,
    { r: ROLES[role], n: name, e: email, p: phone, a: extra.address || null, ph: p.hash, ps: p.salt, nh: n.hash, ns: n.salt, dl: extra.discountLimit ?? null, cp: extra.commissionPct || 0, lp: extra.points || 0 });
  return r.id;
}

/** Needed in every environment: roles, permissions, categories and shop settings. */
async function seedCore() {
  for (const [name, id] of Object.entries(ROLES)) await q('INSERT INTO Roles (role_id, name) VALUES (@i, @n)', { i: id, n: name });
  for (const [code, label] of Object.entries(PERMISSIONS)) await q('INSERT INTO Permissions (code, label) VALUES (@c, @l)', { c: code, l: label });
  for (const [role, codes] of Object.entries(ROLE_PERMS)) for (const c of codes) await q('INSERT INTO RolePermissions (role_id, code) VALUES (@r, @c)', { r: ROLES[role], c });
  const catIds = {};
  for (const [name, sizes] of Object.entries(SIZES)) catIds[name] = (await one('INSERT INTO Categories (name, sizes) OUTPUT inserted.category_id AS id VALUES (@n, @s)', { n: name, s: sizes.join(',') })).id;
  await S.saveSettings(S.SETTING_DEFAULTS);
  return catIds;
}

/** PRODUCTION: no demo data. Creates only the first admin, whose email and password come from the environment. */
async function seedProduction() {
  const email = String(process.env.ADMIN_EMAIL || '').trim(), pw = String(process.env.ADMIN_PASSWORD || ''), pin = String(process.env.ADMIN_PIN || '');
  if (!/^[^\s@]+@[^\s@]+[.][^\s@]+$/.test(email)) throw new Error('Set ADMIN_EMAIL (a valid email) in .env.production before creating the production database.');
  if (pw.length < 12) throw new Error('Set ADMIN_PASSWORD (at least 12 characters) in .env.production before creating the production database.');
  if (pin && !/^[0-9]{4,6}$/.test(pin)) throw new Error('ADMIN_PIN must be 4-6 digits (or leave it empty).');
  await mkUser(process.env.ADMIN_NAME || 'Store Owner', email, '', 'admin', pw, pin || null, { discountLimit: 100 });
  console.log(`Created the first admin: ${email}  (sign in, then change the password from Account)`);
}

/** DEVELOPMENT: demo accounts, products, promotions. */
async function seedSampleData(catIds) {
  const ids = {};
  ids.admin = await mkUser('Store Owner', 'admin@lordecambodge.com', '+855 12 000 001', 'admin', 'Admin@1234', '0000', { discountLimit: 100 });
  ids.manager = await mkUser('Rith Manager', 'manager@lordecambodge.com', '+855 12 000 005', 'manager', 'Manager@1234', '4567', { discountLimit: 30, commissionPct: 1 });
  ids.seller = await mkUser('Sophea Chan', 'seller@lordecambodge.com', '+855 12 000 002', 'seller', 'Seller@1234', '1234', { discountLimit: 15, commissionPct: 3 });
  ids.seller2 = await mkUser('Dara Sok', 'seller2@lordecambodge.com', '+855 12 000 003', 'seller', 'Seller@1234', '2345', { discountLimit: 10, commissionPct: 2.5 });
  ids.tailor = await mkUser('Chenda Tailor', 'tailor@lordecambodge.com', '+855 12 000 006', 'tailor', 'Tailor@1234', '3456');
  ids.client = await mkUser('Vanna Kim', 'client@lordecambodge.com', '+855 12 000 004', 'client', 'Client@1234', null,
    { address: 'No. 12, St. 51, Phnom Penh', points: 620 });
  ids.client2 = await mkUser('Bopha Lim', 'client2@lordecambodge.com', '+855 12 000 007', 'client', 'Client@1234', null, { points: 1800 });
  await q('INSERT INTO Measurements (user_id, chest, waist, shoulder, sleeve, inseam, neck) VALUES (@u, 98, 84, 45, 63, 80, 39)', { u: ids.client });

  for (let i = 0; i < PRODUCTS.length; i++) {
    const [name, cat, fabric, fit, colorName, hex, price, cost, rent] = PRODUCTS[i];
    const p = await one(`INSERT INTO Products (sku, barcode, category_id, name, description, fabric, fit, color_name, color_hex, price, cost, rent_per_day, rent_deposit, tailorable)
      OUTPUT inserted.product_id AS id VALUES (@sku, @bc, @c, @n, @d, @fa, @fi, @cn, @hx, @pr, @co, @rp, @rd, @t)`,
      { sku: 'LDC-' + (1001 + i), bc: '885' + String(1000000000 + i * 7919).slice(0, 10), c: catIds[cat], n: name,
        d: `${fit} fit ${cat.toLowerCase().replace(/s$/, '')} in ${fabric.toLowerCase()}, ${colorName.toLowerCase()}. Crafted for the modern Cambodian gentleman.`,
        fa: fabric, fi: fit, cn: colorName, hx: hex, pr: price, co: cost, rp: rent, rd: rent ? rent * 4 : 0, t: ['Suits', 'Blazers', 'Trousers', 'Shirts'].includes(cat) });
    for (let k = 0; k < SIZES[cat].length; k++) {
      let stock = 3 + ((i * 7 + k * 5) % 9);
      if (i === 2 && k === 1) stock = 1; if (i === 4 && k === 0) stock = 0;
      await q('INSERT INTO ProductVariants (product_id, size, stock) VALUES (@p, @s, @st)', { p: p.id, s: SIZES[cat][k], st: stock });
    }
  }
  await q("INSERT INTO Suppliers (name, phone, email) VALUES ('Royal Textiles Co.', '+855 23 555 100', 'sales@royaltextiles.example'), ('Bangkok Fine Shoes', '+66 2 555 0101', 'orders@bkkshoes.example')");
  await q("INSERT INTO PromoCodes (code, pct, note) VALUES ('WELCOME10', 10, 'New customer 10% off'), ('KHMER15', 15, 'Khmer New Year sale')");
  await q("INSERT INTO SeasonalSales (name, pct, category_id, date_from, date_to) VALUES ('Linen Season', 10, @c, '2000-01-01', '2099-12-31')", { c: catIds.Shirts });
  const b1 = (await one("INSERT INTO Bundles (name, pct) OUTPUT inserted.bundle_id AS id VALUES ('Suit + Tie combo', 10)")).id;
  const b2 = (await one("INSERT INTO Bundles (name, pct) OUTPUT inserted.bundle_id AS id VALUES ('Suit + Shirt + Shoes', 12)")).id;
  for (const [b, cats] of [[b1, ['Suits', 'Ties']], [b2, ['Suits', 'Shirts', 'Shoes']]]) for (const c of cats) await q('INSERT INTO BundleCategories (bundle_id, category_id) VALUES (@b, @c)', { b, c: catIds[c] });
  await S.notify(ids.client, 'Welcome to L’Or de Cambodge', 'Use code WELCOME10 for 10% off your first order.', 'promo');
  return ids;
}

/** Demo orders spread over the last weeks so dashboards and reports have data. */
async function seedDemo(ids) {
  const actorOf = async (id) => {
    const u = await one('SELECT u.user_id AS id, u.name, r.name AS role, u.discount_limit AS discountLimit FROM Users u JOIN Roles r ON r.role_id = u.role_id WHERE u.user_id = @id', { id });
    return { ...u, perms: await S.effectivePerms(id, u.role) };
  };
  const prods = await q('SELECT p.product_id, c.name AS category FROM Products p JOIN Categories c ON c.category_id = p.category_id');
  const sizeOf = async (pid) => (await q('SELECT size FROM ProductVariants WHERE product_id = @p AND stock > 6', { p: pid }))[0]?.size;
  let seed = 7; const rnd = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const methods = ['Cash', 'Card', 'ABA Pay', 'KHQR'];

  for (const sid of [ids.seller, ids.seller2]) {
    const a = await actorOf(sid);
    await q('INSERT INTO Attendance (user_id, clock_in) VALUES (@u, DATEADD(HOUR, -9, SYSUTCDATETIME()))', { u: sid });
    await S.startShift(a, 100);
    const n = sid === ids.seller ? 16 : 11;
    for (let i = 0; i < n; i++) {
      const items = [];
      for (let k = 0, m = 1 + Math.floor(rnd() * 3); k < m; k++) {
        const p = pick(prods), size = await sizeOf(p.product_id);
        if (size) items.push({ productId: p.product_id, size, qty: 1, kind: 'buy' });
      }
      if (!items.length) continue;
      const qt = await S.quote(a, { items });
      const payments = rnd() < 0.3 ? [{ method: 'Cash', amount: r(qt.total / 2) }, { method: pick(methods.slice(1)), amount: r(qt.total - r(qt.total / 2)) }] : [{ method: pick(methods), amount: qt.total }];
      try {
        const o = await S.placeOrder(a, { items, customerId: rnd() < 0.5 ? ids.client : (rnd() < 0.5 ? ids.client2 : null), payments, discountPct: rnd() < 0.2 ? 5 : 0 });
        const age = Math.floor(rnd() * 26);
        await q(`UPDATE Orders SET created_at = DATEADD(DAY, -@d, created_at) WHERE order_id = @o;
                 UPDATE OrderPayments SET at = DATEADD(DAY, -@d, at) WHERE order_id = @o;
                 UPDATE OrderStatusHistory SET at = DATEADD(DAY, -@d, at) WHERE order_id = @o;`, { d: age, o: o.order_id });
      } catch { /* out of stock for a random pick - skip */ }
    }
  }
  // close the demo shifts so sellers start fresh when they log in
  for (const sid of [ids.seller, ids.seller2]) {
    const a = await actorOf(sid), sh = await S.openShiftOf(sid);
    const rep = await S.shiftReport(sh.shift_id);
    await S.closeShift(a, sh.shift_id, rep.expected, 'Demo shift');
    await q('UPDATE Attendance SET clock_out = SYSUTCDATETIME() WHERE user_id = @u AND clock_out IS NULL', { u: sid });
  }

  // online orders from the demo client in different states
  const client = await actorOf(ids.client), manager = await actorOf(ids.manager);
  const suit = prods.find(p => p.category === 'Suits').product_id, tie = prods.find(p => p.category === 'Ties').product_id;
  const o1 = await S.placeOrder(client, { items: [{ productId: suit, size: await sizeOf(suit), qty: 1, kind: 'buy' }, { productId: tie, size: 'One size', qty: 1, kind: 'buy' }], payMethod: 'KHQR' });
  const o2 = await S.placeOrder(client, { items: [{ productId: suit, qty: 1, kind: 'tailor', tailor: { fabric: 'Wool', style: 'Two-button peak lapel', fit: 'Slim', notes: 'Slightly longer sleeves' } }], payMethod: 'Pay in store' });
  await S.setStatus(manager, o2.order_id, 'Tailoring');
  await S.assignTailor(manager, o2.order_id, ids.tailor);
  await S.placeOrder(client, { items: [{ productId: tie, size: 'One size', qty: 2, kind: 'buy' }], payMethod: 'Pay in store' });
  await S.setStatus(manager, o1.order_id, 'Ready');
  // overdue rental (rented 5 days ago, due 2 days ago)
  const rentable = prods.find(p => p.category === 'Suits').product_id;
  const rs = await actorOf(ids.seller);
  await q('INSERT INTO Attendance (user_id) VALUES (@u)', { u: ids.seller }); await S.startShift(rs, 50);
  const rsz = await sizeOf(rentable), tomorrow = new Date(Date.now() + 864e5).toISOString().slice(0, 10), later = new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10);
  const rq = await S.quote(rs, { items: [{ productId: rentable, size: rsz, qty: 1, kind: 'rent', rentFrom: tomorrow, rentTo: later }] });
  const ro = await S.placeOrder(rs, { items: [{ productId: rentable, size: rsz, qty: 1, kind: 'rent', rentFrom: tomorrow, rentTo: later }], customerId: ids.client2, payments: [{ method: 'Cash', amount: rq.total }] });
  await q(`UPDATE OrderItems SET rent_from = CAST(DATEADD(DAY, -5, SYSUTCDATETIME()) AS DATE), rent_to = CAST(DATEADD(DAY, -2, SYSUTCDATETIME()) AS DATE) WHERE order_id = @o`, { o: ro.order_id });
  const sh = await S.openShiftOf(ids.seller); const rep = await S.shiftReport(sh.shift_id);
  await S.closeShift(rs, sh.shift_id, rep.expected, 'Demo shift');
  await q('UPDATE Attendance SET clock_out = SYSUTCDATETIME() WHERE user_id = @u AND clock_out IS NULL', { u: ids.seller });

  await S.createAlteration(manager, { customerId: ids.client, item: 'Navy suit jacket', work: 'Shorten sleeves 2cm, take in waist', fee: 15, due: new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10), tailorId: ids.tailor });
  await S.createAlteration(manager, { customerName: 'Walk-in: Mr. Heng', item: 'Trousers', work: 'Hem 3cm', fee: 8 });
  const d = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
  await q("INSERT INTO Appointments (customer_id, customer_name, service, appt_date, appt_time, status, assigned_to) VALUES (@c, 'Vanna Kim', 'Fitting', @d, '10:00', 'Confirmed', @t)", { c: ids.client, d: d(0), t: ids.seller });
  await q("INSERT INTO Appointments (customer_id, customer_name, service, appt_date, appt_time, status) VALUES (@c, 'Bopha Lim', 'Consultation', @d, '14:30', 'Booked')", { c: ids.client2, d: d(1) });
  function r(n) { return Math.round(n * 100) / 100; }
}

async function main() {
  const reset = process.argv.includes('--reset');
  console.log(`Environment: ${config.env.toUpperCase()}   database: ${config.db.database} on ${config.db.server}`);
  // Safety rails: the two environments must never be mixed up.
  if (config.isProd && reset && process.env.ALLOW_PROD_RESET !== '1') throw new Error('Refusing to wipe the PRODUCTION database. (If you really mean it, set ALLOW_PROD_RESET=1 for this one command.)');
  if (!config.isProd && /^lodecambodgedb$/i.test(config.db.database)) throw new Error('The development settings point at the production database name. Fix .env.development.');
  if (config.isProd && /_dev$/i.test(config.db.database)) throw new Error('The production settings point at a development database. Fix .env.production.');
  await getPool();
  if (reset) { console.log('Dropping all tables...'); await dropAll(); }
  const exists = await one("SELECT OBJECT_ID('dbo.Users') AS id");
  if (!exists.id) { console.log('Creating schema...'); await createSchema(); }
  const any = await one('SELECT COUNT(*) AS n FROM Users');
  if (any.n === 0) {
    console.log('Seeding core data (roles, permissions, categories, settings)...'); const catIds = await seedCore();
    if (config.isProd) await seedProduction();
    else { console.log('Seeding sample accounts and products...'); const ids = await seedSampleData(catIds); console.log('Seeding demo orders...'); await seedDemo(ids); }
  } else console.log('Database already has data - nothing to seed (use --reset to start over).');
  const counts = await one('SELECT (SELECT COUNT(*) FROM Users) users, (SELECT COUNT(*) FROM Products) products, (SELECT COUNT(*) FROM Orders) orders');
  console.log('Done:', counts);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
