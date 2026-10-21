/* clay-router.js — clayjs satellite: URL-hash routing as tab-local attributes. https://clayjs.com */
(function () {
  var clay = window.clay = window.clay || {};
  clay.loaded = clay.loaded || {};

  var script = document.currentScript;
  if (!script || !script.src) {
    console.error("clay-router: could not determine my own URL (load me with a classic <script src=...>, not type=\"module\")");
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

  // Mirror the hash onto <html> now, before the module loads, so a saved
  // show-when:route-* rule is right at first paint. The module re-applies.
  try {
    var raw = location.hash.slice(1);
    if (raw.indexOf("=") !== -1) {
      new URLSearchParams(raw).forEach(function (value, name) {
        if (/^[a-z][a-z0-9-]*$/.test(name) && name !== "active" && value) {
          document.documentElement.setAttribute("route-" + name, value);
        }
      });
    }
  } catch (e) { /* the module applies it */ }

  clay.loaded.router = import(base + "/src/route/route.js")
    .then(function (m) { return m.default; })
    .catch(function (err) { console.error("clay-router failed to load:", err); throw err; });
  // Mark handled: see clay-ui.js.
  clay.loaded.router.catch(function () {});
})();
