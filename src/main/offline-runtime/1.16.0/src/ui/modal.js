import { bevelButton, setShown } from "./bevel-controls.js";
import { set } from "../lib/hostile-css.js";
import { bevelDialog, dismissOf } from "./bevel-dialog.js";
import { resolveTheme } from "./theme.js";

// The theme one open() draws with. Internal: only dialogs.js sets it, so no page can
// leave a value behind that makes the next open() throw.
export const SURFACE_THEME = Symbol("clay.surfaceTheme");

/*

  theModal

  // a pretty alternative to window.prompt

  - set the content of the modal
  - open it
  - user confirms
  - everything about the modal resets

  themodal.html = content;   // html, yes and no each take markup, or a node placed as it is
  themodal.yes = content;
  themodal.no = content;

  themodal.closeHtml = "x";  // any non-empty value shows the corner close
  themodal.title = content;  // markup or a node: a header with the title (optional)
  themodal.width = "440px";  // the panel's width (default 600px)

  themodal.disableFocus = true;
  themodal.disableScroll = true;

  themodal.onYes(content);
  themodal.onNo(content);

  themodal.open();
  themodal.close();

*/

// MicroModal
// MIT License (c) 2017 Indrashish Ghosh
// MODIFIED: removed `this.activeElement.focus()` after modal is closed
// MODIFIED: takes the modal element itself, not an id, and adds no open class; the
// shell is created on open and removed on close, so nothing has to be looked up

const MicroModal = (() => {
  'use strict'

  const FOCUSABLE_ELEMENTS = [
    'a[href]',
    'area[href]',
    'input:not([disabled]):not([type="hidden"]):not([aria-hidden])',
    'select:not([disabled]):not([aria-hidden])',
    'textarea:not([disabled]):not([aria-hidden])',
    'button:not([disabled]):not([aria-hidden])',
    'iframe',
    'object',
    'embed',
    '[contenteditable]',
    '[tabindex]:not([tabindex^="-"])'
  ]

  class Modal {
    constructor ({
      targetModal,
      triggers = [],
      onShow = () => { },
      onClose = () => { },
      openTrigger = 'data-micromodal-trigger',
      closeTrigger = 'data-micromodal-close',
      openClass = 'is-open',
      disableScroll = false,
      disableFocus = false,
      awaitCloseAnimation = false,
      awaitOpenAnimation = false,
      debugMode = false
    }) {
      this.modal = typeof targetModal === 'string' ? document.getElementById(targetModal) : targetModal

      this.config = { debugMode, disableScroll, openTrigger, closeTrigger, openClass, onShow, onClose, awaitCloseAnimation, awaitOpenAnimation, disableFocus }

      if (triggers.length > 0) this.registerTriggers(...triggers)

      this.onClick = this.onClick.bind(this)
      this.onKeydown = this.onKeydown.bind(this)
    }

    registerTriggers (...triggers) {
      triggers.filter(Boolean).forEach(trigger => {
        trigger.addEventListener('click', event => this.showModal(event))
      })
    }

    showModal (event = null) {
      this.activeElement = document.activeElement
      this.modal.setAttribute('aria-hidden', 'false')
      this.scrollBehaviour('disable')
      this.addEventListeners()

      if (this.config.awaitOpenAnimation) {
        const handler = () => {
          this.modal.removeEventListener('animationend', handler, false)
          this.setFocusToFirstNode()
        }
        this.modal.addEventListener('animationend', handler, false)
      } else {
        this.setFocusToFirstNode()
      }

      this.config.onShow(this.modal, this.activeElement, event)
    }

    // Runs on the stored element even after a live-sync morph removed it from the
    // DOM, so onClose, the keydown listener and the scroll restore are never stranded.
    closeModal (event = null) {
      this.modal.setAttribute('aria-hidden', 'true')
      this.removeEventListeners()
      this.scrollBehaviour('enable')
      this.config.onClose(this.modal, this.activeElement, event)
    }

    scrollBehaviour (toggle) {
      if (!this.config.disableScroll) return
      const body = document.querySelector('body')
      switch (toggle) {
        case 'enable':
          Object.assign(body.style, { overflow: '' })
          break
        case 'disable':
          Object.assign(body.style, { overflow: 'hidden' })
          break
        default:
      }
    }

    addEventListeners () {
      this.modal.addEventListener('touchstart', this.onClick)
      this.modal.addEventListener('click', this.onClick)
      document.addEventListener('keydown', this.onKeydown)
    }

    removeEventListeners () {
      if (this.modal) {
        this.modal.removeEventListener('touchstart', this.onClick)
        this.modal.removeEventListener('click', this.onClick)
      }
      document.removeEventListener('keydown', this.onKeydown)
    }

    onClick (event) {
      if (
        event.target.hasAttribute(this.config.closeTrigger) ||
        event.target.parentNode.hasAttribute(this.config.closeTrigger)
      ) {
        event.preventDefault()
        event.stopPropagation()
        this.closeModal(event)
      }
    }

    onKeydown (event) {
      if (event.keyCode === 27) this.closeModal(event) // esc
      if (event.keyCode === 9) this.retainFocus(event) // tab
    }

    getFocusableNodes () {
      const nodes = this.modal.querySelectorAll(FOCUSABLE_ELEMENTS)
      return Array(...nodes)
    }

    setFocusToFirstNode () {
      if (this.config.disableFocus) return

      const focusableNodes = this.getFocusableNodes()

      if (focusableNodes.length === 0) return

      const nodesWhichAreNotCloseTargets = focusableNodes.filter(node => {
        return !node.hasAttribute(this.config.closeTrigger)
      })

      if (nodesWhichAreNotCloseTargets.length > 0) nodesWhichAreNotCloseTargets[0].focus()
      if (nodesWhichAreNotCloseTargets.length === 0) focusableNodes[0].focus()
    }

    retainFocus (event) {
      let focusableNodes = this.getFocusableNodes()

      if (focusableNodes.length === 0) return

      focusableNodes = focusableNodes.filter(node => {
        return (node.offsetParent !== null)
      })

      if (!this.modal.contains(document.activeElement)) {
        focusableNodes[0].focus()
      } else {
        const focusedItemIndex = focusableNodes.indexOf(document.activeElement)

        if (event.shiftKey && focusedItemIndex === 0) {
          focusableNodes[focusableNodes.length - 1].focus()
          event.preventDefault()
        }

        if (!event.shiftKey && focusableNodes.length > 0 && focusedItemIndex === focusableNodes.length - 1) {
          focusableNodes[0].focus()
          event.preventDefault()
        }
      }
    }
  }


  // Keep a reference to the opened modal
  let activeModal = null

  const generateTriggerMap = (triggers, triggerAttr) => {
    const triggerMap = []

    triggers.forEach(trigger => {
      const targetModal = trigger.attributes[triggerAttr].value
      if (triggerMap[targetModal] === undefined) triggerMap[targetModal] = []
      triggerMap[targetModal].push(trigger)
    })

    return triggerMap
  }

  const validateModalPresence = id => {
    if (!document.getElementById(id)) {
      console.warn(`MicroModal: \u2757Seems like you have missed %c'${ id }'`, 'background-color: #f8f9fa;color: #50596c;font-weight: bold;', 'ID somewhere in your code. Refer example below to resolve it.')
      console.warn('%cExample:', 'background-color: #f8f9fa;color: #50596c;font-weight: bold;', `<div class="modal" id="${ id }"></div>`)
      return false
    }
  }

  const validateTriggerPresence = triggers => {
    if (triggers.length <= 0) {
      console.warn('MicroModal: \u2757Please specify at least one %c\'micromodal-trigger\'', 'background-color: #f8f9fa;color: #50596c;font-weight: bold;', 'data attribute.')
      console.warn('%cExample:', 'background-color: #f8f9fa;color: #50596c;font-weight: bold;', '<a href="#" data-micromodal-trigger="my-modal"></a>')
      return false
    }
  }

  const validateArgs = (triggers, triggerMap) => {
    validateTriggerPresence(triggers)
    if (!triggerMap) return true
    for (const id in triggerMap) validateModalPresence(id)
    return true
  }

  const init = config => {
    const options = Object.assign({}, { openTrigger: 'data-micromodal-trigger' }, config)

    const triggers = [...document.querySelectorAll(`[${ options.openTrigger }]`)]

    const triggerMap = generateTriggerMap(triggers, options.openTrigger)

    if (options.debugMode === true && validateArgs(triggers, triggerMap) === false) return

    for (const key in triggerMap) {
      const value = triggerMap[key]
      options.targetModal = key
      options.triggers = [...value]
      activeModal = new Modal(options) // eslint-disable-line no-new
    }
  }

  const show = (targetModal, config) => {
    const options = config || {}
    options.targetModal = targetModal

    if (options.debugMode === true && validateModalPresence(targetModal) === false) return

    if (activeModal) activeModal.removeEventListeners()

    activeModal = new Modal(options) // eslint-disable-line no-new
    activeModal.showModal()
  }

  const close = () => {
    if (!activeModal) return
    activeModal.closeModal()
    activeModal = null
  }

  return { init, show, close }
})()



// themodal.js 
// MIT License (c) 2023 David Miranda
//
// Drawn in Bevel (bevel-dialog.js): inline !important, no classes, no ids, so a
// page stylesheet cannot repaint it. What callers put in html, yes and no is theirs
// and goes in untouched.

const themodal = (() => {
  let html = "";
  let yes = "";
  let no = "";
  let zIndex = "100";
  let closeHtml = "";
  let title = "";
  let width = "";
  let theme;

  let enableClickOutsideCloses = true;
  let disableScroll = true;
  let disableFocus = false;

  let onYes = [];
  let onNo = [];
  let onOpen = [];

  const themodalMain = {
    isShowing: false,
    open() {
      // This modal's callbacks were registered (onYes pushed / onNo assigned)
      // immediately before open(). Capture them for THIS open() call, then clear
      // the shared arrays so the next modal starts clean. Every handler below
      // fires ONLY these captured callbacks, so stacked modals can never drain
      // each other's promises.
      const myOnYes = onYes;
      const myOnNo = onNo;
      const myOnOpen = onOpen;
      onYes = [];
      onNo = [];
      onOpen = [];

      // The prompt promise must settle exactly once: resolve on yes, reject on
      // any dismissal (no / close / backdrop / Esc / superseded). dismiss() runs
      // the no-callbacks at most once; the yes path sets `settled` to block it.
      let settled = false;
      const dismiss = () => {
        if (settled) return;
        settled = true;
        myOnNo.forEach(cb => cb());
      };

      // Singleton: only one modal on screen at a time. If one is still up (or
      // left stale state behind, e.g. a live-sync morph removed its DOM), reject
      // its promise and tear it down before opening the new one.
      if (this.isShowing || document.querySelector('[data-clay-modal]')) {
        this._dismiss?.();
        this._cleanupListeners?.();
        document.querySelectorAll('[data-clay-modal]').forEach(n => { dismissOf.get(n)?.(); n.remove(); });
        this.isShowing = false;
        document.body.style.overflow = '';
      }

      // Expose this modal's dismiss so a later open()/close can settle it.
      this._dismiss = dismiss;

      const surfaceTheme = theme === undefined ? resolveTheme() : theme;
      const shell = bevelDialog({ zIndex, closable: !!closeHtml, titled: !!title, ...(width ? { width } : {}), theme: surfaceTheme });
      const modalRootElem = shell.root;
      const modalOverlayElem = shell.overlay;
      const modalContainerElem = shell.panel;
      const modalContentElem = shell.body;
      const modalButtonsElem = shell.footer;
      const modalCloseElem = shell.close;
      const buttonParts = { theme: surfaceTheme, parts: ['dialog.button'], labelParts: ['dialog.buttonLabel'] };
      const modalNoElem = bevelButton('', buttonParts);
      const modalYesElem = bevelButton('', { variant: 'primary', ...buttonParts });
      modalYesElem.type = 'submit';
      modalButtonsElem.append(modalNoElem, modalYesElem);

      // Markup is parsed in; a node is placed as it is, listeners and all.
      const place = (target, value) => {
        if (value instanceof Node) target.append(value);
        else target.innerHTML = value;
      };
      place(modalContentElem, html);
      place(modalYesElem.firstChild, yes);
      place(modalNoElem.firstChild, no);
      if (title) place(shell.heading, title);
      if (title) modalContainerElem.setAttribute("aria-label", shell.heading.textContent.trim());
      // No body content (a confirm that is all title) means no empty band between header and footer.
      setShown(modalContentElem, !(html === "" || html == null), "block");
      if ((html === "" || html == null) && title) set(modalButtonsElem, "border-top", "0");

      document.body.prepend(modalRootElem);

      // MODIFIED so modal doesn't close if mousedown happened inside the modal
      let mousedownOnBackdrop = false;

      // MODIFIED so modal doesn't close if mousedown happened inside the modal
      function handleMousedown(event) {
        // Check if mousedown started on backdrop (overlay but not container)
        mousedownOnBackdrop = modalOverlayElem.contains(event.target) &&
                              !modalContainerElem.contains(event.target);
      }

      function handleClick(event) {
        // Just close on no / close-button / backdrop; onClose runs dismiss().
        if (modalNoElem.contains(event.target) || modalCloseElem?.contains(event.target)) {
          MicroModal.close();
        // MODIFIED so modal doesn't close if mousedown happened inside the modal
        } else if (enableClickOutsideCloses && mousedownOnBackdrop && !modalContainerElem.contains(event.target) && modalOverlayElem.contains(event.target)) {
          MicroModal.close();
        }

        // Reset after handling
        mousedownOnBackdrop = false;
      }

      function handleSubmit(event) {
        if (modalRootElem.contains(event.target)) {
          event.preventDefault();
          
          // Execute callbacks and check if any return false or throw errors
          let shouldClose = true;

          for (const cb of myOnYes) {
            try {
              const result = cb();
              // If callback explicitly returns false, don't close
              if (result === false) {
                shouldClose = false;
                break;
              }
            } catch (error) {
              // If callback throws an error, don't close
              shouldClose = false;
              // Could optionally bubble the error up or handle it here
              break;
            }
          }

          // Only close if all callbacks succeeded. The yes callbacks already
          // scheduled their resolve, so mark settled to stop onClose rejecting.
          if (shouldClose) {
            settled = true;
            MicroModal.close();
          }
        }
      }

      // MODIFIED so modal doesn't close if mousedown happened inside the modal
      document.addEventListener("mousedown", handleMousedown);
      document.addEventListener("click", handleClick);
      document.addEventListener("submit", handleSubmit);

      // Store cleanup so stale listeners can be removed if DOM is yanked externally
      this._cleanupListeners = () => {
        document.removeEventListener("mousedown", handleMousedown);
        document.removeEventListener("click", handleClick);
        document.removeEventListener("submit", handleSubmit);
      };

      function setButtonsVisibility () {
        setShown(modalButtonsElem, !!(yes || no), "flex");
        setShown(modalYesElem, !!yes, "inline-flex");
        setShown(modalNoElem, !!no, "inline-flex");
      }

      setButtonsVisibility();

      MicroModal.show(modalRootElem, {
        disableScroll,
        disableFocus: true, // we use our own
        // reset everything on close
        onClose: modal => {
          // Settle the promise as rejected if it closed without a yes
          // (no / close / backdrop / Esc). No-op once already resolved.
          dismiss();

          modalRootElem.remove();

          html = "";
          yes = "";
          no = "";
          zIndex = "100";
          closeHtml = "";
          title = "";
          width = "";
          theme = undefined;

          // reset to defaults
          enableClickOutsideCloses = true;
          disableScroll = true;
          disableFocus = false;

          // onYes/onNo/onOpen are owned by open() now (captured into this call's
          // locals and cleared there), so they are deliberately not reset here:
          // a late onClose must not wipe a newer modal's freshly-registered cbs.

          this.isShowing = false;

          // MODIFIED so modal doesn't close if mousedown happened inside the modal
          document.removeEventListener("mousedown", handleMousedown);
          document.removeEventListener("click", handleClick);
          document.removeEventListener("submit", handleSubmit);
          this._cleanupListeners = null;
          this._dismiss = null;
        }
      });

      this.isShowing = true;

      myOnOpen.forEach(cb => cb());

      if (!disableFocus) {
        let firstInput = modalContentElem.querySelector(":is(input,textarea,button):not([hidden])") ||
          [modalYesElem, modalNoElem].find(button => !button.hidden);
        firstInput?.focus();
        firstInput?.setSelectionRange?.(-1, -1);
      }
    },
    close() {
      // onClose runs the dismiss/reject path; just trigger the close.
      MicroModal.close();
    },
    get html() {
      return html;
    },
    set html(newVal) {
      html = newVal;
    },
    get closeHtml() {
      return closeHtml;
    },
    set closeHtml(newVal) {
      closeHtml = newVal;
    },
    get title() {
      return title;
    },
    set title(newVal) {
      title = newVal;
    },
    get width() {
      return width;
    },
    set width(newVal) {
      width = newVal;
    },
    get [SURFACE_THEME]() {
      return theme;
    },
    set [SURFACE_THEME](newVal) {
      theme = newVal;
    },
    get yes() {
      return yes;
    },
    set yes(newVal) {
      yes = newVal;
    },
    get no() {
      return no;
    },
    set no(newVal) {
      no = newVal;
    },
    get zIndex() {
      return zIndex;
    },
    set zIndex(newVal) {
      zIndex = newVal;
    },
    get disableFocus() {
      return disableFocus;
    },
    set disableFocus(newVal) {
      disableFocus = newVal;
    },
    get disableScroll() {
      return disableScroll;
    },
    set disableScroll(newVal) {
      disableScroll = newVal;
    },

    // Two registration forms are in use across callers: themodal.onYes(cb)
    // (call → push, supports multiple) and themodal.onNo = cb (assign → replace).
    // Expose both via get (returns a push fn) + set (replaces with one cb), so
    // the assign form registers a callback instead of clobbering the method.
    get onYes() { return (cb) => { onYes.push(cb); }; },
    set onYes(cb) { onYes = [cb]; },
    get onNo() { return (cb) => { onNo.push(cb); }; },
    set onNo(cb) { onNo = [cb]; },
    get onOpen() { return (cb) => { onOpen.push(cb); }; },
    set onOpen(cb) { onOpen = [cb]; },
  };

  return themodalMain;
})();

export default themodal;
