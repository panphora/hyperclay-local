const { execSync } = require('child_process');

// stapler asks Apple's CloudKit about the ticket, so a dropped connection there
// fails it after the slow notarization has already succeeded.
function retryStapler(action, target, {
  attempts = 4,
  run = command => execSync(command, { stdio: 'inherit' }),
  sleep = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms),
} = {}) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      run(`xcrun stapler ${action} "${target}"`);
      return;
    } catch (error) {
      if (attempt === attempts) throw error;
      sleep(15000);
    }
  }
}

const stapleTicket = (target, options) => retryStapler('staple', target, options);
const validateStaple = (target, options) => retryStapler('validate', target, options);

module.exports = { stapleTicket, validateStaple };
