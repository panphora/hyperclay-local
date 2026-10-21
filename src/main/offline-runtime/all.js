/* all.js — clayjs satellite: All(selector) chainable querySelectorAll wrapper. https://clayjs.com */
(function () {
  var clay = window.clay = window.clay || {};
  clay.loaded = clay.loaded || {};

  var script = document.currentScript;
  if (!script || !script.src) {
    console.error("all.js: could not determine my own URL (load me with a classic <script src=...>, not type=\"module\")");
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

  clay.loaded.all = import(base + "/src/dom/all.js")
    .then(function (m) {
      var All = m.default;
      window.All = All;   // interop carve-out (§2.3)
      clay.All = All;
      return All;
    })
    .catch(function (err) { console.error("all.js failed to load:", err); throw err; });
  // Mark handled: see clay-ui.js.
  clay.loaded.all.catch(function () {});
})();
