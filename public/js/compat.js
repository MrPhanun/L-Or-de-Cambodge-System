/* Browser compatibility: polyfills for newer built-ins + notice for browsers too old to run the app. */
(function () {
  function supportsSyntax() {
    try { new Function('var a={};return a?.b ?? 1;'); return true; } catch (e) { return false; }
  }
  if (!supportsSyntax() || !window.Promise || !window.fetch) {
    document.addEventListener('DOMContentLoaded', function () {
      document.body.innerHTML = '<div style="font-family:Arial,sans-serif;max-width:480px;margin:15vh auto;padding:24px;text-align:center">' +
        '<h2>Please update your browser</h2><p>This site needs a modern browser. Open it in the latest Chrome, Edge, Firefox, Safari or Opera.</p></div>';
    });
    return;
  }
  function at(n) { n = Math.trunc(n) || 0; if (n < 0) n += this.length; return this[n]; }
  [Array, String].forEach(function (C) {
    if (!C.prototype.at) Object.defineProperty(C.prototype, 'at', { value: at, writable: true, configurable: true });
  });
  if (!String.prototype.replaceAll) {
    Object.defineProperty(String.prototype, 'replaceAll', { writable: true, configurable: true, value: function (s, r) {
      return s instanceof RegExp ? this.replace(s, r) : this.split(s).join(r);
    } });
  }
  if (!Object.fromEntries) {
    Object.fromEntries = function (it) { var o = {}; for (var e of it) o[e[0]] = e[1]; return o; };
  }
  if (!window.structuredClone) {
    window.structuredClone = function (v) { return JSON.parse(JSON.stringify(v)); };
  }
  if (!Element.prototype.closest) {
    Element.prototype.closest = function (s) { var e = this; while (e && e.nodeType === 1) { if ((e.matches || e.msMatchesSelector).call(e, s)) return e; e = e.parentElement; } return null; };
  }
})();
