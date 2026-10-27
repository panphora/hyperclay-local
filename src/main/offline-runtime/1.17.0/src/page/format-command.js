// A command that writes a newer page format asks the format gate first. The answer is
// the command's own result when the gate let it apply, or the gate's refusal, so the
// caller writes nothing on a refusal.
export async function runFormatted(view, apply) {
  if (typeof view.runFormatCommand !== "function") return { ok: false, code: "page-format-unsupported" };
  const answer = await view.runFormatCommand(apply);
  if (answer?.status === "applied") return answer.result;
  return { ok: false, code: answer?.code ?? answer?.status ?? "page-format-refused", retry: answer?.retry === true };
}
