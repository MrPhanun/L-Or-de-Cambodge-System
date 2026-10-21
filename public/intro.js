'use strict';

const INTRO_OPEN_AT_MS = 5000;   // when the curtains start to part
const INTRO_REMOVE_AT_MS = 6200; // when the overlay is removed
const STORAGE_KEY = 'introSeen';

const introEl = document.getElementById('intro');
const titleEl = document.getElementById('introTitle');
const skipBtn = document.getElementById('skip');
const logoBtn = document.getElementById('logo');

function markIntroSeen(seen) {
  try {
    if (seen) sessionStorage.setItem(STORAGE_KEY, '1');
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch { /* storage unavailable - ignore */ }
}

/** Wrap each letter in a span so CSS can animate them one by one. */
function splitTitleIntoLetters() {
  const text = titleEl.textContent;
  titleEl.textContent = '';
  [...text].forEach((char, index) => {
    const span = document.createElement('span');
    span.className = 'ch';
    span.style.setProperty('--i', index);
    span.textContent = char === ' ' ? '\u00A0' : char;
    titleEl.appendChild(span);
  });
}

function splitGreeting() {
  const h1 = document.querySelector('.greeting h1');
  if (!h1) return;
  const text = h1.textContent;
  h1.setAttribute('aria-label', text);
  h1.textContent = '';
  [...text].forEach((char, index) => {
    const span = document.createElement('span');
    span.className = 'ch';
    span.setAttribute('aria-hidden', 'true');
    span.style.setProperty('--i', index);
    span.textContent = char;
    h1.appendChild(span);
  });
}
splitGreeting();

function finishIntro() {
  introEl.classList.add('gone');
  document.body.classList.add('ready');
  markIntroSeen(true);
}

function playIntro() {
  splitTitleIntoLetters();

  const openTimer = setTimeout(() => introEl.classList.add('open'), INTRO_OPEN_AT_MS);
  const removeTimer = setTimeout(finishIntro, INTRO_REMOVE_AT_MS);

  skipBtn.addEventListener('click', () => {
    clearTimeout(openTimer);
    clearTimeout(removeTimer);
    introEl.classList.add('open');
    setTimeout(finishIntro, 700);
  });
}

function replayIntro() {
  markIntroSeen(false);
  location.reload();
}

const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

if (prefersReducedMotion) {
  finishIntro();
} else {
  playIntro();
}

logoBtn.addEventListener('click', replayIntro);
