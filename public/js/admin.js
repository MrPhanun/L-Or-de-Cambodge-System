'use strict';
/* ADMIN VIEW (owner / manager): dashboard, products, inventory & purchasing, orders, tailoring, rentals, customers, staff, promotions, reports, settings, activity log.
   Which screens appear depends on the signed-in user's permissions (managers get a subset). */

const ROLES = ['admin', 'manager', 'seller', 'tailor', 'client'];
const sub = (box) => { const d = document.createElement('div'); box.appendChild(d); return d; };
const tabsBar = (tabs, cur) => H`<div class="tabs">${tabs.map(([id, label]) => H`<button class="${id === cur ? 'active' : ''}" data-act="tab" data-t="${id}">${label}</button>`)}</div>`;

/** Reads an image file, scales it down and returns a data URL (so uploads stay small). */
function fileToDataUrl(file, max = 600, quality = .82) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) return reject(new Error('Please choose an image file.'));
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => { const k = Math.min(1, max / Math.max(img.width, img.height)), c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url); resolve(c.toDataURL('image/jpeg', quality)); };
    img.onerror = () => reject(new Error('Could not read that image.')); img.src = url;
  });
}

// ---------------------------------------------------------------- DASHBOARD
async function viewDashboard(box, ctx) {
  const d = await api.get('/api/admin/dashboard');
  render(box, H`<div class="stack"><div class="grid g4"><div class="kpi"><div class="l">Revenue today</div><div class="v">${money(d.revenue_today)}</div><div class="s">${d.orders_today} orders</div></div>
    <div class="kpi"><div class="l">Last 7 days</div><div class="v">${money(d.revenue_week)}</div></div><div class="kpi"><div class="l">Last 30 days</div><div class="v">${money(d.revenue_month)}</div></div>
    <div class="kpi"><div class="l">Open orders</div><div class="v">${d.open_orders}</div><div class="s">${d.customers} customers</div></div></div>
    <div class="grid g4"><a class="kpi" href="#/rentals"><div class="l">Overdue rentals</div><div class="v ${d.overdue_rentals ? 'bad' : ''}">${d.overdue_rentals}</div></a><a class="kpi" href="#/tailoring"><div class="l">Open alterations</div><div class="v">${d.open_alterations}</div></a>
      <div class="kpi"><div class="l">Fittings today</div><div class="v">${d.appointments_today}</div></div><a class="kpi" href="#/inventory"><div class="l">Low-stock items</div><div class="v ${d.low.length ? 'warn' : ''}">${d.low.length}</div></a></div>
    <div class="card"><h2>Sales, last 14 days</h2>${barChart(d.daily.map(x => ({ label: ymd(x.day).slice(5), value: Number(x.total) })), { fmt: money })}</div>
    <div class="grid g2"><div class="card"><h2>Top products</h2>${hbars(d.top.map(t => ({ label: t.name, value: Number(t.qty) })), (v) => v + ' sold')}</div>
      <div class="card"><div class="row between"><h2>Low-stock alerts</h2><a href="#/inventory">Inventory</a></div>${d.low.length ? H`<div class="table-wrap"><table><tbody>${d.low.map(l => H`<tr><td>${l.name}</td><td>${l.size}</td><td class="num">${l.stock <= 0 ? H`<span class="badge bad">Out</span>` : H`<span class="badge warn">${l.stock} left</span>`}</td></tr>`)}</tbody></table></div>` : H`<div class="empty">Stock levels look healthy.</div>`}</div></div></div>`);
}

// ---------------------------------------------------------------- PRODUCTS & CATEGORIES
async function viewProducts(box, ctx) {
  const [list, cats] = await Promise.all([api.get('/api/admin/products'), api.get('/api/admin/categories')]);
  const f = { q: '', cat: '', show: 'active' };
  const draw = () => {
    const rows = list.filter(p => (!f.q || `${p.name} ${p.sku}`.toLowerCase().includes(f.q.toLowerCase())) && (!f.cat || p.category === f.cat) && (f.show === 'all' || (f.show === 'active') === !!p.active));
    render($('#pt', box), rows.length ? H`<div class="table-wrap"><table><thead><tr><th></th><th>Product</th><th>Category</th><th class="num">Price</th><th class="num">Cost</th><th class="num">Margin</th><th class="num">Stock</th><th>Status</th><th></th></tr></thead><tbody>${rows.map(p => { const st = p.variants.reduce((s, v) => s + v.stock, 0);
      return H`<tr><td style="width:54px"><div style="width:44px;height:46px;border-radius:8px;overflow:hidden;background:#0a0d15">${art(p)}</div></td><td><b>${p.name}</b><div class="hint">${p.sku} &middot; ${p.color_name} &middot; ${p.fabric} &middot; ${p.fit}${p.rent_per_day > 0 ? ' &middot; rentable' : ''}${p.tailorable ? ' &middot; tailorable' : ''}</div></td><td>${p.category}</td><td class="num">${usd(p.price)}</td><td class="num">${usd(p.cost)}</td>
        <td class="num">${p.price ? Math.round((p.price - p.cost) / p.price * 100) : 0}%</td><td class="num">${st}</td><td>${p.active ? H`<span class="badge ok">Active</span>` : H`<span class="badge">Archived</span>`}</td>
        <td class="row"><button class="btn sm" data-act="edit" data-id="${p.product_id}">Edit</button><button class="btn sm danger" data-act="del" data-id="${p.product_id}">Delete</button></td></tr>`; })}</tbody></table></div>` : H`<div class="empty card">No products found.</div>`);
  };
  render(box, H`<div class="toolbar"><input class="grow" id="pq" placeholder="Search name or SKU..."><select id="pc"><option value="">All categories</option>${cats.map(c => H`<option>${c.name}</option>`)}</select><select id="ps"><option value="active">Active</option><option value="archived">Archived</option><option value="all">All</option></select>
    <button class="btn" data-act="cats">Categories</button><button class="btn primary" data-act="add">+ Add product</button></div><div id="pt"></div>`); draw();
  box.addEventListener('input', (e) => { if (e.target.id === 'pq') { f.q = e.target.value; draw(); } });
  box.addEventListener('change', (e) => { if (e.target.id === 'pc') f.cat = e.target.value; else if (e.target.id === 'ps') f.show = e.target.value; else return; draw(); });
  bind(box, { click: { add: () => productForm(null, cats, ctx), edit: (t) => productForm(list.find(p => p.product_id === Number(t.dataset.id)), cats, ctx), cats: () => categoriesDialog(ctx),
    del: async (t) => { const p = list.find(x => x.product_id === Number(t.dataset.id)); if (!(await confirmBox(`Delete "${p.name}"? Products that have been sold are archived instead so history stays intact.`, { danger: true, okText: 'Delete' }))) return;
      const r = await api.del('/api/admin/products/' + p.product_id); toast(r.archived ? 'Product archived (it has sales history)' : 'Product deleted', 'ok'); ctx.refresh(); } } });
}
function productForm(p, cats, ctx) {
  const isNew = !p; p = p || { name: '', sku: 'LDC-' + (2000 + Math.floor(Math.random() * 900)), barcode: '', category: cats[0]?.name, fabric: 'Wool', fit: 'Regular', color_name: '', color_hex: '#1d2a52', price: '', cost: '', rent_per_day: 0, rent_deposit: 0, description: '', tailorable: false, active: true, variants: [] };
  let variants = p.variants.map(v => ({ size: v.size, stock: v.stock, existing: true })), image = null;
  const f = (k, v = p[k]) => v ?? '';
  const m = modal({ title: isNew ? 'Add product' : `Edit ${p.name}`, size: 'wide', body: H`<form data-act="save" class="stack"><div class="grid g2">
    <label class="f"><span>Name</span><input name="name" value="${f('name')}" required maxlength="150"></label><label class="f"><span>SKU</span><input name="sku" value="${f('sku')}" required maxlength="30"></label>
    <label class="f"><span>Category</span><select name="category">${cats.map(c => H`<option ${c.name === p.category ? 'selected' : ''}>${c.name}</option>`)}</select></label><label class="f"><span>Barcode</span><input name="barcode" value="${f('barcode')}" maxlength="30"></label>
    <label class="f"><span>Fabric</span><select name="fabric">${['Wool', 'Linen', 'Cotton', 'Velvet', 'Silk', 'Tweed', 'Leather'].map(x => H`<option ${x === p.fabric ? 'selected' : ''}>${x}</option>`)}</select></label>
    <label class="f"><span>Fit</span><select name="fit">${['Slim', 'Regular', 'Classic'].map(x => H`<option ${x === p.fit ? 'selected' : ''}>${x}</option>`)}</select></label>
    <label class="f"><span>Color name</span><input name="color_name" value="${f('color_name')}" maxlength="40"></label><label class="f"><span>Color</span><input type="color" name="color_hex" value="${f('color_hex')}"></label>
    <label class="f"><span>Price (USD)</span><input type="number" name="price" min="0" step="0.01" value="${f('price')}" required></label><label class="f"><span>Cost (USD)</span><input type="number" name="cost" min="0" step="0.01" value="${f('cost')}" required></label>
    <label class="f"><span>Rent per day (0 = not rentable)</span><input type="number" name="rent_per_day" min="0" step="0.01" value="${f('rent_per_day')}"></label><label class="f"><span>Rental deposit</span><input type="number" name="rent_deposit" min="0" step="0.01" value="${f('rent_deposit')}"></label></div>
    <label class="f"><span>Description</span><textarea name="description" maxlength="600">${f('description')}</textarea></label>
    <div class="row"><label class="chk"><input type="checkbox" name="tailorable" ${p.tailorable ? 'checked' : ''}> Available as made-to-measure</label><label class="chk"><input type="checkbox" name="active" ${p.active ? 'checked' : ''}> Active (visible in shop)</label></div>
    <div class="row"><div style="width:90px;height:94px;border-radius:10px;overflow:hidden;background:#0a0d15" id="prev">${art(p)}</div><div class="grow"><label class="f"><span>Product image (optional, replaces the generated picture)</span><input type="file" accept="image/*" id="img"></label></div></div>
    <div><div class="row between"><b>Sizes &amp; stock</b><div class="row"><button type="button" class="btn sm" data-act="fill">Use category sizes</button><button type="button" class="btn sm" data-act="addsize">+ Size</button></div></div><div id="vars" class="stack-sm" style="margin-top:8px"></div>
      <div class="hint">${isNew ? 'Set the opening stock for each size.' : 'Existing stock is changed from the Inventory page (so every change is logged). You can add or remove sizes here.'}</div></div>
    <div class="row" style="justify-content:flex-end"><button type="button" class="btn" data-act="close">Cancel</button><button class="btn primary">Save product</button></div></form>` });
  const drawVars = () => render($('#vars', m.el), variants.length ? variants.map((v, i) => H`<div class="row"><input data-i="${i}" data-k="size" value="${v.size}" placeholder="Size" style="width:130px" ${v.existing ? 'disabled' : ''}><input type="number" data-i="${i}" data-k="stock" value="${v.stock}" min="0" style="width:110px" ${v.existing ? 'disabled' : ''} title="${v.existing ? 'Change via Inventory' : 'Opening stock'}"><button type="button" class="btn sm danger" data-act="rmsize" data-i="${i}">Remove</button></div>`) : H`<div class="muted small">No sizes yet.</div>`);
  drawVars();
  m.el.addEventListener('input', (e) => { const i = e.target.dataset.i; if (i === undefined) return; variants[i][e.target.dataset.k] = e.target.dataset.k === 'stock' ? Number(e.target.value) : e.target.value; });
  $('#img', m.el).addEventListener('change', async (e) => { try { image = await fileToDataUrl(e.target.files[0], 700); render($('#prev', m.el), raw(`<img src="${image}" alt="" style="width:100%;height:100%;object-fit:cover">`)); } catch (err) { toast(err.message, 'bad'); } });
  bind(m.el, { click: { addsize: () => { variants.push({ size: '', stock: 0, existing: false }); drawVars(); }, rmsize: (t) => { variants.splice(Number(t.dataset.i), 1); drawVars(); },
    fill: () => { const c = cats.find(x => x.name === $('select[name=category]', m.el).value); for (const s of c.sizes.split(',')) if (!variants.some(v => v.size === s)) variants.push({ size: s, stock: 0, existing: false }); drawVars(); } },
    submit: { save: async (fm) => { const d = formData(fm); const body = { ...d, tailorable: fm.tailorable.checked, active: fm.active.checked, variants: variants.filter(v => String(v.size).trim()).map(v => ({ size: v.size, stock: v.stock })) };
      if (image) body.image_url = image; if (isNew) await api.post('/api/admin/products', body); else await api.put('/api/admin/products/' + p.product_id, body); toast('Product saved', 'ok'); m.close(); ctx.refresh(); } } });
}
async function categoriesDialog(ctx) {
  const cats = await api.get('/api/admin/categories');
  const m = modal({ title: 'Categories', size: 'wide', body: H`<div class="stack"><div class="table-wrap"><table><thead><tr><th>Name</th><th>Default sizes (comma separated)</th><th class="num">Products</th><th></th></tr></thead><tbody>${cats.map(c => H`<tr><td><input data-id="${c.category_id}" data-k="name" value="${c.name}"></td><td><input data-id="${c.category_id}" data-k="sizes" value="${c.sizes}"></td><td class="num">${c.products}</td>
    <td class="row"><button class="btn sm" data-act="save" data-id="${c.category_id}">Save</button><button class="btn sm danger" data-act="del" data-id="${c.category_id}" ${c.products ? 'disabled' : ''}>Delete</button></td></tr>`)}</tbody></table></div>
    <form data-act="add" class="row"><input name="name" placeholder="New category" required class="grow"><input name="sizes" placeholder="Sizes e.g. S,M,L" class="grow"><button class="btn primary">Add</button></form></div>` });
  bind(m.el, { click: { save: async (t) => { const r = t.closest('tr'); await api.put('/api/admin/categories/' + t.dataset.id, { name: $('[data-k=name]', r).value, sizes: $('[data-k=sizes]', r).value }); toast('Saved', 'ok'); },
    del: async (t) => { if (await confirmBox('Delete this category?', { danger: true })) { await api.del('/api/admin/categories/' + t.dataset.id); m.close(); categoriesDialog(ctx); } } },
    submit: { add: async (f) => { await api.post('/api/admin/categories', formData(f)); toast('Category added', 'ok'); m.close(); categoriesDialog(ctx); } } });
}

// ---------------------------------------------------------------- INVENTORY (stock, movements, suppliers, purchase orders)
async function viewInventory(box, ctx) {
  const canEdit = ctx.can('inventory.edit');
  let tab = 'stock'; const f = { q: '', low: false, cat: '' };
  const draw = async () => {
    render(box, H`${tabsBar([['stock', 'Stock levels'], ['moves', 'Movements'], ...(canEdit ? [['sup', 'Suppliers'], ['po', 'Purchase orders']] : [])], tab)}<div id="tb"></div>`);
    const t = $('#tb', box);
    if (tab === 'stock') {
      const inv = await api.get('/api/admin/inventory'), cats = [...new Set(inv.map(v => v.category))];
      const low = ctx.settings.lowStock;
      const value = inv.reduce((s, v) => s + v.stock * (v.cost || 0), 0), retail = inv.reduce((s, v) => s + v.stock * v.price, 0);
      const rows = inv.filter(v => (!f.q || `${v.name} ${v.sku} ${v.barcode || ''}`.toLowerCase().includes(f.q.toLowerCase())) && (!f.cat || v.category === f.cat) && (!f.low || v.stock <= low));
      render(t, H`<div class="grid g3" style="margin-bottom:12px"><div class="kpi"><div class="l">Units in stock</div><div class="v">${inv.reduce((s, v) => s + v.stock, 0)}</div></div>${inv[0] && 'cost' in inv[0] ? H`<div class="kpi"><div class="l">Inventory value (cost)</div><div class="v">${money(value)}</div></div><div class="kpi"><div class="l">Retail value</div><div class="v">${money(retail)}</div><div class="s">potential profit ${money(retail - value)}</div></div>` : ''}</div>
        <div class="toolbar"><input class="grow" id="iq" value="${f.q}" placeholder="Search name, SKU, barcode..."><select id="ic"><option value="">All categories</option>${cats.map(c => H`<option ${c === f.cat ? 'selected' : ''}>${c}</option>`)}</select><label class="chk"><input type="checkbox" id="il" ${f.low ? 'checked' : ''}> Low stock only (${low} or less)</label></div>
        <div class="table-wrap"><table><thead><tr><th>Product</th><th>Size</th><th>SKU</th><th class="num">Stock</th>${canEdit ? H`<th class="num">Cost</th><th></th>` : ''}</tr></thead><tbody>${rows.map(v => H`<tr><td>${v.name}</td><td>${v.size}</td><td class="muted small">${v.sku}</td><td class="num"><span class="badge ${v.stock <= 0 ? 'bad' : v.stock <= low ? 'warn' : 'ok'}">${v.stock}</span></td>${canEdit ? H`<td class="num">${usd(v.cost)}</td><td><button class="btn sm" data-act="adj" data-id="${v.variant_id}">Adjust</button></td>` : ''}</tr>`)}</tbody></table></div>`);
      t.__inv = inv;
    } else if (tab === 'moves') {
      const mv = await api.get('/api/admin/movements');
      render(t, H`<div class="table-wrap"><table><thead><tr><th>When</th><th>Product</th><th>Size</th><th class="num">Qty</th><th>Type</th><th>Ref</th><th>By</th></tr></thead><tbody>${mv.map(x => H`<tr><td>${fdt(x.at)}</td><td>${x.name}</td><td>${x.size}</td><td class="num ${x.qty < 0 ? 'bad' : 'ok'}">${x.qty > 0 ? '+' : ''}${x.qty}</td><td><span class="badge">${x.type}</span></td><td class="small muted">${x.ref || ''}</td><td class="small">${x.user_name || ''}</td></tr>`)}</tbody></table></div>`);
    } else if (tab === 'sup') {
      const sup = await api.get('/api/admin/suppliers');
      render(t, H`<div class="row between" style="margin-bottom:12px"><span class="muted">${sup.length} suppliers</span><button class="btn primary" data-act="addsup">+ Supplier</button></div><div class="table-wrap"><table><thead><tr><th>Name</th><th>Phone</th><th>Email</th><th></th></tr></thead><tbody>${sup.map(s => H`<tr><td><b>${s.name}</b></td><td>${s.phone || ''}</td><td>${s.email || ''}</td><td class="row"><button class="btn sm" data-act="editsup" data-id="${s.supplier_id}">Edit</button><button class="btn sm danger" data-act="delsup" data-id="${s.supplier_id}">Delete</button></td></tr>`)}</tbody></table></div>`);
      t.__sup = sup;
    } else {
      const pos = await api.get('/api/admin/purchases');
      render(t, H`<div class="row between" style="margin-bottom:12px"><span class="muted">${pos.filter(p => p.status === 'Ordered').length} open</span><button class="btn primary" data-act="newpo">+ Purchase order</button></div>
        ${pos.length ? pos.map(p => H`<div class="card" style="margin-bottom:10px"><div class="row between"><div><b>${p.po_no}</b> <span class="muted small">${p.supplier_name} &middot; ${fdate(p.created_at)} &middot; ${p.by_name || ''}</span></div><div class="row"><span class="badge ${p.status === 'Received' ? 'ok' : p.status === 'Cancelled' ? 'bad' : 'warn'}">${p.status}</span><b>${usd(p.total)}</b>
          ${p.status === 'Ordered' ? H`<button class="btn sm primary" data-act="recv" data-id="${p.po_id}">Receive stock</button><button class="btn sm danger" data-act="cancelpo" data-id="${p.po_id}">Cancel</button>` : ''}</div></div>
          <div class="small muted">${p.items.map(i => `${i.qty} x ${i.name} (${i.size}) @ ${usd(i.unit_cost)}`).join(' | ')}</div></div>`) : H`<div class="empty card">No purchase orders yet.</div>`}`);
    }
  };
  box.addEventListener('input', (e) => { if (e.target.id === 'iq') { f.q = e.target.value; clearTimeout(box.__tm); box.__tm = setTimeout(draw, 200); } });
  box.addEventListener('change', (e) => { if (e.target.id === 'ic') f.cat = e.target.value; else if (e.target.id === 'il') f.low = e.target.checked; else return; draw(); });
  bind(box, { click: { tab: (t) => { tab = t.dataset.t; draw(); },
    adj: (t) => { const v = $('#tb', box).__inv.find(x => x.variant_id === Number(t.dataset.id));
      const m = modal({ title: 'Adjust stock', size: 'narrow', body: H`<form data-act="go" class="stack-sm"><div><b>${v.name}</b> - size ${v.size}<div class="muted small">Current stock: ${v.stock}</div></div><label class="f"><span>Change (use - to remove)</span><input type="number" name="delta" step="1" required></label>
        <label class="f"><span>Reason</span><select name="reason"><option>Stock count correction</option><option>Damaged</option><option>Lost / stolen</option><option>Returned to supplier</option><option>Found</option></select></label><button class="btn primary">Apply</button></form>` });
      bind(m.el, { submit: { go: async (fm) => { await api.post('/api/admin/inventory/adjust', { variantId: v.variant_id, ...formData(fm) }); toast('Stock updated', 'ok'); m.close(); draw(); } } }); },
    addsup: () => supplierForm(null, draw), editsup: (t) => supplierForm($('#tb', box).__sup.find(s => s.supplier_id === Number(t.dataset.id)), draw),
    delsup: async (t) => { if (await confirmBox('Delete this supplier?', { danger: true })) { await api.del('/api/admin/suppliers/' + t.dataset.id); draw(); } },
    newpo: () => poForm(draw), recv: async (t) => { if (await confirmBox('Receive this order and add the stock?')) { await api.post(`/api/admin/purchases/${t.dataset.id}/receive`); toast('Stock received', 'ok'); draw(); } },
    cancelpo: async (t) => { if (await confirmBox('Cancel this purchase order?', { danger: true })) { await api.post(`/api/admin/purchases/${t.dataset.id}/cancel`); draw(); } } } });
  await draw();
}
function supplierForm(s, done) {
  const m = modal({ title: s ? 'Edit supplier' : 'New supplier', size: 'narrow', body: H`<form data-act="go" class="stack-sm"><label class="f"><span>Name</span><input name="name" value="${s?.name || ''}" required></label><label class="f"><span>Phone</span><input name="phone" value="${s?.phone || ''}"></label><label class="f"><span>Email</span><input name="email" value="${s?.email || ''}"></label><button class="btn primary">Save</button></form>` });
  bind(m.el, { submit: { go: async (f) => { if (s) await api.put('/api/admin/suppliers/' + s.supplier_id, formData(f)); else await api.post('/api/admin/suppliers', formData(f)); m.close(); done(); } } });
}
async function poForm(done) {
  const [sup, inv] = await Promise.all([api.get('/api/admin/suppliers'), api.get('/api/admin/inventory')]); const lines = [];
  const m = modal({ title: 'New purchase order', size: 'wide', body: H`<form data-act="go" class="stack"><label class="f"><span>Supplier</span><select name="supplierId">${sup.map(s => H`<option value="${s.supplier_id}">${s.name}</option>`)}</select></label>
    <div class="row"><select id="pv" class="grow">${inv.map(v => H`<option value="${v.variant_id}">${v.name} - ${v.size} (stock ${v.stock})</option>`)}</select><input type="number" id="pqn" min="1" value="10" style="width:90px"><input type="number" id="pcost" min="0" step="0.01" placeholder="Unit cost" style="width:110px"><button type="button" class="btn" data-act="addl">Add line</button></div>
    <div id="pl"></div><label class="f"><span>Note</span><input name="note" maxlength="200"></label><button class="btn primary">Create purchase order</button></form>` });
  const draw = () => render($('#pl', m.el), lines.length ? H`<div class="table-wrap"><table><tbody>${lines.map((l, i) => H`<tr><td>${l.label}</td><td class="num">${l.qty}</td><td class="num">${usd(l.unitCost)}</td><td class="num">${usd(l.qty * l.unitCost)}</td><td><button type="button" class="btn sm danger" data-act="rml" data-i="${i}">x</button></td></tr>`)}</tbody></table></div><div class="right"><b>Total ${usd(lines.reduce((s, l) => s + l.qty * l.unitCost, 0))}</b></div>` : H`<div class="muted small">No lines yet.</div>`);
  draw();
  const sel = $('#pv', m.el), cost = $('#pcost', m.el); const setCost = () => { const v = inv.find(x => x.variant_id === Number(sel.value)); cost.value = v?.cost ?? ''; }; setCost(); sel.addEventListener('change', setCost);
  bind(m.el, { click: { addl: () => { const v = inv.find(x => x.variant_id === Number(sel.value)); const qty = Math.floor(Number($('#pqn', m.el).value)), c = Number(cost.value); if (!(qty > 0) || !(c >= 0)) throw new Error('Enter a quantity and a unit cost.'); lines.push({ variantId: v.variant_id, label: `${v.name} (${v.size})`, qty, unitCost: c }); draw(); },
    rml: (t) => { lines.splice(Number(t.dataset.i), 1); draw(); } }, submit: { go: async (f) => { await api.post('/api/admin/purchases', { ...formData(f), items: lines.map(l => ({ variantId: l.variantId, qty: l.qty, unitCost: l.unitCost })) }); toast('Purchase order created', 'ok'); m.close(); done(); } } });
}

// ---------------------------------------------------------------- TAILORING (custom orders, workload, alterations)
async function viewTailoring(box, ctx) {
  const [orders, alts, team] = await Promise.all([api.get('/api/orders?kind=tailor'), api.get('/api/alterations'), api.get('/api/team')]);
  const tailors = team.filter(t => ['tailor', 'seller', 'manager', 'admin'].includes(t.role));
  let tab = 'custom';
  const draw = () => {
    render(box, H`<div class="stack"><div class="card"><h2>Tailor workload</h2><div class="grid g4">${tailors.filter(t => t.role === 'tailor' || orders.some(o => o.tailor_id === t.user_id) || alts.some(a => a.tailor_id === t.user_id)).map(t => { const o = orders.filter(x => x.tailor_id === t.user_id && ['Pending', 'Tailoring'].includes(x.status)).length, a = alts.filter(x => x.tailor_id === t.user_id && ['Received', 'In Progress'].includes(x.status)).length;
      return H`<div class="kpi"><div class="l">${t.name}</div><div class="v">${o + a}</div><div class="s">${o} custom &middot; ${a} alterations</div></div>`; })}
      <div class="kpi"><div class="l">Unassigned</div><div class="v warn">${orders.filter(x => !x.tailor_id && ['Pending', 'Tailoring'].includes(x.status)).length + alts.filter(x => !x.tailor_id && ['Received', 'In Progress'].includes(x.status)).length}</div></div></div></div>
      ${tabsBar([['custom', `Custom orders (${orders.length})`], ['alt', `Alterations (${alts.length})`]], tab)}<div id="tt"></div></div>`);
    if (tab === 'custom') render($('#tt', box), orders.length ? H`<div class="table-wrap"><table><thead><tr><th>Order</th><th>Customer</th><th>Garment</th><th>Status</th><th>Tailor</th><th></th></tr></thead><tbody>${orders.map(o => H`<tr><td><b>${o.order_no}</b><div class="hint">${fdate(o.created_at)}</div></td><td>${o.customer_name}</td><td class="small">${o.items.filter(i => i.kind === 'tailor').map(i => H`<b>${i.name}</b><div class="muted">${i.tailor_fabric}, ${i.tailor_fit}${i.tailor_style ? ', ' + i.tailor_style : ''} ${i.tailor_notes ? '- ' + i.tailor_notes : ''}</div>`)}</td><td>${badge(o.status)}</td>
      <td><select data-act="assign" data-id="${o.order_id}" style="width:auto"><option value="">Unassigned</option>${tailors.map(t => H`<option value="${t.user_id}" ${t.user_id === o.tailor_id ? 'selected' : ''}>${t.name}</option>`)}</select></td><td class="row"><button class="btn sm" data-act="open" data-id="${o.order_id}">Open</button>${o.status === 'Pending' ? H`<button class="btn sm primary" data-act="st" data-id="${o.order_id}" data-s="Tailoring">Start tailoring</button>` : ''}${o.status === 'Tailoring' ? H`<button class="btn sm primary" data-act="st" data-id="${o.order_id}" data-s="Ready">Mark ready</button>` : ''}</td></tr>`)}</tbody></table></div>` : H`<div class="empty card">No custom tailoring orders yet.</div>`);
    else viewAlterations(sub($('#tt', box)), ctx);
  };
  draw();
  bind(box, { click: { tab: (t) => { tab = t.dataset.t; draw(); }, open: (t) => orderDialog(Number(t.dataset.id), ctx, () => ctx.refresh()), st: async (t) => { await api.post(`/api/orders/${t.dataset.id}/status`, { status: t.dataset.s }); toast('Updated', 'ok'); ctx.refresh(); } },
    change: { assign: async (t) => { await api.post(`/api/orders/${t.dataset.id}/assign-tailor`, { tailorId: t.value || null }); toast('Assigned', 'ok'); } } });
}

// ---------------------------------------------------------------- RENTALS (schedule + rental catalogue)
async function viewRentalsAdmin(box, ctx) {
  let tab = 'sched';
  const draw = async () => {
    render(box, H`${tabsBar([['sched', 'Rentals & schedule'], ['cat', 'Rental items']], tab)}<div id="rt"></div>`);
    if (tab === 'sched') await viewRentals(sub($('#rt', box)), ctx);
    else { const ps = (await api.get('/api/admin/products')).filter(p => p.rent_per_day > 0);
      render($('#rt', box), H`<div class="table-wrap"><table><thead><tr><th>Item</th><th class="num">Per day</th><th class="num">Deposit</th><th class="num">Units available</th><th></th></tr></thead><tbody>${ps.map(p => H`<tr><td><b>${p.name}</b><div class="hint">${p.sku}</div></td><td class="num">${usd(p.rent_per_day)}</td><td class="num">${usd(p.rent_deposit)}</td><td class="num">${p.variants.reduce((s, v) => s + v.stock, 0)}</td><td>${ctx.can('products.edit') ? H`<a class="btn sm" href="#/products">Edit in Products</a>` : ''}</td></tr>`)}</tbody></table></div><div class="hint" style="margin-top:8px">Set the daily rate and deposit on each product (Products &gt; Edit). Maximum rental length and late fee % are in Settings.</div>`); }
  };
  bind(box, { click: { tab: (t) => { tab = t.dataset.t; draw(); } } });
  await draw();
}

// ---------------------------------------------------------------- CUSTOMERS
async function viewCustomersAdmin(box, ctx) {
  const list = await api.get('/api/customers');
  const tier = (p) => p >= 3000 ? 'VIP' : p >= 1500 ? 'Gold' : p >= 500 ? 'Silver' : 'Member';
  const counts = { Member: 0, Silver: 0, Gold: 0, VIP: 0 }; list.forEach(c => counts[tier(c.loyalty_points)]++);
  render(box, H`<div class="stack"><div class="grid g4">${Object.entries(counts).map(([k, v]) => H`<div class="kpi"><div class="l">${k}</div><div class="v">${v}</div><div class="s">${{ Member: 'under 500 points', Silver: '500+ points', Gold: '1,500+ points', VIP: '3,000+ points' }[k]}</div></div>`)}</div>
    <div class="alert small">Loyalty: ${ctx.settings.pointsPerDollar} point per $1 spent; 100 points = ${usd(100 * ctx.settings.pointValue)}. ${ctx.can('settings.edit') ? 'Change this in Settings.' : ''}</div><div id="cu"></div></div>`);
  await viewCustomers(sub($('#cu', box)), ctx);
}

// ---------------------------------------------------------------- STAFF
async function viewStaff(box, ctx) {
  let tab = 'team';
  const draw = async () => {
    render(box, H`${tabsBar([['team', 'Team & permissions'], ['att', 'Attendance & shifts'], ['com', 'Commission']], tab)}<div id="st"></div>`);
    const t = $('#st', box);
    if (tab === 'team') {
      const users = await api.get('/api/admin/users'), pm = await api.get('/api/admin/permissions'); t.__users = users; t.__pm = pm;
      render(t, H`<div class="toolbar"><select id="rf"><option value="">All roles</option>${ROLES.map(r => H`<option>${r}</option>`)}</select><span class="grow"></span><button class="btn primary" data-act="newu">+ Add user</button></div><div id="ut"></div>`);
      const drawUsers = (role = '') => render($('#ut', t), H`<div class="table-wrap"><table><thead><tr><th>Name</th><th>Role</th><th class="num">Discount limit</th><th class="num">Commission</th><th>Status</th><th></th></tr></thead><tbody>${users.filter(u => !role || u.role === role).map(u => H`<tr><td><b>${u.name}</b><div class="hint">${u.email}</div></td><td><span class="badge ${u.role === 'admin' ? 'gold' : u.role === 'client' ? '' : 'info'}">${u.role}</span></td>
        <td class="num">${u.role === 'client' ? '-' : (u.discount_limit ?? ctx.settings.maxSellerDiscount) + '%'}</td><td class="num">${u.role === 'client' ? '-' : u.commission_pct + '%'}</td><td>${u.active ? (u.locked_until && new Date(u.locked_until) > new Date() ? H`<span class="badge bad">Locked</span>` : u.clocked_in ? H`<span class="badge ok">Clocked in</span>` : H`<span class="badge ok">Active</span>`) : H`<span class="badge bad">Disabled</span>`}${u.overrides.length ? H` <span class="badge gold">custom perms</span>` : ''}</td>
        <td class="row"><button class="btn sm" data-act="editu" data-id="${u.user_id}">Edit</button><button class="btn sm" data-act="resetu" data-id="${u.user_id}">Reset password / PIN</button></td></tr>`)}</tbody></table></div>`);
      drawUsers(); t.addEventListener('change', (e) => { if (e.target.id === 'rf') drawUsers(e.target.value); });
    } else if (tab === 'att') {
      const [att, rep] = await Promise.all([api.get('/api/admin/attendance'), ctx.can('reports.view') ? api.get(`/api/admin/reports?from=${addDays(-30)}&to=${todayStr()}`) : { shifts: [] }]);
      render(t, H`<div class="grid g2" style="align-items:start"><div class="card"><h2>Clock-in / clock-out</h2><div class="table-wrap"><table><thead><tr><th>Staff</th><th>In</th><th>Out</th><th class="num">Hours</th></tr></thead><tbody>${att.slice(0, 40).map(a => H`<tr><td>${a.name}</td><td>${fdt(a.clock_in)}</td><td>${a.clock_out ? fdt(a.clock_out) : H`<span class="badge ok">On shift</span>`}</td><td class="num">${a.clock_out ? ((new Date(a.clock_out) - new Date(a.clock_in)) / 36e5).toFixed(1) : '-'}</td></tr>`)}</tbody></table></div></div>
        <div class="card"><h2>Cash shifts (30 days)</h2>${rep.shifts.length ? H`<div class="table-wrap"><table><thead><tr><th>Cashier</th><th>Opened</th><th class="num">Expected</th><th class="num">Counted</th><th class="num">Variance</th></tr></thead><tbody>${rep.shifts.map(s => H`<tr><td>${s.user_name}</td><td>${fdt(s.opened_at)}</td><td class="num">${s.closed_at ? usd(s.expected) : '-'}</td><td class="num">${s.closed_at ? usd(s.counted) : H`<span class="badge warn">Open</span>`}</td><td class="num ${Number(s.variance) < 0 ? 'bad' : Number(s.variance) > 0 ? 'warn' : 'ok'}">${s.closed_at ? usd(s.variance) : ''}</td></tr>`)}</tbody></table></div>` : H`<div class="empty">No shifts.</div>`}</div></div>`);
    } else {
      const users = (await api.get('/api/admin/users')).filter(u => ['seller', 'manager', 'admin', 'tailor'].includes(u.role) && u.commission_pct > 0 || u.orders > 0 && u.role !== 'client');
      render(t, H`<div class="table-wrap"><table><thead><tr><th>Staff</th><th>Role</th><th class="num">Orders (all time)</th><th class="num">Sales (30 days)</th><th class="num">Rate</th><th class="num">Commission (30 days)</th></tr></thead><tbody>${users.map(u => H`<tr><td><b>${u.name}</b></td><td>${u.role}</td><td class="num">${u.orders}</td><td class="num">${usd(u.sales_month)}</td><td class="num">${u.commission_pct}%</td><td class="num gold">${usd(u.commission_month)}</td></tr>`)}</tbody></table></div><div class="hint" style="margin-top:8px">Estimated on gross sales; refunds are not deducted here. Rates are set per person in Team &gt; Edit.</div>`);
    }
  };
  bind(box, { click: { tab: (x) => { tab = x.dataset.t; draw(); },
    newu: () => userForm(null, $('#st', box).__pm, ctx), editu: (x) => userForm($('#st', box).__users.find(u => u.user_id === Number(x.dataset.id)), $('#st', box).__pm, ctx),
    resetu: (x) => { const u = $('#st', box).__users.find(y => y.user_id === Number(x.dataset.id)); const m = modal({ title: `Reset credentials - ${u.name}`, size: 'narrow', body: H`<form data-act="go" class="stack-sm"><label class="f"><span>New password (8+ characters, leave empty to keep)</span><input type="text" name="password" autocomplete="off"></label>${u.role !== 'client' ? H`<label class="f"><span>New PIN (4-6 digits, leave empty to keep)</span><input name="pin" inputmode="numeric" autocomplete="off"></label>` : ''}<div class="hint">This also unlocks the account and signs the person out everywhere.</div><button class="btn primary">Apply</button></form>` });
      bind(m.el, { submit: { go: async (f) => { await api.post(`/api/admin/users/${u.user_id}/reset`, formData(f)); toast('Credentials updated', 'ok'); m.close(); draw(); } } }); } } });
  await draw();
}
function userForm(u, pm, ctx) {
  const isNew = !u; const isAdmin = ctx.user.role === 'admin';
  const roles = isAdmin ? ROLES : ROLES.filter(r => r !== 'admin');
  u = u || { name: '', email: '', phone: '', role: 'seller', active: true, discount_limit: ctx.settings.maxSellerDiscount, commission_pct: 0, overrides: [] };
  const ov = Object.fromEntries((u.overrides || []).map(o => [o.code, o.granted ? 'allow' : 'deny']));
  const m = modal({ title: isNew ? 'Add user' : `Edit ${u.name}`, size: 'wide', body: H`<form data-act="save" class="stack"><div class="grid g2">
    <label class="f"><span>Name</span><input name="name" value="${u.name}" required></label><label class="f"><span>Email</span><input type="email" name="email" value="${u.email}" ${isNew ? 'required' : 'disabled'}></label>
    <label class="f"><span>Phone</span><input name="phone" value="${u.phone || ''}"></label><label class="f"><span>Role</span><select name="role" id="ur">${roles.map(r => H`<option ${r === u.role ? 'selected' : ''}>${r}</option>`)}</select></label>
    ${isNew ? H`<label class="f"><span>Password (8+ characters)</span><input type="text" name="password" autocomplete="off" required minlength="8"></label><label class="f"><span>PIN (staff, 4-6 digits)</span><input name="pin" inputmode="numeric" autocomplete="off"></label>` : ''}
    <label class="f"><span>Discount limit % (blank = shop default ${ctx.settings.maxSellerDiscount}%)</span><input type="number" name="discountLimit" min="0" max="100" value="${u.discount_limit ?? ''}"></label><label class="f"><span>Commission %</span><input type="number" name="commissionPct" min="0" max="50" step="0.1" value="${u.commission_pct}"></label></div>
    ${isNew ? '' : H`<label class="chk"><input type="checkbox" name="active" ${u.active ? 'checked' : ''}> Account active</label>`}
    ${isAdmin ? H`<div id="permbox"><b>Permissions</b><div class="hint" style="margin-bottom:6px">Roles come with default permissions. Override them for this person if needed.</div><div class="table-wrap"><table><thead><tr><th>Permission</th><th>Role default</th><th>This user</th></tr></thead><tbody id="ptb"></tbody></table></div></div>` : ''}
    <div class="row" style="justify-content:flex-end"><button type="button" class="btn" data-act="close">Cancel</button><button class="btn primary">${isNew ? 'Create user' : 'Save changes'}</button></div></form>` });
  const drawPerms = () => { if (!isAdmin) return; const role = $('#ur', m.el).value, def = pm.roles[role] || [];
    render($('#ptb', m.el), Object.entries(pm.permissions).map(([code, label]) => H`<tr><td>${label}<div class="hint">${code}</div></td><td>${def.includes(code) ? H`<span class="badge ok">yes</span>` : H`<span class="badge">no</span>`}</td><td><select data-perm="${code}" style="width:auto"><option value="">Default</option><option value="allow" ${ov[code] === 'allow' ? 'selected' : ''}>Allow</option><option value="deny" ${ov[code] === 'deny' ? 'selected' : ''}>Deny</option></select></td></tr>`)); };
  drawPerms(); $('#ur', m.el).addEventListener('change', drawPerms);
  bind(m.el, { submit: { save: async (f) => { const d = formData(f); const overrides = isAdmin ? $$('[data-perm]', m.el).filter(s => s.value).map(s => ({ code: s.dataset.perm, granted: s.value === 'allow' })) : undefined;
    if (isNew) await api.post('/api/admin/users', { name: d.name, email: d.email, phone: d.phone, role: d.role, password: d.password, pin: d.pin, discountLimit: d.discountLimit, commissionPct: d.commissionPct });
    else await api.put('/api/admin/users/' + u.user_id, { name: d.name, phone: d.phone, role: d.role, active: !!f.active?.checked, discountLimit: d.discountLimit, commissionPct: d.commissionPct, overrides });
    toast('Saved', 'ok'); m.close(); ctx.refresh(); } } });
}

// ---------------------------------------------------------------- PROMOTIONS
async function viewPromos(box, ctx) {
  const [d, cats] = await Promise.all([api.get('/api/admin/promos'), api.get('/api/admin/categories')]); let tab = 'codes';
  const draw = () => {
    render(box, H`${tabsBar([['codes', 'Promo codes'], ['sales', 'Seasonal sales'], ['bundles', 'Bundle deals']], tab)}<div id="pt"></div>`); const t = $('#pt', box);
    if (tab === 'codes') render(t, H`<div class="grid g2" style="align-items:start"><div class="table-wrap"><table><thead><tr><th>Code</th><th class="num">%</th><th>Expires</th><th>Active</th><th></th></tr></thead><tbody>${d.codes.map(c => H`<tr><td><b>${c.code}</b><div class="hint">${c.note || ''}</div></td><td class="num">${c.pct}%</td><td class="small">${c.expires_on ? fdate(c.expires_on) : 'never'}</td><td><input type="checkbox" data-act="tgc" data-id="${c.promo_id}" ${c.active ? 'checked' : ''}></td><td><button class="btn sm danger" data-act="delc" data-id="${c.promo_id}">Delete</button></td></tr>`)}</tbody></table></div>
      <form class="card stack-sm" data-act="addc"><h3>New promo code</h3><label class="f"><span>Code</span><input name="code" required maxlength="30" placeholder="SUMMER20"></label><label class="f"><span>Discount %</span><input type="number" name="pct" min="1" max="100" required></label><label class="f"><span>Description</span><input name="note"></label><label class="f"><span>Expires (optional)</span><input type="date" name="expires_on"></label><button class="btn primary">Create code</button></form></div>
      <form class="card stack-sm" data-act="bc" style="margin-top:14px"><h3>Send a promotion notification</h3><div class="grid g2"><label class="f"><span>Title</span><input name="title" required maxlength="120" placeholder="Khmer New Year sale"></label>
      <label class="f"><span>Send to</span><select name="tier"><option value="">All customers</option><option>Silver</option><option>Gold</option><option>VIP</option></select></label></div>
      <label class="f"><span>Message</span><input name="body" required maxlength="300" placeholder="Use code KHMER15 for 15% off all suits this week."></label><button class="btn">Send notification</button><div class="hint">Customers see it in their bell menu and Notifications page. (Email/SMS is not connected in this build.)</div></form>`);
    else if (tab === 'sales') render(t, H`<div class="grid g2" style="align-items:start"><div class="table-wrap"><table><thead><tr><th>Sale</th><th>Applies to</th><th>Dates</th><th>Active</th><th></th></tr></thead><tbody>${d.sales.map(s => H`<tr><td><b>${s.name}</b> <span class="badge gold">-${s.pct}%</span></td><td>${s.category || 'Everything'}</td><td class="small">${fdate(s.date_from)} to ${fdate(s.date_to)}</td><td><input type="checkbox" data-act="tgs" data-id="${s.sale_id}" ${s.active ? 'checked' : ''}></td><td><button class="btn sm danger" data-act="dels" data-id="${s.sale_id}">Delete</button></td></tr>`)}</tbody></table></div>
      <form class="card stack-sm" data-act="adds"><h3>New seasonal sale</h3><label class="f"><span>Name</span><input name="name" required placeholder="Khmer New Year"></label><label class="f"><span>Discount %</span><input type="number" name="pct" min="1" max="100" required></label><label class="f"><span>Category</span><select name="category"><option>All</option>${cats.map(c => H`<option>${c.name}</option>`)}</select></label>
      <div class="grid g2"><label class="f"><span>From</span><input type="date" name="date_from" value="${todayStr()}" required></label><label class="f"><span>To</span><input type="date" name="date_to" value="${addDays(14)}" required></label></div><button class="btn primary">Create sale</button><div class="hint">Sale prices apply automatically in the shop and at the POS.</div></form></div>`);
    else render(t, H`<div class="grid g2" style="align-items:start"><div class="table-wrap"><table><thead><tr><th>Bundle</th><th>Buy together</th><th>Active</th><th></th></tr></thead><tbody>${d.bundles.map(b => H`<tr><td><b>${b.name}</b> <span class="badge gold">-${b.pct}%</span></td><td class="small">${b.cats.join(' + ')}</td><td><input type="checkbox" data-act="tgb" data-id="${b.bundle_id}" ${b.active ? 'checked' : ''}></td><td><button class="btn sm danger" data-act="delb" data-id="${b.bundle_id}">Delete</button></td></tr>`)}</tbody></table></div>
      <form class="card stack-sm" data-act="addb"><h3>New bundle deal</h3><label class="f"><span>Name</span><input name="name" required placeholder="Suit + Belt"></label><label class="f"><span>Discount %</span><input type="number" name="pct" min="1" max="100" required></label>
      <div class="f"><span>Categories (pick 2 or more)</span><div class="chips">${cats.map(c => H`<label class="chk chip"><input type="checkbox" name="cat" value="${c.name}"> ${c.name}</label>`)}</div></div><button class="btn primary">Create bundle</button><div class="hint">The discount applies to the cheapest item from each category in the cart.</div></form></div>`);
  };
  const reload = async () => { Object.assign(d, await api.get('/api/admin/promos')); draw(); };
  const toggle = (path, key) => async (t) => { const row = d[key].find(x => String(Object.values(x)[0]) === t.dataset.id); await api.put(`${path}/${t.dataset.id}`, { ...row, active: t.checked, date_from: row.date_from && ymd(row.date_from), date_to: row.date_to && ymd(row.date_to), expires_on: row.expires_on && ymd(row.expires_on) }); toast('Updated', 'ok'); reload(); };
  const del = (path) => async (t) => { if (await confirmBox('Delete this?', { danger: true })) { await api.del(`${path}/${t.dataset.id}`); reload(); } };
  bind(box, { click: { tab: (t) => { tab = t.dataset.t; draw(); }, delc: del('/api/admin/promos/code'), dels: del('/api/admin/promos/sale'), delb: del('/api/admin/promos/bundle') },
    change: { tgc: toggle('/api/admin/promos/code', 'codes'), tgs: toggle('/api/admin/promos/sale', 'sales'), tgb: toggle('/api/admin/promos/bundle', 'bundles') },
    submit: { bc: async (f) => { const r = await api.post('/api/admin/promos/broadcast', formData(f)); toast(`Sent to ${r.sent} customer(s)`, 'ok'); f.reset(); }, addc: async (f) => { await api.post('/api/admin/promos/code', formData(f)); toast('Code created', 'ok'); reload(); }, adds: async (f) => { await api.post('/api/admin/promos/sale', formData(f)); toast('Sale created', 'ok'); reload(); },
      addb: async (f) => { await api.post('/api/admin/promos/bundle', { name: f.name.value, pct: f.pct.value, cats: $$('input[name=cat]:checked', f).map(c => c.value) }); toast('Bundle created', 'ok'); reload(); } } });
  draw();
}

// ---------------------------------------------------------------- REPORTS
async function viewReports(box, ctx) {
  let from = addDays(-29), to = todayStr(), r = null;
  const load = async () => { r = await api.get(`/api/admin/reports?from=${from}&to=${to}`); draw(); };
  const draw = () => {
    const t = r.totals;
    render($('#rep', box), H`<div class="stack"><div class="grid g4"><div class="kpi"><div class="l">Net sales</div><div class="v">${money(t.net)}</div><div class="s">${t.orders} orders &middot; refunds ${money(t.refunds)}</div></div><div class="kpi"><div class="l">Gross profit</div><div class="v ${t.gross_profit >= 0 ? 'ok' : 'bad'}">${money(t.gross_profit)}</div><div class="s">item sales - cost of goods ${money(t.cogs)}</div></div>
      <div class="kpi"><div class="l">VAT collected</div><div class="v">${money(t.tax)}</div><div class="s">${ctx.settings.vatPct}% output tax</div></div><div class="kpi"><div class="l">Rental revenue</div><div class="v">${money(t.rental_revenue)}</div><div class="s">deposits held ${money(t.deposits)}</div></div></div>
      <div class="card"><div class="row between"><h2>Daily sales</h2><button class="btn sm" data-act="csv">Export CSV</button></div>${barChart(r.byDay.map(x => ({ label: ymd(x.day).slice(5), value: Number(x.total) })), { fmt: money })}</div>
      <div class="grid g2"><div class="card"><h2>Weekly</h2>${tbl(['Week starting', 'Orders', 'Sales'], r.byWeek.map(x => [fdate(x.start), x.orders, usd(x.total)]))}</div><div class="card"><h2>Monthly</h2>${tbl(['Month', 'Orders', 'Sales'], r.byMonth.map(x => [x.month, x.orders, usd(x.total)]))}</div></div>
      <div class="grid g2"><div class="card"><h2>Sales by category</h2>${hbars(r.byCategory.map(x => ({ label: x.category, value: Number(x.revenue) })), usd)}</div><div class="card"><h2>Payment methods</h2>${hbars(r.byMethod.map(x => ({ label: `${x.method} (${x.payments})`, value: Number(x.total) })), usd)}</div></div>
      <div class="grid g3"><div class="card"><h2>Best sizes</h2>${hbars(r.bySize.map(x => ({ label: x.size, value: Number(x.qty) })), (v) => v + ' pcs')}</div><div class="card"><h2>Best colors</h2>${hbars(r.byColor.map(x => ({ label: x.color, value: Number(x.qty) })), (v) => v + ' pcs')}</div><div class="card"><h2>Best styles (fit / fabric)</h2>${hbars(r.byStyle.slice(0, 10).map(x => ({ label: `${x.fit} ${x.fabric}`, value: Number(x.qty) })), (v) => v + ' pcs')}</div></div>
      <div class="card"><h2>Best-selling items</h2>${tbl(['Item', 'Units', 'Revenue'], r.bestItems.map(x => [x.name, x.qty, usd(x.revenue)]))}</div>
      <div class="card"><h2>Sales performance per seller</h2>${tbl(['Seller', 'Orders', 'Sales', 'Commission rate', 'Commission'], r.bySeller.map(x => [x.seller, x.orders, usd(x.total), (x.commission_pct ?? 0) + '%', usd(x.commission)]))}</div>
      <div class="grid g2"><div class="card"><h2>Inventory value &amp; profit</h2>${tbl(['', ''], [['Units in stock', r.inventory.units], ['Value at cost', usd(r.inventory.cost_value)], ['Value at retail', usd(r.inventory.retail_value)], ['Potential profit', usd(r.inventory.retail_value - r.inventory.cost_value)]], true)}</div>
        <div class="card"><h2>Tax summary</h2>${tbl(['', ''], [['Gross sales', usd(t.gross)], ['Discounts given', '-' + usd(t.discounts)], ['VAT collected', usd(t.tax)], ['Rental deposits (liability)', usd(t.deposits)], ['Total invoiced', usd(t.total)], ['Refunds', '-' + usd(t.refunds)]], true)}</div></div>
      <div class="card"><h2>Cash reconciliation (shifts)</h2>${r.shifts.length ? tbl(['Cashier', 'Opened', 'Closed', 'Float', 'Expected', 'Counted', 'Variance'], r.shifts.map(s => [s.user_name, fdt(s.opened_at), s.closed_at ? fdt(s.closed_at) : 'open', usd(s.float_amount), s.closed_at ? usd(s.expected) : '-', s.closed_at ? usd(s.counted) : '-', s.closed_at ? usd(s.variance) : '-']))
        : H`<div class="empty">No shifts in this period.</div>`}<div class="hint">Total variance: ${usd(r.shifts.reduce((s, x) => s + Number(x.variance || 0), 0))}</div></div></div>`);
  };
  const tbl = (head, rows, noHead) => H`<div class="table-wrap"><table>${noHead ? '' : H`<thead><tr>${head.map((h, i) => H`<th class="${i > 0 ? 'num' : ''}">${h}</th>`)}</tr></thead>`}<tbody>${rows.length ? rows.map(row => H`<tr>${row.map((c, i) => H`<td class="${i > 0 ? 'num' : ''}">${c}</td>`)}</tr>`) : H`<tr><td class="empty" colspan="${head.length}">No data</td></tr>`}</tbody></table></div>`;
  render(box, H`<div class="toolbar"><button class="btn sm" data-act="p" data-d="0">Today</button><button class="btn sm" data-act="p" data-d="6">7 days</button><button class="btn sm" data-act="p" data-d="29">30 days</button><button class="btn sm" data-act="p" data-d="m">This month</button><input type="date" id="rf" value="${from}"><span>to</span><input type="date" id="rt" value="${to}"><button class="btn primary" data-act="go">Run report</button></div><div id="rep"><div class="loading"><span class="spin"></span></div></div>`);
  bind(box, { click: { p: (t) => { const d = t.dataset.d; from = d === 'm' ? todayStr().slice(0, 8) + '01' : addDays(-Number(d)); to = todayStr(); $('#rf', box).value = from; $('#rt', box).value = to; return load(); },
    go: () => { from = $('#rf', box).value; to = $('#rt', box).value; if (!from || !to || from > to) throw new Error('Choose a valid date range.'); return load(); },
    csv: () => downloadCSV(`sales_${from}_${to}.csv`, [['Date', 'Orders', 'Sales'], ...r.byDay.map(x => [ymd(x.day), x.orders, x.total]), [], ['Category', 'Units', 'Revenue'], ...r.byCategory.map(x => [x.category, x.qty, x.revenue]), [], ['Seller', 'Orders', 'Sales', 'Commission'], ...r.bySeller.map(x => [x.seller, x.orders, x.total, x.commission])]) } });
  await load();
}

// ---------------------------------------------------------------- SETTINGS
async function viewSettings(box, ctx) {
  const s = await api.get('/api/admin/settings'); let logo = s.logo || null;
  const ALL = ['Cash', 'Card', 'ABA Pay', 'KHQR', 'Pay in store'];
  const methods = [...new Set([...ALL, ...s.paymentMethods])];
  render(box, H`<form class="stack" data-act="save" style="max-width:900px"><div class="card stack"><h2>Shop information</h2><div class="grid g2"><label class="f"><span>Shop name</span><input name="storeName" value="${s.storeName}" required></label><label class="f"><span>Phone</span><input name="phone" value="${s.phone}"></label></div>
    <label class="f"><span>Address</span><input name="address" value="${s.address}"></label><div class="row"><div style="width:64px;height:64px;border-radius:12px;background:#0a0d15;display:grid;place-items:center;overflow:hidden" id="lg">${logo ? raw(`<img src="${esc(logo)}" style="width:100%;height:100%;object-fit:cover" alt="">`) : 'No logo'}</div><label class="f grow"><span>Logo (square image works best)</span><input type="file" accept="image/*" id="logo"></label><button type="button" class="btn sm" data-act="rmlogo">Remove</button></div></div>
    <div class="card stack"><h2>Tax, currency &amp; payments</h2><div class="grid g3"><label class="f"><span>VAT %</span><input type="number" name="vatPct" min="0" max="50" step="0.1" value="${s.vatPct}"></label><label class="f"><span>Display currency</span><select name="currency"><option ${s.currency === 'USD' ? 'selected' : ''}>USD</option><option ${s.currency === 'KHR' ? 'selected' : ''}>KHR</option></select></label>
      <label class="f"><span>KHR per 1 USD</span><input type="number" name="khrRate" min="1" value="${s.khrRate}"></label></div>
    <div class="f"><span>Payment methods accepted</span><div class="chips">${methods.map(m => H`<label class="chk chip"><input type="checkbox" name="pm" value="${m}" ${s.paymentMethods.includes(m) ? 'checked' : ''} ${['Cash', 'Pay in store'].includes(m) ? 'disabled checked' : ''}> ${m}</label>`)}</div><span class="hint">Cash and Pay in store are always on. Online methods are simulated in this build.</span></div></div>
    <div class="card stack"><h2>Rules</h2><div class="grid g3"><label class="f"><span>Default max seller discount %</span><input type="number" name="maxSellerDiscount" min="0" max="100" value="${s.maxSellerDiscount}"></label><label class="f"><span>Refund / exchange window (days)</span><input type="number" name="refundDays" min="0" value="${s.refundDays}"></label>
      <label class="f"><span>Low-stock level</span><input type="number" name="lowStock" min="0" value="${s.lowStock}"></label><label class="f"><span>Max rental days</span><input type="number" name="rentalMaxDays" min="1" max="60" value="${s.rentalMaxDays}"></label>
      <label class="f"><span>Late fee (% of daily rate per day)</span><input type="number" name="lateFeePct" min="0" value="${s.lateFeePct}"></label><label class="f"><span>Made-to-measure markup %</span><input type="number" name="tailorMarkupPct" min="0" value="${s.tailorMarkupPct}"></label>
      <label class="f"><span>Loyalty points per $1</span><input type="number" name="pointsPerDollar" min="0" step="0.1" value="${s.pointsPerDollar}"></label><label class="f"><span>Value of 1 point (USD)</span><input type="number" name="pointValue" min="0" step="0.001" value="${s.pointValue}"></label></div></div>
    <div class="card stack"><h2>Receipt template</h2><div class="grid g2"><label class="f"><span>Header line</span><input name="receiptHeader" value="${s.receiptHeader}"></label><label class="f"><span>Footer message</span><input name="receiptFooter" value="${s.receiptFooter}"></label></div></div>
    <div class="card stack"><h2>Backup &amp; restore</h2><div class="alert small">All shop data lives <b>in this browser only</b> (no server). Export a backup regularly, and use it to move to another computer or browser. Anyone who can open this browser's developer tools can read or change the data, so use a computer you trust.</div>
      <div class="row"><button type="button" class="btn" data-act="export">Export backup (.json)</button><label class="btn" style="cursor:pointer">Restore from file<input type="file" accept="application/json,.json" id="restoreFile" style="display:none"></label>
      ${LB.env === 'development' ? H`<button type="button" class="btn danger" data-act="resetdemo">Reset demo data</button>` : ''}</div>
      <div class="hint">Environment: <b>${LB.env}</b> (set in js/config.js). Restoring replaces everything currently stored here.</div></div>
    <div class="row" style="justify-content:flex-end"><button class="btn primary lg">Save settings</button></div></form>`);
  $('#logo', box).addEventListener('change', async (e) => { try { logo = await fileToDataUrl(e.target.files[0], 160, .85); render($('#lg', box), raw(`<img src="${logo}" style="width:100%;height:100%;object-fit:cover" alt="">`)); } catch (err) { toast(err.message, 'bad'); } });
  $('#restoreFile', box).addEventListener('change', async (e) => {
    try { const f = e.target.files[0]; if (!f) return; const data = JSON.parse(await f.text()); if (!(await confirmBox('Replace ALL data in this browser with the backup? This cannot be undone.', { danger: true, okText: 'Restore' }))) return;
      await api.post('/api/admin/restore', { data: data.data || data }); toast('Backup restored. Please sign in again.', 'ok'); setTimeout(() => { location.href = 'login.html'; }, 900); } catch (err) { toast(err.message || 'That file could not be read.', 'bad'); }
  });
  bind(box, { click: { rmlogo: () => { logo = ''; render($('#lg', box), H`No logo`); },
    export: async () => { const d = await api.get('/api/admin/backup'); const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(d, null, 1)], { type: 'application/json' })); a.download = `lordecambodge-backup-${todayStr()}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); toast('Backup downloaded', 'ok'); },
    resetdemo: async () => { if (await confirmBox('Delete everything and reload the demo data?', { danger: true, okText: 'Reset' })) { await LB.resetDemo(); location.href = 'login.html'; } } }, submit: { save: async (f) => { const d = formData(f); const body = { ...d, paymentMethods: [...$$('input[name=pm]:checked', f).map(c => c.value), 'Cash', 'Pay in store'], logo: logo ?? '' };
    delete body.pm; await api.put('/api/admin/settings', body); toast('Settings saved. Reloading...', 'ok'); setTimeout(() => location.reload(), 700); } } });
}

// ---------------------------------------------------------------- ACTIVITY LOG
async function viewAudit(box, ctx) {
  const f = { user: '', action: '', from: '', to: '' }; let rows = [];
  const draw = async () => { rows = await api.get('/api/admin/audit?' + qs(f));
    render($('#au', box), rows.length ? H`<div class="table-wrap"><table><thead><tr><th>When</th><th>Who</th><th>Role</th><th>Action</th><th>Detail</th><th>IP</th></tr></thead><tbody>${rows.map(a => H`<tr><td class="small">${fdt(a.at)}</td><td>${a.user_name}</td><td><span class="badge">${a.role}</span></td><td><b class="small">${a.action}</b></td><td class="small muted">${a.detail}</td><td class="small muted">${a.ip || ''}</td></tr>`)}</tbody></table></div>` : H`<div class="empty card">No activity matches.</div>`); };
  render(box, H`<div class="toolbar"><input id="au1" placeholder="Who (name)"><input id="au2" placeholder="Action e.g. order, login, stock"><input type="date" id="au3" title="From"><input type="date" id="au4" title="To"><button class="btn" data-act="csv">Export CSV</button></div><div id="au"></div>`);
  let tm; box.addEventListener('input', (e) => { const k = { au1: 'user', au2: 'action', au3: 'from', au4: 'to' }[e.target.id]; if (!k) return; f[k] = e.target.value; clearTimeout(tm); tm = setTimeout(draw, 300); });
  bind(box, { click: { csv: () => downloadCSV('activity_log.csv', [['When', 'Who', 'Role', 'Action', 'Detail', 'IP'], ...rows.map(a => [a.at, a.user_name, a.role, a.action, a.detail, a.ip])]) } });
  await draw();
}

// ---------------------------------------------------------------- boot
Shell.mount({ expectedView: 'admin', subtitle: 'Back office', defaultView: 'dashboard',
  nav: [{ id: 'dashboard', label: 'Dashboard', icon: 'chart', perm: 'reports.view' }, { section: 'Catalogue' }, { id: 'products', label: 'Products', icon: 'hanger', perm: 'products.edit' }, { id: 'inventory', label: 'Inventory', icon: 'box', perm: 'inventory.view' },
    { id: 'promos', label: 'Promotions', icon: 'gift', perm: 'promos.manage' }, { section: 'Operations' }, { id: 'orders', label: 'Orders', icon: 'list', perm: 'orders.view' }, { id: 'tailoring', label: 'Tailoring', icon: 'scissors', perm: 'tailoring.manage' },
    { id: 'rentals', label: 'Rentals', icon: 'swap', perm: 'rental.manage' }, { id: 'customers', label: 'Customers', icon: 'users', perm: 'customers.manage' }, { section: 'Business' }, { id: 'staff', label: 'Staff', icon: 'shield', perm: 'staff.manage' },
    { id: 'reports', label: 'Reports', icon: 'chart', perm: 'reports.view' }, { id: 'audit', label: 'Activity log', icon: 'log', perm: 'audit.view' }, { id: 'settings', label: 'Settings', icon: 'gear', perm: 'settings.edit' }],
  views: { dashboard: viewDashboard, products: viewProducts, inventory: viewInventory, promos: viewPromos, orders: viewOrders, tailoring: viewTailoring, rentals: viewRentalsAdmin, customers: viewCustomersAdmin, staff: viewStaff, reports: viewReports, audit: viewAudit, settings: viewSettings }
});
