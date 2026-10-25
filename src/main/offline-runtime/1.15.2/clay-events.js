/* clay-events.js — clayjs satellite: onclickaway, onclickchildren, onclone, onmutation, onpagemutation, onrender. https://clayjs.com */
(function () {
  var clay = window.clay = window.clay || {};
  clay.loaded = clay.loaded || {};

  var script = document.currentScript;
  if (!script || !script.src) {
    console.error("clay-events: could not determine my own URL (load me with a classic <script src=...>, not type=\"module\")");
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
  // Only an explicit ?editmode=true asks for the supplement: the owner cookie is not
  // an edit request, because an owner who opens a document in view resolves to view.
  function __clayLikelyEdit(search) {
    return new URLSearchParams(search).get("editmode") === "true";
  }
  var likelyEdit = __clayLikelyEdit(window.location.search);
  if (!clay.__runtime) {
    clay.__runtime = Promise.all([
      import(dir + M.manifest),
      likelyEdit ? import(dir + M.edit).catch(function () { return null; }) : null
    ]).then(function (r) {
      var manifest = r[0].default;
      manifest.base = dir;
      var edit = r[1] ? r[1].default : null;
      var hints = null;
      // The cached hint fetch a resolved edit, draft or first entry uses. A failed one
      // clears itself for retry and never selects another release.
      function loadEditHints() {
        if (!hints) {
          hints = (edit ? Promise.resolve(edit) : import(dir + M.edit).then(function (m) { return m.default; }))
            .catch(function (err) { hints = null; throw err; });
        }
        return hints;
      }
      return { chunks: true, dir: dir, manifest: manifest, edit: edit, loadEditHints: loadEditHints };
    }, function (err) {
      console.warn("clayjs: the bundled runtime did not load, loading the module tree instead:", err);
      return { chunks: false, tree: tree };
    });
  }
  return { tree: tree, runtime: clay.__runtime };
})({"dir":"m/","manifest":"manifest-799F0940.js","edit":"manifest-edit-E04C2E9C.js","preload":["events/index-JN6FW3OX.js","c-EHV7RYXM.js","c-IJUK2GPW.js","c-I7PZZ6CZ.js","c-HA6INT6J.js","c-WRBKEJD4.js","c-DCFSEJZG.js","c-VHNSBD2M.js","manifest-799F0940.js"]})

  // The mutation-backed attrs subscribe to a hub that observes document.body, so
  // wait for DOM ready before importing (same gate as clay.js).
  function domReady() {
    return new Promise(function (r) {
      if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", r);
      else r();
    });
  }

  // [onrender] sweeps the whole document the moment that import resolves, and those
  // handlers routinely reach for clay-dom's element helpers (this.val, this.exec,
  // this.nearest). The two satellites are independent dynamic imports with nothing
  // ordering them, so on a cold load events can win and every handler throws
  // "Cannot read properties of undefined". By DOM ready every satellite tag has run,
  // so clay.loaded.dom is present exactly when clay-dom.js is on the page: wait for it
  // then, proceed when it is absent. A clay-dom that failed to load must not take
  // events down with it, so its rejection is swallowed here rather than chained.
  clay.loaded.events = domReady()
    .then(function () { return clay.loaded.dom && clay.loaded.dom.catch(function () {}); })
    .then(function () { return __clayChunks.runtime.then(function (R) {
  if (!R.chunks) return import(__clayChunks.tree + "/src/events/index.js");
  var file = R.manifest.entries["events/index.js"];
  if (!file) throw new Error("clayjs: release " + R.manifest.version + " has no events/index.js");
  return import(R.dir + file);
}); })
    .catch(function (err) { console.error("clay-events failed to load:", err); throw err; });
  // Mark handled: see clay-ui.js.
  clay.loaded.events.catch(function () {});
})();
