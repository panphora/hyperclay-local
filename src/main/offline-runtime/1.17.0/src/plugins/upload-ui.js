/**
 * upload-ui.js — the shared row for one upload task: name, progress, actions.
 *
 * `upload-task.js` owns the upload; this module only draws what that task says and
 * forwards a person's clicks back to it. Journal and Kanban mount the same row, so
 * neither duplicates the controls and neither can drift from the other's behaviour.
 *
 *   const unmount = await clay.upload.mount(task, container);
 *   unmount();
 *
 * Everything it draws is `clay="editor-ui"`, so none of it reaches a saved file or a
 * sync frame. Nothing here is imported by `upload.js` statically: the row and its
 * stylesheet load the first time somebody mounts one, so a document that never
 * uploads never downloads them.
 *
 * The look is a set of `--clay-upload-*` custom properties, each with a default in
 * its own `var()`. A container that sets one — `.journal-drop { --clay-upload-ink:
 * #333 }` — restyles the row without replacing any of its behaviour.
 */

import { canRetry } from "./upload-task.js";

const CSS = `.clay-upload {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--clay-upload-gap, 8px);
  padding: var(--clay-upload-padding, 8px 10px);
  font-family: var(--clay-upload-font, inherit);
  font-size: var(--clay-upload-font-size, 13px);
  line-height: var(--clay-upload-line-height, 1.4);
  color: var(--clay-upload-ink, #171A1F);
  text-align: left;
  background: var(--clay-upload-bg, transparent);
  border: var(--clay-upload-border-width, 0) solid var(--clay-upload-border, #D8D8DE);
  border-radius: var(--clay-upload-radius, 6px);
  box-sizing: border-box;
  max-width: 100%;
}
.clay-upload *, .clay-upload *::before, .clay-upload *::after { box-sizing: border-box; }
.clay-upload__name {
  flex: 1 1 8em;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: var(--clay-upload-name-weight, 500);
  color: var(--clay-upload-ink, #171A1F);
}
.clay-upload__progress {
  flex: 2 1 6em;
  width: auto;
  height: var(--clay-upload-progress-height, 6px);
  margin: 0;
  appearance: none;
  -webkit-appearance: none;
  border: 0;
  border-radius: calc(var(--clay-upload-progress-height, 6px) / 2);
  background: var(--clay-upload-track, rgba(23, 26, 31, .14));
  overflow: hidden;
}
.clay-upload__progress::-webkit-progress-bar { background: var(--clay-upload-track, rgba(23, 26, 31, .14)); }
.clay-upload__progress::-webkit-progress-value { background: var(--clay-upload-fill, #2F6FEB); }
.clay-upload__progress::-moz-progress-bar { background: var(--clay-upload-fill, #2F6FEB); }
.clay-upload__label {
  flex: 0 1 auto;
  font-variant-numeric: tabular-nums;
  color: var(--clay-upload-muted, #5C6069);
}
.clay-upload__status {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
}
.clay-upload__actions { display: flex; flex: none; align-items: center; gap: var(--clay-upload-action-gap, 4px); }
.clay-upload__button {
  min-height: var(--clay-upload-button-height, 28px);
  padding: var(--clay-upload-button-padding, 4px 10px);
  font: inherit;
  font-weight: var(--clay-upload-button-weight, 500);
  color: var(--clay-upload-button-ink, #2F6FEB);
  background: var(--clay-upload-button-bg, transparent);
  border: 1px solid var(--clay-upload-button-border, transparent);
  border-radius: var(--clay-upload-button-radius, 4px);
  cursor: pointer;
  white-space: nowrap;
}
.clay-upload__button:hover { background: var(--clay-upload-button-bg-hover, rgba(47, 111, 235, .1)); }
.clay-upload__button:focus-visible { outline: 2px solid var(--clay-upload-fill, #2F6FEB); outline-offset: 2px; }
.clay-upload__button[hidden] { display: none; }
.clay-upload[data-clay-upload-state="failed"] .clay-upload__label { color: var(--clay-upload-failure-ink, #B3261E); }
@media (pointer: coarse) {
  .clay-upload__button { min-height: var(--clay-upload-button-height, 44px); }
}
@media (prefers-reduced-motion: reduce) {
  .clay-upload__progress { transition: none; }
}
@media (prefers-color-scheme: dark) {
  .clay-upload { color: var(--clay-upload-ink, #E9E9EC); border-color: var(--clay-upload-border, #3A3D45); }
  .clay-upload__name { color: var(--clay-upload-ink, #E9E9EC); }
  .clay-upload__label { color: var(--clay-upload-muted, #A2A6AE); }
  .clay-upload__progress { background: var(--clay-upload-track, rgba(233, 233, 236, .2)); }
  .clay-upload__progress::-webkit-progress-bar { background: var(--clay-upload-track, rgba(233, 233, 236, .2)); }
  .clay-upload__button { color: var(--clay-upload-button-ink, #8AB4FF); }
  .clay-upload[data-clay-upload-state="failed"] .clay-upload__label { color: var(--clay-upload-failure-ink, #FFB4AB); }
}
@media print { .clay-upload { display: none; } }`;

function stylesOnce() {
  if (document.getElementById("clay-upload-style")) return;
  const style = document.createElement("style");
  style.id = "clay-upload-style";
  style.setAttribute("clay", "editor-ui");
  style.textContent = CSS;
  document.head.append(style);
}

function percentOf({ loaded, total, percent }) {
  if (typeof percent === "number") return percent;
  if (typeof total === "number" && total > 0) return Math.round((loaded / total) * 100);
  return null;
}

/**
 * Draw one upload task into a container, and stop when told to.
 *
 * @param {Object} task - from `clay.upload.start`
 * @param {Element|string} container - where the row goes
 * @returns {{unmount: function}}
 */
export function mount(task, container) {
  if (!task || typeof task.subscribe !== "function") {
    throw new TypeError("clay.upload.mount needs an upload task");
  }
  const host = typeof container === "string" ? document.querySelector(container) : container;
  if (!host || host.nodeType !== 1) {
    throw new TypeError("clay.upload.mount needs a container");
  }

  stylesOnce();

  const name = task.file?.name || "File";

  const root = document.createElement("div");
  root.className = "clay-upload";
  root.setAttribute("clay", "editor-ui");
  root.setAttribute("data-clay-upload-state", "uploading");
  root.innerHTML =
    `<span class="clay-upload__name"></span>` +
    `<progress class="clay-upload__progress"></progress>` +
    `<span class="clay-upload__label"></span>` +
    `<span class="clay-upload__status" role="status" aria-live="polite" aria-atomic="true"></span>` +
    `<span class="clay-upload__actions">` +
    `<button type="button" class="clay-upload__button clay-upload__cancel">Cancel</button>` +
    `<button type="button" class="clay-upload__button clay-upload__retry" hidden>Retry</button>` +
    `<button type="button" class="clay-upload__button clay-upload__dismiss">Dismiss</button>` +
    `</span>`;

  const nameEl = root.querySelector(".clay-upload__name");
  const progressEl = root.querySelector(".clay-upload__progress");
  const labelEl = root.querySelector(".clay-upload__label");
  const statusEl = root.querySelector(".clay-upload__status");
  const cancelEl = root.querySelector(".clay-upload__cancel");
  const retryEl = root.querySelector(".clay-upload__retry");
  const dismissEl = root.querySelector(".clay-upload__dismiss");

  nameEl.textContent = name;
  progressEl.setAttribute("aria-label", `Upload progress for ${name}`);

  // The announcement key, not the text: progress events repeat the same state, and a
  // live region that speaks on every byte is unusable. Only a real transition —
  // started, finishing, done, failed, cancelled — changes what it says.
  let announced = null;
  let lastError = null;

  function announce(text) {
    if (text === announced) return;
    announced = text;
    statusEl.textContent = text;
  }

  function draw(snapshot) {
    const { state } = snapshot;
    const uploading = state === "uploading";
    const percent = percentOf(snapshot);
    const finishing = uploading && percent !== null && percent >= 100;

    root.setAttribute("data-clay-upload-state", state);

    if (uploading) {
      // A retry draws a row that was showing a failure a moment ago: the progress
      // element comes back, and the old error must not colour the retry button.
      progressEl.hidden = false;
      lastError = null;
      if (percent === null) {
        progressEl.removeAttribute("value");
        progressEl.removeAttribute("max");
        labelEl.textContent = "Uploading";
      } else {
        progressEl.setAttribute("max", "100");
        progressEl.setAttribute("value", String(percent));
        labelEl.textContent = finishing ? "Finishing upload" : `${percent}%`;
      }
      announce(finishing ? `Finishing upload of ${name}` : `Uploading ${name}`);
    } else {
      const message = snapshot.result?.msg || (state === "succeeded" ? "Uploaded" : state === "cancelled" ? "Upload cancelled" : "Upload failed");
      if (state === "succeeded") {
        progressEl.setAttribute("max", "100");
        progressEl.setAttribute("value", "100");
      } else {
        progressEl.removeAttribute("value");
        progressEl.removeAttribute("max");
      }
      progressEl.hidden = state !== "succeeded";
      labelEl.textContent = message;
      if (state === "failed") {
        lastError = message;
        announce(message);
      } else if (state === "cancelled") {
        lastError = null;
        announce("Upload cancelled");
      } else {
        announce(message);
      }
    }

    cancelEl.hidden = !uploading;
    // Dismissing a running upload would hide it while it still finishes and lands; Cancel is the way out then.
    dismissEl.hidden = uploading;
    retryEl.hidden = !canRetry(snapshot);
    if (!retryEl.hidden) retryEl.setAttribute("aria-label", lastError ? `Retry ${name}: ${lastError}` : `Retry ${name}`);
  }

  function unmount() {
    unsubscribe();
    root.remove();
  }

  cancelEl.addEventListener("click", () => {
    if (cancelEl.hidden) return;
    task.cancel();
  });
  retryEl.addEventListener("click", () => {
    if (retryEl.hidden) return;
    retryEl.hidden = true;
    task.retry();
  });
  dismissEl.addEventListener("click", () => {
    if (dismissEl.hidden) return;
    unmount();
  });

  const unsubscribe = task.subscribe(draw);
  host.append(root);

  return { unmount };
}

export default mount;
