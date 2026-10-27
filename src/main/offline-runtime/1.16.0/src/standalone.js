/* clayjs standalone: the entry of the single-file build. https://clayjs.com/offline

   Twin of entries/clay.js. That bootstrap derives a base URL from its own script
   tag and imports the loader at runtime; this one is bundled together with the
   loader and every module it can ask for (see MODULES in loader-logic.js), so
   `plugins=` decides what runs, never what downloads. The bootstrap logic below
   (window.clay, `ready`, `__booted`, the retry path) is the same code as clay.js
   and must stay in step with it; tests/unit/bootstrap-twins.test.js compares the
   shared pieces. */
import { boot } from "./loader.js";
import onDomReady from "./lib/dom-ready.js";
import { noteBootParams } from "./core/draft-mode.js";

(function () {
  // Suppress every vendored bundle's window auto-export; the loader assembles
  // window.clay explicitly.
  window.__hyperclayNoAutoExport = true;

  // Merge into any window.clay a satellite already created; never replace it.
  var clay = window.clay = window.clay || {};
  // A second tag is a no-op: the original boot's `ready` promise survives.
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

  // clay.js needs its own URL to find the loader; this file needs it only for the
  // query string, so pasted inline into the page it boots with the defaults.
  var script = document.currentScript;
  var params = script && script.src ? new URL(script.src, location.href).searchParams : new URLSearchParams();
  clay.__booted = true;
  // Before the satellites below: the internals graph reaches core/is-edit-mode.js,
  // which freezes its draft-mode answer as it evaluates. boot() notes the same
  // params again, which is harmless.
  noteBootParams(params);

  function domReady() {
    return new Promise(function (r) { onDomReady(r); });
  }

  // The module satellites, on the terms of their own entry scripts: each is a
  // promise on clay.loaded, the ones that touch document.body wait for DOM
  // ready, and events waits for dom because [onrender] handlers reach for its
  // element helpers the moment events lands.
  function satellite(name, promise) {
    var p = promise.catch(function (err) {
      console.error("clayjs: " + name + " failed to load:", err);
      throw err;
    });
    // Mark handled: a failed satellite must not emit an unhandled rejection.
    // Consumers who await clay.loaded[name] still get the error.
    p.catch(function () {});
    clay.loaded[name] = p;
  }

  clay.loaded = clay.loaded || {};
  // The two generated satellites are classic scripts that assemble themselves
  // onto window.clay when they run, and they carry no guard of their own, so
  // they run here, behind the sentinel, and not as hoisted static imports: a
  // duplicate tag would otherwise mount a second Sap runtime on the page. For
  // the same reason a tag that already registered one (a leftover
  // <script src="sap.js"> above this one) wins, and the copy in here stays idle.
  if (!clay.loaded.data) satellite("data", import("../entries/clay-data.js"));
  if (!clay.loaded.sap) satellite("sap", import("../entries/sap.js"));
  satellite("dom", import("./dom/dom-helpers.js"));
  satellite("utils", import("./utils/index.js"));
  satellite("internals", import("./internals/index.js"));
  satellite("all", import("./dom/all.js").then(function (m) {
    window.All = m.default;   // interop carve-out, as in entries/all.js
    clay.All = m.default;
    return m.default;
  }));
  satellite("ui", domReady().then(function () { return import("./ui/index.js"); }));
  satellite("options", domReady().then(function () { return import("./options/options.js"); }));
  satellite("router", import("./route/route.js").then(function (m) { return m.default; }));
  satellite("events", domReady()
    .then(function () { return clay.loaded.dom && clay.loaded.dom.catch(function () {}); })
    .then(function () { return import("./events/index.js"); }));

  // The first argument is the loader's unused `base`; see boot() in loader.js.
  boot(null, params, clay.__readyResolve).catch(function (err) {
    clay.__booted = false;
    console.error("clayjs failed to load:", err);
    // Settle the promise so `await clay.ready` fails loudly instead of hanging,
    // then mint a fresh one for a corrected retry tag. See entries/clay.js. A
    // retry re-evaluates this whole file, satellites included; the path is
    // reachable only when a bundled module throws on evaluation, which is a
    // clayjs bug, not a page condition.
    var reject = clay.__readyReject;
    mintReady();
    if (reject) reject(err);
  });
})();
