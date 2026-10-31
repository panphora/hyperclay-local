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

  var __clayChunks = (function (M) {
  var clay = window.clay = window.clay || {};
  var dir = new URL(M.dir, base + "/").href;
  var tree = base.slice(-5) === "/dist" ? base.slice(0, -5) : base;
  var have = {};
  document.head.querySelectorAll('link[rel="modulepreload"]').forEach(function (link) { have[link.href] = true; });
  // Only an explicit ?editmode=true asks for the supplement, or the window.clayEditMode
  // global a standalone page sets before this script; the owner cookie is not an edit
  // request, because an owner who opens a document in view resolves to view.
  function __clayLikelyEdit(search) {
    var asked = new URLSearchParams(search).get("editmode");
    if (asked) return asked === "true";
    if (typeof clayEditMode !== "undefined") return Boolean(clayEditMode);
    return typeof __hyperclayEditMode !== "undefined" && Boolean(__hyperclayEditMode);
  }
  var likelyEdit = __clayLikelyEdit(window.location.search);
  // The supplement an edit page is about to import, preloaded like the manifest.
  if (likelyEdit) M.preload.push(M.edit);
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
})({"dir":"m/","manifest":"manifest-993BFDFD.js","edit":"manifest-edit-AB3FA12F.js","preload":["route/route-OAYDMIK3.js","c-VHNSBD2M.js","manifest-993BFDFD.js"]})

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

  clay.loaded.router = __clayChunks.runtime.then(function (R) {
  if (!R.chunks) return import(__clayChunks.tree + "/src/route/route.js");
  var file = R.manifest.entries["route/route.js"];
  if (!file) throw new Error("clayjs: release " + R.manifest.version + " has no route/route.js");
  return import(R.dir + file);
})
    .then(function (m) { return m.default; })
    .catch(function (err) { console.error("clay-router failed to load:", err); throw err; });
  // Mark handled: see clay-ui.js.
  clay.loaded.router.catch(function () {});
})();
