const DATA_WRITE = "data-write";
const WRITE_HOLD_REASON = "Waiting for the page data write to finish";
const SYNC_WAIT_MS = 12000;
const HTTP_WAIT_MS = 30000;

function refusal(code, message, details) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

async function responseBody(response) {
  if (typeof response.json === "function") return response.json();
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function responseError(response) {
  let body = {};
  try {
    body = (await responseBody(response)) || {};
  } catch {}

  const message = body.message || body.error || response.statusText || `Request failed (${response.status})`;
  const error = new Error(message);
  error.status = response.status;
  error.error = body.error;
  error.details = body.details;
  return error;
}

function responseEtag(response) {
  const value = response.headers?.get?.("ETag");
  return typeof value === "string" && value ? value : null;
}

function dataUrl(rules, location) {
  const base = `${location.origin}${location.pathname}`;
  if (rules !== undefined) return `${base}?data=${encodeURIComponent(JSON.stringify(rules))}`;
  return `${location.origin}/_/api${location.pathname}`;
}

function connected(sync) {
  return !!sync && !sync.isDestroyed && sync.sse?.readyState === 1;
}

function syncWaiter(eventTarget, timeoutMs) {
  const seen = [];
  let expected = null;
  let resolvePending = null;
  let timer = null;

  const matchesExact = (detail) =>
    detail?.source === "disk" && (expected === null || detail.etag === expected);

  const matchesPending = (detail) =>
    detail?.source === "disk" && (detail.etag == null || expected === null || detail.etag === expected);

  const cleanup = () => {
    clearTimeout(timer);
    eventTarget.removeEventListener("clay:sync-applied", onApplied);
  };

  const onApplied = (event) => {
    seen.push(event.detail);
    if (!resolvePending || !matchesPending(event.detail)) return;
    const resolve = resolvePending;
    resolvePending = null;
    cleanup();
    resolve(true);
  };

  eventTarget.addEventListener("clay:sync-applied", onApplied);

  return {
    waitFor(etag) {
      expected = etag;
      if (seen.some(matchesExact)) {
        cleanup();
        return Promise.resolve(true);
      }
      return new Promise((resolve) => {
        resolvePending = resolve;
        timer = setTimeout(() => {
          resolvePending = null;
          cleanup();
          resolve(false);
        }, timeoutMs);
      });
    },
    cancel: cleanup,
  };
}

function httpDeadline(timeoutMs) {
  const controller = new AbortController();
  let rejectDeadline;
  const expired = new Promise((_, reject) => {
    rejectDeadline = reject;
  });
  const timer = setTimeout(() => {
    const error = new Error("The page data write timed out.");
    error.name = "TimeoutError";
    controller.abort(error);
    rejectDeadline(error);
  }, timeoutMs);

  return {
    signal: controller.signal,
    waitFor(promise) {
      return Promise.race([promise, expired]);
    },
    cancel() {
      clearTimeout(timer);
    },
  };
}

async function defaultWriteModules() {
  const [save, saveCore, etag, warning, editMode] = await Promise.all([
    import("./save.js"),
    import("./save-core.js"),
    import("./etag.js"),
    import("./unsaved-warning.js"),
    import("./is-edit-mode.js"),
  ]);
  return { ...save, ...saveCore, ...etag, ...warning, ...editMode };
}

async function draftRefusal() {
  const { isDraftMode } = await import("./is-edit-mode.js");
  if (!isDraftMode) return null;
  return refusal("DataUnavailableInDraft", "Page data is kept in this browser for this visitor.");
}

export function createPageDataWrite({
  supports,
  token,
  fetchImpl,
  getLocation,
  eventTarget,
  getLiveSync,
  loadWriteModules = defaultWriteModules,
  syncTimeoutMs = SYNC_WAIT_MS,
  httpTimeoutMs = HTTP_WAIT_MS,
}) {
  let writeRunning = false;
  let writeOutcomeUnknown = false;

  function assertWriteState(modules, { checkHold = true } = {}) {
    // A save session with admission closed is a page between modes. Its own exit is the
    // only write that may go out until it commits or resumes, and page data is not it.
    if (modules.savesAdmitted && !modules.savesAdmitted()) {
      throw refusal("ModeTransition", "The page is switching modes. Write page data again when it has settled.");
    }
    if (writeOutcomeUnknown) {
      throw refusal("DataWriteOutcomeUnknown", "A previous page data write has an unknown outcome. Reload before writing again.");
    }
    if (writeRunning) {
      throw refusal("DataWriteInProgress", "Another page data write is already running.");
    }
    if (modules.isSaveInProgress()) {
      throw refusal("SaveInProgress", "The page is already being saved.");
    }
    if (modules.saveFateIsUnknown()) {
      throw refusal("SaveOutcomeUnknown", "The page's last save has an unknown outcome.");
    }
    if (checkHold && (modules.savesHeld() || modules.isSaveConflicted())) {
      throw refusal("SavesHeld", "The page cannot write data while another save hold is active.");
    }
    if (modules.hasUnsavedChanges()) {
      throw refusal("UnsavedChanges", "Save or discard the page's unsaved changes before writing data.");
    }
    if (!connected(getLiveSync())) {
      throw refusal("SyncRequired", "Page data writes require the sync plugin to be connected.");
    }
  }

  async function waitForBaseline(modules) {
    if (modules.baselineSettled()) return;
    await new Promise((resolve) => eventTarget.addEventListener("clay:baseline-settled", resolve, { once: true }));
  }

  async function writeData(values, { rules, ifMatch } = {}) {
    const draft = await draftRefusal();
    if (draft) throw draft;

    if (!(await supports(DATA_WRITE))) {
      throw refusal("DataWriteUnsupported", "This host does not support writing page data.");
    }

    const modules = await loadWriteModules();
    if (!modules.isEditMode) {
      throw refusal("DataWriteUnavailable", "Page data writes require an editable page.");
    }

    await waitForBaseline(modules);
    assertWriteState(modules);

    let match = ifMatch;
    if (match == null) match = modules.lastSeenEtag() || await modules.seedEtag();
    if (typeof match !== "string" || match === "") {
      throw refusal("DataWriteVersionRequired", "Page data writes require a trustworthy document ETag.");
    }

    assertWriteState(modules);
    writeRunning = true;
    modules.holdAllSaves(WRITE_HOLD_REASON);

    let waiter = null;
    try {
      if (modules.isSaveInProgress()) {
        throw refusal("SaveInProgress", "The page is already being saved.");
      }
      if (modules.saveFateIsUnknown()) {
        throw refusal("SaveOutcomeUnknown", "The page's last save has an unknown outcome.");
      }
      if (modules.isSaveConflicted()) {
        throw refusal("SavesHeld", "The page cannot write data while another save hold is active.");
      }
      if (modules.hasUnsavedChanges()) {
        throw refusal("UnsavedChanges", "Save or discard the page's unsaved changes before writing data.");
      }
      // Rechecked immediately before the POST: a mode switch can close admission while
      // this write was waiting for the sync and the stamp.
      if (modules.savesAdmitted && !modules.savesAdmitted()) {
        throw refusal("ModeTransition", "The page is switching modes. Write page data again when it has settled.");
      }
      if (!connected(getLiveSync())) {
        throw refusal("SyncRequired", "Page data writes require the sync plugin to be connected.");
      }

      const headers = {
        "Content-Type": "application/json",
        "If-Match": match,
      };
      const currentToken = token();
      if (currentToken) headers["Save-Token"] = currentToken;

      const body = JSON.stringify(values);
      waiter = syncWaiter(eventTarget, syncTimeoutMs);
      const deadline = httpDeadline(httpTimeoutMs);

      let response;
      try {
        response = await deadline.waitFor(fetchImpl(dataUrl(rules, getLocation()), {
          method: "POST",
          credentials: "same-origin",
          redirect: "error",
          headers,
          body,
          signal: deadline.signal,
        }));
      } catch (cause) {
        deadline.cancel();
        writeOutcomeUnknown = true;
        throw Object.assign(
          refusal("DataWriteOutcomeUnknown", "The page data write has an unknown outcome. Do not retry automatically."),
          { cause, unknownOutcome: true }
        );
      }

      let data;
      try {
        if (!response.ok) throw await deadline.waitFor(responseError(response));
        data = await deadline.waitFor(responseBody(response));
      } catch (cause) {
        if (cause?.status) throw cause;
        writeOutcomeUnknown = true;
        throw Object.assign(
          refusal("DataWriteOutcomeUnknown", "The page data was written, but its response could not be read."),
          { cause, unknownOutcome: true }
        );
      } finally {
        deadline.cancel();
      }

      const etag = responseEtag(response);
      if (etag && etag === modules.lastSeenEtag()) {
        waiter.cancel();
        waiter = null;
        return { data, etag };
      }

      const applied = await waiter.waitFor(etag);
      waiter = null;
      if (!applied) {
        return {
          data,
          etag,
          pageUpdatePending: true,
          message: "Written, page update pending.",
        };
      }
      return { data, etag };
    } finally {
      waiter?.cancel();
      writeRunning = false;
      modules.releaseAllSaves({ reason: WRITE_HOLD_REASON });
    }
  }

  return { writeData };
}
