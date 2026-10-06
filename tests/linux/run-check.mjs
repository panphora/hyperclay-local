import { execFileSync, spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';

const [timeoutInput, graceInput, command, ...args] = process.argv.slice(2);
const timeoutMs = Number(timeoutInput);
const graceMs = Number(graceInput);
const validDuration = (value) => Number.isInteger(value) && value > 0 && value <= 2147483647;
if (!validDuration(timeoutMs) || !validDuration(graceMs) || !command) {
  console.error('usage: run-check.mjs <timeout-ms> <kill-grace-ms> <command> [args...]');
  process.exit(2);
}

const child = spawn(command, args, { detached: true, stdio: 'inherit' });
let stopping = false;
let interruptStatus = null;

function ownedGroups() {
  const groups = new Set([child.pid]);
  if (!child.pid) return groups;
  try {
    const rows = execFileSync('ps', ['-eo', 'pid=,ppid=,pgid='], {
      encoding: 'utf8', timeout: 1000, stdio: ['ignore', 'pipe', 'ignore'],
    });
    const children = new Map();
    for (const line of rows.split('\n')) {
      const fields = /^\s*(\d+)\s+(\d+)\s+(\d+)\s*$/.exec(line);
      if (!fields) continue;
      const [pid, parent, group] = fields.slice(1).map(Number);
      if (!children.has(parent)) children.set(parent, []);
      children.get(parent).push({ pid, group });
    }
    const seen = new Set([child.pid]);
    const queue = [child.pid];
    for (let index = 0; index < queue.length; index += 1) {
      for (const descendant of children.get(queue[index]) || []) {
        if (seen.has(descendant.pid)) continue;
        seen.add(descendant.pid);
        queue.push(descendant.pid);
        if (descendant.group > 1) groups.add(descendant.group);
      }
    }
  } catch (error) {
    console.error('Could not enumerate check process groups:', error.message);
  }
  return groups;
}

function signalGroup(group, signal) {
  if (!group) return;
  try {
    process.kill(-group, signal);
  } catch (error) {
    if (error.code !== 'ESRCH') console.error('Could not signal check process group:', error.message);
  }
}

function terminate(status, message) {
  if (status !== 124 && interruptStatus === null) interruptStatus = status;
  if (stopping) return;
  stopping = true;
  clearTimeout(deadline);
  const killAt = performance.now() + graceMs;
  const groups = ownedGroups();
  console.error(message);
  signalGroup(child.pid, 'SIGTERM');
  setTimeout(() => {
    for (const group of groups) signalGroup(group, 'SIGKILL');
    process.exit(interruptStatus ?? status);
  }, Math.max(0, killAt - performance.now()));
}

const deadline = setTimeout(() => {
  terminate(124, 'TIMEOUT: check exceeded ' + timeoutMs + ' ms; terminating its process group');
}, timeoutMs);

child.on('error', (error) => {
  clearTimeout(deadline);
  console.error('Could not start check:', error.message);
  process.exitCode = 1;
});
child.on('exit', (code) => {
  if (stopping) return;
  clearTimeout(deadline);
  process.exitCode = code === null ? 1 : code;
});
process.on('SIGTERM', () => terminate(143, 'Check interrupted by SIGTERM'));
process.on('SIGINT', () => terminate(130, 'Check interrupted by SIGINT'));
