'use strict';
/* Shared front-end library: safe HTML templating, API client, formatting, modal/toast, product art, charts, app shell. */

// ------------------------------------------------------------------ safe templating (everything is escaped unless wrapped in raw())
class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const raw = (s) => new Raw(s);
const part = (v) => v instanceof Raw ? v.s : Array.isArray(v) ? v.map(part).join('') : (v == null || v === false) ? '' : esc(v);
function H(strings, ...vals) { let out = strings[0]; vals.forEach((v, i) => { out += part(v) + strings[i + 1]; }); return new Raw(out); }
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
function render(el, content) { el.innerHTML = part(content); return el; }

/** Delegated events: elements carry data-act="name"; handlers = { click: {name: fn}, change: {...}, input: {...}, submit: {...} } */
function bind(root, handlers) {
  for (const [type, acts] of Object.entries(handlers)) {
    root.addEventListener(type, (e) => {
      const t = e.target.closest('[data-act]');
      if (!t || !root.contains(t) || !acts[t.dataset.act]) return;
      if (type === 'submit') e.preventDefault();
      Promise.resolve(acts[t.dataset.act](t, e)).catch((err) => toast(err.message || 'Something went wrong', 'bad'));
    });
  }
}
const formData = (form) => Object.fromEntries(new FormData(form).entries());

// ------------------------------------------------------------------ API
class ApiError extends Error { constructor(m, status) { super(m); this.status = status; } }
async function api(method, url, body) {
  // No server: the request is answered by the browser-side backend (js/backend/*.js) from this browser's localStorage.
  try { return await LB.request(method, url, body === undefined ? undefined : JSON.parse(JSON.stringify(body))); }
  catch (e) {
    if (e instanceof ApiError) throw e;
    if (e.status === 401 && !url.includes('/auth/login')) { location.href = 'login.html'; throw new ApiError('Please sign in.', 401); }
    if (e.status) throw new ApiError(e.message, e.status);
    console.error(e); throw new ApiError('Something went wrong. Please try again.', 500);
  }
}
api.get = (u) => api('GET', u); api.post = (u, b) => api('POST', u, b ?? {}); api.put = (u, b) => api('PUT', u, b ?? {});
api.patch = (u, b) => api('PATCH', u, b ?? {}); api.del = (u) => api('DELETE', u);
const qs = (o) => Object.entries(o).filter(([, v]) => v !== '' && v != null).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');

// ------------------------------------------------------------------ formatting
const Fmt = { settings: { currency: 'USD', khrRate: 4100 } };
const usd = (n) => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const khr = (n) => Math.round(Number(n || 0) * Fmt.settings.khrRate).toLocaleString('en-US') + ' ៛';
const money = (n) => Fmt.settings.currency === 'KHR' ? khr(n) : usd(n);
const moneyBoth = (n) => Fmt.settings.currency === 'KHR' ? H`${khr(n)} <span class="muted small">${usd(n)}</span>` : H`${usd(n)} <span class="muted small">${khr(n)}</span>`;
const ymd = (d) => String(d || '').slice(0, 10);
const fdate = (d) => { if (!d) return '-'; const x = new Date(ymd(d) + 'T00:00:00Z'); return x.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }); };
const fdt = (d) => d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '-';
const ftime = (d) => d ? new Date(d).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '-';
const todayStr = () => new Date().toISOString().slice(0, 10);
const addDays = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const num = (v) => Number(v) || 0;
const STATUS_CLASS = { Pending: 'warn', Tailoring: 'info', Ready: 'gold', 'Picked Up': 'ok', Delivered: 'ok', Returned: 'ok', Cancelled: 'bad', Received: 'warn', 'In Progress': 'info', Collected: 'ok',
  Booked: 'warn', Confirmed: 'info', Completed: 'ok', 'No-show': 'bad' };
const badge = (s) => H`<span class="badge ${STATUS_CLASS[s] || ''}">${s}</span>`;
const stockBadge = (n, low = 3) => n <= 0 ? H`<span class="badge bad">Out of stock</span>` : n <= low ? H`<span class="badge warn">Only ${n} left</span>` : H`<span class="badge ok">In stock</span>`;

// ------------------------------------------------------------------ toast / modal
function toast(msg, type = '') {
  let box = $('.toasts'); if (!box) { box = document.createElement('div'); box.className = 'toasts'; document.body.appendChild(box); }
  const t = document.createElement('div'); t.className = 'toast ' + type; t.textContent = msg; t.setAttribute('role', 'status'); box.appendChild(t);
  setTimeout(() => t.remove(), type === 'bad' ? 6000 : 3500);
}
/** modal({title, body, footer, size}) -> {el, close}. Click on data-act="close" closes it. */
function modal({ title, body, footer, size = '', onClose }) {
  const ov = document.createElement('div'); ov.className = 'overlay'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true');
  render(ov, H`<div class="modal ${size}"><header><h2>${title}</h2><button class="icon-btn" data-act="close" aria-label="Close">&times;</button></header>
    <div class="body">${body}</div>${footer ? H`<footer>${footer}</footer>` : ''}</div>`);
  const close = () => { ov.remove(); document.removeEventListener('keydown', onKey); onClose?.(); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  ov.addEventListener('mousedown', (e) => { if (e.target === ov) close(); });
  ov.addEventListener('click', (e) => { if (e.target.closest('[data-act="close"]')) close(); });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(ov);
  const first = $('input:not([type=hidden]), select, textarea', ov); first?.focus();
  return { el: ov, close, $: (s) => $(s, ov) };
}
function confirmBox(message, { okText = 'Confirm', danger = false } = {}) {
  return new Promise((resolve) => {
    const m = modal({ title: 'Please confirm', size: 'narrow', body: H`<p>${message}</p>`,
      footer: H`<button class="btn" data-act="close">Cancel</button><button class="btn ${danger ? 'danger' : 'primary'}" data-act="ok">${okText}</button>`, onClose: () => resolve(false) });
    $('[data-act="ok"]', m.el).addEventListener('click', () => { resolve(true); m.el.remove(); });
  });
}
async function busy(btn, fn) {
  if (btn) btn.disabled = true;
  try { return await fn(); } finally { if (btn) btn.disabled = false; }
}
const inputField = (label, name, value = '', attrs = '') => H`<label class="f"><span>${label}</span><input name="${name}" value="${value}" ${raw(attrs)}></label>`;

function downloadCSV(name, rows) {
  const csv = rows.map(r => r.map(c => { const s = String(c ?? ''); return /[",\n]/.test(s) || /^[=+\-@]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(',')).join('\r\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ------------------------------------------------------------------ product art (generated SVG, no image files needed)
function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16); let r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  const f = (v) => Math.max(0, Math.min(255, Math.round(amt >= 0 ? v + (255 - v) * amt : v * (1 + amt))));
  return '#' + [f(r), f(g), f(b)].map(v => v.toString(16).padStart(2, '0')).join('');
}
function glyph(p, c) {
  const d = shade(c, -.35), l = shade(c, .18), name = (p.name || '').toLowerCase();
  const stitch = `stroke="${shade(c, .35)}" stroke-width="1" stroke-dasharray="3 3" fill="none"`;
  switch (p.category) {
    case 'Suits': return `<path d="M50 52 L82 40 Q100 60 118 40 L150 52 L164 170 L36 170Z" fill="${c}"/><path d="M82 40 L100 128 L118 40 L100 62Z" fill="#f4f6fb"/>
      <path d="M82 40 L100 128 L62 150 L58 60Z M118 40 L100 128 L138 150 L142 60Z" fill="${d}"/><path d="M96 70 L104 70 L106 128 L100 150 L94 128Z" fill="${l}" opacity=".9"/>
      <circle cx="100" cy="146" r="3" fill="${l}"/><path d="M64 150 L64 170 M136 150 L136 170" ${stitch}/><rect x="62" y="170" width="34" height="30" rx="3" fill="${d}"/><rect x="104" y="170" width="34" height="30" rx="3" fill="${d}"/>`;
    case 'Blazers': return `<path d="M52 50 L84 38 Q100 58 116 38 L148 50 L160 176 L40 176Z" fill="${c}"/><path d="M84 38 L100 120 L64 140 L60 60Z M116 38 L100 120 L136 140 L140 60Z" fill="${d}"/>
      <rect x="54" y="132" width="30" height="26" rx="3" fill="none" ${stitch}/><rect x="116" y="132" width="30" height="26" rx="3" fill="none" ${stitch}/><circle cx="100" cy="124" r="3.2" fill="${l}"/><circle cx="100" cy="144" r="3.2" fill="${l}"/>`;
    case 'Trousers': return `<path d="M62 30 L138 30 L148 190 L108 190 L100 80 L92 190 L52 190Z" fill="${c}"/><rect x="62" y="30" width="76" height="12" fill="${d}"/><path d="M100 42 L100 80" stroke="${d}" stroke-width="2"/>
      <path d="M72 44 L74 188 M126 44 L124 188" stroke="${l}" stroke-width="1.5" opacity=".5"/><rect x="94" y="30" width="12" height="12" fill="${l}" opacity=".7"/>`;
    case 'Shirts': return `<path d="M52 56 L84 42 L100 58 L116 42 L148 56 L170 120 L148 130 L146 188 L54 188 L52 130 L30 120Z" fill="${c}"/><path d="M84 42 L100 78 L116 42 L100 58Z" fill="${shade(c, .25)}"/>
      <path d="M100 78 L100 188" stroke="${d}" stroke-width="2"/>${[96, 118, 140, 162].map(y => `<circle cx="100" cy="${y}" r="2.6" fill="${d}"/>`).join('')}`;
    case 'Ties': return /bow/.test(name)
      ? `<path d="M100 100 L50 70 L50 130Z M100 100 L150 70 L150 130Z" fill="${c}"/><rect x="90" y="88" width="20" height="24" rx="5" fill="${d}"/>`
      : `<path d="M88 30 L112 30 L106 56 L120 160 L100 190 L80 160 L94 56Z" fill="${c}"/><path d="M88 30 L112 30 L108 50 L92 50Z" fill="${d}"/><path d="M96 70 L100 180" stroke="${l}" stroke-width="2" opacity=".5"/>`;
    case 'Shoes': return `<path d="M30 130 Q34 90 70 92 L96 100 Q130 106 160 124 Q176 134 172 150 L30 150Z" fill="${c}"/><rect x="28" y="150" width="146" height="12" rx="5" fill="${d}"/><path d="M96 100 Q120 108 140 122" ${stitch}/><path d="M70 92 L72 112 M82 96 L84 114" stroke="${l}" stroke-width="2"/>`;
    default:
      if (/belt/.test(name)) return `<rect x="20" y="86" width="160" height="28" rx="6" fill="${c}"/><rect x="82" y="80" width="36" height="40" rx="6" fill="none" stroke="#d4a64a" stroke-width="5"/><rect x="96" y="92" width="4" height="16" fill="#d4a64a"/>${[130, 142, 154, 166].map(x => `<circle cx="${x}" cy="100" r="2.2" fill="${d}"/>`).join('')}`;
      if (/cufflink/.test(name)) return `<circle cx="70" cy="100" r="26" fill="${c}"/><circle cx="130" cy="100" r="26" fill="${c}"/><circle cx="70" cy="100" r="14" fill="${l}"/><circle cx="130" cy="100" r="14" fill="${l}"/><path d="M96 100 L104 100" stroke="${c}" stroke-width="4"/>`;
      if (/pocket/.test(name)) return `<path d="M50 60 L150 60 L150 150 L50 150Z" fill="${c}"/><path d="M50 60 L100 105 L150 60" fill="${l}" opacity=".6"/><path d="M50 150 L100 105 L150 150" fill="${d}" opacity=".5"/>`;
      return `<path d="M30 70 Q100 40 170 70 L176 128 Q100 100 24 128Z" fill="${c}"/><path d="M40 84 Q100 62 160 84" stroke="${l}" stroke-width="2" fill="none" opacity=".6"/><path d="M36 106 Q100 84 164 106" stroke="${d}" stroke-width="2" fill="none"/>`;
  }
}
function art(p, view = 0) {
  if (p.image_url && view === 0) return raw(`<img src="${esc(p.image_url)}" alt="${esc(p.name)}" loading="lazy">`);
  const c = /^#[0-9a-f]{6}$/i.test(p.color_hex) ? p.color_hex : '#1d2a52', id = 'g' + Math.random().toString(36).slice(2, 7);
  let inner;
  if (view === 1) inner = `<defs><pattern id="${id}" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="8" height="8" fill="${c}"/><rect width="2" height="8" fill="${shade(c, .12)}"/></pattern></defs><rect width="200" height="210" fill="url(#${id})"/><text x="100" y="196" text-anchor="middle" font-size="12" fill="#fff" opacity=".7">${esc(p.fabric || '')} - ${esc(p.color_name || '')}</text>`;
  else if (view === 2) inner = `<g transform="translate(-40 -30) scale(1.4)">${glyph(p, c)}</g>`;
  else inner = glyph(p, c);
  return raw(`<svg viewBox="0 0 200 210" role="img" aria-label="${esc(p.name)}">${inner}</svg>`);
}

// ------------------------------------------------------------------ charts
function barChart(items, { fmt = (v) => v, height = 190 } = {}) {
  if (!items.length) return H`<div class="empty">No data for this period.</div>`;
  const W = 640, Hh = height, pad = 26, max = Math.max(...items.map(i => i.value), 1), bw = (W - pad * 2) / items.length;
  const bars = items.map((it, i) => { const h = Math.max(2, (Hh - pad * 2) * it.value / max), x = pad + i * bw + bw * .15;
    return `<rect class="bar" x="${x}" y="${Hh - pad - h}" width="${bw * .7}" height="${h}" rx="3"><title>${esc(it.label)}: ${esc(fmt(it.value))}</title></rect>` +
      (items.length <= 16 || i % Math.ceil(items.length / 14) === 0 ? `<text x="${x + bw * .35}" y="${Hh - 8}" text-anchor="middle">${esc(it.label)}</text>` : ''); }).join('');
  return raw(`<svg class="chart" viewBox="0 0 ${W} ${Hh}" preserveAspectRatio="none" role="img"><line x1="${pad}" x2="${W - pad}" y1="${Hh - pad}" y2="${Hh - pad}" stroke="rgba(255,255,255,.12)"/>${bars}</svg>`);
}
function hbars(items, fmt = (v) => v) {
  const max = Math.max(...items.map(i => i.value), 1);
  return items.length ? H`${items.map(i => H`<div class="hbar"><span title="${i.label}">${i.label}</span><div class="t"><i style="width:${Math.max(2, i.value / max * 100)}%"></i></div><b class="mono">${fmt(i.value)}</b></div>`)}` : H`<div class="empty">No data for this period.</div>`;
}

// ------------------------------------------------------------------ order helpers
function orderSteps(o) {
  if (o.status === 'Cancelled') return H`<span class="badge bad">Cancelled</span>`;
  const end = o.has_rental ? ['Picked Up', 'Returned'] : [o.fulfilment === 'delivery' ? 'Delivered' : 'Picked Up'];
  const flow = ['Pending', ...(o.has_tailor ? ['Tailoring'] : []), 'Ready', ...end];
  const idx = flow.indexOf(o.status);
  return H`<div class="steps">${flow.map((s, i) => H`<div class="st ${i < idx || (i === idx && i === flow.length - 1) ? 'done' : ''} ${i === idx && i !== flow.length - 1 ? 'cur' : ''}">${s}</div>`)}</div>`;
}
const itemLabel = (i) => i.kind === 'rent' ? `${i.name} (rent ${fdate(i.rent_from)} - ${fdate(i.rent_to)})` : i.kind === 'tailor' ? `${i.name} (made to measure)` : i.name;

function receiptHtml(o, s) {
  const lines = o.items.map(i => H`<tr><td colspan="2">${itemLabel(i)}</td></tr><tr><td>&nbsp;&nbsp;${i.qty} x ${usd(i.unit_price)} ${i.size !== 'One size' ? '(' + i.size + ')' : ''}</td><td class="r" style="text-align:right">${usd(i.kind === 'rent' ? i.unit_price * i.rent_days * i.qty : i.unit_price * i.qty)}</td></tr>`);
  return H`<div class="receipt">
    ${s.logo ? H`<div class="c"><img src="${s.logo}" alt="" style="height:44px"></div>` : ''}
    <h3>${s.storeName}</h3><div class="c">${s.address}<br>${s.phone}</div><hr>
    <div class="c"><b>${s.receiptHeader}</b></div>
    <div class="r"><span>No: ${o.order_no}</span><span>${fdt(o.created_at)}</span></div>
    <div>Customer: ${o.customer_name}</div>${o.seller_name ? H`<div>Served by: ${o.seller_name}</div>` : ''}<hr>
    <table style="width:100%">${lines}</table><hr>
    <div class="r"><span>Subtotal</span><span>${usd(o.subtotal)}</span></div>
    ${num(o.bundle_discount) ? H`<div class="r"><span>Bundle (${o.bundle_names})</span><span>-${usd(o.bundle_discount)}</span></div>` : ''}
    ${num(o.discount) ? H`<div class="r"><span>Discount ${o.discount_pct}%${o.promo_code ? ' (' + o.promo_code + ')' : ''}</span><span>-${usd(o.discount)}</span></div>` : ''}
    ${num(o.points_value) ? H`<div class="r"><span>Points redeemed</span><span>-${usd(o.points_value)}</span></div>` : ''}
    <div class="r"><span>VAT ${s.vatPct}%</span><span>${usd(o.tax)}</span></div>
    ${num(o.deposit) ? H`<div class="r"><span>Rental deposit</span><span>${usd(o.deposit)}</span></div>` : ''}
    <div class="r"><b>TOTAL</b><b>${usd(o.total)}</b></div><div class="r"><span></span><span>${khr(o.total)}</span></div><hr>
    ${o.payments.map(p => H`<div class="r"><span>${p.method}${p.kind === 'deposit' ? ' (deposit)' : ''}</span><span>${usd(p.amount)}</span></div>`)}
    ${num(o.balance) > 0.005 ? H`<div class="r"><b>BALANCE DUE</b><b>${usd(o.balance)}</b></div>` : H`<div class="r"><span>Paid in full</span><span></span></div>`}
    ${o.refunds.map(r => H`<div class="r"><span>Refund (${r.method})</span><span>-${usd(r.amount)}</span></div>`)}<hr>
    <div class="c">${s.receiptFooter}</div></div>`;
}
async function showReceipt(order, settings) {
  const s = settings || (await api.get('/api/settings'));
  const subject = encodeURIComponent(`Your receipt ${order.order_no} - ${s.storeName}`);
  const bodyTxt = encodeURIComponent(`${s.storeName}\nReceipt ${order.order_no}\n` + order.items.map(i => `${i.qty} x ${itemLabel(i)} - ${usd(i.unit_price * i.qty)}`).join('\n') + `\nTotal: ${usd(order.total)}\nPaid: ${usd(order.paid)}\n\n${s.receiptFooter}`);
  const m = modal({ title: `Receipt ${order.order_no}`, body: receiptHtml(order, s),
    footer: H`<a class="btn" href="mailto:?subject=${subject}&body=${bodyTxt}">Email receipt</a><button class="btn primary" data-act="print">Print</button>` });
  bind(m.el, { click: { print: () => window.print() } });
}

// ------------------------------------------------------------------ icons + app shell
const ICONS = {
  home: 'M3 11l9-8 9 8v9a1 1 0 01-1 1h-5v-6H9v6H4a1 1 0 01-1-1z', shop: 'M4 7h16l-1 13H5zM8 7a4 4 0 018 0', cart: 'M3 4h2l2 12h11l2-8H6M9 20h.01M17 20h.01',
  box: 'M21 8l-9-5-9 5v8l9 5 9-5zM3 8l9 5 9-5M12 13v9', user: 'M12 12a4 4 0 100-8 4 4 0 000 8zM4 21a8 8 0 0116 0', ruler: 'M3 17l14-14 4 4L7 21zM8 12l2 2M11 9l2 2M14 6l2 2', cal: 'M4 5h16v16H4zM4 10h16M9 3v4M15 3v4',
  scissors: 'M6 9a3 3 0 100-6 3 3 0 000 6zM6 21a3 3 0 100-6 3 3 0 000-6zM20 4L8.1 15.9M14.5 14.5L20 20M8.1 8.1L12 12', hanger: 'M12 6a2 2 0 112 2c0 1-2 1.5-2 3l9 6a1 1 0 01-.6 1.8H3.6A1 1 0 013 17l9-6',
  bell: 'M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 01-3.4 0', chart: 'M4 20V10M10 20V4M16 20v-8M22 20H2', tag: 'M20 12l-8 8-9-9V3h8zM7.5 7.5h.01', users: 'M16 11a3 3 0 100-6M2 20a6 6 0 0112 0M18 20a6 6 0 00-3-5M9 11a3 3 0 100-6',
  gear: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01', pos: 'M4 3h16v6H4zM6 13h12v8H6zM8 16h.01M12 16h.01M16 16h.01', clock: 'M12 7v5l3 2M21 12a9 9 0 11-18 0 9 9 0 0118 0', gift: 'M20 12v9H4v-9M2 7h20v5H2zM12 22V7M12 7H7.5a2.5 2.5 0 110-5C11 2 12 7 12 7zM12 7h4.5a2.5 2.5 0 100-5C13 2 12 7 12 7z',
  truck: 'M1 3h15v13H1zM16 8h4l3 3v5h-7zM5.5 21a2 2 0 100-4 2 2 0 000 4zM18.5 21a2 2 0 100-4 2 2 0 000 4z', log: 'M9 12h6M9 16h6M9 8h2M5 3h10l4 4v14H5z', shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
  search: 'M11 19a8 8 0 100-16 8 8 0 000 16zM21 21l-4.3-4.3', star: 'M12 2l3 7 7 .6-5.3 4.7 1.6 7.2L12 17.8 5.7 21.5l1.6-7.2L2 9.6 9 9z', swap: 'M7 16V4M3 8l4-4 4 4M17 8v12M21 16l-4 4-4-4'
};
const icon = (n) => raw(`<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${ICONS[n] || ICONS.list}"/></svg>`);

function devTag(settings) { if (settings?.env === 'development' && !document.querySelector('.env-tag')) { const t = document.createElement('div'); t.className = 'env-tag'; t.textContent = 'DEV'; document.body.appendChild(t); } }

const Shell = {
  user: null, settings: null, ctx: null,
  /** nav: [{id,label,icon,perm?,section?}], views: {id: async (box, ctx) => void} */
  async mount({ expectedView, subtitle, nav, views, defaultView }) {
    const me = await api.get('/api/auth/me').catch(() => null);
    if (!me || me.user.view !== expectedView) { location.replace('login.html'); return new Promise(() => {}); }
    this.user = me.user; this.settings = await api.get('/api/settings'); Object.assign(Fmt.settings, this.settings); devTag(this.settings);
    const can = (p) => !p || this.user.perms.includes('*') || this.user.perms.includes(p);
    let items = nav.filter(n => can(n.perm));
    items = items.filter((n, i) => !n.section || (items[i + 1] && !items[i + 1].section));   // hide section titles with no screens under them
    const app = $('#app');
    render(app, H`<div class="app"><aside class="side" id="side">
      <div class="brand"><div class="logo">${this.settings.logo ? H`<img src="${this.settings.logo}" alt="">` : 'L'}</div><div><b>${this.settings.storeName}</b><span>${subtitle}</span></div></div>
      <nav class="nav" id="nav">${items.map(n => n.section ? H`<div class="sep">${n.section}</div>` : H`<a data-nav="${n.id}" tabindex="0">${icon(n.icon)}<span>${n.label}</span><span class="badge hidden" data-badge="${n.id}"></span></a>`)}</nav>
      <div class="me"><div class="small muted">Signed in as</div><b>${this.user.name}</b> <span class="badge ${this.user.role === 'client' ? 'gold' : 'info'}">${this.user.role}</span>
        <div class="row" style="margin-top:10px"><button class="btn sm grow" data-act="account">Account</button><button class="btn sm grow" data-act="logout">Sign out</button></div></div></aside>
      <div class="main"><header class="top"><button class="icon-btn menu-btn" data-act="menu" aria-label="Menu">${icon('list')}</button><div class="grow"><h1 id="pageTitle"></h1></div>
        <div class="row" style="position:relative"><button class="icon-btn" data-act="bell" aria-label="Notifications">${icon('bell')}<span class="dot hidden" id="bellDot"></span></button><div class="dropdown hidden" id="bellBox"></div></div></header>
        <main class="page" id="view"></main></div></div>`);
    const box = $('#view'); let current = null, token = 0;
    const go = (id) => { location.hash = '#/' + id; };
    const ctx = this.ctx = { user: this.user, settings: this.settings, can, go, refresh: () => show(current), setBadge: (id, n) => { const b = $(`[data-badge="${id}"]`); if (b) { b.textContent = n; b.classList.toggle('hidden', !n); } } };
    const show = async (id) => {
      const item = items.find(n => n.id === id) || items.find(n => n.id === defaultView) || items[0];
      current = item.id; const my = ++token;
      $$('#nav a').forEach(a => a.classList.toggle('active', a.dataset.nav === current));
      $('#pageTitle').textContent = item.label; $('#side').classList.remove('open');
      render(box, H`<div class="loading"><span class="spin"></span> Loading...</div>`);
      try { const d = document.createElement('div'); d.className = 'view'; await views[current](d, ctx); if (my === token) box.replaceChildren(d); }
      catch (e) { if (my === token) render(box, H`<div class="alert bad">${e.message}</div>`); }
    };
    window.addEventListener('hashchange', () => show(location.hash.replace('#/', '')));
    bind(app, { click: {
      menu: () => $('#side').classList.toggle('open'),
      logout: async () => { await api.post('/api/auth/logout').catch(() => {}); location.href = 'login.html'; },
      account: () => this.accountDialog(),
      bell: () => this.toggleBell() } });
    app.addEventListener('click', (e) => { const a = e.target.closest('[data-nav]'); if (a) go(a.dataset.nav); });
    app.addEventListener('keydown', (e) => { const a = e.target.closest('[data-nav]'); if (a && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); go(a.dataset.nav); } });
    document.addEventListener('click', (e) => { if (!e.target.closest('#bellBox') && !e.target.closest('[data-act="bell"]')) $('#bellBox')?.classList.add('hidden'); });
    this.setUnread(me.unread);
    setInterval(async () => { try { this.setUnread((await api.get('/api/auth/me')).unread); } catch { /* offline */ } }, 30000);
    await show(location.hash.replace('#/', '') || defaultView);
    return ctx;
  },
  setUnread(n) { const d = $('#bellDot'); if (d) { d.textContent = n; d.classList.toggle('hidden', !n); } },
  async toggleBell() {
    const b = $('#bellBox'); if (!b.classList.contains('hidden')) return b.classList.add('hidden');
    const list = await api.get('/api/me/notifications');
    render(b, H`<div class="row between" style="padding:10px 14px"><b>Notifications</b><button class="btn sm" data-act="readall">Mark all read</button></div>
      ${list.length ? list.map(n => H`<div class="it ${n.is_read ? '' : 'unread'}"><b>${n.title}</b><div class="small">${n.body}</div><div class="hint">${fdt(n.at)}</div></div>`) : H`<div class="empty">Nothing yet.</div>`}`);
    b.classList.remove('hidden');
    bind(b, { click: { readall: async () => { await api.post('/api/me/notifications/read'); this.setUnread(0); this.toggleBell(); this.toggleBell(); } } });
  },
  accountDialog() {
    const u = this.user, staff = u.role !== 'client';
    const m = modal({ title: 'My account', body: H`<div class="stack">
      <div><b>${u.name}</b><div class="muted small">${u.email} - ${u.role}</div></div>
      <form data-act="pw" class="stack-sm"><h3>Change password</h3>
        <label class="f"><span>Current password</span><input type="password" name="current" autocomplete="current-password" required></label>
        <label class="f"><span>New password (8+ characters)</span><input type="password" name="next" autocomplete="new-password" minlength="8" required></label><button class="btn primary">Update password</button></form>
      ${staff ? H`<form data-act="pin" class="stack-sm"><h3>Change PIN</h3><label class="f"><span>Current password</span><input type="password" name="current" required></label>
        <label class="f"><span>New PIN (4-6 digits)</span><input name="pin" inputmode="numeric" pattern="\\d{4,6}" required></label><button class="btn">Update PIN</button></form>` : ''}</div>` });
    bind(m.el, { submit: {
      pw: async (f) => { await api.post('/api/auth/password', formData(f)); toast('Password updated. Other devices were signed out.', 'ok'); m.close(); },
      pin: async (f) => { await api.post('/api/auth/pin', formData(f)); toast('PIN updated.', 'ok'); m.close(); } } });
  }
};
