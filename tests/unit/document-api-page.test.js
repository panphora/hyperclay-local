const { execFileSync } = require('child_process');
const path = require('path');

test('the Local HTTP page API protects room edits and accepts a fresh conditional write', () => {
  const output = execFileSync(process.execPath, [path.join(__dirname, '../helpers/document-api-page-probe.cjs')], {
    cwd: process.cwd(), encoding: 'utf8', timeout: 30000,
  });
  expect(output).toContain('page API proof passed');
});

test('loading the Local server does not load page, checkpoint or jsdom modules', () => {
  const script = `
    require('./src/main/server');
    require('./src/main/local-checkpoint');
    const loaded = Object.keys(require.cache).filter(name =>
      /hyper-html-api\\/src\\/page\\.js|clayjs\\/dist\\/server\\/checkpoint|clayjs\\/src\\/page\\/ybind\\/external|node_modules\\/jsdom/.test(name));
    if (loaded.length) throw new Error(loaded.join('\\n'));
    console.log('lazy page modules passed');
  `;
  const output = execFileSync(process.execPath, ['-e', script], { cwd: process.cwd(), encoding: 'utf8' });
  expect(output).toContain('lazy page modules passed');
});
