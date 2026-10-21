/**
 * [onaftersave] Custom Attribute
 *
 * Runs inline JavaScript after a successful save.
 * Only fires on 'clay:save-saved' events (not on error/offline).
 *
 * Usage:
 *   <span clay="no-save" onaftersave="this.innerText = event.detail.msg"></span>
 *   <link href="styles.css" onaftersave="clay.cacheBust(this)">
 *
 * MARK WHAT YOU MUTATE `no-save` (or `freeze`).
 * These handlers run after the save baseline has been taken, so anything they
 * write to the live DOM reads as a change the person made, and the page stays
 * dirty: the close-tab warning never clears, and on an autosave page it loops.
 * `no-save` keeps the element out of the file entirely, which is what you want
 * for a status chip or any other runtime-only chrome. `freeze` is the choice
 * when the element must exist in the saved file, but as authored rather than as
 * the handler left it.
 *
 * CHANGED IN 0.7: `no-trigger-autosave` is no longer enough on its own.
 * It stops the handler's write from STARTING a save, and it still does that. It
 * no longer hides the write from an explicit save or from the close warning,
 * because those two now deliberately see batching regions — an edit you make
 * inside one is real work that nothing else is going to write. A handler whose
 * output is marked only `no-trigger-autosave` will leave the page reporting
 * unsaved changes after every save. Change those markers to `no-save`, or to
 * `freeze` if the element belongs in the file.
 *
 * `clay.cacheBust()` and `[refetch-on-save]` need no marker at all: they
 * remember the authored URL and restore it on every snapshot (authored-url.js).
 * A handler that mutates some OTHER element has to mark that element itself.
 *
 * (The alternative — re-reading the whole live DOM after handlers run — is what
 * clayjs used to do, and it silently discarded anything typed during a save.)
 *
 * The event.detail object contains:
 *   - status: 'saved'
 *   - msg: string (e.g., 'Saved')
 *   - timestamp: number (Date.now())
 */

function broadcast(e) {
  const status = e.type.replace('clay:save-', '');
  const detail = { ...e.detail, status };

  document.querySelectorAll('[onaftersave]').forEach(el => {
    try {
      const event = new CustomEvent('aftersave', { detail });
      const handler = new Function('event', el.getAttribute('onaftersave'));
      handler.call(el, event);
    } catch (err) {
      console.error('[onaftersave] Error in handler:', err);
    }
  });
}

function init() {
  document.addEventListener('clay:save-saved', broadcast);
}

init();

export default init;
