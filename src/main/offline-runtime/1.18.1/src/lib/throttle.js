function throttle(callback, delay, executeFirst = true) {
  let lastCall = executeFirst ? 0 : Date.now();
  let timeoutId = null;
  let pending = [];

  // See debounce.js: settle both branches, or a throwing callback strands every
  // caller sharing the window. throttle's caller is the save lane.
  function settle(ctx, args, waiting) {
    let result;
    try {
      result = callback.apply(ctx, args);
    } catch (error) {
      for (const p of waiting) p.reject(error);
      return;
    }
    Promise.resolve(result).then(
      value => { for (const p of waiting) p.resolve(value); },
      error => { for (const p of waiting) p.reject(error); },
    );
  }

  return function (...args) {
    const ctx = this;
    const now = Date.now();
    const remaining = delay - (now - lastCall);

    return new Promise((resolve, reject) => {
      if (remaining <= 0) {
        clearTimeout(timeoutId);
        timeoutId = null;
        lastCall = now;

        const waiting = pending.concat({ resolve, reject });
        pending = [];
        settle(ctx, args, waiting);
      } else {
        pending.push({ resolve, reject });

        if (!timeoutId) {
          timeoutId = setTimeout(() => {
            lastCall = Date.now();
            timeoutId = null;
            const waiting = pending;
            pending = [];
            settle(ctx, args, waiting);
          }, remaining);
        }
      }
    });
  };
}

export default throttle;
