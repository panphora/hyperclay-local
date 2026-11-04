const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const runtime = require('./browser-runtime.cjs');
const pin = require('./browser-runtime.json');

function profileFor(executable) {
  if (!path.isAbsolute(executable) || /[\n\r\0"\\*?\[\]{}]/.test(executable)) {
    throw new Error('Browser path contains AppArmor pattern characters.');
  }
  const name = 'hyper-chrome-' + crypto.createHash('sha256').update(executable).digest('hex').slice(0, 16);
  return { name, text: `abi <abi/4.0>,\ninclude <tunables/global>\nprofile ${name} "${executable}" flags=(unconfined) {\n  userns,\n}\n` };
}

function configure() {
  if (process.platform !== 'linux') return;
  const restriction = '/proc/sys/kernel/apparmor_restrict_unprivileged_userns';
  if (!fs.existsSync(restriction) || fs.readFileSync(restriction, 'utf8').trim() !== '1') return;
  const key = runtime.platformKey();
  const cache = runtime.cacheRoot();
  const root = fs.existsSync(cache) ? fs.realpathSync(cache) : cache;
  const executable = path.join(root, pin.version, key, pin.platforms[key].executable);
  const profile = profileFor(executable);
  const destination = `/etc/apparmor.d/${profile.name}`;
  const run = (command, args, options = {}) => process.getuid() === 0
    ? execFileSync(command, args, options)
    : execFileSync('sudo', ['-n', command, ...args], options);
  run('tee', [destination], { input: profile.text, stdio: ['pipe', 'ignore', 'inherit'] });
  run('apparmor_parser', ['-r', destination], { stdio: 'inherit' });
  console.log(`Chrome sandbox profile: ${executable}`);
}

module.exports = { profileFor };
if (require.main === module) configure();
