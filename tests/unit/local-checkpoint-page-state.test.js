const { execFileSync } = require('child_process');
const path = require('path');

test('a checkpoint of a page whose merge state is beside the file keeps its room', () => {
  const output = execFileSync(process.execPath, [path.join(__dirname, '../helpers/checkpoint-page-state-probe.cjs')], {
    cwd: process.cwd(), encoding: 'utf8', timeout: 30000,
  });
  expect(output).toContain('checkpoint1 ok');
  expect(output).toMatch(/checkpoint2 \{"kind":"ok"/);
  expect(output).toContain('same room? true');
  expect(output).toContain('recovered dir? false');
  expect(output).toContain('file has page tag? false');
});
