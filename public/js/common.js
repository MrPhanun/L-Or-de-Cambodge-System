'use strict';
/* Screens shared by the seller and admin views: customers, orders (+ refunds/exchanges), rentals, alteration tickets, shift report card. */

const MEAS = [['chest', 'Chest'], ['waist', 'Waist'], ['shoulder', 'Shoulder'], ['sleeve', 'Sleeve'], ['inseam', 'Inseam'], ['neck', 'Neck']];
let cat = null;
const loadCat = async () => (cat = await api.get('/api/catalog'));

// ---------------------------------------------------------------- customers (also used by POS)
function newCustomerDialog(ctx, done) {
  const m = modal({ title: 'New customer', size: 'narrow', body: H`<form data-act="go" class="stack-sm"><label class="f"><span>Full name</span><input name="name" required></label><label class="f"><span>Email</span><input type="email" name="email" required></label>
    <label class="f"><span>Phone</span><input name="phone"></label><label class="f"><span>Address</span><input name="address"></label><button class="btn primary">Create customer</button>
    <div class="hint">This creates a customer record for the counter. For online access, an admin sets a password for them (Staff &gt; Reset password).</div></form>` });
  bind(m.el, { submit: { go: async (f) => { const d = formData(f); const r = await api.post('/api/customers', d); toast('Customer created', 'ok'); m.close(); done?.({ user_id: r.id, name: d.name, email: d.email, phone: d.phone }); } } });
}
async function customerCard(id, ctx) {
  const c = await api.get('/api/customers/' + id);
  const m = modal({ title: c.name, size: 'wide', body: H`<div class="stack"><div class="row between"><div class="muted small">${c.email} &middot; ${c.phone || 'no phone'} &middot; ${c.address || 'no address'}</div><span class="tier ${c.tier}">${c.tier} - ${c.loyalty_points} pts</span></div>
    <div class="grid g2"><form data-act="meas" class="card"><h3>Measurements (cm)</h3><div class="grid g3">${MEAS.map(([k, l]) => H`<label class="f"><span>${l}</span><input type="number" step="0.5" name="${k}" value="${c.measurements[k] ?? ''}"></label>`)}</div>
      <div class="row between" style="margin-top:8px"><span class="hint">${c.measurements.updated_at ? 'Updated ' + fdate(c.measurements.updated_at) : 'Not recorded'}</span><button class="btn sm primary">Save</button></div></form>
      <div class="card"><h3>Upcoming &amp; recent appointments</h3>${c.appointments.slice(0, 4).map(a => H`<div class="row between small" style="padding:4px 0"><span>${fdate(a.appt_date)} ${a.appt_time} - ${a.service}</span>${badge(a.status)}</div>`)}${c.appointments.length ? '' : H`<div class="empty">None</div>`}
        <h3 style="margin-top:10px">Alterations</h3>${c.alterations.slice(0, 4).map(a => H`<div class="row between small" style="padding:4px 0"><span>${a.alt_no} ${a.item}</span>${badge(a.status)}</div>`)}${c.alterations.length ? '' : H`<div class="empty">None</div>`}</div></div>
    <div><h3>Purchase history</h3><div class="table-wrap"><table><thead><tr><th>Order</th><th>Date</th><th>Items</th><th>Status</th><th class="num">Total</th></tr></thead><tbody>${c.orders.map(o => H`<tr><td>${o.order_no}</td><td>${fdate(o.created_at)}</td><td class="small">${o.items.map(i => i.name).join(', ')}</td><td>${badge(o.status)}</td><td class="num">${usd(o.total)}</td></tr>`)}</tbody></table></div></div></div>` });
  bind(m.el, { submit: { meas: async (f) => { await api.put(`/api/customers/${id}/measurements`, formData(f)); toast('Measurements saved', 'ok'); } } });
}
async function viewCustomers(box, ctx) {
  let list = await api.get('/api/customers');
  const draw = () => render($('#cust', box), list.length ? H`<div class="table-wrap"><table><thead><tr><th>Name</th><th>Contact</th><th class="num">Orders</th><th class="num">Spent</th><th class="num">Points</th><th></th></tr></thead><tbody>${list.map(c => H`<tr><td><b>${c.name}</b></td><td class="small">${c.phone || ''}<div class="muted">${c.email}</div></td><td class="num">${c.orders}</td><td class="num">${usd(c.spent)}</td><td class="num">${c.loyalty_points}</td><td><button class="btn sm" data-act="open" data-id="${c.user_id}">Profile</button></td></tr>`)}</tbody></table></div>` : H`<div class="empty">No customers found.</div>`);
  render(box, H`<div class="toolbar"><input class="grow" id="cs" placeholder="Search by name, phone or email..."><button class="btn primary" data-act="new">+ New customer</button></div><div id="cust"></div>`); draw();
  let tm; box.addEventListener('input', (e) => { if (e.target.id !== 'cs') return; clearTimeout(tm); tm = setTimeout(async () => { list = await api.get('/api/customers?search=' + encodeURIComponent(e.target.value)); draw(); }, 250); });
  bind(box, { click: { open: (t) => customerCard(Number(t.dataset.id), ctx), new: () => newCustomerDialog(ctx, () => ctx.refresh()) } });
}

// ---------------------------------------------------------------- ORDERS (online + in-store, fulfil, collect balance, refund / exchange)
function itemTable(o) {
  return H`<div class="table-wrap"><table><thead><tr><th>Item</th><th>Detail</th><th class="num">Qty</th><th class="num">Total</th></tr></thead><tbody>${o.items.map(i => H`<tr><td>${i.name}</td><td class="small muted">${i.kind === 'rent' ? `Rent ${fdate(i.rent_from)} - ${fdate(i.rent_to)}` : i.kind === 'tailor' ? `${i.tailor_fabric}, ${i.tailor_fit} ${i.tailor_notes || ''}` : 'Size ' + i.size}</td><td class="num">${i.qty}</td><td class="num">${usd(i.kind === 'rent' ? i.unit_price * i.rent_days * i.qty : i.unit_price * i.qty)}</td></tr>`)}</tbody></table></div>`;
}
async function orderDialog(id, ctx, onChange) {
  const o = await api.get('/api/orders/' + id), s = ctx.settings;
  const canFul = ctx.can('orders.fulfil'), canRef = ctx.can('refund.process'), canPay = ctx.can('pos.sell') || canFul;
  const next = o.status === 'Pending' ? (o.has_tailor ? ['Tailoring'] : ['Ready']) : o.status === 'Tailoring' ? ['Ready'] : o.status === 'Ready' ? [o.fulfilment === 'delivery' ? 'Delivered' : 'Picked Up'] : [];
  const m = modal({ title: `${o.order_no} - ${o.customer_name}`, size: 'wide', body: H`<div class="stack"><div class="row between"><div>${badge(o.status)} ${o.overdue ? H`<span class="badge bad">Overdue</span>` : ''} <span class="muted small">${fdt(o.created_at)} &middot; ${o.channel === 'pos' ? 'In store' : 'Online'}${o.seller_name ? ' &middot; ' + o.seller_name : ''} &middot; ${o.fulfilment}${o.address ? ' (' + o.address + ')' : ''}</span></div><b>${usd(o.total)}</b></div>
    ${o.note ? H`<div class="alert small">Note: ${o.note}</div>` : ''}${orderSteps(o)}${itemTable(o)}
    <div class="grid g2"><div><h3>Payments</h3>${o.payments.map(p => H`<div class="row between small"><span>${p.method}${p.kind === 'deposit' ? ' (deposit)' : ''} - ${fdt(p.at)}</span><span>${usd(p.amount)}</span></div>`)}${o.payments.length ? '' : H`<div class="muted small">Nothing paid yet.</div>`}
      ${o.balance > 0.005 ? H`<div class="row between warn" style="margin-top:6px"><b>Balance due</b><b>${usd(o.balance)}</b></div>` : H`<div class="ok small" style="margin-top:6px">Paid in full</div>`}
      ${o.refunds.map(r => H`<div class="row between small ok"><span>Refund ${r.method} - ${r.reason}</span><span>-${usd(r.amount)}</span></div>`)}${o.exchanges.map(x => H`<div class="small muted">Exchanged ${x.from_size} to ${x.to_size}</div>`)}
      ${o.balance > 0.005 && canPay && !['Cancelled', 'Returned'].includes(o.status) ? H`<div class="row" style="margin-top:8px"><select id="cm" style="width:auto">${s.paymentMethods.filter(x => x !== 'Pay in store').map(x => H`<option>${x}</option>`)}</select><input type="number" id="ca" step="0.01" value="${o.balance.toFixed(2)}" style="width:110px"><button class="btn sm primary" data-act="collect">Collect</button></div>` : ''}</div>
      <div><h3>History</h3><ul class="timeline">${o.history.map(h => H`<li><b>${h.status}</b> <span class="hint">${fdt(h.at)} - ${h.by_name || ''}</span></li>`)}</ul></div></div></div>`,
    footer: H`<button class="btn" data-act="rc">Receipt</button>${canRef && !['Cancelled'].includes(o.status) && o.payments.length ? H`<button class="btn" data-act="refund">Refund / exchange</button>` : ''}
      ${canFul && !['Picked Up', 'Delivered', 'Cancelled', 'Returned'].includes(o.status) ? H`<button class="btn danger" data-act="cancel">Cancel order</button>` : ''}${canFul ? next.map(n => H`<button class="btn primary" data-act="st" data-s="${n}">Mark ${n}</button>`) : ''}` });
  const reload = () => { m.close(); onChange?.(); orderDialog(id, ctx, onChange); };
  bind(m.el, { click: { rc: () => showReceipt(o, s),
    st: async (t) => { await api.post(`/api/orders/${id}/status`, { status: t.dataset.s }); toast('Order updated', 'ok'); m.close(); onChange?.(); },
    cancel: async () => { if (await confirmBox(`Cancel ${o.order_no}? Stock will be returned.`, { danger: true })) { await api.post(`/api/orders/${id}/status`, { status: 'Cancelled' }); toast('Order cancelled', 'ok'); m.close(); onChange?.(); } },
    collect: async () => { await api.post(`/api/orders/${id}/payments`, { method: $('#cm', m.el).value, amount: Number($('#ca', m.el).value) }); toast('Payment recorded', 'ok'); reload(); },
    refund: () => { m.close(); refundDialog(o, ctx, onChange); } } });
}
function refundDialog(o, ctx, onChange) {
  const sizes = {}; const need = async () => { await loadCat(); };
  const m = modal({ title: `Return / exchange - ${o.order_no}`, size: 'wide', body: H`<div class="stack"><div class="tabs"><button class="active" data-act="rt" data-t="refund">Refund</button><button data-act="rt" data-t="exchange">Size exchange</button></div><div id="rb"></div></div>` });
  let tab = 'refund'; const days = Math.floor((Date.now() - new Date(o.created_at)) / 864e5);
  const draw = async () => {
    if (tab === 'refund') render($('#rb', m.el), H`<form data-act="doref" class="stack"><div class="small muted">${days > ctx.settings.refundDays ? H`<span class="warn">Outside the ${ctx.settings.refundDays}-day window - needs manager approval.</span>` : `Within the ${ctx.settings.refundDays}-day return window.`}</div>
      <div class="table-wrap"><table><thead><tr><th>Item</th><th class="num">Bought</th><th class="num">Return qty</th></tr></thead><tbody>${o.items.map(i => { const done = o.refunds.reduce((s, r) => s + r.lines.filter(l => l.item_id === i.item_id).reduce((a, l) => a + l.qty, 0), 0); return H`<tr><td>${i.name} <span class="muted small">${i.size}</span></td><td class="num">${i.qty}${done ? ` (${done} returned)` : ''}</td><td class="num"><input type="number" name="q_${i.item_id}" min="0" max="${i.qty - done}" value="0" style="width:80px" ${i.qty - done <= 0 ? 'disabled' : ''}></td></tr>`; })}</tbody></table></div>
      <div class="grid g2"><label class="f"><span>Reason</span><select name="reason"><option>Wrong size</option><option>Defective</option><option>Changed mind</option><option>Not as described</option><option>Other</option></select></label>
        <label class="f"><span>Refund to</span><select name="method">${ctx.settings.paymentMethods.filter(x => x !== 'Pay in store').map(x => H`<option>${x}</option>`)}</select></label></div><button class="btn primary">Process refund</button></form>`);
    else { await need(); render($('#rb', m.el), H`<form data-act="doex" class="stack"><div class="hint">Swap the size of a ready-made item. Stock is adjusted automatically. Same product only (no price change).</div>
      ${o.items.filter(i => i.kind === 'buy').map(i => { const p = cat.products.find(x => x.product_id === i.product_id); return H`<div class="row between" style="padding:8px 0;border-bottom:1px solid var(--line)"><span>${i.name} - now <b>${i.size}</b></span><span class="row"><select name="s_${i.item_id}" style="width:auto"><option value="">Keep</option>${(p?.variants || []).filter(v => v.size !== i.size && v.stock > 0).map(v => H`<option value="${v.size}">${v.size} (${v.stock} in stock)</option>`)}</select></span></div>`; })}
      <button class="btn primary">Exchange selected</button></form>`); }
  };
  draw();
  bind(m.el, { click: { rt: (t) => { tab = t.dataset.t; $$('.tabs button', m.el).forEach(b => b.classList.toggle('active', b === t)); draw(); } },
    submit: { doref: async (f) => { const d = formData(f), lines = o.items.map(i => ({ itemId: i.item_id, qty: Number(d['q_' + i.item_id] || 0) })).filter(l => l.qty > 0); if (!lines.length) throw new Error('Choose at least one item to return.');
        const r = await api.post(`/api/orders/${o.order_id}/refund`, { lines, reason: d.reason, method: d.method }); toast(`Refunded ${usd(r.refunds.at(-1).amount)}`, 'ok'); m.close(); onChange?.(); showReceipt(r, ctx.settings); },
      doex: async (f) => { const d = formData(f); let n = 0, last; for (const i of o.items) { const s = d['s_' + i.item_id]; if (s) { last = await api.post(`/api/orders/${o.order_id}/exchange`, { itemId: i.item_id, newSize: s }); n++; } } if (!n) throw new Error('Choose a new size.'); toast(`${n} item(s) exchanged`, 'ok'); m.close(); onChange?.(); showReceipt(last, ctx.settings); } } });
}
async function viewOrders(box, ctx) {
  const f = { status: '', channel: '', search: '', from: '', to: '', mine: '' };
  const draw = async () => {
    const orders = await api.get('/api/orders?' + qs({ ...f, limit: 300 }));
    ctx.setBadge('orders', orders.filter(o => o.channel === 'online' && ['Pending', 'Tailoring', 'Ready'].includes(o.status)).length);
    render($('#ot', box), orders.length ? H`<div class="table-wrap"><table><thead><tr><th>Order</th><th>Date</th><th>Customer</th><th>Channel</th><th>Status</th><th class="num">Total</th><th class="num">Balance</th><th></th></tr></thead><tbody>${orders.map(o => H`<tr><td><b>${o.order_no}</b>${o.has_tailor ? H` <span class="badge info">T</span>` : ''}${o.has_rental ? H` <span class="badge info">R</span>` : ''}</td><td>${fdt(o.created_at)}</td><td>${o.customer_name}</td><td>${o.channel === 'pos' ? 'Store' : 'Online'}</td>
      <td>${o.overdue ? H`<span class="badge bad">Overdue</span>` : badge(o.status)}</td><td class="num">${usd(o.total)}</td><td class="num ${o.balance > 0.005 ? 'warn' : ''}">${o.balance > 0.005 ? usd(o.balance) : '-'}</td><td><button class="btn sm" data-act="open" data-id="${o.order_id}">Open</button></td></tr>`)}</tbody></table></div>` : H`<div class="empty">No orders match.</div>`);
  };
  render(box, H`<div class="toolbar"><input class="grow" id="os" placeholder="Search order no. or customer..."><select id="ost"><option value="">Any status</option>${['Pending', 'Tailoring', 'Ready', 'Picked Up', 'Delivered', 'Returned', 'Cancelled'].map(s => H`<option>${s}</option>`)}</select>
    <select id="och"><option value="">All channels</option><option value="online">Online</option><option value="pos">In store</option></select><input type="date" id="ofr" title="From"><input type="date" id="oto" title="To">
    <label class="chk"><input type="checkbox" id="omine"> My sales</label></div><div id="ot"></div>`);
  let tm; box.addEventListener('input', (e) => { if (e.target.id === 'os') { f.search = e.target.value; clearTimeout(tm); tm = setTimeout(draw, 250); } });
  box.addEventListener('change', (e) => { const id = e.target.id; if (id === 'ost') f.status = e.target.value; else if (id === 'och') f.channel = e.target.value; else if (id === 'ofr') f.from = e.target.value; else if (id === 'oto') f.to = e.target.value; else if (id === 'omine') f.mine = e.target.checked ? '1' : ''; else return; draw(); });
  bind(box, { click: { open: (t) => orderDialog(Number(t.dataset.id), ctx, draw) } });
  await draw();
}

// ---------------------------------------------------------------- RENTALS
async function viewRentals(box, ctx) {
  const all = await api.get('/api/rentals');
  let tab = 'out';
  const groups = { upcoming: (o) => ['Pending', 'Ready'].includes(o.status), out: (o) => o.status === 'Picked Up' && !o.overdue, overdue: (o) => o.overdue, returned: (o) => o.status === 'Returned' };
  const lateCalc = (o) => { let fee = 0; for (const i of o.items.filter(x => x.kind === 'rent')) { const late = Math.max(0, Math.round((new Date(todayStr()) - new Date(ymd(i.rent_to))) / 864e5)); fee += late * i.unit_price * ctx.settings.lateFeePct / 100 * i.qty; } return fee; };
  const draw = () => {
    ctx.setBadge('rentals', all.filter(groups.overdue).length);
    const list = all.filter(groups[tab]);
    render(box, H`<div class="tabs">${Object.keys(groups).map(t => H`<button class="${t === tab ? 'active' : ''}" data-act="tab" data-t="${t}">${t[0].toUpperCase() + t.slice(1)} (${all.filter(groups[t]).length})</button>`)}</div>
      ${list.length ? H`<div class="table-wrap"><table><thead><tr><th>Order</th><th>Customer</th><th>Item</th><th>Period</th><th class="num">Deposit</th><th>Status</th><th></th></tr></thead><tbody>${list.map(o => H`<tr><td><b>${o.order_no}</b></td><td>${o.customer_name}</td><td class="small">${o.items.filter(i => i.kind === 'rent').map(i => `${i.name} (${i.size})`).join(', ')}</td>
        <td class="small">${o.items.filter(i => i.kind === 'rent').map(i => `${fdate(i.rent_from)} - ${fdate(i.rent_to)}`)[0]}</td><td class="num">${usd(o.deposit)}</td><td>${o.overdue ? H`<span class="badge bad">Overdue - late fee ${usd(lateCalc(o))}</span>` : badge(o.status)}</td>
        <td>${o.status === 'Picked Up' ? H`<button class="btn sm primary" data-act="checkin" data-id="${o.order_id}">Check in</button>` : o.status === 'Ready' || o.status === 'Pending' ? H`<button class="btn sm" data-act="open" data-id="${o.order_id}">Check out</button>` : H`<button class="btn sm" data-act="open" data-id="${o.order_id}">View</button>`}</td></tr>`)}</tbody></table></div>` : H`<div class="empty card">Nothing here.</div>`}
      <div class="hint" style="margin-top:10px">Late fee: ${ctx.settings.lateFeePct}% of the daily rate per extra day, taken from the deposit. Rentals paid at the counter are checked out automatically; online reservations are checked out by marking them Picked Up after payment.</div>`);
  };
  draw();
  bind(box, { click: { tab: (t) => { tab = t.dataset.t; draw(); }, open: (t) => orderDialog(Number(t.dataset.id), ctx, () => ctx.refresh()),
    checkin: (t) => { const o = all.find(x => x.order_id === Number(t.dataset.id)), late = lateCalc(o);
      const m = modal({ title: `Check in ${o.order_no}`, size: 'narrow', body: H`<form data-act="go" class="stack"><div class="small">${o.customer_name} &middot; deposit held ${usd(o.deposit)}</div>${late ? H`<div class="alert bad">Late fee: ${usd(late)}</div>` : H`<div class="alert ok">Returned on time.</div>`}
        <label class="f"><span>Damage / cleaning fee (USD)</span><input type="number" name="damageFee" min="0" step="0.01" value="0"></label><label class="f"><span>Condition notes</span><input name="note" maxlength="200"></label>
        <div class="hint">Deposit refund = deposit - late fee - damage fee.</div><button class="btn primary">Complete check-in</button></form>` });
      bind(m.el, { submit: { go: async (f) => { const r = await api.post(`/api/orders/${o.order_id}/rental-checkin`, formData(f)); toast(`Checked in. Deposit refund ${usd(r.rental_return.deposit_refund)}`, 'ok'); m.close(); ctx.refresh(); } } }); } } });
}

// ---------------------------------------------------------------- ALTERATIONS
async function viewAlterations(box, ctx) {
  const [list, team] = await Promise.all([api.get('/api/alterations'), api.get('/api/team')]);
  const tailors = team.filter(t => ['tailor', 'seller', 'manager', 'admin'].includes(t.role));
  let tab = 'open';
  const draw = () => {
    ctx.setBadge('alterations', list.filter(a => ['Received', 'In Progress'].includes(a.status)).length);
    const rows = list.filter(a => tab === 'open' ? ['Received', 'In Progress'].includes(a.status) : tab === 'ready' ? a.status === 'Ready' : a.status === 'Collected');
    render(box, H`<div class="row between" style="margin-bottom:12px"><div class="tabs" style="margin:0;flex:1">${[['open', 'In workshop'], ['ready', 'Ready'], ['done', 'Collected']].map(([t, l]) => H`<button class="${t === tab ? 'active' : ''}" data-act="tab" data-t="${t}">${l}</button>`)}</div><button class="btn primary" data-act="new">+ New ticket</button></div>
      ${rows.length ? H`<div class="table-wrap"><table><thead><tr><th>Ticket</th><th>Customer</th><th>Item &amp; work</th><th>Due</th><th>Tailor</th><th>Status</th><th class="num">Fee</th><th></th></tr></thead><tbody>${rows.map(a => H`<tr><td><b>${a.alt_no}</b></td><td>${a.customer_name}</td><td><b class="small">${a.item}</b><div class="small muted">${a.work}</div></td><td class="small ${a.due_date && ymd(a.due_date) < todayStr() && a.status !== 'Collected' ? 'bad' : ''}">${a.due_date ? fdate(a.due_date) : '-'}</td>
        <td><select data-act="assign" data-id="${a.alteration_id}" style="width:auto" ${ctx.user.role === 'tailor' && a.tailor_id && a.tailor_id !== ctx.user.id ? 'disabled' : ''}><option value="">Unassigned</option>${tailors.map(t => H`<option value="${t.user_id}" ${t.user_id === a.tailor_id ? 'selected' : ''}>${t.name}</option>`)}</select></td>
        <td>${badge(a.status)}</td><td class="num">${usd(a.fee)}</td><td>${a.status === 'Received' ? H`<button class="btn sm" data-act="st" data-s="In Progress" data-id="${a.alteration_id}">Start</button>` : a.status === 'In Progress' ? H`<button class="btn sm primary" data-act="st" data-s="Ready" data-id="${a.alteration_id}">Mark ready</button>` : a.status === 'Ready' ? H`<button class="btn sm primary" data-act="st" data-s="Collected" data-id="${a.alteration_id}">Collected</button>` : ''}</td></tr>`)}</tbody></table></div>` : H`<div class="empty card">No tickets here.</div>`}`);
  };
  draw();
  const m2 = (t) => list.find(a => a.alteration_id === Number(t.dataset.id));
  bind(box, { click: { tab: (t) => { tab = t.dataset.t; draw(); }, st: async (t) => { const a = await api.patch('/api/alterations/' + t.dataset.id, { status: t.dataset.s }); Object.assign(m2(t), a); toast('Ticket updated', 'ok'); draw(); },
    new: () => { const m = modal({ title: 'New alteration ticket', body: H`<form data-act="go" class="stack-sm"><label class="f"><span>Customer (optional)</span><select name="customerId" id="ac"><option value="">Walk-in</option></select></label>
      <label class="f"><span>Walk-in name</span><input name="customerName" placeholder="if no account"></label><label class="f"><span>Garment</span><input name="item" required placeholder="e.g. Navy suit jacket"></label>
      <label class="f"><span>Work to do</span><textarea name="work" required placeholder="e.g. Shorten sleeves 2cm, take in waist"></textarea></label><div class="grid g2"><label class="f"><span>Fee (USD)</span><input type="number" name="fee" min="0" step="0.01" value="0"></label><label class="f"><span>Due date</span><input type="date" name="due" min="${todayStr()}"></label></div>
      <label class="f"><span>Assign to</span><select name="tailorId"><option value="">Unassigned</option>${tailors.map(t => H`<option value="${t.user_id}">${t.name} (${t.role})</option>`)}</select></label><button class="btn primary">Create ticket</button></form>` });
      if (ctx.can('customers.manage')) api.get('/api/customers').then(cs => render($('#ac', m.el), H`<option value="">Walk-in</option>${cs.map(c => H`<option value="${c.user_id}">${c.name}</option>`)}`)).catch(() => {});
      bind(m.el, { submit: { go: async (f) => { await api.post('/api/alterations', formData(f)); toast('Ticket created', 'ok'); m.close(); ctx.refresh(); } } }); } },
    change: { assign: async (t) => { const a = await api.patch('/api/alterations/' + t.dataset.id, { tailorId: t.value || null }); Object.assign(m2(t), a); toast('Assigned', 'ok'); } } });
}

// ---------------------------------------------------------------- SHIFT / end-of-shift report
function reportCard(rep, ctx, closed) {
  const s = rep.shift;
  return H`<div class="receipt"><h3>${ctx.settings.storeName}</h3><div class="c">End-of-shift cash report</div><hr><div>Cashier: ${s.user_name}</div><div>Opened: ${fdt(s.opened_at)}</div>${s.closed_at ? H`<div>Closed: ${fdt(s.closed_at)}</div>` : ''}<hr>
    <div class="r"><span>Orders paid</span><span>${rep.orders}</span></div>${rep.payments.map(p => H`<div class="r"><span>${p.method} (${p.n})</span><span>${usd(p.total)}</span></div>`)}<div class="r"><b>Total takings</b><b>${usd(rep.sales)}</b></div>
    ${rep.refunds.map(p => H`<div class="r"><span>Refunds ${p.method} (${p.n})</span><span>-${usd(p.total)}</span></div>`)}<hr>
    <div class="r"><span>Opening float</span><span>${usd(s.float_amount)}</span></div><div class="r"><span>+ Cash sales</span><span>${usd(rep.cash_in)}</span></div><div class="r"><span>- Cash refunds</span><span>${usd(rep.cash_refunds)}</span></div>
    <div class="r"><b>Expected in drawer</b><b>${usd(rep.expected)}</b></div>${closed ? H`<div class="r"><span>Counted</span><span>${usd(s.counted)}</span></div><div class="r"><b>Variance</b><b>${usd(s.variance)}</b></div>${s.note ? H`<div>Note: ${s.note}</div>` : ''}` : ''}</div>`;
}
