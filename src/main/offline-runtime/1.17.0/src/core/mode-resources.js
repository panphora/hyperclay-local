// Which authored resource a live switch can start and take back, decided before
// preparation rather than discovered halfway through it. Which edit module is supported
// is a separate table (mode-support.js). This module is a dynamic target: a reader never
// fetches it.
//
// A style or a stylesheet link is one attribute, and the existing type flip restores it.
// A script that has run cannot be un-run, so a document whose served bytes carry an
// `editmode:resource` script has no reversible entry: its script would have to execute
// again, and re-executing it on every entry is exactly what the reload path exists to
// avoid. Such a document keeps the guarded reload.
import { enableAdminResources, disableAdminResources } from "./admin-resources.js";

export const RESOURCE_SELECTOR = '[editmode\\:resource]:is(style, link, script)';
export const SCRIPT_SELECTOR = 'script[editmode\\:resource]';

export function resourceSupport(root = document) {
  const scripts = [...root.querySelectorAll(SCRIPT_SELECTOR)];
  return { reversible: scripts.length === 0, scripts };
}

// The adapter's lease over the authored resources: a reversible flip for the styles and
// stylesheets. A document whose script could not be taken back never reaches it, because
// the caller refuses that document before preparation.
export function resourcesLease(root = document) {
  return {
    enable() {
      enableAdminResources(root);
    },
    quiesce() {},
    resume() {},
    dispose() {
      disableAdminResources();
    },
  };
}

export function resourcesParticipant(root = document) {
  return {
    id: "clay:resources",
    order: 100,
    prepare() {
      const { reversible } = resourceSupport(root);
      if (!reversible) {
        throw Object.assign(
          new Error("clay.modeLifecycle: an editmode:resource script cannot be re-run"),
          { code: "unsupported-plugin" }
        );
      }
      return resourcesLease(root);
    },
  };
}
