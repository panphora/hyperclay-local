import nearest from "./nearest.js";
import pipe from "./pipe.js";
import { createContentView, cleanContentClone } from '../lib/content-dom.js';

function init () {

  window.clay = window.clay || {};
  window.clay.dom = Object.assign(window.clay.dom || {}, { createContentView, cleanContentClone });

  // Bail if already initialized
  if (HTMLElement.prototype.hasOwnProperty('nearest')) {
    return;
  }

  // elem.el.menu returns nearest element with a "menu" attribute (alias for elem.nearest.menu)
  // elem.nearest.project returns nearest element with a "project" attribute
  Object.defineProperty(HTMLElement.prototype, 'el', {
    configurable: true,
    get: function() {
      let element = this;

      const handler = {
        get(target, prop) {
          return nearest(element, `[${prop}], .${prop}`);
        }
      };

      return new Proxy({}, handler);
    }
  });

  Object.defineProperty(HTMLElement.prototype, 'nearest', {
    configurable: true,
    get: function() {
      let element = this;

      const handler = {
        get(target, prop) {
          return nearest(element, `[${prop}], .${prop}`);
        }
      };

      return new Proxy({}, handler);
    }
  });

  // elem.val.project returns the value of the nearest element with "project" attribute
  // elem.val.project = "hello world" sets the value of the nearest element with "project" attribute
  // For form elements (input/select/textarea), uses the value property; otherwise uses the attribute
  Object.defineProperty(HTMLElement.prototype, 'val', {
    configurable: true,
    get: function() {
      let element = this;

      const isFormElement = (elem) =>
        elem.tagName === 'INPUT' || elem.tagName === 'SELECT' || elem.tagName === 'TEXTAREA';

      const handler = {
        get(target, prop) {
          return nearest(element, `[${prop}], .${prop}`, elem => {
            if (isFormElement(elem)) {
              return elem.value;
            }
            return elem.getAttribute(prop);
          });
        },
        set(target, prop, value) {
          const foundElem = nearest(element, `[${prop}], .${prop}`);

          if (foundElem) {
            if (isFormElement(foundElem)) {
              foundElem.value = value;
            } else {
              foundElem.setAttribute(prop, value);
            }
          }

          return true;
        }
      };

      return new Proxy({}, handler);
    }
  });

  // elem.text.project returns the innerText of the nearest element with the "project" attribute
  // elem.text.project = "hello world" sets the innerText of the nearest element with the "project" attribute
  Object.defineProperty(HTMLElement.prototype, 'text', {
    configurable: true,
    get: function() {
      let element = this;

      const handler = {
        get(target, prop) {
          return nearest(element, `[${prop}], .${prop}`, elem => elem.innerText);
        },
        set(target, prop, value) {
          const foundElem = nearest(element, `[${prop}], .${prop}`);

          if (foundElem) {
            foundElem.innerText = value;
          }

          return true;
        }
      };

      return new Proxy({}, handler);
    }
  });

  // elem.exec.sync_out() executes the code in the nearest "sync_out" attribute, using elem as the `this`
  Object.defineProperty(HTMLElement.prototype, 'exec', {
    configurable: true,
    get: function() {
      let element = this;

      const handler = {
        get(target, prop) {
          return function() {
            const foundElem = nearest(element, `[${prop}], .${prop}`);
            if (foundElem) {
              const code = foundElem.getAttribute(prop);
              if (code) {
                return new Function(code).call(foundElem);
              }
            }
          };
        }
      };

      return new Proxy({}, handler);
    }
  });

  /**
   * CYCLE METHODS
   *
   * Element.prototype.cycle - Cycles through elements with a specific attribute and replaces the current element with the next one
   * Usage: element.cycle(1, 'project') - Replaces element with the next element that has 'project' attribute
   *
   * Element.prototype.cycleAttr - Cycles through possible values of a specific attribute on matching elements
   * Usage:
   *   element.cycleAttr(1, 'project_type') - Sets project_type to the next value found on elements with project_type
   *   element.cycleAttr(1, 'project_type', 'option:project_type') - Sets project_type based on values from option:project_type
   *
   * Notes:
   * - Both methods support forward/backward cycling with positive/negative order parameter
   * - For attributes containing special characters like colons (e.g., 'option:project_type'),
   *   the colon is automatically escaped for the CSS selector
   * - cycle() replaces the entire element with the next one
   * - cycleAttr() only changes the attribute value on the current element
   */
  Element.prototype.cycle = function(order = 1, attr) {
    const escapedAttr = attr.replace(/:/g, '\\:');
    const next = pipe(
      // Get all elements
      () => document.querySelectorAll(`[${escapedAttr}]`),

      // Convert to array of {element, value} objects
      els => Array.from(els).map(el => ({
        element: el,
        value: el.textContent.trim()
      })),

      // Get unique by value
      els => [...new Map(els.map(el => [el.value, el])).values()],

      // Sort by value
      els => els.sort((a, b) => a.value.localeCompare(b.value)),

      // Find next element object
      els => els[(els.findIndex(el => el.value === this.textContent.trim()) + order + els.length) % els.length],

      // Return just the element
      obj => obj.element
    )();

    if (next) this.replaceWith(next.cloneNode(true));
  };

  Element.prototype.cycleAttr = function(order = 1, setAttr, lookupAttr) {
    // If lookupAttr is not provided, use setAttr for both
    lookupAttr = lookupAttr || setAttr;

    const escapedLookupAttr = lookupAttr.replace(/:/g, '\\:');
    const next = pipe(
      // Get all elements that match the lookup attribute
      () => document.querySelectorAll(`[${escapedLookupAttr}]`),

      // Get unique attribute values
      els => [...new Set(Array.from(els).map(el =>
        el.getAttribute(lookupAttr)
      ))],

      // Sort them
      vals => vals.sort(),

      // Get next value based on current setAttr value
      vals => vals[(vals.indexOf(this.getAttribute(setAttr)) + order + vals.length) % vals.length]
    )();

    if (next) this.setAttribute(setAttr, next);
  };

  Element.prototype.show = function() {
    this.style.display = '';
    return this;
  };

  Element.prototype.hide = function() {
    this.style.display = 'none';
    return this;
  };

}

// Auto-init when module is imported
init();

export { init, createContentView, cleanContentClone };
export default init;
