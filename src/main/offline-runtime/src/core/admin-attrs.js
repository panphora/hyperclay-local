// Admin system - combines all admin features (edit-only).
import { init as initContenteditable } from './admin-contenteditable.js';
import { init as initInputs } from './admin-inputs.js';
import { init as initOnClick } from './admin-onclick.js';
import { init as initResources } from './admin-resources.js';

let initialized = false;

function init() {
  if (initialized) return;
  initialized = true;
  initContenteditable();
  initInputs();
  initOnClick();
  initResources();
}

// Auto-init when module is imported
init();

export { init };
export default init;
