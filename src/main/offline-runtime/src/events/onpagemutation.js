/*
   [onpagemutation] / [onglobalmutation] - Trigger code when ANY element on the page changes

   Usage:
   <span onglobalmutation="const n = String(All('li').length); if (this.textContent !== n) this.textContent = n">0</span>
   <span onpagemutation="const n = String(All('li').length); if (this.textContent !== n) this.textContent = n">0</span>

   Guard every write: writing into the page, even the same text, is a mutation and re-runs the handler.

   Both attributes are equivalent - onglobalmutation is the preferred name for clarity.
*/
import Mutation from "../lib/mutation.js";

function init() {
  const executeGlobalMutation = async element => {
    try {
      // Support both onglobalmutation and onpagemutation (legacy)
      const code = element.getAttribute('onglobalmutation') || element.getAttribute('onpagemutation');
      const asyncFn = new Function(`return (async function() { ${code} })`)();
      await asyncFn.call(element);
    } catch (error) {
      console.error('Error in onglobalmutation/onpagemutation execution:', error);
    }
  };

  // Pausable (the default): a live-sync morph must NOT trigger these hooks, or
  // their DOM writes would autosave → broadcast → morph the other tab → fire the
  // same hook → broadcast back, looping forever. Safe to skip morphs because the
  // other tab already ran the identical hook and the morph carries the result.
  Mutation.onAnyChange({
    debounce: 200,
    omitChangeDetails: true,
    require: 'observed'
  }, () => {
    document.querySelectorAll('[onglobalmutation], [onpagemutation]').forEach(executeGlobalMutation);
  });
}
export { init };
export default init;
