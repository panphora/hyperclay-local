/* clay-options.js — clayjs satellite: option:/option-not:/show-when:/hide-when: visibility. https://clayjs.com */
(function () {
  var clay = window.clay = window.clay || {};
  clay.loaded = clay.loaded || {};

  var script = document.currentScript;
  if (!script || !script.src) {
    console.error("clay-options: could not determine my own URL (load me with a classic <script src=...>, not type=\"module\")");
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

  // Subscribes to the mutation hub (observes document.body); wait for DOM ready.
  function domReady() {
    return new Promise(function (r) {
      if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", r);
      else r();
    });
  }

  clay.loaded.options = domReady()
    .then(function () { return import(base + "/src/options/options.js"); })
    .catch(function (err) { console.error("clay-options failed to load:", err); throw err; });
  // Mark handled: see clay-ui.js.
  clay.loaded.options.catch(function () {});
})();
