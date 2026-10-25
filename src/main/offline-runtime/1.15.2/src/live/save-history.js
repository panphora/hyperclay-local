export const RECOVERY_WINDOW_MS = 45_000;
export const RECOVERY_ROUNDS_MS = [0, 10_000, 30_000];
export const QUERY_TIMEOUT_MS = 6_000;
export const MAX_HISTORY_IDS = 2;

export async function sha256Hex(html) {
  const subtle = globalThis.crypto && globalThis.crypto.subtle;
  if (!subtle) return null;
  try {
    const bytes = new TextEncoder().encode(String(html));
    const digest = await subtle.digest("SHA-256", bytes);
    const view = new Uint8Array(digest);
    let hex = "";
    for (let i = 0; i < view.length; i += 1) hex += view[i].toString(16).padStart(2, "0");
    return hex;
  } catch (_) {
    return null;
  }
}

function uniqueSaveIds(attempts) {
  const ids = [];
  for (const attempt of attempts || []) {
    const saveId = attempt && attempt.saveId;
    if (typeof saveId === "string" && saveId && !ids.includes(saveId)) ids.push(saveId);
    if (ids.length >= MAX_HISTORY_IDS) break;
  }
  return ids;
}

function positive(answer, saveId, requestHash) {
  return Boolean(
    answer &&
      typeof answer === "object" &&
      answer.saveId === saveId &&
      answer.requestHash === requestHash &&
      answer.status === "applied"
  );
}

export function createSaveHistoryRecovery({
  query,
  digest = sha256Hex,
  now = () => Date.now(),
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  function start({ captureId, html, attempts, initialOutcome, startedAt, onApplied, onUnknown }) {
    const deadline = startedAt + RECOVERY_WINDOW_MS;
    const ids = uniqueSaveIds(attempts);
    const timers = new Set();
    const controllers = new Set();
    let body = html;
    let hash = null;
    let terminal = false;

    function call(fn, arg) {
      try {
        if (typeof fn === "function") fn(arg);
      } catch (err) {
        console.error("clayjs: save-history callback failed:", err);
      }
    }

    function finish() {
      terminal = true;
      body = null;
      for (const timer of timers) clearTimer(timer);
      timers.clear();
      for (const controller of controllers) controller.abort();
      controllers.clear();
    }

    function apply(saveId, requestHash) {
      if (terminal) return;
      finish();
      call(onApplied, { captureId, saveId, requestHash });
    }

    function giveUp(reason) {
      if (terminal) return;
      finish();
      call(onUnknown, { captureId, reason });
    }

    function addTimer(fn, delay) {
      let id = null;
      id = setTimer(() => {
        if (id !== null) timers.delete(id);
        fn();
      }, Math.max(0, delay));
      timers.add(id);
      return id;
    }

    function dropTimer(id) {
      if (id !== null) {
        clearTimer(id);
        timers.delete(id);
      }
    }

    async function probe(saveId) {
      if (terminal) return;
      const remaining = deadline - now();
      if (remaining <= 0) return;
      const controller = new AbortController();
      controllers.add(controller);
      const timer = addTimer(() => controller.abort(), Math.min(QUERY_TIMEOUT_MS, remaining));
      let answer = null;
      try {
        answer = await query({ saveId, requestHash: hash, signal: controller.signal });
      } catch (_) {
        answer = null;
      } finally {
        dropTimer(timer);
        controllers.delete(controller);
      }
      if (terminal) return;
      if (positive(answer, saveId, hash)) apply(saveId, hash);
    }

    function runRound() {
      if (terminal) return;
      if (now() >= deadline) return;
      for (const saveId of ids) probe(saveId);
    }

    async function run() {
      let computed = null;
      try {
        computed = await digest(body);
      } catch (_) {
        computed = null;
      }
      body = null;
      if (terminal) return;
      if (typeof computed !== "string" || !computed) {
        giveUp("unavailable");
        return;
      }
      hash = computed;

      if (
        initialOutcome &&
        typeof initialOutcome === "object" &&
        initialOutcome.status === "applied" &&
        initialOutcome.requestHash === hash &&
        ids.includes(initialOutcome.saveId)
      ) {
        apply(initialOutcome.saveId, hash);
        return;
      }

      const elapsed = now() - startedAt;
      if (elapsed >= RECOVERY_WINDOW_MS) {
        giveUp("expired");
        return;
      }

      let due = -1;
      for (let i = 0; i < RECOVERY_ROUNDS_MS.length; i += 1) {
        if (RECOVERY_ROUNDS_MS[i] <= elapsed) due = i;
      }
      if (due < 0) {
        for (let i = 0; i < RECOVERY_ROUNDS_MS.length; i += 1) {
          addTimer(runRound, startedAt + RECOVERY_ROUNDS_MS[i] - now());
        }
        return;
      }
      runRound();
      for (let i = due + 1; i < RECOVERY_ROUNDS_MS.length; i += 1) {
        addTimer(runRound, startedAt + RECOVERY_ROUNDS_MS[i] - now());
      }
    }

    addTimer(() => giveUp("expired"), deadline - now());
    run();

    return {
      cancel() {
        finish();
      },
    };
  }

  return { start };
}
