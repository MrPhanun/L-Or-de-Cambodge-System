'use strict';
const express = require('express');
const { q, one, tx } = require('../db');
const { hashSecret } = require('../security');
const S = require('../services');
const { ROLES, PERMISSIONS, ROLE_PERMS } = require('../perms');
const M = require('../middleware');

const router = express.Router();
const { wrap, requirePerm } = M;
const r2 = S.r2;
const HEX = /^#[0-9a-fA-F]{6}$/;
const str = (v, n) => String(v ?? '').trim().slice(0, n);
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

// ================================================================ dashboard + reports
router.get('/dashboard', requirePerm('reports.view'), wrap(async (req, res) => {
  const settings = await S.getSettings();
  const k = await one(`SELECT
    COALESCE(SUM(CASE WHEN CAST(created_at AS DATE) = CAST(SYSUTCDATETIME() AS DATE) THEN total END), 0) AS revenue_today,
    COUNT(CASE WHEN CAST(created_at AS DATE) = CAST(SYSUTCDATETIME() AS DATE) THEN 1 END) AS orders_today,
    COALESCE(SUM(CASE WHEN created_at >= DATEADD(DAY, -6, CAST(SYSUTCDATETIME() AS DATE)) THEN total END), 0) AS revenue_week,
    COALESCE(SUM(CASE WHEN created_at >= DATEADD(DAY, -29, CAST(SYSUTCDATETIME() AS DATE)) THEN total END), 0) AS revenue_month,
    COUNT(CASE WHEN status IN ('Pending','Tailoring','Ready') THEN 1 END) AS open_orders
    FROM Orders WHERE status <> 'Cancelled'`);
  const daily = await q(`WITH d AS (SELECT CAST(DATEADD(DAY, -n, SYSUTCDATETIME()) AS DATE) AS day FROM (VALUES (0),(1),(2),(3),(4),(5),(6),(7),(8),(9),(10),(11),(12),(13)) v(n))
    SELECT d.day, COALESCE(SUM(o.total), 0) AS total, COUNT(o.order_id) AS orders FROM d LEFT JOIN Orders o ON CAST(o.created_at AS DATE) = d.day AND o.status <> 'Cancelled' GROUP BY d.day ORDER BY d.day`);
  const top = await q(`SELECT TOP 5 i.name, SUM(i.qty) AS qty, SUM(i.qty * i.unit_price) AS revenue FROM OrderItems i JOIN Orders o ON o.order_id = i.order_id
    WHERE o.status <> 'Cancelled' AND i.kind <> 'rent' GROUP BY i.name ORDER BY SUM(i.qty) DESC, revenue DESC`);
  const low = await q(`SELECT TOP 12 p.name, v.size, v.stock FROM ProductVariants v JOIN Products p ON p.product_id = v.product_id WHERE p.active = 1 AND v.stock <= @low ORDER BY v.stock, p.name`, { low: settings.lowStock });
  const counts = await one(`SELECT (SELECT COUNT(*) FROM Users u JOIN Roles r ON r.role_id = u.role_id WHERE r.name = 'client') AS customers,
    (SELECT COUNT(*) FROM Orders o WHERE o.has_rental = 1 AND o.status = 'Picked Up' AND EXISTS (SELECT 1 FROM OrderItems i WHERE i.order_id = o.order_id AND i.kind = 'rent' AND i.rent_to < CAST(SYSUTCDATETIME() AS DATE))) AS overdue_rentals,
    (SELECT COUNT(*) FROM Alterations WHERE status IN ('Received','In Progress')) AS open_alterations,
    (SELECT COUNT(*) FROM Appointments WHERE appt_date = CAST(SYSUTCDATETIME() AS DATE) AND status IN ('Booked','Confirmed')) AS appointments_today`);
  res.json({ ...k, ...counts, daily, top, low });
}));

router.get('/reports', requirePerm('reports.view'), wrap(async (req, res) => {
  const from = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.from)) ? req.query.from : S.todayStr();
  const to = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.to)) ? req.query.to : S.todayStr();
  const p = { from, to };
  const W = "o.status <> 'Cancelled' AND o.created_at >= @from AND o.created_at < DATEADD(DAY, 1, CAST(@to AS DATE))";
  const totals = await one(`SELECT COUNT(*) AS orders, COALESCE(SUM(o.subtotal), 0) AS gross, COALESCE(SUM(o.bundle_discount + o.discount + o.points_value), 0) AS discounts,
    COALESCE(SUM(o.tax), 0) AS tax, COALESCE(SUM(o.deposit), 0) AS deposits, COALESCE(SUM(o.total), 0) AS total FROM Orders o WHERE ${W}`, p);
  const refunds = await one(`SELECT COALESCE(SUM(r.amount), 0) AS amount FROM OrderRefunds r WHERE r.at >= @from AND r.at < DATEADD(DAY, 1, CAST(@to AS DATE))`, p);
  const cogs = await one(`SELECT COALESCE(SUM(i.qty * i.unit_cost), 0) AS cogs, COALESCE(SUM(i.qty * i.unit_price), 0) AS item_sales FROM OrderItems i JOIN Orders o ON o.order_id = i.order_id WHERE ${W} AND i.kind <> 'rent'`, p);
  const rentalRev = await one(`SELECT COALESCE(SUM(i.unit_price * i.rent_days * i.qty), 0) AS rental FROM OrderItems i JOIN Orders o ON o.order_id = i.order_id WHERE ${W} AND i.kind = 'rent'`, p);
  const byDay = await q(`SELECT CAST(o.created_at AS DATE) AS day, COUNT(*) AS orders, SUM(o.total) AS total FROM Orders o WHERE ${W} GROUP BY CAST(o.created_at AS DATE) ORDER BY day`, p);
  const byWeek = await q(`SELECT DATEPART(ISO_WEEK, o.created_at) AS week, MIN(CAST(o.created_at AS DATE)) AS start, COUNT(*) AS orders, SUM(o.total) AS total FROM Orders o WHERE ${W} GROUP BY DATEPART(ISO_WEEK, o.created_at) ORDER BY start`, p);
  const byMonth = await q(`SELECT FORMAT(o.created_at, 'yyyy-MM') AS month, COUNT(*) AS orders, SUM(o.total) AS total FROM Orders o WHERE ${W} GROUP BY FORMAT(o.created_at, 'yyyy-MM') ORDER BY month`, p);
  const byCategory = await q(`SELECT COALESCE(i.category, '-') AS category, SUM(i.qty) AS qty, SUM(i.qty * i.unit_price) AS revenue FROM OrderItems i JOIN Orders o ON o.order_id = i.order_id WHERE ${W} AND i.kind <> 'rent' GROUP BY i.category ORDER BY revenue DESC`, p);
  const bySize = await q(`SELECT TOP 12 i.size, SUM(i.qty) AS qty FROM OrderItems i JOIN Orders o ON o.order_id = i.order_id WHERE ${W} GROUP BY i.size ORDER BY qty DESC`, p);
  const byColor = await q(`SELECT TOP 12 COALESCE(i.color_name, '-') AS color, SUM(i.qty) AS qty FROM OrderItems i JOIN Orders o ON o.order_id = i.order_id WHERE ${W} GROUP BY i.color_name ORDER BY qty DESC`, p);
  const byStyle = await q(`SELECT COALESCE(i.fit, '-') AS fit, COALESCE(i.fabric, '-') AS fabric, SUM(i.qty) AS qty FROM OrderItems i JOIN Orders o ON o.order_id = i.order_id WHERE ${W} GROUP BY i.fit, i.fabric ORDER BY qty DESC`, p);
  const bestItems = await q(`SELECT TOP 10 i.name, SUM(i.qty) AS qty, SUM(i.qty * i.unit_price) AS revenue FROM OrderItems i JOIN Orders o ON o.order_id = i.order_id WHERE ${W} GROUP BY i.name ORDER BY qty DESC`, p);
  const bySeller = await q(`SELECT COALESCE(u.name, 'Online') AS seller, COUNT(*) AS orders, SUM(o.total) AS total, u.commission_pct,
      ROUND(SUM(o.total) * COALESCE(u.commission_pct, 0) / 100, 2) AS commission FROM Orders o LEFT JOIN Users u ON u.user_id = o.seller_id WHERE ${W} GROUP BY u.name, u.commission_pct ORDER BY total DESC`, p);
  const byMethod = await q(`SELECT pm.method, COUNT(*) AS payments, SUM(pm.amount) AS total FROM OrderPayments pm WHERE pm.at >= @from AND pm.at < DATEADD(DAY, 1, CAST(@to AS DATE)) GROUP BY pm.method ORDER BY total DESC`, p);
  const inventory = await one(`SELECT COALESCE(SUM(v.stock * pr.cost), 0) AS cost_value, COALESCE(SUM(v.stock * pr.price), 0) AS retail_value, COALESCE(SUM(v.stock), 0) AS units
    FROM ProductVariants v JOIN Products pr ON pr.product_id = v.product_id WHERE pr.active = 1`);
  const shifts = await q(`SELECT cs.shift_id, u.name AS user_name, cs.opened_at, cs.closed_at, cs.float_amount, cs.expected, cs.counted, cs.variance, cs.note FROM CashShifts cs JOIN Users u ON u.user_id = cs.user_id
    WHERE cs.opened_at >= @from AND cs.opened_at < DATEADD(DAY, 1, CAST(@to AS DATE)) ORDER BY cs.opened_at DESC`, p);
  const gross_profit = r2(Number(cogs.item_sales) - Number(cogs.cogs));
  res.json({ from, to, totals: { ...totals, refunds: refunds.amount, net: r2(Number(totals.total) - Number(refunds.amount)), cogs: cogs.cogs, rental_revenue: rentalRev.rental, gross_profit },
    byDay, byWeek, byMonth, byCategory, bySize, byColor, byStyle, bestItems, bySeller, byMethod, inventory, shifts });
}));

// ================================================================ products & categories
router.get('/products', requirePerm('products.edit'), wrap(async (req, res) => res.json(await S.listProducts({ includeInactive: true, includeCost: true }))));

async function writeProduct(conn, id, b) {
  const name = str(b.name, 150);
  if (!name) throw S.bad('Product name is required.');
  const cat = await one('SELECT category_id FROM Categories WHERE name = @n', { n: str(b.category, 50) }, conn);
  if (!cat) throw S.bad('Choose a category.');
  const price = num(b.price, -1), cost = num(b.cost, 0);
  if (!(price >= 0)) throw S.bad('Price must be 0 or more.');
  if (cost < 0 || cost > price * 5 + 1) throw S.bad('Cost looks invalid.');
  if (!HEX.test(String(b.color_hex || '#1d2a52'))) throw S.bad('Color must be a hex value like #1d2a52.');
  if (b.image_url && (!String(b.image_url).startsWith('data:image/') || String(b.image_url).length > 700000)) throw S.bad('Image must be a small picture (under ~500 KB).');
  const sku = str(b.sku, 30);
  if (!sku) throw S.bad('SKU is required.');
  if (await one('SELECT 1 AS x FROM Products WHERE sku = @s AND product_id <> @id', { s: sku, id: id || 0 }, conn)) throw S.bad('SKU already exists.');
  const params = { n: name, sku, bc: str(b.barcode, 30) || null, c: cat.category_id, d: str(b.description, 600), fa: str(b.fabric, 30), fi: str(b.fit, 20), cn: str(b.color_name, 40),
    hx: b.color_hex || '#1d2a52', pr: r2(price), co: r2(cost), rp: r2(Math.max(0, num(b.rent_per_day))), rd: r2(Math.max(0, num(b.rent_deposit))), img: b.image_url || null, t: b.tailorable ? 1 : 0, a: b.active === false ? 0 : 1 };
  if (id) {
    await q(`UPDATE Products SET name=@n, sku=@sku, barcode=@bc, category_id=@c, description=@d, fabric=@fa, fit=@fi, color_name=@cn, color_hex=@hx, price=@pr, cost=@co,
             rent_per_day=@rp, rent_deposit=@rd, image_url=COALESCE(@img, image_url), tailorable=@t, active=@a WHERE product_id=@id`, { ...params, id }, conn);
    return id;
  }
  return (await one(`INSERT INTO Products (name, sku, barcode, category_id, description, fabric, fit, color_name, color_hex, price, cost, rent_per_day, rent_deposit, image_url, tailorable, active)
    OUTPUT inserted.product_id AS id VALUES (@n, @sku, @bc, @c, @d, @fa, @fi, @cn, @hx, @pr, @co, @rp, @rd, @img, @t, @a)`, params, conn)).id;
}
async function syncVariants(conn, productId, variants, actor) {
  if (!Array.isArray(variants)) return;
  const existing = await q('SELECT variant_id, size, stock FROM ProductVariants WHERE product_id = @p', { p: productId }, conn);
  const wanted = new Set();
  for (const v of variants) {
    const size = str(v.size, 20); if (!size) continue;
    wanted.add(size);
    const have = existing.find(e => e.size === size);
    if (!have) {
      const stock = Math.max(0, Math.floor(num(v.stock)));
      const nv = await one('INSERT INTO ProductVariants (product_id, size, stock) OUTPUT inserted.variant_id AS id VALUES (@p, @s, @st)', { p: productId, s: size, st: stock }, conn);
      if (stock) await q("INSERT INTO StockMovements (variant_id, qty, type, ref, user_id) VALUES (@v, @q, 'adjust', 'initial stock', @u)", { v: nv.id, q: stock, u: actor.id }, conn);
    }
  }
  for (const e of existing.filter(e => !wanted.has(e.size))) {
    const used = await one('SELECT COUNT(*) AS n FROM OrderItems WHERE variant_id = @v', { v: e.variant_id }, conn);
    if (used.n) throw S.bad(`Size ${e.size} has sales history and cannot be removed (set stock to 0 instead).`);
    await q('DELETE FROM StockMovements WHERE variant_id = @v; DELETE FROM PurchaseOrderItems WHERE variant_id = @v; DELETE FROM ProductVariants WHERE variant_id = @v', { v: e.variant_id }, conn);
  }
}
router.post('/products', requirePerm('products.edit'), wrap(async (req, res) => {
  const id = await tx(async (conn) => { const pid = await writeProduct(conn, null, req.body || {}); await syncVariants(conn, pid, req.body.variants, req.user); await S.audit(req.user, 'product.create', req.body.name, req.ip, conn); return pid; });
  res.json({ ok: true, id });
}));
router.put('/products/:id', requirePerm('products.edit'), wrap(async (req, res) => {
  const id = Number(req.params.id);
  await tx(async (conn) => { await writeProduct(conn, id, req.body || {}); await syncVariants(conn, id, req.body.variants, req.user); await S.audit(req.user, 'product.update', `#${id} ${req.body.name}`, req.ip, conn); });
  res.json({ ok: true });
}));
router.delete('/products/:id', requirePerm('products.edit'), wrap(async (req, res) => {
  const id = Number(req.params.id);
  const used = await one('SELECT COUNT(*) AS n FROM OrderItems WHERE product_id = @id', { id });
  const p = await one('SELECT name FROM Products WHERE product_id = @id', { id });
  if (!p) throw S.notFound();
  if (used.n) { await q('UPDATE Products SET active = 0 WHERE product_id = @id', { id }); await S.audit(req.user, 'product.archive', p.name, req.ip); return res.json({ ok: true, archived: true }); }
  await tx(async (conn) => {
    await q('DELETE FROM StockMovements WHERE variant_id IN (SELECT variant_id FROM ProductVariants WHERE product_id = @id); DELETE FROM PurchaseOrderItems WHERE variant_id IN (SELECT variant_id FROM ProductVariants WHERE product_id = @id); DELETE FROM Products WHERE product_id = @id', { id }, conn);
    await S.audit(req.user, 'product.delete', p.name, req.ip, conn);
  });
  res.json({ ok: true, archived: false });
}));

router.get('/categories', requirePerm('products.edit'), wrap(async (req, res) => res.json(await q('SELECT c.*, (SELECT COUNT(*) FROM Products p WHERE p.category_id = c.category_id) AS products FROM Categories c ORDER BY c.category_id'))));
router.post('/categories', requirePerm('products.edit'), wrap(async (req, res) => {
  const name = str(req.body.name, 50), sizes = String(req.body.sizes || 'One size').split(',').map(s => s.trim()).filter(Boolean).join(',').slice(0, 200);
  if (!name) throw S.bad('Category name is required.');
  if (await one('SELECT 1 AS x FROM Categories WHERE name = @n', { n: name })) throw S.bad('Category already exists.');
  await q('INSERT INTO Categories (name, sizes) VALUES (@n, @s)', { n: name, s: sizes || 'One size' });
  await S.audit(req.user, 'category.create', name, req.ip); res.json({ ok: true });
}));
router.put('/categories/:id', requirePerm('products.edit'), wrap(async (req, res) => {
  const name = str(req.body.name, 50), sizes = String(req.body.sizes || 'One size').split(',').map(s => s.trim()).filter(Boolean).join(',').slice(0, 200);
  if (!name) throw S.bad('Category name is required.');
  if (await one('SELECT 1 AS x FROM Categories WHERE name = @n AND category_id <> @id', { n: name, id: Number(req.params.id) })) throw S.bad('Category already exists.');
  await q('UPDATE Categories SET name = @n, sizes = @s WHERE category_id = @id', { n: name, s: sizes, id: Number(req.params.id) });
  await S.audit(req.user, 'category.update', name, req.ip); res.json({ ok: true });
}));
router.delete('/categories/:id', requirePerm('products.edit'), wrap(async (req, res) => {
  const n = await one('SELECT COUNT(*) AS n FROM Products WHERE category_id = @id', { id: Number(req.params.id) });
  if (n.n) throw S.bad('Move or delete the products in this category first.');
  await q('DELETE FROM BundleCategories WHERE category_id = @id; UPDATE SeasonalSales SET active = 0 WHERE category_id = @id; DELETE FROM Categories WHERE category_id = @id', { id: Number(req.params.id) });
  await S.audit(req.user, 'category.delete', `#${req.params.id}`, req.ip); res.json({ ok: true });
}));

// ================================================================ inventory, suppliers, purchase orders
router.get('/inventory', requirePerm('inventory.view'), wrap(async (req, res) => {
  const withCost = S.can(req.user, 'inventory.edit') || S.can(req.user, 'reports.view');
  res.json(await q(`SELECT v.variant_id, p.product_id, p.name, p.sku, p.barcode, c.name AS category, p.color_name, p.color_hex, p.fabric, p.fit, v.size, v.stock, p.price ${withCost ? ', p.cost' : ''}
    FROM ProductVariants v JOIN Products p ON p.product_id = v.product_id JOIN Categories c ON c.category_id = p.category_id WHERE p.active = 1 ORDER BY p.name, v.variant_id`));
}));
router.post('/inventory/adjust', requirePerm('inventory.edit'), wrap(async (req, res) => {
  const delta = Math.trunc(num(req.body.delta)), reason = str(req.body.reason, 40);
  if (!delta) throw S.bad('Enter a quantity (use a negative number to remove stock).');
  if (!reason) throw S.bad('A reason is required.');
  await tx(async (conn) => { await S.moveStock(conn, Number(req.body.variantId), delta, 'adjust', reason, req.user.id); await S.audit(req.user, 'stock.adjust', `variant ${req.body.variantId} ${delta > 0 ? '+' : ''}${delta} (${reason})`, req.ip, conn); });
  res.json({ ok: true });
}));
router.get('/movements', requirePerm('inventory.view'), wrap(async (req, res) => res.json(await q(`SELECT TOP 200 m.*, p.name, v.size, u.name AS user_name FROM StockMovements m JOIN ProductVariants v ON v.variant_id = m.variant_id
  JOIN Products p ON p.product_id = v.product_id LEFT JOIN Users u ON u.user_id = m.user_id ORDER BY m.at DESC, m.movement_id DESC`))));

router.get('/suppliers', requirePerm('inventory.edit'), wrap(async (req, res) => res.json(await q('SELECT * FROM Suppliers ORDER BY name'))));
router.post('/suppliers', requirePerm('inventory.edit'), wrap(async (req, res) => {
  if (!str(req.body.name, 120)) throw S.bad('Supplier name is required.');
  await q('INSERT INTO Suppliers (name, phone, email) VALUES (@n, @p, @e)', { n: str(req.body.name, 120), p: str(req.body.phone, 30), e: str(req.body.email, 150) });
  await S.audit(req.user, 'supplier.create', req.body.name, req.ip); res.json({ ok: true });
}));
router.put('/suppliers/:id', requirePerm('inventory.edit'), wrap(async (req, res) => {
  await q('UPDATE Suppliers SET name = @n, phone = @p, email = @e WHERE supplier_id = @id', { n: str(req.body.name, 120), p: str(req.body.phone, 30), e: str(req.body.email, 150), id: Number(req.params.id) });
  res.json({ ok: true });
}));
router.delete('/suppliers/:id', requirePerm('inventory.edit'), wrap(async (req, res) => {
  if ((await one('SELECT COUNT(*) AS n FROM PurchaseOrders WHERE supplier_id = @id', { id: Number(req.params.id) })).n) throw S.bad('This supplier has purchase orders and cannot be deleted.');
  await q('DELETE FROM Suppliers WHERE supplier_id = @id', { id: Number(req.params.id) }); res.json({ ok: true });
}));

router.get('/purchases', requirePerm('inventory.edit'), wrap(async (req, res) => {
  const pos = await q(`SELECT po.*, s.name AS supplier_name, u.name AS by_name FROM PurchaseOrders po JOIN Suppliers s ON s.supplier_id = po.supplier_id LEFT JOIN Users u ON u.user_id = po.created_by ORDER BY po.created_at DESC`);
  const items = pos.length ? await q(`SELECT i.*, p.name, v.size FROM PurchaseOrderItems i JOIN ProductVariants v ON v.variant_id = i.variant_id JOIN Products p ON p.product_id = v.product_id
    WHERE i.po_id IN (SELECT CAST(value AS INT) FROM OPENJSON(@ids))`, { ids: JSON.stringify(pos.map(p => p.po_id)) }) : [];
  for (const po of pos) { po.items = items.filter(i => i.po_id === po.po_id); po.total = r2(po.items.reduce((s, i) => s + i.qty * Number(i.unit_cost), 0)); }
  res.json(pos);
}));
router.post('/purchases', requirePerm('inventory.edit'), wrap(async (req, res) => {
  const items = (req.body.items || []).map(i => ({ v: Number(i.variantId), q: Math.floor(num(i.qty)), c: num(i.unitCost, -1) }));
  if (!items.length || items.some(i => !(i.q > 0) || !(i.c >= 0))) throw S.bad('Add at least one item with a quantity and unit cost.');
  const id = await tx(async (conn) => {
    if (!(await one('SELECT 1 AS x FROM Suppliers WHERE supplier_id = @id', { id: Number(req.body.supplierId) }, conn))) throw S.bad('Choose a supplier.');
    const po = await one("INSERT INTO PurchaseOrders (supplier_id, note, created_by) OUTPUT inserted.po_id AS id VALUES (@s, @n, @u)", { s: Number(req.body.supplierId), n: str(req.body.note, 250), u: req.user.id }, conn);
    await q('UPDATE PurchaseOrders SET po_no = @n WHERE po_id = @id', { n: 'PO-' + (1000 + po.id), id: po.id }, conn);
    for (const i of items) {
      if (!(await one('SELECT 1 AS x FROM ProductVariants WHERE variant_id = @v', { v: i.v }, conn))) throw S.bad('Unknown item in purchase order.');
      await q('INSERT INTO PurchaseOrderItems (po_id, variant_id, qty, unit_cost) VALUES (@p, @v, @q, @c)', { p: po.id, v: i.v, q: i.q, c: i.c }, conn);
    }
    await S.audit(req.user, 'purchase.create', `PO-${1000 + po.id}`, req.ip, conn);
    return po.id;
  });
  res.json({ ok: true, id });
}));
router.post('/purchases/:id/receive', requirePerm('inventory.edit'), wrap(async (req, res) => {
  await tx(async (conn) => {
    const po = await one('SELECT * FROM PurchaseOrders WHERE po_id = @id', { id: Number(req.params.id) }, conn);
    if (!po) throw S.notFound();
    if (po.status !== 'Ordered') throw S.bad(`Purchase order is already ${po.status}.`);
    for (const i of await q('SELECT * FROM PurchaseOrderItems WHERE po_id = @id', { id: po.po_id }, conn)) {
      await S.moveStock(conn, i.variant_id, i.qty, 'purchase', po.po_no, req.user.id);
      await q('UPDATE Products SET cost = @c WHERE product_id = (SELECT product_id FROM ProductVariants WHERE variant_id = @v)', { c: i.unit_cost, v: i.variant_id }, conn);   // latest purchase cost
    }
    await q("UPDATE PurchaseOrders SET status = 'Received', received_at = SYSUTCDATETIME() WHERE po_id = @id", { id: po.po_id }, conn);
    await S.audit(req.user, 'purchase.receive', po.po_no, req.ip, conn);
  });
  res.json({ ok: true });
}));
router.post('/purchases/:id/cancel', requirePerm('inventory.edit'), wrap(async (req, res) => {
  const r = await q("UPDATE PurchaseOrders SET status = 'Cancelled' OUTPUT inserted.po_no WHERE po_id = @id AND status = 'Ordered'", { id: Number(req.params.id) });
  if (!r.length) throw S.bad('Only open purchase orders can be cancelled.');
  await S.audit(req.user, 'purchase.cancel', r[0].po_no, req.ip); res.json({ ok: true });
}));

// ================================================================ staff & roles
router.get('/permissions', requirePerm('staff.manage'), wrap(async (req, res) => res.json({ permissions: PERMISSIONS, roles: ROLE_PERMS })));
router.get('/users', requirePerm('staff.manage'), wrap(async (req, res) => {
  const users = await q(`SELECT u.user_id, u.name, u.email, u.phone, r.name AS role, u.active, u.discount_limit, u.commission_pct, u.loyalty_points, u.created_at, u.failed_logins, u.locked_until,
      (SELECT COUNT(*) FROM Orders o WHERE o.seller_id = u.user_id AND o.status <> 'Cancelled') AS orders,
      (SELECT COALESCE(SUM(o.total), 0) FROM Orders o WHERE o.seller_id = u.user_id AND o.status <> 'Cancelled' AND o.created_at >= DATEADD(DAY, -29, CAST(SYSUTCDATETIME() AS DATE))) AS sales_month,
      (SELECT TOP 1 clock_in FROM Attendance a WHERE a.user_id = u.user_id AND a.clock_out IS NULL) AS clocked_in
    FROM Users u JOIN Roles r ON r.role_id = u.role_id ORDER BY CASE r.name WHEN 'admin' THEN 0 WHEN 'manager' THEN 1 WHEN 'seller' THEN 2 WHEN 'tailor' THEN 3 ELSE 4 END, u.name`);
  const ov = await q('SELECT user_id, code, granted FROM UserPermissions');
  for (const u of users) { u.overrides = ov.filter(o => o.user_id === u.user_id); u.commission_month = r2(Number(u.sales_month) * Number(u.commission_pct) / 100); }
  res.json(users);
}));
router.post('/users', requirePerm('staff.manage'), wrap(async (req, res) => res.json({ ok: true, id: await S.createUser(req.user, req.body || {}, req.ip) })));
router.put('/users/:id', requirePerm('staff.manage'), wrap(async (req, res) => {
  const id = Number(req.params.id), b = req.body || {};
  const target = await one('SELECT u.user_id, u.email, r.name AS role, u.active FROM Users u JOIN Roles r ON r.role_id = u.role_id WHERE u.user_id = @id', { id });
  if (!target) throw S.notFound();
  const role = b.role ?? target.role;
  if (!ROLES[role]) throw S.bad('Invalid role.');
  if (req.user.role !== 'admin' && (target.role === 'admin' || role === 'admin')) throw S.forbidden('Only an admin can change admin accounts or grant the admin role.');
  if (id === req.user.id && (role !== target.role || b.active === false)) throw S.bad('You cannot change your own role or deactivate yourself.');
  if (target.role === 'admin' && (role !== 'admin' || b.active === false)) {
    const n = await one("SELECT COUNT(*) AS n FROM Users u JOIN Roles r ON r.role_id = u.role_id WHERE r.name = 'admin' AND u.active = 1 AND u.user_id <> @id", { id });
    if (!n.n) throw S.bad('There must be at least one active admin.');
  }
  if (b.active === false && target.role !== 'client') await q('DELETE FROM Sessions WHERE user_id = @id', { id });
  await tx(async (conn) => {
    await q(`UPDATE Users SET name = COALESCE(@n, name), phone = COALESCE(@p, phone), role_id = @r, active = COALESCE(@a, active), discount_limit = @dl, commission_pct = @cp WHERE user_id = @id`,
      { n: b.name ? str(b.name, 100) : null, p: b.phone != null ? str(b.phone, 30) : null, r: ROLES[role], a: b.active == null ? null : (b.active ? 1 : 0),
        dl: b.discountLimit === '' || b.discountLimit == null ? null : Math.min(100, Math.max(0, num(b.discountLimit))), cp: Math.min(50, Math.max(0, num(b.commissionPct))), id }, conn);
    if (Array.isArray(b.overrides)) {
      await q('DELETE FROM UserPermissions WHERE user_id = @id', { id }, conn);
      for (const o of b.overrides) if (PERMISSIONS[o.code] && req.user.role === 'admin') await q('INSERT INTO UserPermissions (user_id, code, granted) VALUES (@u, @c, @g)', { u: id, c: o.code, g: o.granted ? 1 : 0 }, conn);
    }
    if (role !== target.role) await q('DELETE FROM Sessions WHERE user_id = @id', { id }, conn);   // force re-login with the new role
    await S.audit(req.user, 'user.update', `${target.email} role=${role} active=${b.active}`, req.ip, conn);
  });
  res.json({ ok: true });
}));
router.post('/users/:id/reset', requirePerm('staff.manage'), wrap(async (req, res) => {
  const id = Number(req.params.id);
  const t = await one('SELECT r.name AS role, u.email FROM Users u JOIN Roles r ON r.role_id = u.role_id WHERE u.user_id = @id', { id });
  if (!t) throw S.notFound();
  if (t.role === 'admin' && req.user.role !== 'admin') throw S.forbidden();
  const { password, pin } = req.body || {};
  if (password) { if (String(password).length < 8) throw S.bad('Password must be at least 8 characters.'); const p = await hashSecret(password); await q('UPDATE Users SET pass_hash = @h, pass_salt = @s, failed_logins = 0, locked_until = NULL WHERE user_id = @id', { h: p.hash, s: p.salt, id }); }
  if (pin) { if (!/^\d{4,6}$/.test(String(pin))) throw S.bad('PIN must be 4-6 digits.'); const p = await hashSecret(pin); await q('UPDATE Users SET pin_hash = @h, pin_salt = @s WHERE user_id = @id', { h: p.hash, s: p.salt, id }); }
  if (!password && !pin) throw S.bad('Enter a new password or PIN.');
  await q('DELETE FROM Sessions WHERE user_id = @id', { id });
  await S.audit(req.user, 'user.reset', t.email, req.ip);
  res.json({ ok: true });
}));
router.get('/attendance', requirePerm('staff.manage'), wrap(async (req, res) => res.json(await q(`SELECT TOP 200 a.*, u.name FROM Attendance a JOIN Users u ON u.user_id = a.user_id ORDER BY a.clock_in DESC`))));

// ================================================================ promotions
const nameOf = (v) => str(v, 80);
router.get('/promos', requirePerm('promos.manage'), wrap(async (req, res) => {
  const bundles = await q('SELECT * FROM Bundles ORDER BY bundle_id');
  const cats = await q('SELECT bc.bundle_id, c.name FROM BundleCategories bc JOIN Categories c ON c.category_id = bc.category_id');
  for (const b of bundles) b.cats = cats.filter(c => c.bundle_id === b.bundle_id).map(c => c.name);
  res.json({ codes: await q('SELECT * FROM PromoCodes ORDER BY promo_id'),
    sales: await q('SELECT s.*, c.name AS category FROM SeasonalSales s LEFT JOIN Categories c ON c.category_id = s.category_id ORDER BY s.sale_id'), bundles });
}));
const pctOf = (v) => { const n = num(v); if (!(n > 0 && n <= 100)) throw S.bad('Discount % must be between 0 and 100.'); return n; };
router.post('/promos/code', requirePerm('promos.manage'), wrap(async (req, res) => {
  const code = str(req.body.code, 30).toUpperCase().replace(/[^A-Z0-9_-]/g, '');
  if (!code) throw S.bad('Enter a code (letters and numbers).');
  if (await one('SELECT 1 AS x FROM PromoCodes WHERE code = @c', { c: code })) throw S.bad('Code already exists.');
  await q('INSERT INTO PromoCodes (code, pct, note, expires_on) VALUES (@c, @p, @n, @e)', { c: code, p: pctOf(req.body.pct), n: str(req.body.note, 120), e: req.body.expires_on || null });
  await S.audit(req.user, 'promo.create', code, req.ip); res.json({ ok: true });
}));
router.put('/promos/code/:id', requirePerm('promos.manage'), wrap(async (req, res) => {
  await q('UPDATE PromoCodes SET pct = @p, note = @n, active = @a, expires_on = @e WHERE promo_id = @id', { p: pctOf(req.body.pct), n: str(req.body.note, 120), a: req.body.active ? 1 : 0, e: req.body.expires_on || null, id: Number(req.params.id) });
  await S.audit(req.user, 'promo.update', `#${req.params.id}`, req.ip); res.json({ ok: true });
}));
router.delete('/promos/code/:id', requirePerm('promos.manage'), wrap(async (req, res) => { await q('DELETE FROM PromoCodes WHERE promo_id = @id', { id: Number(req.params.id) }); await S.audit(req.user, 'promo.delete', `#${req.params.id}`, req.ip); res.json({ ok: true }); }));
router.post('/promos/sale', requirePerm('promos.manage'), wrap(async (req, res) => {
  const b = req.body || {};
  if (!nameOf(b.name) || !/^\d{4}-\d{2}-\d{2}$/.test(String(b.date_from)) || !/^\d{4}-\d{2}-\d{2}$/.test(String(b.date_to)) || b.date_to < b.date_from) throw S.bad('Name and a valid date range are required.');
  const cat = b.category && b.category !== 'All' ? await one('SELECT category_id FROM Categories WHERE name = @n', { n: String(b.category) }) : null;
  await q('INSERT INTO SeasonalSales (name, pct, category_id, date_from, date_to) VALUES (@n, @p, @c, @f, @t)', { n: nameOf(b.name), p: pctOf(b.pct), c: cat?.category_id || null, f: b.date_from, t: b.date_to });
  await S.audit(req.user, 'sale.create', b.name, req.ip); res.json({ ok: true });
}));
router.put('/promos/sale/:id', requirePerm('promos.manage'), wrap(async (req, res) => { await q('UPDATE SeasonalSales SET active = @a WHERE sale_id = @id', { a: req.body.active ? 1 : 0, id: Number(req.params.id) }); res.json({ ok: true }); }));
router.delete('/promos/sale/:id', requirePerm('promos.manage'), wrap(async (req, res) => { await q('DELETE FROM SeasonalSales WHERE sale_id = @id', { id: Number(req.params.id) }); res.json({ ok: true }); }));
router.post('/promos/bundle', requirePerm('promos.manage'), wrap(async (req, res) => {
  const b = req.body || {}, cats = [...new Set(Array.isArray(b.cats) ? b.cats : [])];
  if (!nameOf(b.name) || cats.length < 2) throw S.bad('Name and at least two categories are required.');
  await tx(async (conn) => {
    const id = (await one('INSERT INTO Bundles (name, pct) OUTPUT inserted.bundle_id AS id VALUES (@n, @p)', { n: nameOf(b.name), p: pctOf(b.pct) }, conn)).id;
    for (const c of cats) { const row = await one('SELECT category_id FROM Categories WHERE name = @n', { n: String(c) }, conn); if (!row) throw S.bad(`Unknown category ${c}.`); await q('INSERT INTO BundleCategories (bundle_id, category_id) VALUES (@b, @c)', { b: id, c: row.category_id }, conn); }
    await S.audit(req.user, 'bundle.create', b.name, req.ip, conn);
  });
  res.json({ ok: true });
}));
router.put('/promos/bundle/:id', requirePerm('promos.manage'), wrap(async (req, res) => { await q('UPDATE Bundles SET active = @a WHERE bundle_id = @id', { a: req.body.active ? 1 : 0, id: Number(req.params.id) }); res.json({ ok: true }); }));
router.delete('/promos/bundle/:id', requirePerm('promos.manage'), wrap(async (req, res) => { await q('DELETE FROM BundleCategories WHERE bundle_id = @id; DELETE FROM Bundles WHERE bundle_id = @id', { id: Number(req.params.id) }); res.json({ ok: true }); }));

router.post('/promos/broadcast', requirePerm('promos.manage'), wrap(async (req, res) => {
  const title = str(req.body.title, 120), body = str(req.body.body, 300), tier = str(req.body.tier, 10);
  if (!title || !body) throw S.bad('Enter a title and a message.');
  const min = { Silver: 500, Gold: 1500, VIP: 3000 }[tier] || 0;
  const r = await q(`INSERT INTO Notifications (user_id, title, body, type)
    SELECT u.user_id, @t, @b, 'promo' FROM Users u JOIN Roles r ON r.role_id = u.role_id WHERE r.name = 'client' AND u.active = 1 AND u.loyalty_points >= @min;
    SELECT @@ROWCOUNT AS n;`, { t: title, b: body, min });
  await S.audit(req.user, 'promo.broadcast', `${title} (${tier || 'all customers'}) -> ${r[0]?.n ?? 0}`, req.ip);
  res.json({ ok: true, sent: r[0]?.n ?? 0 });
}));

// ================================================================ settings, audit
router.get('/settings', requirePerm('settings.edit'), wrap(async (req, res) => res.json(await S.getSettings())));
router.put('/settings', requirePerm('settings.edit'), wrap(async (req, res) => {
  const b = req.body || {}, patch = {};
  const txt = (k, n) => { if (k in b) patch[k] = str(b[k], n); };
  txt('storeName', 80); txt('address', 200); txt('phone', 30); txt('receiptHeader', 60); txt('receiptFooter', 250);
  const nums = { vatPct: [0, 50], khrRate: [1, 100000], lowStock: [0, 1000], maxSellerDiscount: [0, 100], pointsPerDollar: [0, 100], pointValue: [0, 10], refundDays: [0, 365], rentalMaxDays: [1, 60], lateFeePct: [0, 500], tailorMarkupPct: [0, 300] };
  for (const [k, [lo, hi]] of Object.entries(nums)) if (k in b) { const n = num(b[k], NaN); if (!(n >= lo && n <= hi)) throw S.bad(`${k} must be between ${lo} and ${hi}.`); patch[k] = n; }
  if ('currency' in b) { if (!['USD', 'KHR'].includes(b.currency)) throw S.bad('Currency must be USD or KHR.'); patch.currency = b.currency; }
  if ('paymentMethods' in b) {
    const m = [...new Set((Array.isArray(b.paymentMethods) ? b.paymentMethods : []).map(x => str(x, 20)).filter(Boolean))];
    if (!m.includes('Cash') || !m.includes('Pay in store')) throw S.bad('Cash and "Pay in store" must stay enabled.');
    patch.paymentMethods = m;
  }
  if ('logo' in b) { if (b.logo && (!String(b.logo).startsWith('data:image/') || String(b.logo).length > 400000)) throw S.bad('Logo must be a small image (under ~250 KB).'); patch.logo = b.logo || ''; }
  await S.saveSettings(patch);
  await S.audit(req.user, 'settings.update', Object.keys(patch).join(', '), req.ip);
  res.json({ ok: true });
}));
router.get('/audit', requirePerm('audit.view'), wrap(async (req, res) => {
  const where = ['1=1'], p = {};
  if (req.query.user) { where.push('user_name LIKE @u'); p.u = `%${str(req.query.user, 50)}%`; }
  if (req.query.action) { where.push('action LIKE @a'); p.a = `%${str(req.query.action, 40)}%`; }
  if (req.query.from) { where.push('at >= @f'); p.f = String(req.query.from); }
  if (req.query.to) { where.push('at < DATEADD(DAY, 1, CAST(@t AS DATE))'); p.t = String(req.query.to); }
  res.json(await q(`SELECT TOP 500 * FROM AuditLog WHERE ${where.join(' AND ')} ORDER BY audit_id DESC`, p));
}));

module.exports = router;
