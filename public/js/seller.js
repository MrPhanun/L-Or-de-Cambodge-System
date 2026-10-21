'use strict';
/* SELLER VIEW (cashier / sales staff and tailors): dashboard, POS, orders, rentals, alterations, customers, appointments, stock, performance, shift. */

let shiftInfo = null;
const loadShift = async () => (shiftInfo = await api.get('/api/shift/status').catch(() => null));

// ---------------------------------------------------------------- shift widgets (clock-in, cash shift, end-of-shift report)
function shiftBar(ctx) {
  const s = shiftInfo; if (!s) return H``;
  if (!s.clockedIn) return H`<div class="alert warn row between"><span>You are <b>clocked out</b>. Clock in to start working.</span><button class="btn primary" data-act="clockin">Clock in</button></div>`;
  if (!s.shift) return H`<div class="alert row between"><span>Clocked in since ${ftime(s.clockedIn.clock_in)}. <b>No cash shift open</b>${ctx.can('pos.sell') ? ' - open one to take payments.' : '.'}</span>
    <div class="row">${ctx.can('pos.sell') ? H`<button class="btn primary" data-act="openshift">Open cash shift</button>` : ''}<button class="btn" data-act="clockout">Clock out</button></div></div>`;
  return H`<div class="alert ok row between"><span>Shift open since ${ftime(s.shift.opened_at)} &middot; float ${usd(s.shift.float_amount)} &middot; sales so far <b>${usd(s.report.sales)}</b></span><a href="#/shift" class="btn sm">End-of-shift report</a></div>`;
}
const shiftHandlers = (ctx) => ({
  clockin: async () => { await api.post('/api/shift/clock-in'); toast('Clocked in', 'ok'); ctx.refresh(); },
  clockout: async () => { if (await confirmBox('Clock out now?')) { await api.post('/api/shift/clock-out'); toast('Clocked out. Good work today!', 'ok'); ctx.refresh(); } },
  openshift: () => {
    const m = modal({ title: 'Open cash shift', size: 'narrow', body: H`<form data-act="go" class="stack"><label class="f"><span>Opening cash float in the drawer (USD)</span><input type="number" name="float" min="0" step="0.01" value="100" required></label><button class="btn primary">Open shift</button></form>` });
    bind(m.el, { submit: { go: async (f) => { await api.post('/api/shift/open', formData(f)); m.close(); toast('Shift opened', 'ok'); ctx.refresh(); } } });
  }
});

// ---------------------------------------------------------------- DASHBOARD
async function viewDashboard(box, ctx) {
  await loadShift();
  const [perf, orders, appts, rentals, alts] = await Promise.all([
    ctx.can('performance.view') ? api.get('/api/performance').catch(() => null) : null,
    ctx.can('orders.view') ? api.get('/api/orders?limit=300') : [], ctx.can('appointments.manage') ? api.get(`/api/appointments?date=${todayStr()}`) : [],
    ctx.can('rental.manage') ? api.get('/api/rentals') : [], ctx.can('alteration.manage') ? api.get('/api/alterations') : []]);
  const online = orders.filter(o => o.channel === 'online' && ['Pending', 'Tailoring', 'Ready'].includes(o.status));
  const overdue = rentals.filter(o => o.overdue), dueAlt = alts.filter(a => ['Received', 'In Progress'].includes(a.status));
  ctx.setBadge('orders', online.length); ctx.setBadge('rentals', overdue.length); ctx.setBadge('alterations', dueAlt.length);
  render(box, H`<div class="stack"><div id="sb">${shiftBar(ctx)}</div>
    ${perf ? H`<div class="grid g4"><div class="kpi"><div class="l">My sales today</div><div class="v">${usd(perf.today)}</div></div><div class="kpi"><div class="l">Last 7 days</div><div class="v">${usd(perf.week)}</div></div>
      <div class="kpi"><div class="l">Last 30 days</div><div class="v">${usd(perf.month)}</div><div class="s">${perf.orders_month} orders</div></div><div class="kpi"><div class="l">Est. commission (30d)</div><div class="v gold">${usd(perf.commission_month)}</div><div class="s">${perf.commission_pct}% of net sales</div></div></div>` : ''}
    <div class="grid g2"><div class="card"><div class="row between"><h2>Online orders to handle</h2><a href="#/orders">Open</a></div>${online.length ? online.slice(0, 6).map(o => H`<div class="row between" style="padding:7px 0;border-bottom:1px solid var(--line)"><span><b>${o.order_no}</b> ${o.customer_name}</span>${badge(o.status)}</div>`) : H`<div class="empty">All caught up.</div>`}</div>
      <div class="card"><div class="row between"><h2>Today's fittings</h2><a href="#/appointments">Open</a></div>${appts.length ? appts.map(a => H`<div class="row between" style="padding:7px 0;border-bottom:1px solid var(--line)"><span><b>${a.appt_time}</b> ${a.customer_name} - ${a.service}</span>${badge(a.status)}</div>`) : H`<div class="empty">No appointments today.</div>`}</div>
      ${ctx.can('rental.manage') ? H`<div class="card"><div class="row between"><h2>Rentals</h2><a href="#/rentals">Open</a></div>${overdue.length ? H`<div class="alert bad">${overdue.length} overdue rental${overdue.length > 1 ? 's' : ''}: ${overdue.map(o => o.customer_name).join(', ')}</div>` : H`<div class="empty">No overdue rentals.</div>`}</div>` : ''}
      ${ctx.can('alteration.manage') ? H`<div class="card"><div class="row between"><h2>Alteration tickets</h2><a href="#/alterations">Open</a></div>${dueAlt.length ? dueAlt.slice(0, 5).map(a => H`<div class="row between" style="padding:7px 0;border-bottom:1px solid var(--line)"><span><b>${a.alt_no}</b> ${a.item}</span>${badge(a.status)}</div>`) : H`<div class="empty">Nothing waiting.</div>`}</div>` : ''}</div></div>`);
  bind(box, { click: shiftHandlers(ctx) });
}

// ---------------------------------------------------------------- POS
const posState = { items: [], customer: null, promo: '', discount: 0, redeem: 0, payments: [], note: '', filter: { q: '', category: 'All', color: '', fit: '' } };
const resetPos = () => Object.assign(posState, { items: [], customer: null, promo: '', discount: 0, redeem: 0, payments: [], note: '' });

async function viewPos(box, ctx) {
  await Promise.all([loadCat(), loadShift()]);
  const limit = ctx.user.discountLimit ?? ctx.settings.maxSellerDiscount;
  const methods = ctx.settings.paymentMethods.filter(m => m !== 'Pay in store');
  const colors = [...new Set(cat.products.map(p => p.color_name).filter(Boolean))].sort();
  render(box, H`<div class="stack"><div id="sb">${shiftBar(ctx)}</div><div class="pos"><div class="stack">
    <div class="toolbar" style="margin:0"><input class="grow" id="pq" placeholder="Scan barcode or search name / SKU..." autocomplete="off" autofocus>
      <select id="pcol"><option value="">Any color</option>${colors.map(c => H`<option>${c}</option>`)}</select><select id="pfit"><option value="">Any fit</option>${['Slim', 'Regular', 'Classic'].map(c => H`<option>${c}</option>`)}</select></div>
    <div class="chips" id="pcats">${['All', ...cat.categories.map(c => c.name)].map(c => H`<span class="chip ${c === 'All' ? 'active' : ''}" data-act="cat" data-v="${c}">${c}</span>`)}</div>
    <div class="products dense" id="pgrid"></div></div>
    <div class="card cart" id="cart"></div></div><button class="cart-fab hidden" id="fab" data-act="gocart"></button></div>`);

  const drawGrid = () => {
    const f = posState.filter, t = f.q.toLowerCase();
    const list = cat.products.filter(p => (f.category === 'All' || p.category === f.category) && (!f.color || p.color_name === f.color) && (!f.fit || p.fit === f.fit)
      && (!t || `${p.name} ${p.sku} ${p.barcode || ''} ${p.color_name} ${p.fabric}`.toLowerCase().includes(t)));
    render($('#pgrid', box), list.length ? list.map(p => { const n = p.variants.reduce((s, v) => s + v.stock, 0);
      return H`<div class="pcard compact" data-act="pick" data-id="${p.product_id}" tabindex="0"><div class="art">${art(p)}</div>${p.sale_pct ? H`<span class="badge gold tag">-${p.sale_pct}%</span>` : ''}
        <div class="pinfo"><div class="nm small">${p.name}</div><div class="row between"><b>${usd(p.eff_price)}</b>${n <= 0 ? H`<span class="badge bad">Out</span>` : H`<span class="small muted">${n} pcs</span>`}</div></div></div>`; })
      : H`<div class="empty" style="grid-column:1/-1">No products match.</div>`);
  };

  // ---- quote + cart drawing
  let quote = null;
  const payTotal = () => posState.payments.reduce((s, p) => s + Number(p.amount), 0);
  const drawCart = async () => {
    const cartBox = $('#cart', box);
    if (!posState.items.length) quote = null; else { try { quote = await api.post('/api/quote', { items: posState.items, promoCode: posState.promo, discountPct: posState.discount, redeemPoints: posState.redeem, customerId: posState.customer?.user_id }); } catch (e) { toast(e.message, 'bad'); posState.items.pop(); return drawCart(); } }
    const total = quote?.total || 0, paid = payTotal(), due = Math.max(0, Math.round((total - paid) * 100) / 100);
    render(cartBox, H`<div class="row between"><h2>Current sale</h2><div class="row"><button class="btn sm" data-act="held">Held (<span id="hc">0</span>)</button><button class="btn sm danger" data-act="clear" ${posState.items.length ? '' : 'disabled'}>Clear</button></div></div>
      <div class="row" style="margin:8px 0"><button class="btn sm grow" data-act="cust">${posState.customer ? posState.customer.name : 'Walk-in customer (tap to choose)'}</button>${posState.customer ? H`<span class="badge gold">${posState.customer.loyalty_points} pts</span>` : ''}</div>
      <div class="cart-lines">${quote ? quote.lines.map((l, i) => H`<div class="cl"><div><b class="small">${l.name}</b><div class="hint">${l.kind === 'rent' ? `Rent ${l.rent_days}d ${fdate(l.rent_from)} (+deposit ${usd(l.deposit)})` : l.kind === 'tailor' ? 'Made to measure' : 'Size ' + l.size}</div></div>
        <div class="right"><b>${usd(l.line_total)}</b><div class="row" style="justify-content:flex-end;margin-top:3px">${l.kind === 'buy' ? H`<div class="qty"><button data-act="dec" data-i="${i}">-</button><span>${l.qty}</span><button data-act="inc" data-i="${i}">+</button></div>` : ''}<button class="btn sm danger" data-act="del" data-i="${i}">x</button></div></div></div>`) : H`<div class="empty">Tap a product to add it.</div>`}</div>
      ${quote ? H`<div class="stack-sm" style="margin-top:8px"><div class="grid g2"><label class="f"><span>Discount % (max ${limit}%)</span><input type="number" id="disc" min="0" max="${limit}" step="1" value="${posState.discount}"></label>
        <label class="f"><span>Promo code</span><input id="promo" value="${posState.promo}" placeholder="optional"></label></div>
        ${posState.customer && posState.customer.loyalty_points >= 100 ? H`<label class="f"><span>Redeem points (have ${posState.customer.loyalty_points})</span><input type="number" id="redeem" min="0" max="${posState.customer.loyalty_points}" step="50" value="${posState.redeem}"></label>` : ''}
        ${quote.promo_invalid ? H`<div class="small bad">Promo code is not valid.</div>` : ''}</div>
      <div class="tot"><div><span>Subtotal</span><span>${usd(quote.subtotal)}</span></div>${quote.bundle_discount ? H`<div class="ok"><span>Bundle: ${quote.bundle_names}</span><span>-${usd(quote.bundle_discount)}</span></div>` : ''}
        ${quote.discount ? H`<div class="ok"><span>Discount ${quote.discount_pct}%</span><span>-${usd(quote.discount)}</span></div>` : ''}${quote.points_value ? H`<div class="ok"><span>Points</span><span>-${usd(quote.points_value)}</span></div>` : ''}
        <div><span>VAT ${ctx.settings.vatPct}%</span><span>${usd(quote.tax)}</span></div>${quote.deposit ? H`<div><span>Rental deposit</span><span>${usd(quote.deposit)}</span></div>` : ''}
        <div class="grand"><span>Total</span><span>${usd(total)}</span></div><div class="small muted right">${khr(total)}</div></div>
      <div style="margin-top:10px"><div class="small muted" style="margin-bottom:4px">Payments (split, deposit or partial allowed)</div>
        ${posState.payments.map((p, i) => H`<div class="row between small" style="padding:3px 0"><span>${p.method}${p.kind === 'deposit' ? ' (deposit)' : ''}</span><span>${usd(p.amount)} <button class="btn sm danger" data-act="delpay" data-i="${i}">x</button></span></div>`)}
        <div class="row" style="margin-top:6px"><select id="pm" style="width:auto">${methods.map(m => H`<option>${m}</option>`)}</select><input type="number" id="pa" min="0" step="0.01" placeholder="${due ? due.toFixed(2) : '0.00'}" style="width:100px"><button class="btn sm" data-act="addpay">Add</button><button class="btn sm" data-act="fullpay">Pay rest</button></div>
        <label class="chk small" style="margin-top:6px"><input type="checkbox" id="dep"> Record as deposit</label>
        <div class="row between" style="margin-top:8px"><b class="${due > 0 ? 'warn' : 'ok'}">${due > 0 ? 'Balance due' : 'Fully paid'}</b><b>${due > 0 ? usd(due) : usd(0)}</b></div>
        ${paid > total ? '' : ''}</div>
      <button class="btn primary lg block" data-act="checkout" style="margin-top:10px" ${(shiftInfo?.shift ? '' : 'disabled')}>${shiftInfo?.shift ? (due > 0 ? (paid > 0 ? 'Save with balance due' : 'Reserve (no payment)') : 'Complete sale') : 'Open a cash shift first'}</button>
      <button class="btn block" data-act="hold" style="margin-top:6px">Hold order</button>` : ''}`);
    const fab = $('#fab', box), count = posState.items.reduce((n, i) => n + i.qty, 0);
    if (fab) { fab.classList.toggle('hidden', !count); render(fab, H`<span>Current sale: ${count} item${count === 1 ? '' : 's'}</span><b>${usd(total)}</b>`); }
    api.get('/api/held').then(h => { const e = $('#hc', cartBox); if (e) e.textContent = h.length; }).catch(() => {});
  };

  // ---- product picker (size / rent / made-to-measure)
  const pick = (id) => {
    const p = cat.products.find(x => x.product_id === id); if (!p) return;
    let size = '', mode = 'buy', from = todayStr(), to = addDays(2);
    const siblings = cat.products.filter(x => x.category === p.category && x.product_id !== id && x.name.split(' ')[0] === p.name.split(' ')[0]).slice(0, 4);
    const m = modal({ title: p.name, body: H`<div class="stack-sm"><div class="row"><div style="width:120px;flex:none" class="gallery"><div class="big">${art(p)}</div></div><div class="grow"><b style="font-size:1.2rem">${usd(p.eff_price)}</b> ${p.sale_pct ? H`<span class="badge gold">-${p.sale_pct}%</span>` : ''}
        <div class="small muted"><span class="sw" style="background:${p.color_hex}"></span> ${p.color_name} &middot; ${p.fabric} &middot; ${p.fit} fit</div><div class="hint">SKU ${p.sku} &middot; ${p.barcode || ''}</div></div></div>
      <div class="tabs"><button class="active" data-act="mode" data-m="buy">Buy</button>${p.rent_per_day > 0 ? H`<button data-act="mode" data-m="rent">Rent</button>` : ''}${p.tailorable ? H`<button data-act="mode" data-m="tailor">Made to measure</button>` : ''}</div>
      <div id="pk"></div>${siblings.length ? H`<div class="small muted">Other colors / fits: ${siblings.map(s => H`<a href="#" data-act="sib" data-id="${s.product_id}">${s.color_name} ${s.fit}</a> `)}</div>` : ''}</div>` });
    const draw = () => {
      const sizes = H`<div class="sizes">${p.variants.map(v => H`<div class="size ${v.stock <= 0 ? 'out' : ''} ${size === v.size ? 'active' : ''}" data-act="sz" data-s="${v.size}">${v.size}<small>${v.stock}</small></div>`)}</div>`;
      render($('#pk', m.el), mode === 'buy' ? H`${sizes}<button class="btn primary block" data-act="addbuy" style="margin-top:10px">Add to sale</button>`
        : mode === 'rent' ? H`${sizes}<div class="grid g2" style="margin-top:8px"><label class="f"><span>From</span><input type="date" id="rf" value="${from}" min="${todayStr()}"></label><label class="f"><span>To</span><input type="date" id="rt" value="${to}" min="${from}"></label></div>
          <div class="hint">${usd(p.rent_per_day)}/day, deposit ${usd(p.rent_deposit)}. Rentals are paid in full at check-out.</div><button class="btn primary block" data-act="addrent" style="margin-top:8px">Add rental</button>`
        : H`<div class="stack-sm"><div class="alert small">Uses the customer's saved measurements. Select a customer first. Priced ${ctx.settings.tailorMarkupPct}% above ready-made.</div>
          <div class="grid g2"><label class="f"><span>Fabric</span><select id="tfa">${['Wool', 'Linen', 'Cotton', 'Velvet', 'Silk', 'Tweed'].map(x => H`<option ${x === p.fabric ? 'selected' : ''}>${x}</option>`)}</select></label>
          <label class="f"><span>Fit</span><select id="tfi">${['Slim', 'Regular', 'Classic'].map(x => H`<option ${x === p.fit ? 'selected' : ''}>${x}</option>`)}</select></label></div>
          <label class="f"><span>Style / notes</span><input id="tno" maxlength="200" placeholder="e.g. peak lapel, 2 buttons"></label><button class="btn primary block" data-act="addtail">Add made-to-measure</button></div>`);
    }; draw();
    bind(m.el, { click: {
      mode: (t) => { mode = t.dataset.m; size = ''; $$('.tabs button', m.el).forEach(b => b.classList.toggle('active', b === t)); draw(); },
      sz: (t) => { if (t.classList.contains('out')) return; size = t.dataset.s; draw(); }, sib: (t, e) => { e.preventDefault(); m.close(); pick(Number(t.dataset.id)); },
      addbuy: async () => { if (!size) throw new Error('Choose a size.'); const v = p.variants.find(x => x.size === size); const have = posState.items.filter(i => i.productId === id && i.size === size && i.kind === 'buy').reduce((s, i) => s + i.qty, 0);
        if (have + 1 > v.stock) throw new Error(`Only ${v.stock} in stock.`); const ex = posState.items.find(i => i.productId === id && i.size === size && i.kind === 'buy'); if (ex) ex.qty++; else posState.items.push({ kind: 'buy', productId: id, size, qty: 1 }); m.close(); await drawCart(); },
      addrent: async () => { if (!size) throw new Error('Choose a size.'); from = $('#rf', m.el).value; to = $('#rt', m.el).value; posState.items.push({ kind: 'rent', productId: id, size, qty: 1, rentFrom: from, rentTo: to }); m.close(); await drawCart(); },
      addtail: async () => { if (!posState.customer) throw new Error('Choose the customer first (made-to-measure needs their measurements).'); posState.items.push({ kind: 'tailor', productId: id, qty: 1, tailor: { fabric: $('#tfa', m.el).value, fit: $('#tfi', m.el).value, notes: $('#tno', m.el).value } }); m.close(); await drawCart(); } } });
    m.el.addEventListener('change', (e) => { if (e.target.id === 'rf') { from = e.target.value; if (to < from) to = from; draw(); } if (e.target.id === 'rt') { to = e.target.value; } });
  };

  // ---- customer chooser
  const chooseCustomer = () => {
    const m = modal({ title: 'Customer', body: H`<div class="stack"><input id="cs" placeholder="Search name, phone or email..." autofocus><div id="cl"></div><button class="btn" data-act="newc">+ New customer</button></div>` });
    const load = async () => { const list = await api.get('/api/customers?search=' + encodeURIComponent($('#cs', m.el).value)); render($('#cl', m.el), H`<div class="row between" style="padding:8px 0"><span class="muted">Walk-in (no account)</span><button class="btn sm" data-act="walkin">Use</button></div>${list.slice(0, 12).map(c => H`<div class="row between" style="padding:8px 0;border-top:1px solid var(--line)"><span><b>${c.name}</b><div class="hint">${c.phone || c.email} &middot; ${c.loyalty_points} pts</div></span><button class="btn sm" data-act="use" data-id="${c.user_id}">Select</button></div>`)}`); window.__custs = list; };
    load(); let tm; $('#cs', m.el).addEventListener('input', () => { clearTimeout(tm); tm = setTimeout(load, 250); });
    bind(m.el, { click: { walkin: () => { posState.customer = null; posState.redeem = 0; m.close(); drawCart(); }, use: (t) => { posState.customer = window.__custs.find(c => c.user_id === Number(t.dataset.id)); posState.redeem = 0; m.close(); drawCart(); },
      newc: () => { m.close(); newCustomerDialog(ctx, (c) => { posState.customer = { ...c, loyalty_points: 0 }; drawCart(); }); } } });
  };

  // ---- checkout
  const checkout = async (t) => {
    if (!quote) return; const paid = payTotal(), due = Math.round((quote.total - paid) * 100) / 100;
    if (quote.lines.some(l => l.kind === 'rent') && due > 0.005) throw new Error('Rentals must be paid in full (rent + deposit) before check-out.');
    if (due > 0.005 && !posState.customer) throw new Error('Choose a customer to keep an order with a balance due.');
    if (due > 0.005 && !(await confirmBox(`Balance of ${usd(due)} will remain. The customer can pay it later and collect the goods once paid. Continue?`))) return;
    await busy(t, async () => {
      const o = await api.post('/api/orders', { items: posState.items, customerId: posState.customer?.user_id, promoCode: posState.promo, discountPct: posState.discount, redeemPoints: posState.redeem, payments: posState.payments, note: posState.note });
      toast(`Sale ${o.order_no} saved`, 'ok'); resetPos(); await loadCat(); drawGrid(); await loadShift(); render($('#sb', box), shiftBar(ctx)); await drawCart(); showReceipt(o, ctx.settings); });
  };

  const heldDialog = async () => {
    const list = await api.get('/api/held');
    const m = modal({ title: 'Held orders', body: list.length ? H`${list.map(h => { const c = JSON.parse(h.cart_json); return H`<div class="row between" style="padding:9px 0;border-bottom:1px solid var(--line)"><span><b>${h.label || 'Held order'}</b><div class="hint">${c.items.length} item(s) &middot; ${fdt(h.created_at)}</div></span><div class="row"><button class="btn sm primary" data-act="res" data-id="${h.held_id}">Resume</button><button class="btn sm danger" data-act="rm" data-id="${h.held_id}">Delete</button></div></div>`; })}` : H`<div class="empty">No held orders.</div>` });
    bind(m.el, { click: { res: async (t) => { const h = list.find(x => x.held_id === Number(t.dataset.id)); const c = JSON.parse(h.cart_json); Object.assign(posState, { items: c.items, promo: c.promo || '', discount: c.discount || 0, redeem: 0, payments: [], customer: c.customer || null }); await api.del('/api/held/' + h.held_id); m.close(); await drawCart(); toast('Order resumed', 'ok'); },
      rm: async (t) => { await api.del('/api/held/' + t.dataset.id); m.close(); heldDialog(); } } });
  };

  bind(box, { click: { ...shiftHandlers({ ...ctx, refresh: () => ctx.refresh() }),
    cat: (t) => { posState.filter.category = t.dataset.v; $$('#pcats .chip', box).forEach(c => c.classList.toggle('active', c === t)); drawGrid(); }, pick: (t) => pick(Number(t.dataset.id)), cust: chooseCustomer,
    inc: async (t) => { const l = posState.items[t.dataset.i]; l.qty = Math.min(20, l.qty + 1); await drawCart(); }, dec: async (t) => { const l = posState.items[t.dataset.i]; l.qty = Math.max(1, l.qty - 1); await drawCart(); },
    del: async (t) => { posState.items.splice(Number(t.dataset.i), 1); await drawCart(); }, clear: async () => { if (await confirmBox('Clear the current sale?', { danger: true })) { resetPos(); await drawCart(); } },
    addpay: async () => { const amt = Number($('#pa', box).value) || Math.max(0, quote.total - payTotal()); if (!(amt > 0)) throw new Error('Enter an amount.'); posState.payments.push({ method: $('#pm', box).value, amount: Math.round(amt * 100) / 100, kind: $('#dep', box).checked ? 'deposit' : 'payment' }); await drawCart(); },
    fullpay: async () => { const amt = Math.round((quote.total - payTotal()) * 100) / 100; if (!(amt > 0)) throw new Error('Nothing left to pay.'); posState.payments.push({ method: $('#pm', box).value, amount: amt, kind: 'payment' }); await drawCart(); },
    delpay: async (t) => { posState.payments.splice(Number(t.dataset.i), 1); await drawCart(); }, checkout,
    hold: async () => { const label = posState.customer?.name || `Hold ${new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`; await api.post('/api/held', { label, cart: { items: posState.items, promo: posState.promo, discount: posState.discount, customer: posState.customer, customerId: posState.customer?.user_id } }); resetPos(); toast('Order held', 'ok'); await drawCart(); },
    held: heldDialog, gocart: () => $('#cart', box).scrollIntoView({ behavior: 'smooth', block: 'start' }) },
    input: {}, change: {} });
  box.addEventListener('input', (e) => { if (e.target.id === 'pq') { posState.filter.q = e.target.value; drawGrid(); } });
  box.addEventListener('keydown', (e) => { if (e.target.id === 'pq' && e.key === 'Enter') { const v = e.target.value.trim(); const hit = cat.products.find(p => p.barcode === v || p.sku.toLowerCase() === v.toLowerCase()); if (hit) { e.target.value = ''; posState.filter.q = ''; drawGrid(); pick(hit.product_id); } }
    if ((e.target.id === 'promo' || e.target.id === 'disc' || e.target.id === 'redeem') && e.key === 'Enter') e.target.dispatchEvent(new Event('change', { bubbles: true })); });
  box.addEventListener('change', async (e) => { const id = e.target.id;
    if (id === 'pcol') { posState.filter.color = e.target.value; drawGrid(); } else if (id === 'pfit') { posState.filter.fit = e.target.value; drawGrid(); }
    else if (id === 'disc') { posState.discount = Math.max(0, Math.min(limit, Number(e.target.value) || 0)); if (Number(e.target.value) > limit) toast(`Your discount limit is ${limit}%.`, 'bad'); await drawCart(); }
    else if (id === 'promo') { posState.promo = e.target.value.trim(); await drawCart(); } else if (id === 'redeem') { posState.redeem = Math.max(0, Math.floor(Number(e.target.value) || 0)); await drawCart(); } });
  drawGrid(); await drawCart();
}

// ---------------------------------------------------------------- APPOINTMENTS
async function viewAppointments(box, ctx) {
  let date = todayStr();
  const draw = async () => {
    const list = await api.get('/api/appointments?date=' + date);
    render($('#al', box), list.length ? H`<div class="table-wrap"><table><thead><tr><th>Time</th><th>Customer</th><th>Service</th><th>Note</th><th>Status</th><th></th></tr></thead><tbody>${list.map(a => H`<tr><td><b>${a.appt_time}</b></td><td>${a.customer_name}</td><td>${a.service}</td><td class="small muted">${a.note || ''}</td><td>${badge(a.status)}</td>
      <td class="row">${a.status === 'Booked' ? H`<button class="btn sm" data-act="st" data-s="Confirmed" data-id="${a.appointment_id}">Confirm</button>` : ''}${['Booked', 'Confirmed'].includes(a.status) ? H`<button class="btn sm primary" data-act="st" data-s="Completed" data-id="${a.appointment_id}">Done</button><button class="btn sm" data-act="st" data-s="No-show" data-id="${a.appointment_id}">No-show</button><button class="btn sm danger" data-act="st" data-s="Cancelled" data-id="${a.appointment_id}">Cancel</button>` : ''}</td></tr>`)}</tbody></table></div>` : H`<div class="empty card">No appointments on ${fdate(date)}.</div>`);
  };
  render(box, H`<div class="toolbar"><button class="btn sm" data-act="prev">&lt;</button><input type="date" id="ad" value="${date}"><button class="btn sm" data-act="next">&gt;</button><button class="btn sm" data-act="today">Today</button><span class="grow"></span><button class="btn primary" data-act="book">+ Book for customer</button></div><div id="al"></div>`);
  const setDate = (d) => { date = d; $('#ad', box).value = d; draw(); };
  const shift = (n) => setDate(new Date(new Date(date + 'T00:00:00Z').getTime() + n * 864e5).toISOString().slice(0, 10));
  box.addEventListener('change', (e) => { if (e.target.id === 'ad') setDate(e.target.value); });
  bind(box, { click: { prev: () => shift(-1), next: () => shift(1), today: () => setDate(todayStr()), st: async (t) => { await api.patch('/api/appointments/' + t.dataset.id, { status: t.dataset.s }); toast('Updated', 'ok'); draw(); },
    book: async () => { const cs = await api.get('/api/customers'); const m = modal({ title: 'Book appointment', size: 'narrow', body: H`<form data-act="go" class="stack-sm"><label class="f"><span>Customer</span><select name="customerId">${cs.map(c => H`<option value="${c.user_id}">${c.name}</option>`)}</select></label>
      <label class="f"><span>Service</span><select name="service"><option>Fitting</option><option>Consultation</option><option>Rental fitting</option><option>Alteration pickup</option></select></label><div class="grid g2"><label class="f"><span>Date</span><input type="date" name="date" value="${date}" min="${todayStr()}"></label>
      <label class="f"><span>Time</span><input type="time" name="time" value="10:00" min="09:00" max="18:00" step="1800"></label></div><label class="f"><span>Note</span><input name="note"></label><button class="btn primary">Book</button></form>` });
      bind(m.el, { submit: { go: async (f) => { await api.post('/api/appointments', formData(f)); toast('Booked', 'ok'); m.close(); draw(); } } }); } } });
  await draw();
}

// ---------------------------------------------------------------- STOCK CHECK
async function viewStock(box, ctx) {
  const inv = await api.get('/api/admin/inventory');
  const f = { q: '', cat: '', color: '', size: '' };
  const colors = [...new Set(inv.map(v => v.color_name).filter(Boolean))].sort(), cats = [...new Set(inv.map(v => v.category))];
  render(box, H`<div class="toolbar"><input class="grow" id="sq" placeholder="Search name, SKU, barcode..."><select id="scat"><option value="">All categories</option>${cats.map(c => H`<option>${c}</option>`)}</select><select id="scol"><option value="">Any color</option>${colors.map(c => H`<option>${c}</option>`)}</select><input id="ssz" placeholder="Size e.g. 50" style="width:110px"></div><div id="st"></div>`);
  const draw = () => {
    const by = new Map();
    for (const v of inv) { if (f.cat && v.category !== f.cat) continue; if (f.color && v.color_name !== f.color) continue;
      if (f.q && !`${v.name} ${v.sku} ${v.barcode || ''}`.toLowerCase().includes(f.q.toLowerCase())) continue; if (!by.has(v.product_id)) by.set(v.product_id, { v, sizes: [] }); by.get(v.product_id).sizes.push(v); }
    let rows = [...by.values()]; if (f.size) rows = rows.filter(r => r.sizes.some(s => s.size.toLowerCase() === f.size.toLowerCase() && s.stock > 0));
    render($('#st', box), rows.length ? H`<div class="table-wrap"><table><thead><tr><th>Product</th><th>Color / fit</th><th>Stock by size</th><th class="num">Total</th><th class="num">Price</th></tr></thead><tbody>${rows.map(r => H`<tr><td><b>${r.v.name}</b><div class="hint">${r.v.sku}</div></td><td class="small"><span class="sw" style="background:${r.v.color_hex}"></span> ${r.v.color_name} &middot; ${r.v.fit}</td>
      <td><div class="row" style="gap:6px">${r.sizes.map(s => H`<span class="badge ${s.stock <= 0 ? 'bad' : s.stock <= ctx.settings.lowStock ? 'warn' : 'ok'}">${s.size}: ${s.stock}</span>`)}</div></td><td class="num">${r.sizes.reduce((a, s) => a + s.stock, 0)}</td><td class="num">${usd(r.v.price)}</td></tr>`)}</tbody></table></div>` : H`<div class="empty">No matching stock.</div>`);
  };
  box.addEventListener('input', (e) => { if (e.target.id === 'sq') f.q = e.target.value; else if (e.target.id === 'ssz') f.size = e.target.value.trim(); else return; draw(); });
  box.addEventListener('change', (e) => { if (e.target.id === 'scat') f.cat = e.target.value; else if (e.target.id === 'scol') f.color = e.target.value; else return; draw(); });
  draw();
}

// ---------------------------------------------------------------- PERFORMANCE
async function viewPerformance(box, ctx) {
  const p = await api.get('/api/performance');
  render(box, H`<div class="stack"><div class="grid g4"><div class="kpi"><div class="l">Today</div><div class="v">${usd(p.today)}</div></div><div class="kpi"><div class="l">Last 7 days</div><div class="v">${usd(p.week)}</div></div>
    <div class="kpi"><div class="l">Last 30 days</div><div class="v">${usd(p.month)}</div><div class="s">${p.orders_month} orders &middot; refunds ${usd(p.refunds_month)}</div></div><div class="kpi"><div class="l">Commission (30 days)</div><div class="v gold">${usd(p.commission_month)}</div><div class="s">${p.commission_pct}% of net ${usd(p.net_month)}</div></div></div>
    <div class="card"><h2>My sales, last 14 days</h2>${barChart(p.daily.map(d => ({ label: ymd(d.day).slice(5), value: Number(d.total) })), { fmt: usd })}</div>
    <div class="hint">Commission is an estimate from your rate set by the owner; final payroll may differ.</div></div>`);
}

// ---------------------------------------------------------------- SHIFT / end-of-shift report
async function viewShift(box, ctx) {
  await loadShift();
  const hist = await api.get('/api/shift/history');
  render(box, H`<div class="stack"><div id="sb">${shiftBar(ctx)}</div><div class="grid g2" style="align-items:start">
    <div class="card">${shiftInfo?.shift ? H`<h2>Close shift</h2><div class="muted small" style="margin-bottom:10px">Count the cash in the drawer and enter it below. The system compares it with what it expects.</div>${reportCard({ ...shiftInfo.report, shift: { ...shiftInfo.report.shift } }, ctx, false)}
      <form data-act="close" class="stack-sm" style="margin-top:12px"><label class="f"><span>Counted cash in drawer (USD)</span><input type="number" name="counted" min="0" step="0.01" required></label><label class="f"><span>Note (optional)</span><input name="note" maxlength="200"></label><button class="btn primary">Close shift &amp; print report</button></form>`
      : H`<h2>No open shift</h2><div class="muted">Clock in and open a cash shift from the bar above to start taking payments.</div>`}</div>
    <div class="card"><h2>My recent shifts</h2>${hist.length ? hist.map(s => H`<div class="row between" style="padding:8px 0;border-bottom:1px solid var(--line)"><span>${fdt(s.opened_at)}${s.closed_at ? '' : ' (open)'}<div class="hint">${s.closed_at ? `Variance ${usd(s.variance)}` : 'In progress'}</div></span>${s.closed_at ? H`<button class="btn sm" data-act="rep" data-id="${s.shift_id}">Report</button>` : ''}</div>`) : H`<div class="empty">No shifts yet.</div>`}</div></div></div>`);
  const showRep = async (id) => { const r = await api.get('/api/shift/report/' + id); const m = modal({ title: 'Shift report', body: reportCard(r, ctx, !!r.shift.closed_at), footer: H`<button class="btn primary" data-act="print">Print</button>` }); bind(m.el, { click: { print: () => window.print() } }); };
  bind(box, { click: { ...shiftHandlers(ctx), rep: (t) => showRep(Number(t.dataset.id)) }, submit: { close: async (f) => { const d = formData(f); if (!(await confirmBox(`Close the shift with ${usd(d.counted)} counted?`))) return; const r = await api.post('/api/shift/close', d); toast('Shift closed', 'ok'); await showRep(r.shift.shift_id); ctx.refresh(); } } });
}

// ---------------------------------------------------------------- boot
Shell.mount({ expectedView: 'seller', subtitle: 'Point of sale', defaultView: 'dashboard',
  nav: [{ id: 'dashboard', label: 'Dashboard', icon: 'home' }, { id: 'pos', label: 'POS checkout', icon: 'pos', perm: 'pos.sell' }, { id: 'orders', label: 'Orders', icon: 'box', perm: 'orders.view' },
    { id: 'rentals', label: 'Rentals', icon: 'hanger', perm: 'rental.manage' }, { id: 'alterations', label: 'Alterations', icon: 'scissors', perm: 'alteration.manage' }, { id: 'customers', label: 'Customers', icon: 'users', perm: 'customers.manage' },
    { id: 'appointments', label: 'Appointments', icon: 'cal', perm: 'appointments.manage' }, { id: 'stock', label: 'Stock check', icon: 'tag', perm: 'inventory.view' },
    { section: 'Me' }, { id: 'performance', label: 'My performance', icon: 'chart', perm: 'performance.view' }, { id: 'shift', label: 'Shift & cash', icon: 'clock', perm: 'shift.manage' }],
  views: { dashboard: viewDashboard, pos: viewPos, orders: viewOrders, rentals: viewRentals, alterations: viewAlterations, customers: viewCustomers, appointments: viewAppointments, stock: viewStock, performance: viewPerformance, shift: viewShift }
});
