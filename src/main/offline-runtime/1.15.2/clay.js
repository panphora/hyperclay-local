/* clayjs bootstrap. https://clayjs.com */
(function () {
  // Suppress every vendored bundle's window auto-export; the loader assembles
  // window.clay explicitly.
  window.__hyperclayNoAutoExport = true;

  // Merge into any window.clay a satellite already created; never replace it.
  var clay = window.clay = window.clay || {};
  // A second core tag is a no-op: the original boot's `ready` promise survives.
  // A FAILED boot resets the sentinel so a corrected tag can retry; the retry
  // resolves the ORIGINAL `ready` promise via the stashed resolver.
  if (clay.__booted) return;

  function mintReady() {
    clay.ready = new Promise(function (res, rej) {
      clay.__readyResolve = res;
      clay.__readyReject = rej;
    });
    // Nobody may be awaiting a failed boot's promise, and an unhandled rejection
    // in the console is noise on top of the error we already logged.
    clay.ready.catch(function () {});
  }

  if (!clay.ready) mintReady();

  // clay.start runs app code once per page, after boot. A live-sync merge can
  // re-insert an inline script and run it again; the repeat call is a no-op.
  // It lives in the bootstrap so an inline script can call it before boot ends.
  if (!clay.start) {
    var started = Object.create(null);
    clay.start = function (name, fn) {
      if (typeof name === "function") { fn = name; name = ""; }
      if (started[name]) return;
      started[name] = true;
      // A failed boot rejects the old promise after minting a new one, so a call
      // made before the failure waits for the corrected tag's boot instead.
      var wait = function () {
        var ready = clay.ready;
        return ready.then(fn, function (err) {
          if (clay.ready === ready) throw err;
          return wait();
        });
      };
      return wait();
    };
  }

  var script = document.currentScript;
  if (!script || !script.src) {
    console.error("clayjs: could not determine my own URL (load me with a classic <script src=...>, not type=\"module\")");
    return;
  }
  clay.__booted = true;

  var url = new URL(script.src, location.href);
  // The query and the fragment come off before the last slash is found. Leaving them
  // on split the base inside them, so clay.js?next=/a/b imported ".../clay.js?next=/a/src/loader.js"
  // and the library never booted.
  var path = url.href.split("#")[0].split("?")[0];
  var base = path.slice(0, path.lastIndexOf("/"));
  // In the npm tarball the entry scripts sit in entries/ while src/ stays beside it
  // at the package root, so a CDN that serves package paths literally (jsDelivr,
  // unpkg) would look for src/ one directory too deep and load nothing. Stepping out
  // of an "entries" segment makes those URLs resolve. clayjs.com never has the
  // segment: build.js flattens entries/ into each version prefix, so this is a no-op
  // there. The question is asked of the pathname, because asking it of the whole URL
  // matched a host merely named "entries" and sent the import to another origin.
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
})({"dir":"m/","manifest":"manifest-35623C00.js","edit":"manifest-edit-6B47A064.js","preload":["loader-EOZBHQTA.js","c-RLA3PT2D.js","c-7SWMYKAI.js","c-UGHH4MB3.js","c-EHV7RYXM.js","c-IJUK2GPW.js","c-I7PZZ6CZ.js","c-HA6INT6J.js","c-WRBKEJD4.js","c-DCFSEJZG.js","c-VHNSBD2M.js","c-LJI5DT2L.js","c-FILLTJA7.js","c-VKEDWYDF.js","c-CYWLPPUS.js","manifest-35623C00.js","core/draft-mode-WSQAT67S.js","c-N7JPUPGC.js","core/is-edit-mode-RYNJSCCI.js","c-72P6BIQH.js","c-P7KNDG34.js","lib/region-policy-SB2AWVG5.js"]})
  __clayChunks.runtime.then(function (R) {
  if (!R.chunks) return import(__clayChunks.tree + "/src/loader.js");
  window.clay.__chunked = true;
  return import(R.dir + R.manifest.entries["loader.js"]).then(function (m) {
    return { boot: function (b, p, resolve) { return m.boot(b, p, resolve, R.manifest, R.edit); } };
  });
})
    .then(function (m) { return m.boot(base, url.searchParams, clay.__readyResolve); })
    .catch(function (err) {
      clay.__booted = false;
      console.error("clayjs failed to load:", err);
      // Settle the promise so `await clay.ready` fails loudly instead of hanging
      // forever with nothing to catch. Then mint a fresh one: a promise settles
      // once, so without this the corrected retry tag would call __readyResolve on
      // an already-rejected promise and every later await would keep throwing even
      // though the retry succeeded.
      var reject = clay.__readyReject;
      mintReady();
      if (reject) reject(err);
    });
})();
