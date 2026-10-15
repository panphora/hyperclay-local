const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..', '..');
const nsis = require('../../package.json').build.nsis;
const include = fs.readFileSync(path.join(root, 'build', 'installer.nsh'), 'utf8');

describe('Windows installer', () => {
  test('is a one-click per-user installer under the published file name', () => {
    expect(nsis).toEqual({ oneClick: true, perMachine: false, artifactName: 'HyperclayLocal-Setup-${version}.${ext}' });
  });

  test('build/installer.nsh is not ignored, so every build includes it', () => {
    // Checked in a scratch repo holding only .gitignore, so it works without a checkout.
    // 1 is "not ignored"; 0 (ignored) or 128 (git failed) must fail.
    const scratch = fs.mkdtempSync(path.join(require('os').tmpdir(), 'hcl-gitignore-'));
    try {
      expect(spawnSync('git', ['init', '-q'], { cwd: scratch }).status).toBe(0);
      fs.copyFileSync(path.join(root, '.gitignore'), path.join(scratch, '.gitignore'));
      expect(spawnSync('git', ['check-ignore', '-q', 'build/installer.nsh'], { cwd: scratch, stdio: 'ignore' }).status).toBe(1);
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  });

  const at = (text) => {
    const index = include.indexOf(text);
    expect(index).toBeGreaterThan(-1);
    return index;
  };

  test('a silent run on a machine with an all-users install exits 3 before changing anything', () => {
    expect(include).toContain('ReadRegStr $hclMachineDir HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation');
    expect(include).toMatch(/\$\{if\} \$\{Silent\}\s+SetErrorLevel 3\s+Quit/);
  });

  test('an all-users entry whose folder is gone counts as no all-users install', () => {
    expect(include).toMatch(/\$\{ifNot\} \$\{FileExists\} "\$hclMachineDir\\\*\.\*"\s+StrCpy \$hclMachineDir ""/);
    expect(at('${FileExists} "$hclMachineDir\\*.*"')).toBeLessThan(at('${if} ${Silent}'));
  });

  test('takes over only a copy under Program Files, and checks that before anything else can change', () => {
    expect(include).toContain('GetFullPathName $hclMachineFull $hclMachineDir');
    expect(include).toContain('StrCpy $1 "$hclMachineFull\\" $0\n    ${if} $1 == "$PROGRAMFILES64\\"');
    expect(include).toContain('StrCpy $1 "$hclMachineFull\\" $0\n    ${if} $1 == "$PROGRAMFILES\\"');
    expect(include).toMatch(/\$\{if\} \$2 != 1\s+MessageBox MB_OK\|MB_ICONSTOP "[^"]*Remove that copy from Settings > Apps[^"]*Nothing was installed\."\s+Quit/);
    expect(at('${if} $2 != 1')).toBeLessThan(at('retryRunning:'));
  });

  test('checks the per-user folder can be written before the all-users copy is removed', () => {
    const probe = at('FileOpen $0 "$INSTDIR\\hyperclay-write-check.tmp" w');
    expect(include.slice(probe)).toMatch(/^[^\n]*\n\s+\$\{if\} \$\{Errors\}[\s\S]*?MessageBox[^\n]*nothing was installed[^\n]*\n\s+Quit/);
    expect(probe).toBeLessThan(at('ExecShellWait "runas"'));
  });

  test('anything not clearly stopped counts as running: unreadable paths, failed queries, and sibling folders do not slip through', () => {
    const line = include.split('\n').find((l) => l.includes('Get-CimInstance Win32_Process'));
    expect(line).toContain("$$d = '$hclMachineFull\\'");
    expect(line).toContain("$$_.Name -eq '${APP_EXECUTABLE_FILENAME}' -and (-not $$_.ExecutablePath -or $$_.ExecutablePath.StartsWith($$d, 'OrdinalIgnoreCase'))");
    expect(line).toContain('-ErrorAction Stop');
    expect(line).toContain('if ($$n -eq 0) { exit 10 } else { exit 0 } } catch { exit 0 }');
    expect(include).toMatch(/Pop \$0\s+\$\{if\} \$0 != 10\s+MessageBox MB_RETRYCANCEL/);
  });

  test('removes the all-users copy with its own uninstaller, elevated, and installs only once HKLM is empty', () => {
    const remove = include.indexOf('ExecShellWait "runas"');
    expect(remove).toBeGreaterThan(-1);
    expect(include).toContain("'/S /KEEP_APP_DATA /allusers --updated _?=$hclMachineDir'");
    const recheck = include.indexOf('ReadRegStr $0 HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation', remove);
    expect(recheck).toBeGreaterThan(remove);
    expect(include.slice(recheck)).toMatch(/\$\{if\} \$0 != ""[\s\S]*?Quit/);
  });
});
