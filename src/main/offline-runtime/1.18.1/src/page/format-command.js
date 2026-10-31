import { announce } from "./announce.js";
import toast from "../ui/toast-lazy.js";

// A refusal the person cannot see is the same as a command that did nothing, so the
// gate's "no" is said out loud. Only the gate's own refusal: a command the gate let
// through reports its own result to its caller.
const UNSUPPORTED = new Set(["page-format-unsupported", "unsupported-host"]);
const UNSUPPORTED_TEXT = "This host can't store that yet, so nothing was added.";
const RETRY_TEXT = "That didn't go through. Try again.";
const REFUSED_TEXT = "That couldn't be added here.";

function say(view, answer) {
  const text = answer?.status === "upgrade-required" && answer.message ? answer.message
    : UNSUPPORTED.has(answer?.code) || UNSUPPORTED.has(answer?.status) ? UNSUPPORTED_TEXT
    : answer?.retry === true ? RETRY_TEXT : REFUSED_TEXT;
  if (view.isDestroyed) return;
  announce(view, text);
  toast(text, "error");
}

// A command that writes a newer page format asks the format gate first. The answer is
// the command's own result when the gate let it apply, or the gate's refusal, so the
// caller writes nothing on a refusal.
export async function runFormatted(view, apply) {
  if (typeof view.runFormatCommand !== "function") {
    say(view, { code: "page-format-unsupported" });
    return { ok: false, code: "page-format-unsupported" };
  }
  const answer = await view.runFormatCommand(apply);
  if (answer?.status === "applied") return answer.result;
  say(view, answer);
  return { ok: false, code: answer?.code ?? answer?.status ?? "page-format-refused", retry: answer?.retry === true };
}
