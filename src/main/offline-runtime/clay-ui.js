/* clay-ui.js — clayjs satellite: toasts, modals, ask/confirm/tell dialogs, auto clay:save-* feedback. https://clayjs.com */
(function () {
  var clay = window.clay = window.clay || {};
  clay.loaded = clay.loaded || {};

  var script = document.currentScript;
  if (!script || !script.src) {
    console.error("clay-ui: could not determine my own URL (load me with a classic <script src=...>, not type=\"module\")");
    return;
  }
  var url = new URL(script.src, location.href);
  // Query and fragment off first, then step out of the tarball's entries/ directory
  // so package-path CDNs resolve src/. See clay.js for the full reason on both.
  var path = url.href.split("#")[0].split("?")[0];
  var base = path.slice(0, path.lastIndexOf("/"));
  if (url.pathname.slice(0, url.pathname.lastIndexOf("/")).slice(-8) === "/entries") {
    base = base.slice(0, -8);
  }

  // Toasts and dialogs append to document.body, so `loaded.ui` must not resolve
  // before the DOM is ready (same gate as clay-events).
  function domReady() {
    return new Promise(function (r) {
      if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", r);
      else r();
    });
  }

  clay.loaded.ui = domReady()
    .then(function () { return import(base + "/src/ui/index.js"); })
    .catch(function (err) { console.error("clay-ui failed to load:", err); throw err; });
  // Mark handled: a blocked satellite must not emit an unhandled rejection.
  // Consumers who await clay.loaded.ui still get the error.
  clay.loaded.ui.catch(function () {});
})();
