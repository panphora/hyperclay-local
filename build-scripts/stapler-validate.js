const { execSync } = require('child_process');

// stapler validate asks Apple's CloudKit about the ticket, so a dropped connection
// there fails it after the slow notarization has already succeeded.
function validateStaple(target, {
  attempts = 4,
  run = command => execSync(command, { stdio: 'inherit' }),
  sleep = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms),
} = {}) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      run(`xcrun stapler validate "${target}"`);
      return;
    } catch (error) {
      if (attempt === attempts) throw error;
      sleep(15000);
    }
  }
}

module.exports = { validateStaple };
