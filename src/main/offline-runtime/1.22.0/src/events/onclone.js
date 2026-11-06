function init() {
  // Bail if already patched (idempotence)
  if (Node.prototype.__hyperclayOnclone) {
    return;
  }

  const originalCloneNode = Node.prototype.cloneNode;

  // Store original for idempotence check
  Node.prototype.__hyperclayOnclone = originalCloneNode;

  Node.prototype.cloneNode = function(deep) {
    const clonedNode = originalCloneNode.call(this, deep);

    if (clonedNode.nodeType === Node.ELEMENT_NODE) {
      if (!window.__preventOnclone) {
        processOnclone(clonedNode);
        clonedNode.querySelectorAll('[onclone]').forEach(processOnclone);
      }

      // Patch textareas: the persist module writes live values to data-value
      // on every keystroke (because writing textContent on a focused textarea
      // destroys cursor/scroll). Shift data-value into textContent on the
      // clone so consumers get the current value without special handling.
      if (deep) {
        const textareas = clonedNode.tagName === 'TEXTAREA'
          ? [clonedNode]
          : clonedNode.querySelectorAll('textarea[data-value]');
        textareas.forEach(ta => {
          const val = ta.getAttribute('data-value');
          if (val !== null) {
            ta.textContent = val;
            ta.removeAttribute('data-value');
          }
        });
      }
    }

    return clonedNode;
  };

  function processOnclone(element) {
    const oncloneCode = element.getAttribute('onclone');
    if (oncloneCode) {
      try {
        new Function(oncloneCode).call(element);
      } catch (error) {
        console.error('Error executing onclone:', error);
      }
    }
  }
}
export { init };
export default init;
