// C6.1: the round-trip driver boots in plain Node, answers a `snapshot` before
// `start` with an error instead of crashing, and dies with its parent. It never
// reaches the network: the app host is the test app and the port is closed, and
// no scenario here starts a manager.
const path = require('path');
const { fork } = require('child_process');

const REPO = path.resolve(__dirname, '../..');
const DRIVER = path.join(REPO, 'tests/round-trip/desktop-driver.cjs');
// This repo carries undici 7.29.0 of its own, so the driver resolves it here.
const UNDICI_PATH = require.resolve('undici');

function startDriver() {
  const child = fork(DRIVER, [], {
    env: {
      ...process.env,
      APP_HOSTNAME: 'hyperclay.test',
      APP_PORT: '1',
      LOCAL_DIR: REPO,
      UNDICI_PATH,
    },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  child.stderrText = '';
  child.stderr.on('data', (chunk) => { child.stderrText += chunk; });
  return child;
}

function nextMessage(child, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.off('message', onMessage);
      reject(new Error(`the driver sent nothing in ${timeoutMs}ms: ${child.stderrText}`));
    }, timeoutMs);
    const onMessage = (message) => { clearTimeout(timer); resolve(message); };
    child.once('message', onMessage);
  });
}

let callId = 0;

async function callDriver(child, cmd, args = {}) {
  const id = ++callId;
  const reply = nextMessage(child);
  child.send({ id, cmd, args });
  const message = await reply;
  if (message.id !== id) throw new Error(`unexpected reply ${JSON.stringify(message)}`);
  return message;
}

async function waitForExit(child, timeoutMs = 3000) {
  let timer = null;
  const expired = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('the driver did not exit')), timeoutMs);
  });
  try {
    return await Promise.race([new Promise((resolve) => child.once('exit', resolve)), expired]);
  } finally {
    clearTimeout(timer);
  }
}

async function stopDriver(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((resolve) => child.once('exit', resolve));
  child.kill();
  await exited;
}

describe('round-trip driver', () => {
  it('announces itself ready', async () => {
    const child = startDriver();
    try {
      expect(await nextMessage(child)).toEqual({ ready: true });
    } finally {
      await stopDriver(child);
    }
  });

  it('answers a snapshot before start with an error and stays up', async () => {
    const child = startDriver();
    try {
      expect(await nextMessage(child)).toEqual({ ready: true });

      const message = await callDriver(child, 'snapshot');

      expect(message.ok).toBe(false);
      expect(message.error && message.error.message).toMatch(/snapshot/);
      expect(child.exitCode).toBe(null);
    } finally {
      await stopDriver(child);
    }
  });

  it('exits when the parent disconnects', async () => {
    const child = startDriver();
    try {
      expect(await nextMessage(child)).toEqual({ ready: true });

      child.disconnect();

      expect(await waitForExit(child)).toBe(0);
    } finally {
      await stopDriver(child);
    }
  });
});
