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

  var __clayChunks = (function (M) {
  var clay = window.clay = window.clay || {};
  var dir = new URL(M.dir, base + "/").href;
  var tree = base.slice(-5) === "/dist" ? base.slice(0, -5) : base;
  var have = {};
  document.head.querySelectorAll('link[rel="modulepreload"]').forEach(function (link) { have[link.href] = true; });
  M.preload.forEach(function (file) {
    var href = dir + file;
    if (have[href]) return;
    have[href] = true;
    var link = document.createElement("link");
    link.rel = "modulepreload";
    link.href = href;
    link.setAttribute("clay", "no-save");
    document.head.appendChild(link);
  });
  function __clayLikelyEdit(search, cookie) {
    return new URLSearchParams(search).get("editmode") === "true" || /(?:^|;\s*)isAdminOfCurrentResource=/.test(cookie);
  }
  // A sandboxed document throws on document.cookie; no cookies readable is no cookie.
  function __clayReadCookie() {
    try { return document.cookie || ""; } catch (err) { return ""; }
  }
  var likelyEdit = __clayLikelyEdit(window.location.search, __clayReadCookie());
  if (!clay.__runtime) {
    clay.__runtime = Promise.all([
      import(dir + M.manifest),
      likelyEdit ? import(dir + M.edit).catch(function () { return null; }) : null
    ]).then(function (r) {
      var manifest = r[0].default;
      manifest.base = dir;
      return { chunks: true, dir: dir, manifest: manifest, edit: r[1] ? r[1].default : null };
    }, function (err) {
      console.warn("clayjs: the bundled runtime did not load, loading the module tree instead:", err);
      return { chunks: false, tree: tree };
    });
  }
  return { tree: tree, runtime: clay.__runtime };
})({"dir":"m/","manifest":"manifest-35623C00.js","edit":"manifest-edit-6B47A064.js","preload":["ui/index-5LDOXGEE.js","c-JE3QT2XY.js","c-OCJF3QI5.js","c-H6WCNKAE.js","c-JT3CJXND.js","c-VAK7SG37.js","c-NUHP2XDB.js","c-LJI5DT2L.js","c-UTGOU6Z2.js","c-UL2YUY52.js","c-R3RRYHL6.js","c-VKEDWYDF.js","c-2AZDZWCK.js","c-VHNSBD2M.js","manifest-35623C00.js"]})

  // Toasts and dialogs append to document.body, so `loaded.ui` must not resolve
  // before the DOM is ready (same gate as clay-events).
  function domReady() {
    return new Promise(function (r) {
      if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", r);
      else r();
    });
  }

  clay.loaded.ui = domReady()
    .then(function () { return __clayChunks.runtime.then(function (R) {
  if (!R.chunks) return import(__clayChunks.tree + "/src/ui/index.js");
  var file = R.manifest.entries["ui/index.js"];
  if (!file) throw new Error("clayjs: release " + R.manifest.version + " has no ui/index.js");
  return import(R.dir + file);
}); })
    .catch(function (err) { console.error("clay-ui failed to load:", err); throw err; });
  // Mark handled: a blocked satellite must not emit an unhandled rejection.
  // Consumers who await clay.loaded.ui still get the error.
  clay.loaded.ui.catch(function () {});
})();
