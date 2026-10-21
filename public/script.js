'use strict';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^\+?[0-9][0-9\s-]{6,17}$/;

const $ = (id) => document.getElementById(id);
const els = {
  card: $('card'), form: $('loginForm'), email: $('email'), password: $('password'), submit: $('submit'), toggle: $('toggle'), message: $('msg'),
  pinSwitch: $('pinSwitch'), pwLabel: $('pwLabel'), sub: $('sub'), reg: $('registerForm'), switchLink: $('switchLink'), switchLine: $('switchLine')
};
const state = { pin: false, registering: false };

// ---------- helpers ----------
function setError(id, text) {
  const el = $(id + 'Error'); if (el) el.textContent = text;
  $(id).classList.toggle('invalid', Boolean(text));
}
function showMessage(el, text, type) { el.className = `msg ${type}`; el.textContent = text; }
function shakeCard() { els.card.classList.remove('shake'); void els.card.offsetWidth; els.card.classList.add('shake'); }
async function post(url, body) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' }, body: JSON.stringify(body), credentials: 'same-origin' });
  let json = {}; try { json = await res.json(); } catch { /* empty */ }
  if (!res.ok) throw new Error(json.error || 'Something went wrong. Please try again.');
  return json;
}

// ---------- tabs / modes ----------
function applyMode() {
  els.sub.textContent = state.registering ? 'Create your account. It takes a minute.' : 'Sign in with your email and password. We will take you to the right place.';
  els.pwLabel.textContent = state.pin ? 'PIN' : 'Password';
  els.pinSwitch.textContent = state.pin ? 'Use password instead' : 'Staff: sign in with PIN';
  els.password.type = 'password'; els.toggle.textContent = 'Show';
  els.password.setAttribute('inputmode', state.pin ? 'numeric' : 'text');
  els.password.autocomplete = state.pin ? 'off' : 'current-password';
  els.form.classList.toggle('hidden', state.registering);
  els.reg.classList.toggle('hidden', !state.registering);
  els.pinSwitch.classList.toggle('hidden', state.registering);
  els.switchLine.firstChild.textContent = state.registering ? 'Already have an account? ' : 'New here? ';
  els.switchLink.textContent = state.registering ? 'Sign in' : 'Create an account';
  $('google').classList.toggle('hidden', state.registering);
}
els.pinSwitch.addEventListener('click', () => { state.pin = !state.pin; els.password.value = ''; applyMode(); els.password.focus(); });
els.switchLink.addEventListener('click', (e) => { e.preventDefault(); state.registering = !state.registering; applyMode(); });
$('google').addEventListener('click', () => {
  showMessage(els.message, 'Google sign-in is not set up yet: it needs a Google OAuth client ID configured on the server. Please use your email or phone.', 'bad');
  state.registering = false; applyMode();
});
els.toggle.addEventListener('click', () => {
  const show = els.password.type === 'password';
  els.password.type = show ? 'text' : 'password'; els.toggle.textContent = show ? 'Hide' : 'Show';
  els.toggle.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
});

// ---------- sign in ----------
function validateLogin() {
  let ok = true;
  const id = els.email.value.trim();
  const e1 = !id ? 'Email or phone is required.' : (EMAIL_PATTERN.test(id) || PHONE_PATTERN.test(id)) ? '' : 'Enter a valid email or phone number.';
  setError('email', e1); if (e1) ok = false;
  const v = els.password.value, pinMode = state.pin;
  const e2 = !v ? (pinMode ? 'PIN is required.' : 'Password is required.') : pinMode && !/^\d{4,6}$/.test(v) ? 'PIN is 4-6 digits.' : '';
  setError('password', e2); if (e2) ok = false;
  return ok;
}
els.form.addEventListener('submit', async (e) => {
  e.preventDefault(); showMessage(els.message, '', '');
  if (!validateLogin()) return shakeCard();
  els.submit.classList.add('loading'); els.submit.disabled = true;
  try {
    const r = await post('/api/auth/login', { identifier: els.email.value, secret: els.password.value, mode: state.pin ? 'pin' : 'password' });
    showMessage(els.message, 'Signed in. Redirecting...', 'ok');
    location.href = r.home;
  } catch (err) { showMessage(els.message, err.message, 'bad'); shakeCard(); els.password.value = ''; }
  finally { els.submit.classList.remove('loading'); els.submit.disabled = false; }
});

// ---------- register ----------
els.reg.addEventListener('submit', async (e) => {
  e.preventDefault(); showMessage($('rMsg'), '', '');
  const name = $('rName').value.trim(), email = $('rEmail').value.trim(), phone = $('rPhone').value.trim(), pw = $('rPassword').value;
  const errs = { rName: name ? '' : 'Name is required.', rEmail: EMAIL_PATTERN.test(email) ? '' : 'Enter a valid email address.',
    rPhone: !phone || PHONE_PATTERN.test(phone) ? '' : 'Enter a valid phone number.', rPassword: pw.length >= 8 ? '' : 'Use at least 8 characters.' };
  for (const [id, t] of Object.entries(errs)) setError(id, t);
  if (Object.values(errs).some(Boolean)) return shakeCard();
  const btn = $('rSubmit'); btn.classList.add('loading'); btn.disabled = true;
  try { const r = await post('/api/auth/register', { name, email, phone, password: pw }); location.href = r.home; }
  catch (err) { showMessage($('rMsg'), err.message, 'bad'); shakeCard(); }
  finally { btn.classList.remove('loading'); btn.disabled = false; }
});

for (const id of ['email', 'password', 'rName', 'rEmail', 'rPhone', 'rPassword']) $(id).addEventListener('input', () => setError(id, ''));
applyMode();
