'use strict';
/* CLIENT VIEW: shop, product details, cart & checkout, measurements, custom tailoring, appointments, rentals, orders, loyalty, notifications, profile. */

const MEASURES = [['chest', 'Chest'], ['waist', 'Waist'], ['shoulder', 'Shoulder'], ['sleeve', 'Sleeve'], ['inseam', 'Inseam'], ['neck', 'Neck']];
const STYLES = ['Single-breasted, 2 buttons', 'Single-breasted, 3 buttons', 'Double-breasted', 'Peak lapel', 'Shawl lapel (tuxedo)', 'Mandarin collar', 'Classic collar'];
const TIERS = [{ name: 'Member', min: 0, perk: 'Welcome offer and birthday greeting' }, { name: 'Silver', min: 500, perk: 'Free alterations on hems' },
  { name: 'Gold', min: 1500, perk: 'Priority fittings and free delivery' }, { name: 'VIP', min: 3000, perk: 'Private styling session and early access to new collections' }];
let catalog = null;

// ---------------------------------------------------------------- cart (kept in this browser; prices are always recalculated by the server)
const cartKey = () => 'lodc_cart_' + Shell.user.id;
const getCart = () => { try { return JSON.parse(localStorage.getItem(cartKey())) || []; } catch { return []; } };
const setCart = (c) => { try { localStorage.setItem(cartKey(), JSON.stringify(c)); } catch { /* storage blocked */ } Shell.ctx?.setBadge('cart', c.reduce((s, i) => s + i.qty, 0)); };
function addToCart(item) {
  const c = getCart();
  const same = c.find(i => i.kind === item.kind && i.productId === item.productId && i.size === item.size && i.rentFrom === item.rentFrom && i.rentTo === item.rentTo && item.kind !== 'tailor');
  if (same) same.qty = Math.min(20, same.qty + item.qty); else c.push(item);
  setCart(c);
}
const loadCatalog = async () => (catalog = await api.get('/api/catalog'));
const priceOf = (p) => H`${p.sale_pct ? H`<span class="old">${usd(p.price)}</span>` : ''}${usd(p.eff_price)}`;

// ---------------------------------------------------------------- ACCOUNT OVERVIEW
async function viewOverview(box, ctx) {
  const [profile, orders, appts, notes] = await Promise.all([api.get('/api/me/profile'), api.get('/api/orders'), api.get('/api/appointments'), api.get('/api/me/notifications')]);
  const active = orders.filter(o => !['Picked Up', 'Delivered', 'Cancelled', 'Returned'].includes(o.status) || o.overdue);
  const next = appts.filter(a => ['Booked', 'Confirmed'].includes(a.status) && ymd(a.appt_date) >= todayStr()).sort((a, b) => ymd(a.appt_date).localeCompare(ymd(b.appt_date)))[0];
  const pct = profile.next_tier_at ? Math.min(100, profile.loyalty_points / profile.next_tier_at * 100) : 100;
  render(box, H`<div class="stack">
    <div class="card"><div class="row between"><div><div class="muted">Bonjour,</div><h1>${ctx.user.name}</h1></div><span class="tier ${profile.tier}">${profile.tier}</span></div>
      <div style="margin-top:14px"><div class="row between small"><span>${profile.loyalty_points} points</span><span class="muted">${profile.next_tier ? `${profile.next_tier_at - profile.loyalty_points} points to ${profile.next_tier}` : 'Top tier reached'}</span></div>
      <div class="progress" style="margin-top:6px"><i style="width:${pct}%"></i></div></div></div>
    <div class="grid g3">
      <div class="kpi"><div class="l">Active orders</div><div class="v">${active.length}</div><div class="s">${orders.length} orders in total</div></div>
      <div class="kpi"><div class="l">Next appointment</div><div class="v" style="font-size:1.1rem">${next ? `${fdate(next.appt_date)} ${next.appt_time}` : 'None booked'}</div><div class="s">${next ? next.service : 'Book a fitting any time'}</div></div>
      <div class="kpi"><div class="l">Measurements</div><div class="v" style="font-size:1.1rem">${profile.measurements.chest ? 'Saved' : 'Missing'}</div><div class="s">${profile.measurements.updated_at ? 'Updated ' + fdate(profile.measurements.updated_at) : 'Needed for tailoring'}</div></div>
    </div>
    <div class="grid g2">
      <div class="card"><div class="row between"><h2>Order status</h2><a href="#/orders">All orders</a></div>
        ${active.length ? active.slice(0, 3).map(o => H`<div style="margin:10px 0"><div class="row between"><b>${o.order_no}</b>${badge(o.status)}</div>${orderSteps(o)}<div class="small muted">${o.items.map(i => i.name).join(', ')}</div></div>`) : H`<div class="empty">No active orders. <a href="#/shop">Start shopping</a></div>`}</div>
      <div class="card"><div class="row between"><h2>Latest updates</h2><a href="#/notifications">All</a></div>
        ${notes.slice(0, 5).map(n => H`<div style="padding:8px 0;border-bottom:1px solid var(--line)"><b>${n.title}</b><div class="small muted">${n.body}</div></div>`)}</div>
    </div></div>`);
}

// ---------------------------------------------------------------- CART & CHECKOUT
async function viewCart(box, ctx) {
  const cart = getCart();
  if (!cart.length) return render(box, H`<div class="card empty">Your cart is empty. <a href="#/shop">Browse the shop</a></div>`);
  const profile = await api.get('/api/me/profile');
  const state = { promo: '', redeem: 0, fulfilment: 'pickup', address: profile.address || '', pay: 'Pay in store', note: '' };
  const online = ctx.settings.paymentMethods.filter(m => m !== 'Cash');
  const draw = async () => {
    let q;
    try { q = await api.post('/api/quote', { items: cart, promoCode: state.promo, redeemPoints: state.redeem }); }
    catch (e) { if (/no longer available|valid size|out of stock/i.test(e.message)) { setCart([]); } throw e; }
    render(box, H`<div class="grid g2" style="grid-template-columns:1.4fr 1fr;align-items:start">
      <div class="card"><h2>Your cart</h2>${q.lines.map((l, i) => H`<div class="cl"><div><b>${l.name}</b><div class="small muted">${l.kind === 'rent' ? `Rental ${fdate(l.rent_from)} to ${fdate(l.rent_to)} (${l.rent_days} days), deposit ${usd(l.deposit)}` : l.kind === 'tailor' ? `Made to measure: ${l.tailor_fabric}, ${l.tailor_fit}, ${l.tailor_style || 'standard style'}` : `Size ${l.size}`}</div></div>
        <div class="right"><b>${usd(l.line_total)}</b><div class="row" style="justify-content:flex-end;margin-top:4px">${l.kind === 'buy' ? H`<div class="qty"><button data-act="dec" data-i="${i}">-</button><span>${l.qty}</span><button data-act="inc" data-i="${i}">+</button></div>` : ''}<button class="btn sm danger" data-act="del" data-i="${i}">Remove</button></div></div></div>`)}
        ${q.bundle_discount ? H`<div class="alert ok" style="margin-top:10px">Bundle deal applied: ${q.bundle_names} saves you ${usd(q.bundle_discount)}.</div>` : ''}</div>
      <div class="stack"><div class="card"><h2>Checkout</h2><div class="stack-sm">
        <label class="f"><span>Promo code</span><div class="row"><input id="promo" value="${state.promo}" placeholder="e.g. WELCOME10" class="grow"><button class="btn" data-act="apply">Apply</button></div></label>
        ${q.promo_invalid ? H`<div class="small bad">That code is not valid.</div>` : q.promo_code ? H`<div class="small ok">Code ${q.promo_code} applied.</div>` : ''}
        <label class="f"><span>Use loyalty points (you have ${profile.loyalty_points}; 100 points = ${usd(100 * ctx.settings.pointValue)})</span><input type="number" id="redeem" min="0" max="${profile.loyalty_points}" value="${state.redeem}" step="50"></label>
        <label class="f"><span>Receive</span><select id="ful"><option value="pickup" ${state.fulfilment === 'pickup' ? 'selected' : ''}>Pick up in store</option><option value="delivery" ${state.fulfilment === 'delivery' ? 'selected' : ''}>Delivery</option></select></label>
        ${state.fulfilment === 'delivery' ? H`<label class="f"><span>Delivery address</span><textarea id="addr">${state.address}</textarea></label>` : ''}
        <label class="f"><span>Payment</span><select id="pay">${online.map(m => H`<option ${state.pay === m ? 'selected' : ''}>${m}</option>`)}</select></label>
        ${state.pay !== 'Pay in store' ? H`<div class="alert warn small">Demo mode: online payments (KHQR, ABA Pay, card) are simulated. No card details are collected and no money moves.</div>` : H`<div class="hint">Pay when you collect your order at the shop.</div>`}
        <label class="f"><span>Note for the shop (optional)</span><input id="note" value="${state.note}" maxlength="200"></label></div>
        <div class="tot"><div><span>Subtotal</span><span>${usd(q.subtotal)}</span></div>
          ${q.bundle_discount ? H`<div class="ok"><span>Bundle</span><span>-${usd(q.bundle_discount)}</span></div>` : ''}${q.discount ? H`<div class="ok"><span>Promo ${q.discount_pct}%</span><span>-${usd(q.discount)}</span></div>` : ''}
          ${q.points_value ? H`<div class="ok"><span>Points (${q.redeemed_points})</span><span>-${usd(q.points_value)}</span></div>` : ''}
          <div><span>VAT ${ctx.settings.vatPct}%</span><span>${usd(q.tax)}</span></div>${q.deposit ? H`<div><span>Rental deposit (refundable)</span><span>${usd(q.deposit)}</span></div>` : ''}
          <div class="grand"><span>Total</span><span>${usd(q.total)}</span></div><div class="muted small right">${khr(q.total)}</div></div>
        <button class="btn primary lg block" data-act="place" style="margin-top:12px">${state.pay === 'Pay in store' ? 'Place order' : `Pay ${usd(q.total)}`}</button></div></div></div>`);
  };
  const sync = () => { state.promo = $('#promo', box)?.value ?? state.promo; state.redeem = Math.max(0, Math.floor(Number($('#redeem', box)?.value) || 0)); state.fulfilment = $('#ful', box)?.value || state.fulfilment;
    state.address = $('#addr', box)?.value ?? state.address; state.pay = $('#pay', box)?.value || state.pay; state.note = $('#note', box)?.value ?? state.note; };
  bind(box, { click: {
    apply: async () => { sync(); await draw(); },
    inc: async (t) => { cart[t.dataset.i].qty = Math.min(20, cart[t.dataset.i].qty + 1); setCart(cart); sync(); await draw(); },
    dec: async (t) => { cart[t.dataset.i].qty = Math.max(1, cart[t.dataset.i].qty - 1); setCart(cart); sync(); await draw(); },
    del: async (t) => { cart.splice(Number(t.dataset.i), 1); setCart(cart); ctx.refresh(); },
    place: async (t) => { sync(); await busy(t, async () => {
      const o = await api.post('/api/orders', { items: cart, promoCode: state.promo, redeemPoints: state.redeem, fulfilment: state.fulfilment, address: state.address, payMethod: state.pay, note: state.note });
      setCart([]); toast(`Order ${o.order_no} placed`, 'ok');
      const m = modal({ title: 'Thank you!', size: 'narrow', body: H`<div class="stack"><div class="alert ok">Order <b>${o.order_no}</b> is confirmed. ${o.paid >= o.total ? 'Payment received.' : 'Please pay in store when you collect it.'}</div>${orderSteps(o)}</div>`,
        footer: H`<button class="btn" data-act="rc">Receipt</button><button class="btn primary" data-act="go">Track my order</button>` });
      bind(m.el, { click: { rc: () => showReceipt(o, ctx.settings), go: () => { m.close(); ctx.go('orders'); } } });
      ctx.go('orders'); }); } },
    change: { ful: async () => { sync(); await draw(); }, pay: async () => { sync(); await draw(); } }, keydown: {} });
  box.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.id === 'promo') { sync(); draw(); } });
  await draw();
}

// ---------------------------------------------------------------- MEASUREMENTS
async function viewMeasurements(box) {
  const p = await api.get('/api/me/profile'), m = p.measurements || {};
  render(box, H`<div class="grid g2" style="align-items:start"><form class="card stack" data-act="save"><h2>My measurements (cm)</h2>
    <div class="grid g2">${MEASURES.map(([k, l]) => H`<label class="f"><span>${l}</span><input type="number" step="0.5" min="10" max="250" name="${k}" value="${m[k] ?? ''}"></label>`)}</div>
    <div class="row between"><span class="hint">${m.updated_at ? 'Last updated ' + fdate(m.updated_at) : 'Not saved yet'}</span><button class="btn primary">Save measurements</button></div></form>
    <div class="card"><h2>How to measure</h2><ul class="stack-sm small muted" style="padding-left:18px"><li><b>Chest:</b> around the fullest part, under the arms.</li><li><b>Waist:</b> around your natural waistline.</li>
      <li><b>Shoulder:</b> from one shoulder edge to the other across the back.</li><li><b>Sleeve:</b> from shoulder edge to the wrist bone.</li><li><b>Inseam:</b> crotch to the ankle along the inside leg.</li><li><b>Neck:</b> around the base of the neck.</li></ul>
      <div class="hint" style="margin-top:8px">Our tailor can also take these for you at a fitting. <a href="#/appointments">Book one</a>.</div></div></div>`);
  bind(box, { submit: { save: async (f) => { await api.put('/api/me/measurements', formData(f)); toast('Measurements saved', 'ok'); } } });
}

// ---------------------------------------------------------------- CUSTOM TAILORING
async function viewTailoring(box, ctx) {
  await loadCatalog();
  const profile = await api.get('/api/me/profile'), m = profile.measurements || {};
  const prods = catalog.products.filter(p => p.tailorable), pick = Number(sessionStorage.getItem('lodc_tailor_pick')) || prods[0]?.product_id;
  sessionStorage.removeItem('lodc_tailor_pick');
  const have = MEASURES.every(([k]) => m[k]);
  render(box, H`<div class="grid g2" style="align-items:start"><form class="card stack" data-act="submit"><h2>Custom tailoring request</h2>
    ${have ? '' : H`<div class="alert warn">Your measurements are incomplete. <a href="#/measurements">Add them first</a> so we can cut your garment correctly.</div>`}
    <label class="f"><span>Garment</span><select name="productId" id="tp">${prods.map(p => H`<option value="${p.product_id}" ${p.product_id === pick ? 'selected' : ''}>${p.name}</option>`)}</select></label>
    <div class="grid g2"><label class="f"><span>Fabric</span><select name="fabric" id="tf">${['Wool', 'Linen', 'Cotton', 'Velvet', 'Silk', 'Tweed'].map(x => H`<option>${x}</option>`)}</select></label>
      <label class="f"><span>Fit</span><select name="fit">${['Slim', 'Regular', 'Classic'].map(x => H`<option>${x}</option>`)}</select></label></div>
    <label class="f"><span>Style</span><select name="style">${STYLES.map(x => H`<option>${x}</option>`)}</select></label>
    <label class="f"><span>Notes for the tailor</span><textarea name="notes" maxlength="500" placeholder="Lining color, monogram, trouser break..."></textarea></label>
    <label class="f"><span>Payment</span><select name="pay">${ctx.settings.paymentMethods.filter(x => x !== 'Cash').map(x => H`<option>${x}</option>`)}</select></label>
    <div class="alert small" id="est">Estimating price...</div><button class="btn primary lg">Submit request</button></form>
    <div class="card"><h2>How it works</h2><ol class="stack-sm small muted" style="padding-left:18px"><li>Choose a garment, fabric, fit and style.</li><li>We use your saved measurements (you can adjust them at a fitting).</li>
      <li>Your request appears in <a href="#/orders">My Orders</a> as <b>Pending</b>, then <b>Tailoring</b> while our tailor works, then <b>Ready</b> for pickup.</li><li>Made-to-measure takes about 7-10 days. Made-to-measure items are priced ${ctx.settings.tailorMarkupPct}% above ready-made.</li></ol>
      <div class="hint" style="margin-top:10px">Tip: book a <a href="#/appointments">fitting</a> to confirm measurements before we cut.</div></div></div>`);
  const est = async () => { const id = Number($('#tp', box).value); try { const q = await api.post('/api/quote', { items: [{ productId: id, qty: 1, kind: 'tailor', tailor: {} }] }); render($('#est', box), H`Estimated price: <b>${usd(q.total)}</b> incl. VAT`); } catch (e) { render($('#est', box), H`${e.message}`); } };
  bind(box, { change: { tp: est }, submit: { submit: async (f) => {
    const d = formData(f); if (!have && !(await confirmBox('Your measurements are incomplete. Submit anyway? We will take them at your fitting.'))) return;
    const o = await api.post('/api/orders', { items: [{ productId: Number(d.productId), qty: 1, kind: 'tailor', tailor: { fabric: d.fabric, fit: d.fit, style: d.style, notes: d.notes } }], payMethod: d.pay, fulfilment: 'pickup' });
    toast(`Request ${o.order_no} submitted`, 'ok'); ctx.go('orders'); } } });
  box.addEventListener('change', (e) => { if (e.target.id === 'tp') est(); }); est();
}

// ---------------------------------------------------------------- RENTALS
async function viewRentals(box, ctx) {
  await loadCatalog();
  const rentable = catalog.products.filter(p => p.rent_per_day > 0);
  const mine = (await api.get('/api/orders?kind=rental'));
  let pid = Number(sessionStorage.getItem('lodc_rent_pick')) || rentable[0]?.product_id; sessionStorage.removeItem('lodc_rent_pick');
  const state = { size: '', from: addDays(2), to: addDays(4) };
  const draw = () => {
    const p = rentable.find(x => x.product_id === pid), days = Math.round((new Date(state.to) - new Date(state.from)) / 864e5) + 1, ok = days >= 1 && days <= ctx.settings.rentalMaxDays;
    render($('#rform', box), H`<h2>Rent a suit</h2><div class="stack-sm">
      <label class="f"><span>Suit</span><select id="rp">${rentable.map(x => H`<option value="${x.product_id}" ${x.product_id === pid ? 'selected' : ''}>${x.name} - ${usd(x.rent_per_day)}/day</option>`)}</select></label>
      <div class="sizes">${p.variants.map(v => H`<div class="size ${v.stock <= 0 ? 'out' : ''} ${state.size === v.size ? 'active' : ''}" data-act="rsize" data-s="${v.size}">${v.size}</div>`)}</div>
      <div class="grid g2"><label class="f"><span>From</span><input type="date" id="rf" min="${todayStr()}" value="${state.from}"></label><label class="f"><span>To</span><input type="date" id="rt" min="${state.from}" value="${state.to}"></label></div>
      <div class="tot"><div><span>${usd(p.rent_per_day)} x ${ok ? days : '?'} days</span><span>${ok ? usd(p.rent_per_day * days) : '-'}</span></div><div><span>Refundable deposit</span><span>${usd(p.rent_deposit)}</span></div></div>
      ${ok ? '' : H`<div class="small bad">Rental must be 1 to ${ctx.settings.rentalMaxDays} days.</div>`}
      <div class="hint">Late returns are charged ${ctx.settings.lateFeePct}% of the daily rate for each extra day, taken from your deposit. The deposit is refunded when you return the suit in good condition.</div>
      <button class="btn primary" data-act="addrent" ${ok ? '' : 'disabled'}>Add rental to cart</button></div>`);
  };
  render(box, H`<div class="grid g2" style="align-items:start"><div class="card" id="rform"></div><div class="card"><h2>My rentals</h2>${mine.length ? mine.map(o => H`<div style="padding:10px 0;border-bottom:1px solid var(--line)"><div class="row between"><b>${o.order_no}</b>${o.overdue ? H`<span class="badge bad">Overdue</span>` : badge(o.status)}</div>
    ${o.items.filter(i => i.kind === 'rent').map(i => H`<div class="small">${i.name} (${i.size}) &middot; ${fdate(i.rent_from)} to ${fdate(i.rent_to)}</div>`)}
    <div class="small muted">Deposit ${usd(o.deposit)}${o.rental_return ? ` - refunded ${usd(o.rental_return.deposit_refund)}${o.rental_return.late_fee ? `, late fee ${usd(o.rental_return.late_fee)}` : ''}` : ''}</div></div>`) : H`<div class="empty">No rentals yet.</div>`}</div></div>`);
  if (!rentable.length) return render($('#rform', box), H`<div class="empty">No rental suits right now.</div>`);
  draw();
  bind(box, { click: { rsize: (t) => { if (t.classList.contains('out')) return; state.size = t.dataset.s; draw(); },
    addrent: () => { if (!state.size) throw new Error('Choose a size.'); addToCart({ kind: 'rent', productId: pid, size: state.size, qty: 1, rentFrom: state.from, rentTo: state.to }); toast('Rental added to cart', 'ok'); ctx.go('cart'); } },
    change: { rp: (t) => { pid = Number(t.value); state.size = ''; draw(); }, rf: (t) => { state.from = t.value; if (state.to < state.from) state.to = state.from; draw(); }, rt: (t) => { state.to = t.value; draw(); } } });
  box.addEventListener('change', (e) => { const id = e.target.id; if (id === 'rp') { pid = Number(e.target.value); state.size = ''; draw(); } else if (id === 'rf') { state.from = e.target.value; if (state.to < state.from) state.to = state.from; draw(); } else if (id === 'rt') { state.to = e.target.value; draw(); } });
}

// ---------------------------------------------------------------- APPOINTMENTS
const SLOTS = Array.from({ length: 18 }, (_, i) => `${String(9 + Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`);
async function viewAppointments(box, ctx) {
  const list = await api.get('/api/appointments');
  render(box, H`<div class="grid g2" style="align-items:start"><form class="card stack" data-act="book"><h2>Book a fitting or consultation</h2>
    <label class="f"><span>Service</span><select name="service"><option>Fitting</option><option>Consultation</option><option>Rental fitting</option><option>Alteration pickup</option></select></label>
    <div class="grid g2"><label class="f"><span>Date</span><input type="date" name="date" min="${todayStr()}" value="${addDays(1)}" required></label><label class="f"><span>Time</span><select name="time">${SLOTS.map(s => H`<option>${s}</option>`)}</select></label></div>
    <label class="f"><span>Notes (optional)</span><input name="note" maxlength="200"></label><button class="btn primary">Book appointment</button><div class="hint">Open daily 09:00 - 18:00. You will get a reminder the day before.</div></form>
    <div class="card"><h2>My appointments</h2>${list.length ? list.map(a => H`<div class="row between" style="padding:10px 0;border-bottom:1px solid var(--line)"><div><b>${a.service}</b><div class="small muted">${fdate(a.appt_date)} at ${a.appt_time}${a.note ? ' - ' + a.note : ''}</div></div>
      <div class="row">${badge(a.status)}${['Booked', 'Confirmed'].includes(a.status) ? H`<button class="btn sm danger" data-act="cancel" data-id="${a.appointment_id}">Cancel</button>` : ''}</div></div>`) : H`<div class="empty">No appointments yet.</div>`}</div></div>`);
  bind(box, { submit: { book: async (f) => { await api.post('/api/appointments', formData(f)); toast('Appointment booked', 'ok'); ctx.refresh(); } },
    click: { cancel: async (t) => { if (await confirmBox('Cancel this appointment?', { danger: true, okText: 'Cancel appointment' })) { await api.patch('/api/appointments/' + t.dataset.id, { status: 'Cancelled' }); ctx.refresh(); } } } });
}

// ---------------------------------------------------------------- ORDERS
function orderDetail(o, ctx) {
  const m = modal({ title: `Order ${o.order_no}`, size: 'wide', body: H`<div class="stack">
    <div class="row between"><div>${badge(o.status)} ${o.overdue ? H`<span class="badge bad">Rental overdue</span>` : ''} <span class="muted small">${fdt(o.created_at)} &middot; ${o.channel === 'pos' ? 'In store' : 'Online'} &middot; ${o.fulfilment}</span></div><b>${usd(o.total)}</b></div>
    ${orderSteps(o)}
    <div class="table-wrap"><table><thead><tr><th>Item</th><th>Details</th><th class="num">Qty</th><th class="num">Total</th></tr></thead><tbody>${o.items.map(i => H`<tr><td>${i.name}</td>
      <td class="small muted">${i.kind === 'rent' ? `Rent ${fdate(i.rent_from)} - ${fdate(i.rent_to)}` : i.kind === 'tailor' ? `${i.tailor_fabric}, ${i.tailor_fit}, ${i.tailor_style || ''} ${i.tailor_notes ? '- ' + i.tailor_notes : ''}` : 'Size ' + i.size}</td><td class="num">${i.qty}</td><td class="num">${usd(i.kind === 'rent' ? i.unit_price * i.rent_days * i.qty : i.unit_price * i.qty)}</td></tr>`)}</tbody></table></div>
    <div class="grid g2"><div><h3>Payment</h3>${o.payments.length ? o.payments.map(p => H`<div class="row between small"><span>${p.method} - ${fdt(p.at)}</span><span>${usd(p.amount)}</span></div>`) : H`<div class="muted small">Not paid yet - pay in store.</div>`}
      ${o.balance > 0.005 ? H`<div class="row between warn"><b>Balance due</b><b>${usd(o.balance)}</b></div>` : ''}${o.refunds.map(r => H`<div class="row between small ok"><span>Refund - ${r.reason}</span><span>-${usd(r.amount)}</span></div>`)}
      ${o.points_awarded ? H`<div class="small gold" style="margin-top:6px">+${o.points_awarded} loyalty points earned</div>` : ''}</div>
      <div><h3>Progress</h3><ul class="timeline">${o.history.map(h => H`<li><b>${h.status}</b><div class="hint">${fdt(h.at)}</div></li>`)}</ul></div></div></div>`,
    footer: H`<button class="btn" data-act="rc">Receipt</button>${o.status === 'Pending' && !o.payments.length ? H`<button class="btn danger" data-act="cancel">Cancel order</button>` : ''}<button class="btn primary" data-act="close">Close</button>` });
  bind(m.el, { click: { rc: () => showReceipt(o, ctx.settings), cancel: async () => { if (await confirmBox('Cancel this order?', { danger: true, okText: 'Cancel order' })) { await api.post(`/api/orders/${o.order_id}/status`, { status: 'Cancelled' }); m.close(); ctx.refresh(); } } } });
}
async function viewOrders(box, ctx) {
  const orders = await api.get('/api/orders');
  let tab = 'All';
  const tabs = ['All', 'Pending', 'Tailoring', 'Ready', 'Picked Up', 'Delivered', 'Cancelled'];
  const draw = () => {
    const list = orders.filter(o => tab === 'All' || o.status === tab);
    render(box, H`<div class="tabs">${tabs.map(t => H`<button class="${t === tab ? 'active' : ''}" data-act="tab" data-t="${t}">${t}${t === 'All' ? '' : ` (${orders.filter(o => o.status === t).length})`}</button>`)}</div>
      ${list.length ? list.map(o => H`<div class="card" style="margin-bottom:12px"><div class="row between"><div><b>${o.order_no}</b> <span class="muted small">${fdate(o.created_at)}</span></div><div class="row">${o.has_tailor ? H`<span class="badge info">Tailoring</span>` : ''}${o.has_rental ? H`<span class="badge info">Rental</span>` : ''}${o.overdue ? H`<span class="badge bad">Overdue</span>` : badge(o.status)}<b>${usd(o.total)}</b></div></div>
        ${orderSteps(o)}<div class="small muted">${o.items.map(i => `${i.qty} x ${i.name}`).join(', ')}</div>
        <div class="row" style="margin-top:10px"><button class="btn sm" data-act="detail" data-id="${o.order_id}">Details</button><button class="btn sm" data-act="reorder" data-id="${o.order_id}">Reorder</button></div></div>`) : H`<div class="card empty">No orders here yet.</div>`}`);
  };
  draw();
  bind(box, { click: { tab: (t) => { tab = t.dataset.t; draw(); }, detail: (t) => orderDetail(orders.find(o => o.order_id === Number(t.dataset.id)), ctx),
    reorder: (t) => { const o = orders.find(x => x.order_id === Number(t.dataset.id)); let n = 0; for (const i of o.items.filter(x => x.kind === 'buy')) { addToCart({ kind: 'buy', productId: i.product_id, size: i.size, qty: i.qty }); n++; }
      if (!n) throw new Error('Only ready-made items can be reordered.'); toast('Items added to your cart', 'ok'); ctx.go('cart'); } } });
}

// ---------------------------------------------------------------- LOYALTY
async function viewLoyalty(box, ctx) {
  const [p, orders] = await Promise.all([api.get('/api/me/profile'), api.get('/api/orders')]);
  const earned = orders.filter(o => o.points_awarded);
  render(box, H`<div class="grid g2" style="align-items:start"><div class="stack"><div class="card"><div class="row between"><h2>My points</h2><span class="tier ${p.tier}">${p.tier}</span></div>
      <div class="kpi" style="border:0;padding:6px 0"><div class="v">${p.loyalty_points}</div><div class="s">worth ${usd(p.loyalty_points * ctx.settings.pointValue)} at checkout</div></div>
      <div class="progress"><i style="width:${p.next_tier_at ? Math.min(100, p.loyalty_points / p.next_tier_at * 100) : 100}%"></i></div><div class="small muted" style="margin-top:6px">${p.next_tier ? `${p.next_tier_at - p.loyalty_points} more points to reach ${p.next_tier}` : 'You are at our highest level. Thank you!'}</div></div>
      <div class="card"><h2>Points history</h2>${earned.length ? earned.map(o => H`<div class="row between small" style="padding:6px 0;border-bottom:1px solid var(--line)"><span>${o.order_no} - ${fdate(o.created_at)}</span><b class="gold">+${o.points_awarded}</b></div>`) : H`<div class="empty">Points are added when you collect an order.</div>`}</div></div>
    <div class="card"><h2>Membership levels</h2>${TIERS.map(t => H`<div style="padding:10px 0;border-bottom:1px solid var(--line)"><div class="row between"><span class="tier ${t.name}">${t.name}</span><span class="muted small">${t.min}+ points</span></div><div class="small muted" style="margin-top:4px">${t.perk}</div></div>`)}
      <div class="hint" style="margin-top:10px">Earn ${ctx.settings.pointsPerDollar} point per $1 spent (before VAT). Redeem points at checkout.</div></div></div>`);
}

// ---------------------------------------------------------------- NOTIFICATIONS / PROFILE
async function viewNotifications(box, ctx) {
  const list = await api.get('/api/me/notifications');
  render(box, H`<div class="row between" style="margin-bottom:12px"><span class="muted">${list.filter(n => !n.is_read).length} unread</span><button class="btn sm" data-act="read">Mark all read</button></div>
    ${list.length ? list.map(n => H`<div class="card" style="margin-bottom:10px;${n.is_read ? '' : 'border-color:rgba(70,105,190,.6)'}"><div class="row between"><b>${n.title}</b><span class="badge">${n.type}</span></div><div class="muted">${n.body}</div><div class="hint">${fdt(n.at)}</div></div>`) : H`<div class="card empty">No notifications yet.</div>`}`);
  bind(box, { click: { read: async () => { await api.post('/api/me/notifications/read'); Shell.setUnread(0); ctx.refresh(); } } });
}
async function viewProfile(box, ctx) {
  const p = await api.get('/api/me/profile');
  render(box, H`<div class="grid g2" style="align-items:start"><form class="card stack" data-act="save"><h2>Profile</h2>
    <label class="f"><span>Full name</span><input name="name" value="${p.name}" required></label><label class="f"><span>Email (sign-in)</span><input value="${p.email}" disabled></label>
    <label class="f"><span>Phone</span><input name="phone" value="${p.phone || ''}"></label><label class="f"><span>Delivery address</span><textarea name="address">${p.address || ''}</textarea></label>
    <button class="btn primary">Save profile</button></form>
    <div class="card stack"><h2>Security</h2><div class="muted small">Member since ${fdate(p.created_at)}</div><button class="btn" data-act="pw">Change password</button></div></div>`);
  bind(box, { submit: { save: async (f) => { await api.put('/api/me/profile', formData(f)); toast('Profile saved', 'ok'); } }, click: { pw: () => Shell.accountDialog() } });
}


// ================================================================ STOREFRONT (home, shop, product page)
const productCard = (p, lowStock = 3) => {
  const total = p.variants.reduce((s, v) => s + v.stock, 0);
  return H`<a class="pcard" href="#/product/${p.product_id}" style="text-decoration:none;color:inherit"><div class="art">${art(p)}</div>
    ${p.sale_pct ? H`<span class="badge gold tag">-${p.sale_pct}%</span>` : total <= 0 ? H`<span class="badge bad tag">Sold out</span>` : ''}
    <div class="pinfo"><div class="nm">${p.name}</div><div class="small muted">${p.fabric} &middot; ${p.fit} fit</div>
      <div class="row between"><span class="pr">${priceOf(p)}</span><span class="psw"><i style="background:${p.color_hex}" title="${p.color_name}"></i></span></div></div></a>`;
};

async function viewStore(box, ctx) {
  await loadCatalog();
  const P = catalog.products, byCat = (n) => P.filter(p => p.category === n);
  const heroSuits = byCat('Suits').slice(0, 3), arrivals = [...P].sort((a, b) => b.product_id - a.product_id).slice(0, 8);
  const tiles = ['Suits', 'Blazers', 'Shirts', 'Shoes'].map(n => ({ n, p: byCat(n)[1] || byCat(n)[0] })).filter(t => t.p);
  render(box, H`<div>
    <section class="hero"><div class="copy"><span class="eyebrow">Phnom Penh &middot; Since the first stitch</span><h1>Tailored for the way you stand.</h1>
      <p>Suits, blazers and finishing touches cut with care. Buy ready-to-wear, have it made to your measurements, or rent for the big day.</p>
      <div class="row"><a class="btn" href="#/shop/Suits">Shop suits</a><a class="btn out" href="#/appointments">Book a fitting</a></div></div>
      <div class="art">${heroSuits.map(p => H`<div>${art(p)}</div>`)}</div></section>
    <section class="sec"><div class="sec-head"><h2>Shop by category</h2><a href="#/shop">View all</a></div><div class="tiles">${tiles.map(t => H`<a class="tile" href="#/shop/${t.n}" style="display:block">${art(t.p)}<div class="lbl"><span>${t.n}</span><span>&rarr;</span></div></a>`)}</div></section>
    <section class="sec"><div class="sec-head"><h2>New arrivals</h2><a href="#/shop">Shop all</a></div><div class="products">${arrivals.map(p => productCard(p, ctx.settings.lowStock))}</div></section>
    <section class="sec"><div class="sec-head"><h2>Made around you</h2></div><div class="services">
      <div class="service"><h3>Made to measure</h3><p>Choose the fabric, fit and style. Our tailor cuts to your saved measurements.</p><a class="btn" href="#/tailoring" style="justify-self:start">Start a request</a></div>
      <div class="service"><h3>Suit rental</h3><p>Wedding, graduation or a big meeting. Pick your dates, pay a refundable deposit.</p><a class="btn" href="#/rentals" style="justify-self:start">Rent a suit</a></div>
      <div class="service"><h3>Fittings &amp; advice</h3><p>Book a free fitting or consultation with one of our stylists.</p><a class="btn" href="#/appointments" style="justify-self:start">Book now</a></div></div></section>
    <section class="sec"><div class="loyal"><div><h3>Earn points on every order</h3><p style="color:#cfc8b8;margin-top:8px">1 point per $1. Reach Silver, Gold and VIP for fittings priority, free delivery and early access.</p></div><div style="justify-self:end"><a class="btn" href="#/loyalty">My points</a></div></div></section>
    <div class="trust"><div><b>Free alterations</b><span>on hems for Silver and above</span></div><div><b>Easy exchanges</b><span>within ${ctx.settings.refundDays} days</span></div><div><b>Secure checkout</b><span>KHQR, ABA Pay, card or pay in store</span></div><div><b>Made in Cambodia</b><span>by our own tailors</span></div></div></div>`);
}

async function viewShop(box, ctx, parts, query) {
  await loadCatalog();
  const f = { cat: parts[1] && parts[1] !== 'All' ? parts[1] : '', q: query.q || '', size: '', color: '', fabrics: new Set(), fit: '', min: '', max: '', stock: false, sort: 'featured' };
  const colors = [...new Map(catalog.products.map(p => [p.color_name, p.color_hex])).entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const fabrics = [...new Set(catalog.products.map(p => p.fabric).filter(Boolean))].sort();
  const sizesFor = () => [...new Set((f.cat ? catalog.categories.filter(c => c.name === f.cat) : catalog.categories).flatMap(c => c.sizes))];
  const side = () => render($('#filters', box), H`<div class="row between" style="margin-bottom:6px"><b class="serif" style="font-size:1.2rem">Filters</b><button class="btn sm ghost" data-act="clear">Clear all</button></div>
    <details open><summary>Category</summary><div class="opts"><a data-act="cat" data-v="" class="${!f.cat ? 'gold' : ''}" style="cursor:pointer;font-weight:${!f.cat ? 700 : 400}">All products</a>${catalog.categories.map(c => H`<a data-act="cat" data-v="${c.name}" style="cursor:pointer;font-weight:${f.cat === c.name ? 700 : 400}" class="${f.cat === c.name ? 'gold' : ''}">${c.name}</a>`)}</div></details>
    <details open><summary>Size</summary><div class="sizes" style="margin-top:12px">${sizesFor().map(s => H`<div class="size ${f.size === s ? 'active' : ''}" data-act="size" data-v="${s}" style="min-width:44px">${s}</div>`)}</div></details>
    <details open><summary>Color</summary><div class="swatches">${colors.map(([n, h]) => H`<button class="swatch ${f.color === n ? 'active' : ''}" data-act="color" data-v="${n}" title="${n}" aria-label="${n}" style="background:${h}"></button>`)}</div></details>
    <details><summary>Fabric</summary><div class="opts">${fabrics.map(x => H`<label class="chk"><input type="checkbox" data-act="fabric" value="${x}" ${f.fabrics.has(x) ? 'checked' : ''}> ${x}</label>`)}</div></details>
    <details><summary>Fit</summary><div class="opts">${['Slim', 'Regular', 'Classic'].map(x => H`<label class="chk"><input type="radio" name="fit" data-act="fit" value="${x}" ${f.fit === x ? 'checked' : ''}> ${x}</label>`)}</div></details>
    <details><summary>Price (USD)</summary><div class="row" style="margin-top:12px;flex-wrap:nowrap"><input type="number" min="0" placeholder="Min" data-act="min" value="${f.min}"><input type="number" min="0" placeholder="Max" data-act="max" value="${f.max}"></div></details>
    <label class="chk" style="margin-top:14px"><input type="checkbox" data-act="stock" ${f.stock ? 'checked' : ''}> In stock only</label><button class="btn primary block filter-btn" data-act="apply" style="margin-top:18px">Show results</button>`);
  render(box, H`<div class="crumbs"><a href="#/">Home</a> / <a href="#/shop">Shop</a>${f.cat ? H` / ${f.cat}` : ''}</div>
    <div class="shop-head"><div><h1 class="serif" id="stitle"></h1><div class="small muted" id="count"></div></div><div class="row"><button class="btn sm filter-btn" data-act="openf">Filters</button><input type="search" id="sq" placeholder="Search" value="${f.q}" style="width:200px"><select data-act="sort" style="width:auto"><option value="featured">Featured</option><option value="lo">Price: low to high</option><option value="hi">Price: high to low</option><option value="name">Name A-Z</option></select></div></div>
    <div class="shop-layout"><aside class="filters" id="filters"></aside><div><div class="products" id="grid"></div></div></div>`);
  const draw = () => {
    let list = catalog.products.filter(p => {
      const text = `${p.name} ${p.fabric} ${p.color_name} ${p.fit} ${p.category}`.toLowerCase();
      const stock = f.size ? (p.variants.find(v => v.size === f.size)?.stock || 0) : p.variants.reduce((s, v) => s + v.stock, 0);
      return (!f.q || text.includes(f.q.toLowerCase())) && (!f.cat || p.category === f.cat) && (!f.size || p.variants.some(v => v.size === f.size)) && (!f.color || p.color_name === f.color)
        && (!f.fabrics.size || f.fabrics.has(p.fabric)) && (!f.fit || p.fit === f.fit) && (f.min === '' || p.eff_price >= Number(f.min)) && (f.max === '' || p.eff_price <= Number(f.max)) && (!f.stock || stock > 0);
    });
    list.sort(f.sort === 'lo' ? (a, b) => a.eff_price - b.eff_price : f.sort === 'hi' ? (a, b) => b.eff_price - a.eff_price : f.sort === 'name' ? (a, b) => a.name.localeCompare(b.name) : (a, b) => a.product_id - b.product_id);
    $('#stitle', box).textContent = f.q ? `Results for "${f.q}"` : f.cat || 'All products'; $('#count', box).textContent = `${list.length} item${list.length === 1 ? '' : 's'}`;
    render($('#grid', box), list.length ? list.map(p => productCard(p, ctx.settings.lowStock)) : H`<div class="empty" style="grid-column:1/-1;padding:60px 0">Nothing matches your filters. <a data-act="clear" style="cursor:pointer;text-decoration:underline">Clear filters</a></div>`);
  };
  const redo = () => { side(); draw(); };
  const set = (k) => (t) => { f[k] = t.value ?? t.dataset.v; draw(); };
  bind(box, { click: { cat: (t) => { f.cat = t.dataset.v; f.size = ''; history.replaceState(null, '', '#/shop/' + (f.cat || 'All')); redo(); }, size: (t) => { f.size = f.size === t.dataset.v ? '' : t.dataset.v; redo(); },
      color: (t) => { f.color = f.color === t.dataset.v ? '' : t.dataset.v; redo(); }, clear: () => { Object.assign(f, { cat: '', q: '', size: '', color: '', fit: '', min: '', max: '', stock: false }); f.fabrics.clear(); $('#sq', box).value = ''; redo(); },
      openf: () => $('#filters', box).classList.add('open'), apply: () => $('#filters', box).classList.remove('open') },
    input: { min: set('min'), max: set('max') },
    change: { fabric: (t) => { t.checked ? f.fabrics.add(t.value) : f.fabrics.delete(t.value); draw(); }, fit: (t) => { f.fit = t.value; draw(); }, stock: (t) => { f.stock = t.checked; draw(); }, sort: set('sort') } });
  box.addEventListener('input', (e) => { if (e.target.id === 'sq') { f.q = e.target.value; draw(); } });
  redo();
}

async function viewProduct(box, ctx, parts) {
  await loadCatalog();
  const id = Number(parts[1]), p = catalog.products.find(x => x.product_id === id);
  if (!p) return render(box, H`<div class="empty">Product not found. <a href="#/shop">Back to the shop</a></div>`);
  let view = 0, size = '', qty = 1;
  const likes = catalog.products.filter(x => x.category === p.category && x.product_id !== id).slice(0, 4);
  const look = p.category === 'Suits' ? ['Ties', 'Shirts', 'Shoes'].map(c => catalog.products.find(x => x.category === c)).filter(Boolean) : [];
  render(box, H`<div class="crumbs"><a href="#/">Home</a> / <a href="#/shop/${p.category}">${p.category}</a> / ${p.name}</div>
    <div class="pdp"><div class="gal"><div class="thumbs">${[0, 1, 2].map(v => H`<button data-act="view" data-v="${v}" class="${v === 0 ? 'active' : ''}" aria-label="Picture ${v + 1}">${art(p, v)}</button>`)}</div><div class="big" id="big">${art(p, 0)}</div></div>
    <div><span class="small muted" style="letter-spacing:.14em;text-transform:uppercase">${p.category}</span><h1 class="serif">${p.name}</h1><div class="price">${priceOf(p)} ${p.sale_pct ? H`<span class="badge gold">Sale -${p.sale_pct}%</span>` : ''}</div>
      <div class="small" style="margin-bottom:18px"><span class="sw" style="background:${p.color_hex}"></span> ${p.color_name} &middot; ${p.fabric} &middot; ${p.fit} fit</div>
      <div class="row between" style="margin-bottom:8px"><b class="small" style="letter-spacing:.1em;text-transform:uppercase">Select size</b><span id="sstat" class="small muted"></span></div>
      <div class="sizes" style="margin-bottom:20px">${p.variants.map(v => H`<div class="size ${v.stock <= 0 ? 'out' : ''}" data-act="size" data-s="${v.size}">${v.size}</div>`)}</div>
      <div class="row" style="margin-bottom:12px;flex-wrap:nowrap"><div class="qty"><button data-act="dec" aria-label="Less">-</button><span id="qty">1</span><button data-act="inc" aria-label="More">+</button></div><button class="btn primary lg grow" data-act="add">Add to bag</button></div>
      <div class="row" style="margin-bottom:22px">${p.rent_per_day > 0 ? H`<button class="btn sm" data-act="rent">Rent from ${usd(p.rent_per_day)}/day</button>` : ''}${p.tailorable ? H`<button class="btn sm" data-act="tailor">Made to measure</button>` : ''}</div>
      <div class="acc"><details open><summary>Description</summary><p>${p.description}</p></details><details><summary>Fabric &amp; fit</summary><p>${p.fabric}, ${p.fit.toLowerCase()} fit, colour ${p.color_name.toLowerCase()}. SKU ${p.sku}.</p></details>
        <details><summary>Delivery &amp; returns</summary><p>Collect in store or have it delivered in Phnom Penh. Free exchanges within ${ctx.settings.refundDays} days with your receipt.</p></details></div></div></div>
    ${look.length ? H`<section class="sec"><div class="sec-head"><h2>Complete the look</h2><span class="small muted">Buy a suit with a tie, or a shirt and shoes, and save automatically</span></div><div class="products">${look.map(x => productCard(x))}</div></section>` : ''}
    ${likes.length ? H`<section class="sec"><div class="sec-head"><h2>You may also like</h2></div><div class="products">${likes.map(x => productCard(x))}</div></section>` : ''}`);
  const need = () => { if (!size) throw new Error('Please choose a size first.'); };
  bind(box, { click: {
    view: (t) => { view = Number(t.dataset.v); render($('#big', box), art(p, view)); $$('.thumbs button', box).forEach(b => b.classList.toggle('active', b === t)); },
    size: (t) => { if (t.classList.contains('out')) return; size = t.dataset.s; $$('.sizes .size', box).forEach(s => s.classList.toggle('active', s === t)); const v = p.variants.find(x => x.size === size); render($('#sstat', box), stockBadge(v.stock, ctx.settings.lowStock)); },
    dec: () => { qty = Math.max(1, qty - 1); $('#qty', box).textContent = qty; }, inc: () => { qty = Math.min(10, qty + 1); $('#qty', box).textContent = qty; },
    add: () => { need(); const v = p.variants.find(x => x.size === size); if (qty > v.stock) throw new Error(`Only ${v.stock} available in size ${size}.`); addToCart({ kind: 'buy', productId: id, size, qty }); toast('Added to your bag', 'ok'); },
    rent: () => { sessionStorage.setItem('lodc_rent_pick', String(id)); ctx.go('rentals'); }, tailor: () => { sessionStorage.setItem('lodc_tailor_pick', String(id)); ctx.go('tailoring'); } } });
}

// ================================================================ SITE SHELL (top navigation, no sidebar)
const ALIAS = { orders: 'account/orders', measurements: 'account/measurements', loyalty: 'account/loyalty', notifications: 'account/notifications', profile: 'account/profile', account: 'account/overview', home: '' };
const ACCOUNT_VIEWS = { overview: ['Overview', viewOverview], orders: ['My orders', viewOrders], measurements: ['My measurements', viewMeasurements], loyalty: ['Loyalty & VIP', viewLoyalty], notifications: ['Notifications', viewNotifications], profile: ['Profile & security', viewProfile] };
const PAGE_VIEWS = { cart: ['Shopping bag', viewCart], tailoring: ['Custom tailoring', viewTailoring], rentals: ['Suit rental', viewRentals], appointments: ['Book a fitting', viewAppointments] };

function parseRoute() {
  const [path, qstr = ''] = location.hash.replace(/^#\/?/, '').split('?');
  let parts = path.split('/').filter(Boolean).map(decodeURIComponent);
  if (parts.length === 1 && ALIAS[parts[0]] !== undefined) parts = ALIAS[parts[0]].split('/').filter(Boolean);
  return { parts, query: Object.fromEntries(new URLSearchParams(qstr)) };
}

async function bootSite() {
  document.body.classList.add('site');
  const me = await api.get('/api/auth/me').catch(() => null);
  if (!me || me.user.view !== 'client') { location.replace('login.html'); return; }
  Shell.user = me.user; Shell.settings = await api.get('/api/settings'); Object.assign(Fmt.settings, Shell.settings); devTag(Shell.settings);
  const s = Shell.settings, u = Shell.user;
  const cats = (await api.get('/api/catalog')).categories.map(c => c.name);
  const app = $('#app');
  render(app, H`<div class="announce">Free exchanges within ${s.refundDays} days &middot; New here? Use code <b>WELCOME10</b> for 10% off</div>
    <header class="hdr"><div class="hdr-in"><div class="left">
        <div class="searchbox">${icon('search')}<input type="search" id="hsearch" placeholder="Search suits, shirts..." aria-label="Search"></div></div>
      <a class="logo-link" href="#/"><span class="mark">${s.logo ? H`<img src="${s.logo}" alt="">` : 'L'}</span><b>${s.storeName}</b></a>
      <div class="right"><button class="icon-btn" data-act="bell" aria-label="Notifications">${icon('bell')}<span class="dot hidden" id="bellDot"></span></button><div class="dropdown hidden" id="bellBox"></div>
        <button class="icon-btn" data-act="acct" aria-label="My account">${icon('user')}</button>
        <div class="acct-menu hidden" id="acctMenu"><div class="who"><b>${u.name}</b><div class="small muted">${u.email}</div><span class="tier ${u.tier}" style="margin-top:6px">${u.tier} &middot; ${u.points} pts</span></div>
          <a href="#/account/overview">Overview</a><a href="#/orders">My orders</a><a href="#/measurements">My measurements</a><a href="#/appointments">Appointments</a><a href="#/loyalty">Loyalty &amp; VIP</a><a href="#/notifications">Notifications</a><a href="#/profile">Profile &amp; security</a><button data-act="logout">Sign out</button></div>
        <a class="icon-btn cart-btn" href="#/cart" aria-label="Shopping bag" style="display:inline-grid;place-items:center;text-decoration:none">${icon('cart')}<span class="dot hidden" id="cartDot"></span></a></div></div>
      <nav class="mainnav" id="mainnav">${cats.map(c => H`<a href="#/shop/${c}" data-c="${c}">${c}</a>`)}<a href="#/rentals" data-c="rentals">Rent</a><a href="#/tailoring" data-c="tailoring">Made to measure</a><a href="#/appointments" data-c="appointments">Book a fitting</a></nav></header>
    <main class="site-main" id="view"></main>
    <footer class="site-foot"><div class="in"><div><b style="color:#fff;font-family:'Playfair Display',serif;font-size:1.3rem">${s.storeName}</b><p style="margin-top:10px;max-width:320px">${s.address}<br>${s.phone}</p><p style="margin-top:10px">Open daily 09:00 - 18:00</p></div>
      <div><h4>Shop</h4>${cats.slice(0, 5).map(c => H`<a href="#/shop/${c}">${c}</a>`)}</div><div><h4>Services</h4><a href="#/tailoring">Made to measure</a><a href="#/rentals">Suit rental</a><a href="#/appointments">Fittings</a><a href="#/measurements">My measurements</a></div>
      <div><h4>Account</h4><a href="#/orders">Track my order</a><a href="#/loyalty">Loyalty &amp; VIP</a><a href="#/profile">Profile</a></div></div><div class="copy">&copy; ${new Date().getFullYear()} ${s.storeName}. Online payments are shown in demo mode.</div></footer>`);
  const box = $('#view');
  const cartCount = () => { try { return (JSON.parse(localStorage.getItem('lodc_cart_' + u.id)) || []).reduce((a, i) => a + i.qty, 0); } catch { return 0; } };
  const ctx = Shell.ctx = { user: u, settings: s, can: () => false, go: (id) => { location.hash = '#/' + (ALIAS[id] ?? id); },
    refresh: () => route(), setBadge: (id, n) => { if (id === 'cart') { const d = $('#cartDot'); d.textContent = n; d.classList.toggle('hidden', !n); } } };
  let token = 0;
  async function route() {
    const { parts, query } = parseRoute(), name = parts[0] || 'store', my = ++token;
    $$('#mainnav a').forEach(a => a.classList.toggle('active', (name === 'shop' && a.dataset.c === (parts[1] || '')) || a.dataset.c === name));
    const d = document.createElement('div'); d.className = 'view'; $('#acctMenu').classList.add('hidden'); $('#bellBox').classList.add('hidden');
    render(box, H`<div class="loading"><span class="spin"></span></div>`);
    try {
      if (name === 'store') await viewStore(d, ctx);
      else if (name === 'shop') await viewShop(d, ctx, parts, query);
      else if (name === 'product') await viewProduct(d, ctx, parts);
      else if (name === 'account') {
        const sub = ACCOUNT_VIEWS[parts[1]] ? parts[1] : 'overview';
        render(d, H`<h1 class="serif page-title">My account</h1><div class="acct"><nav class="acct-nav">${Object.entries(ACCOUNT_VIEWS).map(([k, [l]]) => H`<a href="#/account/${k}" class="${k === sub ? 'active' : ''}">${l}</a>`)}<a href="#/appointments">Appointments</a><a data-act="logout">Sign out</a></nav><div id="acbody"></div></div>`);
        const body = $('#acbody', d); const inner = document.createElement('div'); inner.className = 'view'; body.appendChild(inner);
        await ACCOUNT_VIEWS[sub][1](inner, ctx);
      } else if (PAGE_VIEWS[name]) { const inner = document.createElement('div'); await PAGE_VIEWS[name][1](inner, ctx); render(d, H`<h1 class="serif page-title">${PAGE_VIEWS[name][0]}</h1>`); d.appendChild(inner); }
      else render(d, H`<div class="empty">Page not found. <a href="#/">Go home</a></div>`);
      if (my === token) { box.replaceChildren(d); window.scrollTo(0, 0); document.title = s.storeName; }
    } catch (e) { if (my === token) render(box, H`<div class="alert bad">${e.message}</div>`); }
  }
  window.addEventListener('hashchange', route);
  bind(app, { click: {
    bell: () => Shell.toggleBell(), acct: () => $('#acctMenu').classList.toggle('hidden'),
    logout: async () => { await api.post('/api/auth/logout').catch(() => {}); location.href = 'login.html'; } } });
  document.addEventListener('click', (e) => { if (!e.target.closest('#acctMenu') && !e.target.closest('[data-act="acct"]')) $('#acctMenu')?.classList.add('hidden'); if (!e.target.closest('#bellBox') && !e.target.closest('[data-act="bell"]')) $('#bellBox')?.classList.add('hidden'); });
  $('#hsearch').addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.value.trim()) { location.hash = '#/shop/All?q=' + encodeURIComponent(e.target.value.trim()); e.target.value = ''; } });
  Shell.setUnread(me.unread); ctx.setBadge('cart', cartCount());
  setInterval(async () => { try { Shell.setUnread((await api.get('/api/auth/me')).unread); } catch { /* offline */ } }, 30000);
  await route();
}
bootSite();
