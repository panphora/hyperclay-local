const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const describeShell = process.platform === 'win32' ? describe.skip : describe;
const linuxDir = path.resolve(__dirname, '../linux');
const wrapper = path.join(linuxDir, 'run-check.mjs');
jest.setTimeout(20000);

describeShell('Linux check deadlines and cleanup', () => {
  let fixtureDir;

  beforeEach(() => {
    fixtureDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'linux-check-deadline-')));
    fs.mkdirSync(path.join(fixtureDir, 'lab'));
    fs.writeFileSync(path.join(fixtureDir, 'fixture.AppImage'), '#!/bin/bash\nexit 0\n');
  });

  afterEach(() => {
    for (const name of ['pids.json', 'harness.pid', 'lab/app.pid']) {
      const file = path.join(fixtureDir, name);
      if (!fs.existsSync(file)) continue;
      const text = fs.readFileSync(file, 'utf8').trim();
      const pids = name.endsWith('.json') ? JSON.parse(text) : [Number(text)];
      for (const pid of pids) {
        if (!Number.isInteger(pid) || pid <= 0) continue;
        try { process.kill(pid, 'SIGKILL'); } catch {}
      }
    }
    fs.rmSync(fixtureDir, { recursive: true, force: true });
  });

  function env(extra = {}) {
    return {
      ...process.env,
      CI_FIXTURE: fixtureDir,
      CI_LIBRARY: path.join(linuxDir, 'lib.sh'),
      APPIMAGE: path.join(fixtureDir, 'fixture.AppImage'),
      LINUX_CHECK_OUT: path.join(fixtureDir, 'artifacts'),
      ...extra,
    };
  }

  function runCheck(command, args, timeoutMs = 2000, graceMs = 500) {
    return spawnSync(process.execPath, [wrapper, String(timeoutMs), String(graceMs), command, ...args], {
      encoding: 'utf8', timeout: 10000, env: env(),
    });
  }

  function running(pid) {
    try { process.kill(pid, 0); } catch { return false; }
    const status = spawnSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' }).stdout.trim();
    return status !== '' && !status.startsWith('Z');
  }

  function shellScript(name, body) {
    const file = path.join(fixtureDir, name);
    fs.writeFileSync(file, [
      'mktemp() { printf \'%s/lab\\n\' "$CI_FIXTURE"; }',
      'id() { echo 1000; }',
      'source "$CI_LIBRARY"',
      'ss() { echo \'fixture sockets\'; }',
      body,
      '',
    ].join('\n'));
    return file;
  }

  test('passes successful output and preserves a nonzero check status', () => {
    const pass = runCheck(process.execPath, ['-e', 'console.log("passed")']);
    expect(pass.error).toBeUndefined();
    expect(pass.status).toBe(0);
    expect(pass.stdout).toBe('passed\n');
    const fail = runCheck(process.execPath, ['-e', 'console.error("failed"); process.exit(7)']);
    expect(fail.error).toBeUndefined();
    expect(fail.status).toBe(7);
    expect(fail.stderr).toBe('failed\n');
  });

  test('kills a hung check and its TERM-resistant child after the grace period', () => {
    const file = path.join(fixtureDir, 'hung.js');
    fs.writeFileSync(file, [
      "const fs = require('fs');",
      "const { spawn } = require('child_process');",
      'const child = spawn(process.execPath, [\'-e\', \'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000)\'], { stdio: \'ignore\' });',
      'fs.writeFileSync(' + JSON.stringify(path.join(fixtureDir, 'pids.json')) + ', JSON.stringify([process.pid, child.pid]));',
      'process.on("SIGTERM", () => fs.writeFileSync(' + JSON.stringify(path.join(fixtureDir, 'term')) + ', "received"));',
      'setInterval(() => {}, 1000);',
    ].join('\n'));
    const result = runCheck(process.execPath, [file]);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(124);
    expect(result.stderr).toContain('TIMEOUT: check exceeded 2000 ms');
    expect(fs.readFileSync(path.join(fixtureDir, 'term'), 'utf8')).toBe('received');
    const pids = JSON.parse(fs.readFileSync(path.join(fixtureDir, 'pids.json'), 'utf8'));
    expect(pids).toHaveLength(2);
    expect(pids.every((pid) => Number.isInteger(pid) && pid > 0)).toBe(true);
    expect(pids.map(running)).toEqual([false, false]);
  });

  test('kills a separate child group when graceful close remains stalled', () => {
    const file = path.join(fixtureDir, 'detached.js');
    fs.writeFileSync(file, [
      "const fs = require('fs');",
      "const { spawn } = require('child_process');",
      'const child = spawn(process.execPath, [\'-e\', \'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000)\'], { detached: true, stdio: \'ignore\' });',
      'fs.writeFileSync(' + JSON.stringify(path.join(fixtureDir, 'pids.json')) + ', JSON.stringify([process.pid, child.pid]));',
      'process.on("SIGTERM", () => fs.writeFileSync(' + JSON.stringify(path.join(fixtureDir, 'term')) + ', "close stalled"));',
      'setInterval(() => {}, 1000);',
    ].join('\n'));
    const result = runCheck(process.execPath, [file]);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(124);
    expect(fs.readFileSync(path.join(fixtureDir, 'term'), 'utf8')).toBe('close stalled');
    const pids = JSON.parse(fs.readFileSync(path.join(fixtureDir, 'pids.json'), 'utf8'));
    expect(pids).toHaveLength(2);
    expect(pids.every((pid) => Number.isInteger(pid) && pid > 0)).toBe(true);
    expect(pids.map(running)).toEqual([false, false]);
  });

  test('an interrupt during timeout grace preserves cancellation status', () => {
    const driver = path.join(fixtureDir, 'grace-driver.js');
    fs.writeFileSync(driver, 'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000);\n');
    const controller = path.join(fixtureDir, 'grace-controller.js');
    fs.writeFileSync(controller, [
      "const { spawn } = require('child_process');",
      `const child = spawn(process.execPath, ${JSON.stringify([wrapper, '2000', '500', process.execPath, driver])});`,
      'let output = "";',
      'child.stderr.on("data", (data) => { output += data; if (output.includes("TIMEOUT:")) child.kill("SIGINT"); });',
      'child.on("error", (error) => { console.error(error); process.exitCode = 1; });',
      'child.on("close", (status) => console.log(JSON.stringify({ status, output })));',
    ].join('\n'));
    const result = spawnSync(process.execPath, [controller], { encoding: 'utf8', timeout: 10000, env: env() });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    const output = JSON.parse(result.stdout);
    expect(output.status).toBe(130);
    expect(output.output).toContain('TIMEOUT:');
  });

  test('a stalled server-save driver cannot orphan its AppImage launch', () => {
    fs.copyFileSync(path.join(linuxDir, 'server-save.sh'), path.join(fixtureDir, 'server-save.sh'));
    fs.writeFileSync(path.join(fixtureDir, 'fixture.AppImage'), [
      '#!/usr/bin/env node',
      "const fs = require('fs');",
      'process.on("SIGTERM", () => {});',
      'fs.writeFileSync(process.env.CI_FIXTURE + "/pids.json", JSON.stringify([process.pid]));',
      'fs.writeFileSync(process.env.CI_FIXTURE + "/app-ready", "ready");',
      'setInterval(() => {}, 1000);',
    ].join('\n'));
    fs.writeFileSync(path.join(fixtureDir, 'driver.js'), [
      "const fs = require('fs');",
      'const file = process.env.CI_FIXTURE + "/pids.json";',
      'fs.writeFileSync(file, JSON.stringify([...JSON.parse(fs.readFileSync(file)), process.pid]));',
      'process.on("SIGTERM", () => {});',
      'setInterval(() => {}, 1000);',
    ].join('\n'));
    const bin = path.join(fixtureDir, 'bin');
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, 'setsid'), '#!/usr/bin/perl\nuse POSIX (); POSIX::setsid() or die "setsid: $!"; exec @ARGV or die "exec: $!";\n', { mode: 0o755 });
    fs.writeFileSync(path.join(bin, 'xvfb-run'), '#!/bin/bash\nshift 3\nexec "$@"\n', { mode: 0o755 });
    fs.writeFileSync(path.join(fixtureDir, 'lib.sh'), fs.readFileSync(path.join(linuxDir, 'lib.sh'), 'utf8') + [
      '',
      'wait_for_server() { for _ in {1..40}; do [ -f "$CI_FIXTURE/app-ready" ] && return 0; sleep 0.05; done; return 1; }',
      'port_free_or_fail() { return 0; }',
      'curl() { case "$*" in *"-H"*) printf 403;; *"-w"*) printf 200;; *) return 1;; esac; }',
      'ss() { :; }',
      'pkill() { :; }',
      'node() { "$CI_REAL_NODE" "$CI_FIXTURE/driver.js"; }',
      '',
    ].join('\n'));
    const tools = path.join(fixtureDir, 'ownership-tools.sh');
    fs.writeFileSync(tools, 'mktemp() { printf \'%s/lab\\n\' "$CI_FIXTURE"; }\nid() { echo 1000; }\n');
    const result = spawnSync(process.execPath, [wrapper, '2000', '500', 'bash', path.join(fixtureDir, 'server-save.sh')], {
      encoding: 'utf8', timeout: 10000,
      env: env({ BASH_ENV: tools, PATH: bin + path.delimiter + process.env.PATH, CI_REAL_NODE: process.execPath }),
    });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(124);
    const pids = JSON.parse(fs.readFileSync(path.join(fixtureDir, 'pids.json'), 'utf8'));
    expect(pids).toHaveLength(2);
    expect(pids.map(running)).toEqual([false, false]);
  });

  test('the runner records timeouts and still runs checks after a failure and a hang', () => {
    fs.copyFileSync(path.join(linuxDir, 'run-all.sh'), path.join(fixtureDir, 'run-all.sh'));
    fs.copyFileSync(wrapper, path.join(fixtureDir, 'run-check.mjs'));
    fs.writeFileSync(path.join(fixtureDir, 'pass.sh'), 'echo passed\n');
    fs.writeFileSync(path.join(fixtureDir, 'fail.sh'), 'echo failed >&2\nexit 7\n');
    fs.writeFileSync(path.join(fixtureDir, 'hang.sh'), [
      'echo "$$" > "' + path.join(fixtureDir, 'harness.pid') + '"',
      "trap '' TERM",
      'while :; do sleep 10; done',
      '',
    ].join('\n'));
    fs.writeFileSync(path.join(fixtureDir, 'after.sh'), 'echo after\n');
    const result = spawnSync('bash', [path.join(fixtureDir, 'run-all.sh')], {
      encoding: 'utf8', timeout: 15000,
      env: env({ CHECKS: 'pass fail hang after', LINUX_CHECK_TIMEOUT_MS: '2000', LINUX_CHECK_KILL_GRACE_MS: '500' }),
    });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(fs.readFileSync(path.join(fixtureDir, 'artifacts/summary.txt'), 'utf8')).toBe(
      'PASS pass\nFAIL fail\nFAIL hang (timed out)\nPASS after\n'
    );
    expect(fs.readFileSync(path.join(fixtureDir, 'artifacts/fail.out'), 'utf8')).toContain('failed');
    expect(fs.readFileSync(path.join(fixtureDir, 'artifacts/hang.out'), 'utf8')).toContain('TIMEOUT');
    expect(fs.readFileSync(path.join(fixtureDir, 'artifacts/after.out'), 'utf8')).toBe('after\n');
    expect(running(Number(fs.readFileSync(path.join(fixtureDir, 'harness.pid'), 'utf8')))).toBe(false);
  });

  test.each([130, 143])('the runner stops after an interrupted check with status %i', (status) => {
    fs.copyFileSync(path.join(linuxDir, 'run-all.sh'), path.join(fixtureDir, 'run-all.sh'));
    fs.copyFileSync(wrapper, path.join(fixtureDir, 'run-check.mjs'));
    fs.writeFileSync(path.join(fixtureDir, 'interrupt.sh'), `exit ${status}\n`);
    fs.writeFileSync(path.join(fixtureDir, 'after.sh'), 'echo after\n');
    const result = spawnSync('bash', [path.join(fixtureDir, 'run-all.sh')], {
      encoding: 'utf8', timeout: 10000, env: env({ CHECKS: 'interrupt after' }),
    });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(status);
    expect(fs.readFileSync(path.join(fixtureDir, 'artifacts/summary.txt'), 'utf8')).toBe('INTERRUPTED interrupt\n');
    expect(fs.existsSync(path.join(fixtureDir, 'artifacts/after.out'))).toBe(false);
  });

  test('a deadline during exit cleanup still runs the extra cleanup hook', () => {
    const file = shellScript('cleanup-race.sh', [
      'stop() { sleep 2; printf \'stopped\\n\' >> "$CI_FIXTURE/events"; }',
      'cleanup_extra() { printf \'restored\\n\' >> "$CI_FIXTURE/events"; }',
      'printf \'%s\\n\' "$$" > "$LAB/app.pid"',
      'printf \'startup evidence\\n\' > "$LAB/app.log"',
      'sleep 1',
      'exit 1',
    ].join('\n'));
    const result = runCheck('bash', [file], 2000, 3000);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(124);
    expect(fs.readFileSync(path.join(fixtureDir, 'events'), 'utf8')).toBe('stopped\nrestored\n');
  });

  test('server polling counts time spent in curl against its deadline', () => {
    const file = shellScript('poll.sh', [
      'curl() { printf \'%s\\n\' "$*" >> "$CI_FIXTURE/probes"; sleep 1; return 1; }',
      'SECONDS=0',
      'if wait_for_server 1; then exit 9; fi',
    ].join('\n'));
    const result = spawnSync('bash', [file], { encoding: 'utf8', timeout: 10000, env: env() });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    const probes = fs.readFileSync(path.join(fixtureDir, 'probes'), 'utf8').trim().split('\n');
    expect(probes).toHaveLength(1);
    expect(probes[0]).toContain('-m 1 ');
  });

  test('interruption preserves startup evidence before cleanup and runs the extra cleanup hook', () => {
    const file = shellScript('interrupted.sh', [
      'stop() {',
      '  printf \'stopped\\n\' >> "$CI_FIXTURE/events"',
      '  printf \'cleanup replaced log\\n\' > "$LAB/app.log"',
      '}',
      'cleanup_extra() { printf \'restored\\n\' >> "$CI_FIXTURE/events"; }',
      'sleep 60 &',
      'printf \'%s\\n\' "$!" > "$LAB/app.pid"',
      'printf \'startup evidence\\n\' > "$LAB/app.log"',
      'wait "$!"',
    ].join('\n'));
    const result = runCheck('bash', [file], 2000, 3000);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(124);
    expect(fs.readFileSync(path.join(fixtureDir, 'events'), 'utf8')).toBe('stopped\nrestored\n');
    expect(fs.readFileSync(path.join(fixtureDir, 'artifacts/interrupted/app.log'), 'utf8')).toBe('startup evidence\n');
    expect(fs.readFileSync(path.join(fixtureDir, 'artifacts/interrupted/startup-diagnostics.txt'), 'utf8')).toContain('check exited with status 143');
  });

  test('an early exit after the namespace mutation restores its original value', () => {
    fs.copyFileSync(path.join(linuxDir, 'appimage-launch.sh'), path.join(fixtureDir, 'appimage-launch.sh'));
    fs.writeFileSync(path.join(fixtureDir, 'lib.sh'), fs.readFileSync(path.join(linuxDir, 'lib.sh'), 'utf8') + [
      '',
      'wait_for_server() { return 0; }',
      'stop() { : > "$LAB/app.pid"; }',
      'port_free_or_fail() {',
      '  if [ -f "$CI_FIXTURE/restricted" ]; then exit 17; fi',
      '  return 0',
      '}',
      '',
    ].join('\n'));
    const tools = path.join(fixtureDir, 'fixture-tools.sh');
    fs.writeFileSync(tools, [
      'mktemp() { printf \'%s/lab\\n\' "$CI_FIXTURE"; }',
      'id() { echo 1000; }',
      'xvfb-run() { :; }',
      'setsid() { "$@"; }',
      'ldconfig() { echo \'libgtk-3.so.0\'; }',
      'sysctl() { echo 0; }',
      'sudo() {',
      '  if [ "$1" = \'-n\' ]; then return 0; fi',
      '  printf \'%s\\n\' "$*" >> "$CI_FIXTURE/sysctl.log"',
      '  case "$*" in *\'=1\') printf changed > "$CI_FIXTURE/restricted";; esac',
      '}',
      '',
    ].join('\n'));
    const result = spawnSync('bash', [path.join(fixtureDir, 'appimage-launch.sh')], {
      encoding: 'utf8', timeout: 10000, env: env({ BASH_ENV: tools, SYSTEM_MUTATIONS: '1' }),
    });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(17);
    expect(fs.readFileSync(path.join(fixtureDir, 'sysctl.log'), 'utf8').trim().split('\n')).toEqual([
      'sysctl -w kernel.apparmor_restrict_unprivileged_userns=1',
      'sysctl -w kernel.apparmor_restrict_unprivileged_userns=0',
    ]);
  });

  test('namespace restoration failure turns a successful early exit into failure', () => {
    fs.copyFileSync(path.join(linuxDir, 'appimage-launch.sh'), path.join(fixtureDir, 'appimage-launch.sh'));
    fs.writeFileSync(path.join(fixtureDir, 'lib.sh'), fs.readFileSync(path.join(linuxDir, 'lib.sh'), 'utf8') + [
      '',
      'wait_for_server() { return 0; }',
      'stop() { : > "$LAB/app.pid"; }',
      'port_free_or_fail() {',
      '  if [ -f "$CI_FIXTURE/restricted" ]; then exit 0; fi',
      '  return 0',
      '}',
      '',
    ].join('\n'));
    const tools = path.join(fixtureDir, 'failed-restore-tools.sh');
    fs.writeFileSync(tools, [
      'mktemp() { printf \'%s/lab\\n\' "$CI_FIXTURE"; }',
      'id() { echo 1000; }',
      'xvfb-run() { :; }',
      'setsid() { "$@"; }',
      'ldconfig() { echo \'libgtk-3.so.0\'; }',
      'sysctl() { echo 0; }',
      'sudo() {',
      '  if [ "$1" = \'-n\' ]; then return 0; fi',
      '  printf \'%s\\n\' "$*" >> "$CI_FIXTURE/sysctl.log"',
      '  case "$*" in',
      '    *\'=1\') printf changed > "$CI_FIXTURE/restricted";;',
      '    *\'=0\') return 1;;',
      '  esac',
      '}',
      '',
    ].join('\n'));
    const result = spawnSync('bash', [path.join(fixtureDir, 'appimage-launch.sh')], {
      encoding: 'utf8', timeout: 10000, env: env({ BASH_ENV: tools, SYSTEM_MUTATIONS: '1' }),
    });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(fs.readFileSync(path.join(fixtureDir, 'sysctl.log'), 'utf8').trim().split('\n')).toEqual([
      'sysctl -w kernel.apparmor_restrict_unprivileged_userns=1',
      'sysctl -w kernel.apparmor_restrict_unprivileged_userns=0',
    ]);
  });
});
