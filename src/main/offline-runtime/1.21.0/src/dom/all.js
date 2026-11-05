// Helper to check if an array contains DOM nodes
const isElementArray = (arr) => {
  if (!Array.isArray(arr)) return false;
  // Empty arrays from element operations should stay wrapped for chainability
  if (arr.length === 0) return true;
  return arr.every(item => item instanceof Element || item instanceof Node || item instanceof Document);
};

const createMethodHandler = (elements, plugins, methods) => ({
  get(target, prop) {
    // Handle array-like numeric access and length
    if (prop === 'length') return elements.length;

    // Handle Symbol.iterator BEFORE number check
    if (prop === Symbol.iterator) {
      return elements[Symbol.iterator].bind(elements);
    }

    // Handle other Symbols (toStringTag, etc.) - return undefined to avoid Symbol-to-number conversion
    if (typeof prop === 'symbol') {
      return undefined;
    }

    // Handle numeric indices
    if (!isNaN(prop)) return elements[prop];

    // Handle array methods
    if (prop in Array.prototype) {
      const arrayMethod = Array.prototype[prop];
      return (...args) => {
        const result = arrayMethod.apply(elements, args);
        // For methods that return arrays, only wrap if they contain DOM nodes
        // Otherwise return plain array (jQuery-like behavior for primitives)
        if (Array.isArray(result)) {
          return isElementArray(result)
            ? createElementProxy(result, plugins, methods)
            : result;  // Return plain array for primitives
        }
        // For single element returns (like find), return raw value
        if (result instanceof Element) {
          return result;
        }
        // For boolean/primitive returns (some, every, etc), return raw value
        return result;
      };
    }

    // Handle event listeners and support event delegation
    if (prop.startsWith('on')) {
      return (selectorOrHandlerOrObject, optionalHandler) => {
        const eventName = prop.slice(2);

        // Handle object of bindings
        if (selectorOrHandlerOrObject && typeof selectorOrHandlerOrObject === 'object') {
          Object.entries(selectorOrHandlerOrObject).forEach(([selector, handler]) => {
            elements.forEach(el => {
              el.addEventListener(eventName, (e) => {
                const closest = e.target.closest(selector);
                if (closest && el.contains(closest)) {
                  handler.call(closest, e);
                }
              });
            });
          });
          return createElementProxy(elements, plugins, methods);
        }

        // Handle single binding (existing delegation code)
        if (optionalHandler) {
          const selector = selectorOrHandlerOrObject;
          const handler = optionalHandler;

          elements.forEach(el => {
            el.addEventListener(eventName, (e) => {
              const closest = e.target.closest(selector);
              if (closest && el.contains(closest)) {
                handler.call(closest, e);
              }
            });
          });
        } else {
          const handler = selectorOrHandlerOrObject;
          elements.forEach(el => el.addEventListener(eventName, handler));
        }

        return createElementProxy(elements, plugins, methods);
      };
    }

    // Check plugins first
    if (plugins[prop]) {
      const plugin = plugins[prop];
      if (typeof plugin === 'function') {
        return createElementProxy(plugin(elements), plugins, methods);
      }
      if (typeof plugin === 'object') {
        if (plugin.value) {
          return createElementProxy(plugin.value(elements), plugins, methods);
        }
        if (plugin.properties) {
          return createNestedPluginProxy(elements, plugin.properties, plugins, methods);
        }
      }
      return plugin;
    }

    if (methods[prop]) {
      const method = methods[prop];
      return (...args) => {
        const result = method.apply(createElementProxy(elements, plugins, methods), args);
        // Only wrap arrays that contain DOM nodes, return plain arrays for primitives
        return (result instanceof Array && isElementArray(result))
          ? createElementProxy(result, plugins, methods)
          : result;
      };
    }

    // Check if we have any elements to work with
    // Example: All('.missing') returns [] so firstEl is null
    const firstEl = elements[0];
    if (!firstEl) {
      // No elements found - need to handle property access gracefully
      // so chains like All.missing.classList.add('hidden') don't break

      // These properties return objects with their own methods (classList.add, style.color, etc)
      // We know these are safe to proxy even when empty
      if (['style', 'classList', 'dataset'].includes(prop)) {
        return createIntermediateProxy([], prop, plugins, methods);
      }

      // For unknown properties, we need to check what they are on the DOM
      // BUT we can't do Element.prototype.classList - that throws "Illegal invocation"
      // Instead we use getOwnPropertyDescriptor which safely tells us ABOUT the property
      const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, prop) ||
                         Object.getOwnPropertyDescriptor(Node.prototype, prop);

      if (descriptor?.get) {
        // Properties like 'children', 'parentElement' have getters
        // Treat them like classList - return a proxy that won't break chains
        return createIntermediateProxy([], prop, plugins, methods);
      }

      if (typeof descriptor?.value === 'function') {
        // Regular methods like 'appendChild', 'remove'
        // Return a no-op function: All.missing.remove() does nothing, returns proxy
        return (...args) => createElementProxy([], plugins, methods);
      }

      // Property doesn't exist on DOM elements (like All.missing.foobar)
      return undefined;
    }

    const value = firstEl[prop];

    // The library is designed to handle chaining correctly
    // - When a method returns an Element (like cloneNode), it wraps it in a proxy
    // - When a method returns undefined (like removeAttribute), it chains on the original elements
    // - For other return values, like strings, it returns the results in an array
    if (typeof value === 'function') {
      return (...args) => {
        const results = elements.map(el => el[prop](...args));

        if (results[0] instanceof Element) {
          return createElementProxy(results.filter(Boolean), plugins, methods);
        }
        if (results[0] === undefined) {
          return createElementProxy(elements, plugins, methods);
        }
        return results;
      };
    }

    // Handle intermediate objects (style, classList, dataset)
    if (['style', 'classList', 'dataset'].includes(prop)) {
      return createIntermediateProxy(elements, prop, plugins, methods);
    }

    // Return array of values for leaf properties
    return elements.map(el => el[prop]);
  },

  set(target, prop, value) {
    if (typeof value === 'function') {
      elements.forEach(el => {
        el[prop] = value(el);
      });
    } else {
      elements.forEach(el => {
        el[prop] = value;
      });
    }
    return true;
  }
});

const createNestedPluginProxy = (elements, properties, plugins, methods) => {
  return new Proxy({}, {
    get(target, prop) {
      if (properties[prop]) {
        const plugin = properties[prop];
        if (typeof plugin === 'function') {
          return createElementProxy(plugin(elements), plugins, methods);
        }
        return plugin;
      }
      return undefined;
    }
  });
};

const createIntermediateProxy = (elements, propName, plugins, methods) => {
  return new Proxy({}, {
    get(target, prop) {
      // Handle function properties (like classList.add)
      const firstEl = elements[0];
      if (!firstEl) {
        // Return no-op function for any property access on empty collection
        // This ensures chaining continues to work even with no elements
        return (...args) => createElementProxy(elements, plugins, methods);
      }

      const value = firstEl[propName][prop];
      if (typeof value === 'function') {
        return (...args) => {
          elements.forEach(el => el[propName][prop](...args));
          return createElementProxy(elements, plugins, methods);
        };
      }

      // Return array of values for leaf properties
      return elements.map(el => el[propName][prop]);
    },

    set(target, prop, value) {
      if (typeof value === 'function') {
        elements.forEach(el => {
          el[propName][prop] = value(el);
        });
      } else {
        elements.forEach(el => {
          el[propName][prop] = value;
        });
      }
      return true;
    }
  });
};

const sharedState = {
  plugins: {},
  methods: {}
};

const createElementProxy = (elements, plugins = sharedState.plugins, methods = sharedState.methods) => {
  return new Proxy(elements, createMethodHandler(elements, plugins, methods));
};

const toElementArray = (input) => {
  if (input instanceof Element || input instanceof Document) {
    return [input];
  }
  if (Array.isArray(input)) {
    if (input.every(el => el instanceof Element || el instanceof Document)) {
      return input;
    }
    throw new TypeError('All array elements must be DOM Elements or Document');
  }
  if (typeof input === 'string') {
    return Array.from(document.querySelectorAll(input));
  }
  throw new TypeError('Input must be a selector string, Element, Document, or Array of Elements');
};

// Default plugins
const defaultPlugins = {
  methods: {
    eq(index) {
      if (typeof index !== 'number') {
        throw new TypeError('eq() requires a number as an argument');
      }

      // Handle negative indices (counting from the end)
      const normalizedIndex = index < 0 ? this.length + index : index;

      // Return array with single element at index, or empty array if index is invalid
      // ❗️ Allows chaining to continue
      return this[normalizedIndex] ? [this[normalizedIndex]] : [];
    },

    at(index) {
      if (typeof index !== 'number') {
        throw new TypeError('at() requires a number as an argument');
      }
      const normalizedIndex = index < 0 ? this.length + index : index;
      return this[normalizedIndex];
    },

    prop(properties) {
      if (typeof properties !== 'object' || properties === null) {
        throw new TypeError('prop() requires an object of properties');
      }

      Object.entries(properties).forEach(([key, value]) => {
        this.forEach(el => {
          el[key] = value;
        });
      });

      return this;
    },

    css(styles) {
      if (typeof styles !== 'object' || styles === null) {
        throw new TypeError('css() requires an object of styles');
      }

      Object.entries(styles).forEach(([property, value]) => {
        this.forEach(el => {
          el.style[property] = value;
        });
      });

      return this;
    },

    pluck(attr) {
      return this.map(el => el.getAttribute(attr));
    },

    unique() {
      return [...new Set(this)];
    },

    sortBy(fn) {
      if (typeof fn === 'string') {
        const attr = fn;
        fn = el => el.getAttribute(attr);
      }
      return [...this].sort((a, b) => {
        const aVal = fn(a);
        const bVal = fn(b);
        if (aVal < bVal) return -1;
        if (aVal > bVal) return 1;
        return 0;
      });
    }
  }
};

const All = new Proxy(function (selectorOrElements, contextSelector) {
  // If there's a context selector, search within that context
  if (arguments.length === 2) {
    // Support both string selectors and element references as context
    let contextElements;
    if (typeof contextSelector === 'string') {
      contextElements = Array.from(document.querySelectorAll(contextSelector));
    } else {
      // Convert element/array/document to element array
      contextElements = toElementArray(contextSelector);
    }

    // If first arg is a string selector, search within each context
    if (typeof selectorOrElements === 'string') {
      const elements = contextElements.flatMap(context => {
        // Include context itself if it matches the selector
        // Document has no matches(): it can never be its own match, only a root
        // to search under.
        const matches = context.matches?.(selectorOrElements) ? [context] : [];
        // Plus all descendants that match
        const descendants = Array.from(context.querySelectorAll(selectorOrElements));
        return [...matches, ...descendants];
      });
      return createElementProxy(elements);
    }

    // If first arg is elements, filter to those within context
    const searchElements = toElementArray(selectorOrElements);
    const elements = searchElements.filter(el =>
      contextElements.some(context => context.contains(el))
    );
    return createElementProxy(elements);
  }

  // Single argument - normalize and return
  const elements = toElementArray(selectorOrElements);
  return createElementProxy(elements);
}, {
  get(target, prop) {
    if (prop === 'use') {
      return function (plugin) {
        if (!plugin || typeof plugin !== 'object') {
          throw new TypeError('Plugin must be an object with "properties" or "methods"');
        }
        if (plugin.properties) {
          Object.assign(sharedState.plugins, plugin.properties);
        }
        if (plugin.methods) {
          Object.assign(sharedState.methods, plugin.methods);
        }
        return this;
      };
    }

    if (prop === Symbol.iterator) return undefined;
    if (prop in target) return target[prop];

    const elements = Array.from(document.querySelectorAll(`[${prop}], .${prop}`));
    return createElementProxy(elements);
  }
});

// Install default plugins
All.use(defaultPlugins);

export default All;
