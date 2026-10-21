import toast, { toastPersistent, dismissPersistent } from "./toast.js";
import themodal from "./modal.js";
import { ask, consent, tell, snippet } from "./dialogs.js";
import { saveFeedback } from "../core/save-feedback.js";
import { initTheme } from "./theme.js";

// Attach the public surface explicitly (§2.3). We do NOT rely on toast.js /
// dialogs.js evaluation side effects — their window auto-exports are stripped.
initTheme();

const clay = (window.clay = window.clay || {});
clay.toast = toast;
clay.toastPersistent = toastPersistent;
clay.ask = ask;
clay.confirm = consent;   // hyperclayjs `consent` → clayjs `clay.confirm`
clay.tell = tell;
clay.snippet = snippet;
clay.modal = themodal;

// Toast globals are a carve-out because core's live-sync soft-reads exactly these
// names. Only set them when absent, honoring "already have a toast library? keep yours".
if (typeof window.toast === "undefined") window.toast = toast;
if (typeof window.toastPersistent === "undefined") window.toastPersistent = toastPersistent;

// Automatic save feedback. clay:save-saving stays deliberately silent (a toast for
// a sub-second transient is noise). With the indicator plugin loaded, saved belongs
// to its chip; a failed or offline save stays up as a toast until the next save
// lands. Keep your own toast lib? The events are public. clay.saveToast moves saved
// from the chip to a toast.
saveFeedback.toasts = true;
// clay.saveToast = true shows Saved as a toast (with the host's message) instead of on
// the chip. A page may set it before this loads (window.clay = { saveToast: true }).
saveFeedback.savedToast = !!clay.saveToast;
Object.defineProperty(clay, "saveToast", {
  get: () => saveFeedback.savedToast,
  set: (on) => { saveFeedback.savedToast = !!on; },
  enumerable: true,
  configurable: true,
});
document.addEventListener("clay:save-saved", (e) => {
  dismissPersistent("Couldn't save");
  dismissPersistent("Offline, not saved");
  if (e.detail?.msgType === "warning") toast(e.detail.msg || "Saved", "warning");
  else if (!saveFeedback.chip || saveFeedback.savedToast) toast(e.detail?.msg || "Saved", "success");
});
document.addEventListener("clay:save-error", () => toastPersistent("Couldn't save", "error"));
document.addEventListener("clay:save-offline", () => toastPersistent("Offline, not saved", "warning"));
document.addEventListener("clay:live-notice", (e) => {
  if (e.detail?.code === "save-uncertain") toastPersistent(e.detail.message, "warning");
});

export { toast, toastPersistent, ask, consent, tell, snippet, themodal };
