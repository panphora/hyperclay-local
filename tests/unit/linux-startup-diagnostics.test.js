const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const describeShell = process.platform === 'win32' ? describe.skip : describe;
const library = path.resolve(__dirname, '../linux/lib.sh');

describeShell('Linux startup failure diagnostics', () => {
  let fixtureDir;

  beforeEach(() => {
    fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'linux-startup-diagnostics-'));
    fs.mkdirSync(path.join(fixtureDir, 'lab'));
    fs.writeFileSync(path.join(fixtureDir, 'fixture.AppImage'), '#!/bin/bash\nexit 0\n');
  });

  afterEach(() => {
    fs.rmSync(fixtureDir, { recursive: true, force: true });
  });

  function failLaunch(setup, tools = '') {
    const script = path.join(fixtureDir, 'server-save.sh');
    fs.writeFileSync(script, `#!/bin/bash
mktemp() { printf '%s/lab\n' "$DIAGNOSTICS_FIXTURE"; }
id() { echo 1000; }
source "$DIAGNOSTICS_LIBRARY"
ss() { echo 'fixture sockets: none'; }
${tools}
stop() {
  [ -s "$OUT/$CHECK/startup-diagnostics.txt" ] || exit 92
  printf '%s\n' "$1" > "$DIAGNOSTICS_FIXTURE/stopped"
  printf 'cleanup replaced log\n' > "$LAB/app.log"
}
${setup}
fail "server did not come up"
`);
    return spawnSync('bash', [script], {
      encoding: 'utf8',
      timeout: 10000,
      env: {
        ...process.env,
        DIAGNOSTICS_FIXTURE: fixtureDir,
        DIAGNOSTICS_LIBRARY: library,
        APPIMAGE: path.join(fixtureDir, 'fixture.AppImage'),
        LINUX_CHECK_OUT: path.join(fixtureDir, 'artifacts'),
      },
    });
  }

  function artifact(name) {
    return fs.readFileSync(path.join(fixtureDir, 'artifacts/server-save', name), 'utf8');
  }

  test('preserves the full log and live process state before cleanup', () => {
    const result = failLaunch(`
printf '%s\n' "$$" > "$LAB/app.pid"
for ((i=1; i<=80; i++)); do printf 'startup line %s\n' "$i"; done > "$LAB/app.log"
`);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    const pid = artifact('app.pid').trim();
    expect(artifact('app.log').split('\n').filter(Boolean)).toHaveLength(80);
    expect(artifact('app.log')).toContain('startup line 1\n');
    expect(artifact('app.log')).not.toContain('cleanup replaced');
    expect(artifact('startup-diagnostics.txt')).toContain('launcher_status=present');
    expect(artifact('startup-diagnostics.txt')).toMatch(new RegExp(`\\n\\s*${pid}\\s+\\d+\\s+\\d+\\s+`));
    expect(artifact('startup-diagnostics.txt')).toContain('fixture sockets: none');
    expect(fs.readFileSync(path.join(fixtureDir, 'stopped'), 'utf8').trim()).toBe(pid);
    expect(result.stderr).toContain('startup line 80');
    expect(result.stderr).not.toContain('startup line 1\n');
  });

  test('records an exited launcher without inventing an exit status', () => {
    const result = failLaunch(`
bash -c 'exit 23' &
fixture_pid=$!
wait "$fixture_pid" || true
printf '%s\n' "$fixture_pid" > "$LAB/app.pid"
printf 'startup stopped early\n' > "$LAB/app.log"
`);
    expect(result.status).toBe(1);
    expect(artifact('startup-diagnostics.txt')).toContain('launcher_status=absent (exit status unavailable)');
    expect(artifact('app.log')).toBe('startup stopped early\n');
    expect(fs.existsSync(path.join(fixtureDir, 'stopped'))).toBe(true);
  });

  test('diagnostic command failures still preserve logs and run cleanup', () => {
    const result = failLaunch(`
printf '%s\n' "$$" > "$LAB/app.pid"
printf 'startup log\n' > "$LAB/app.log"
`, `ps() { echo 'ps unavailable' >&2; return 77; }
ss() { echo 'ss unavailable' >&2; return 78; }`);
    expect(result.status).toBe(1);
    expect(artifact('app.log')).toBe('startup log\n');
    expect(artifact('startup-diagnostics.txt')).toContain('ps unavailable');
    expect(artifact('startup-diagnostics.txt')).toContain('ss unavailable');
    expect(fs.existsSync(path.join(fixtureDir, 'stopped'))).toBe(true);
  });

  test('failures before launch record the missing PID without trying to stop anything', () => {
    const result = failLaunch('');
    expect(result.status).toBe(1);
    expect(artifact('startup-diagnostics.txt')).toContain('launcher_status=not recorded');
    expect(fs.existsSync(path.join(fixtureDir, 'stopped'))).toBe(false);
  });
});
