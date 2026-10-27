// Admin system - combines all admin features (edit-only).
import { init as initContenteditable, enableContentEditable, disableContentEditable, SELECTOR as CONTENTEDITABLE } from './admin-contenteditable.js';
import { init as initInputs, enableAdminInputs, disableAdminInputs, SELECTOR_DISABLED, SELECTOR_READONLY } from './admin-inputs.js';
import { init as initOnClick, enableOnClick, disableOnClick, SELECTOR as ONCLICK } from './admin-onclick.js';
import { init as initResources, enableAdminResources, disableAdminResources, SELECTOR as RESOURCES } from './admin-resources.js';
import Mutation from '../lib/mutation.js';
import { isEditMode } from './is-edit-mode.js';

// Every control this family activates, in one selector: what a node added mid-session is
// matched against, and what the lease enables.
const SELECTOR = [CONTENTEDITABLE, SELECTOR_DISABLED, SELECTOR_READONLY, ONCLICK, RESOURCES].join(', ');

const ENABLE = [enableContentEditable, enableAdminInputs, enableOnClick, enableAdminResources];

let installation = null;
// The one add-element subscription this page runs, and whether it admits new controls.
// A live entry installs it at its enable and removes it at its dispose; a tab that booted
// in edit has no lease to do either, so its installation starts it and the adopted
// session's dispose is what takes it away.
let watching = null;
let admission = false;

const activate = (node) => {
  const scope = node.parentNode || node;
  for (const enable of ENABLE) enable(scope);
};

// One shared function, one install, however many times a session asks for it: a control
// that arrives after the sweep — add-from's clone, a node a live frame morphed in — is
// activated as it lands, and nothing after the subscription is removed.
function watch() {
  admission = true;
  if (watching) return;
  watching = Mutation.onAddElement({
    selectorFilter: SELECTOR,
    require: 'observed',
    pausable: false,
    debounce: 0,
  }, (changes) => {
    if (!admission) return;
    changes.forEach(({ element }) => activate(element));
  });
}

function unwatch() {
  admission = false;
  if (!watching) return;
  watching();
  watching = null;
}

// Loader-managed initialization. The loader calls this after it imports the module, in
// its own wave order; the import calls it too, so a page reaches the same installation by
// either road. Calling it again is asking for the transforms the page already has, not
// for a second set: the save-time restore of each authored form is installed once, which
// is what makes a repeated entry cost nothing.
export function install() {
  if (installation) return installation;
  initContenteditable();
  initInputs();
  initOnClick();
  initResources();
  installation = { selector: SELECTOR };
  // A tab that boots in edit: the boot's own page-load helpers turned the served controls
  // on and there is no lease yet to watch for the ones that arrive afterwards.
  if (isEditMode) watch();
  return installation;
}

install();

// One edit session over the live DOM. `enable` turns the served inert controls into
// working ones and starts watching for controls that arrive afterwards — a clone from
// add-from, a node a live frame morphed in; `quiesce` leaves them exactly as they are and
// stops admitting new ones; `resume` is the refused exit; `dispose` hands every control
// back the form the file served and removes this session's subscription, and nothing else.
export function controlsLease(root = document) {
  return {
    enable() {
      for (const enable of ENABLE) enable(root);
      watch();
    },
    quiesce() {
      admission = false;
    },
    resume() {
      admission = true;
    },
    dispose() {
      unwatch();
      disableContentEditable();
      disableAdminInputs();
      disableOnClick();
      disableAdminResources();
    }
  };
}

/**
 * The controls as a mode participant.
 *
 * The installation above is page-lifetime and turns no control on: it puts the
 * save-time restore in front of each authored form, and in a tab that booted in edit it
 * starts the one watcher. A session is the lease below.
 *
 * `initial: true` adopts the edit this tab booted into, where the boot's own
 * `enable...OnPageLoad` helpers already turned the served controls on: its enable asks
 * for the same one watcher the installation already started, and its dispose is what
 * hands the controls back.
 */
export function modeParticipant() {
  return {
    id: 'clay:controls',
    order: 110,
    prepare(context = {}) {
      const lease = controlsLease();
      if (context.initial !== true) return lease;
      return {
        enable: () => watch(),
        quiesce: () => lease.quiesce(),
        resume: () => lease.resume(),
        dispose: () => lease.dispose(),
      };
    },
  };
}

export { install as init };
export default install;
