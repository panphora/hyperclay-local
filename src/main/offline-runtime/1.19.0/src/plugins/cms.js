// The CMS shell, toggle, inline layer and ghost rows, with their --mirk-* tokens pinned
// to Bevel and the Bevel system mono face. The CMS keeps its own stylesheet and its
// own light/dark switching. The "Edit content" toggle also gets Bevel's button face, ink and hover (src/ui/skins/cms-toggle.js).
import { installSkin } from "../ui/vendor-skin.js";
import { CSS } from "../ui/skins/cms.js";
import { CSS as TOGGLE_CSS, ROOTS as TOGGLE_ROOTS } from "../ui/skins/cms-toggle.js";
import { cms as hypercms } from "../vendor/hypercms.vendor.js";

export { cms, default } from "../vendor/hypercms.vendor.js";

installSkin("cms", CSS);
// The toggle takes the page's scheme, so Bevel's face and ink resolve the way the page reads.
installSkin("cms-toggle", TOGGLE_CSS, { roots: TOGGLE_ROOTS });

const fault = (message, code) => Object.assign(new Error(`clay:cms: ${message}`), { code });

const isStale = (context) => {
  if (!context) return false;
  if (context.signal?.aborted) return true;
  return typeof context.isCurrent === "function" && !context.isCurrent();
};

// One edit session over the page the CMS edits, as a ClayJS lease. The source owns the
// session itself, so every method here is the source's own lifecycle call: `enable`
// opens and mounts, `resume` is the refused exit over the same session, and `dispose`
// goes through the CMS's teardown after the barrier.
//
// `quiesce` is the one call the lease shapes. The source answers for the work it still
// holds, an upload in flight or a painted preview, with `{ok:false}` rather than by
// tearing that work down: an exit refused there keeps the session, its buffers and the
// upload, and the controller resumes the same lease once the person finishes or
// discards it. The lease contract carries a refusal as the `code` a controller reports,
// so the non-ok answer is thrown as `pending-input`.
function cmsLease(source) {
  let disposed = false;
  return {
    ready: source.ready,
    enable() {
      if (disposed) return;
      source.enable();
    },
    quiesce() {
      if (disposed) return;
      const result = source.quiesce();
      if (result && result.ok === false) {
        throw Object.assign(fault("the CMS still has work to finish", result.code || "pending-input"), {
          pending: result.pending,
        });
      }
      return result;
    },
    resume() {
      if (disposed) return;
      source.resume();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      source.dispose();
    },
  };
}

// The boot this tab made, adopted instead of prepared. A page that opened the CMS itself
// (`?cms=true`) holds a session the source hands no lease out for, so it cannot be
// quiesced or torn down through the adapter and the caller keeps its reload instead;
// a boot that opened nothing has nothing to hand back, and this lease starts nothing.
function adopt() {
  if (hypercms.isOpen) throw fault("the CMS this boot opened cannot be taken back", "unsupported-plugin");
  const lease = cmsLease(hypercms.prepareModeLease({}));
  return {
    enable() {},
    quiesce: () => lease.quiesce(),
    resume: () => lease.resume(),
    dispose: () => lease.dispose(),
  };
}

/**
 * The CMS as a mode participant: the session the commit that enters edit opens, and the
 * one the exit destroys.
 *
 * `prepare` is inert by construction, because the source's lease mounts nothing until
 * `enable`; a vendor build without that lifecycle is refused here rather than opened
 * beside the controller, where an exit would have no session to quiesce and no teardown
 * to run. `order` is the source's: the CMS edits the page's own attributes and content,
 * so it enters after the modules that prepare that page for editing, and it leaves
 * first, while its session can still refuse an exit over an upload or a preview.
 */
export function cmsParticipant(options = {}) {
  return {
    id: "clay:cms",
    order: 1000,
    async prepare(context = {}) {
      if (typeof hypercms.prepareModeLease !== "function") {
        throw fault("this vendor build has no quiescable session", "unsupported-plugin");
      }
      if (isStale(context)) throw fault("prepared for a stale generation", "stale-document");
      if (context.initial === true) return adopt();
      return cmsLease(hypercms.prepareModeLease(options));
    },
  };
}

export { cmsParticipant as modeParticipant };
