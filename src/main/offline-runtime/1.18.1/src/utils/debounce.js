// debounce.js
function debounce(callback, delay) {
  let timeoutId;
  let pending = [];

  return function (...args) {
    const ctx = this;
    clearTimeout(timeoutId);

    return new Promise((resolve, reject) => {
      pending.push({ resolve, reject });

      timeoutId = setTimeout(() => {
        const waiting = pending;
        pending = [];
        settle(callback, ctx, args, waiting);
      }, delay);
    });
  };
}

// Settle every caller piggybacking on this window, from both branches. The
// callback is invoked synchronously so timing is unchanged; only the failure
// path is new. Without it a throw escapes into the timer, where no caller is
// listening, and everyone waiting on that window waits forever.
function settle(callback, ctx, args, waiting) {
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

export default debounce;
