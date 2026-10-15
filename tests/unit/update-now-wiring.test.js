// The --hyperclay-update-now request may only come from a second launch by the same user.
// main.js cannot be loaded outside Electron, so these read its source: the flag is parsed
// in the second-instance handler and nowhere else, and its only answer is update-request.json.
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8').replace(/\r\n/g, '\n');
const main = read('src/main/main.js');

function handler(event) {
  const start = main.indexOf(`app.on('${event}', (event, `);
  if (start === -1) throw new Error(`src/main/main.js has no ${event} handler`);
  return main.slice(start, main.indexOf('\n});\n', start));
}

describe('update-now wiring in main.js', () => {
  test('the flag is parsed from the second instance argv, inside its handler, exactly once', () => {
    const calls = [...main.matchAll(/parseUpdateNowArg\(([^)]*)\)/g)];
    expect(calls.map((call) => call[1])).toEqual(['argv']);
    expect(handler('second-instance')).toContain('parseUpdateNowArg(argv)');
    expect(handler('second-instance')).toContain('updater.updateNow(updateNowVersion)');
  });

  test('nothing else reaches updateNow: not the cold start argv, open-file, or any IPC handler', () => {
    expect([...main.matchAll(/\.updateNow\(/g)]).toHaveLength(1);
    expect(handler('open-file')).not.toMatch(/updateNow|parseUpdateNowArg/);
    for (const line of main.split('\n').filter((l) => /ipcMain\.(handle|on)\(/.test(l))) {
      expect(line).not.toMatch(/updateNow/);
    }
    expect(read('src/main/popover-preload.js')).not.toMatch(/update-now|updateNow/i);
  });

  test('the updater reports requests into update-request.json in userData', () => {
    expect(main).toContain("writeJsonAtomic(path.join(userData, 'update-request.json'), { ...record, pid: process.pid, at: new Date().toISOString() })");
    expect(main).toContain('onRequest: writeUpdateRequest');
  });

  test('the Windows gate ignores an all-users entry only when its folder is really gone', () => {
    expect(main).toContain('exists: (target) => fs.existsSync(target),');
  });

  test('the mac bundle advertises the trigger in Info.plist', () => {
    expect(JSON.parse(read('package.json')).build.mac.extendInfo).toEqual({ HCLUpdateNowArg: 1 });
  });
});
