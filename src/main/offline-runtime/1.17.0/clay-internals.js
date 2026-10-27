/* clay-internals.js — clayjs satellite: clay.internals = the supported low-level surface (snapshot, region policy, save lane). https://clayjs.com */
(function () {
  var clay = window.clay = window.clay || {};
  clay.loaded = clay.loaded || {};

  var script = document.currentScript;
  if (!script || !script.src) {
    console.error("clay-internals: could not determine my own URL (load me with a classic <script src=...>, not type=\"module\")");
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
})({"dir":"m/","manifest":"manifest-4C419D67.js","edit":"manifest-edit-B077F288.js","preload":["internals/index-PVXGPUDA.js","c-LWLBHLVC.js","c-SDAXDM2D.js","c-TQEMVJCS.js","c-DCXOXBF3.js","c-VRZN56XY.js","c-OW5QIGG3.js","c-BPF2NSPV.js","c-HA6INT6J.js","c-WRBKEJD4.js","c-P7KNDG34.js","c-CYWLPPUS.js","c-N7JPUPGC.js","c-IJUK2GPW.js","c-SPIORRYS.js","c-XQXZAO7N.js","c-S7LK4KUE.js","c-VG5XIN4T.js","c-2YYDMLNZ.js","c-DCFSEJZG.js","c-VHNSBD2M.js","manifest-4C419D67.js"]})

  // No DOM gate: nothing here touches document.body at import time, unlike clay-ui.
  clay.loaded.internals = __clayChunks.runtime.then(function (R) {
  if (!R.chunks) return import(__clayChunks.tree + "/src/internals/index.js");
  var file = R.manifest.entries["internals/index.js"];
  if (!file) throw new Error("clayjs: release " + R.manifest.version + " has no internals/index.js");
  return import(R.dir + file);
})
    .catch(function (err) { console.error("clay-internals failed to load:", err); throw err; });
  // Mark handled: a blocked satellite must not emit an unhandled rejection.
  clay.loaded.internals.catch(function () {});
})();
