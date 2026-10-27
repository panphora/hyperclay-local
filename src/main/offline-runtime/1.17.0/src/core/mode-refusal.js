// What a refused mode change tells the person who asked. A request that was joined,
// superseded or dropped because the page moved on says nothing.
const TEXT = {
  "permission-denied": "You don't have permission to edit this document.",
  "save-failed": "Couldn't save, so this page stays in edit mode.",
  "host-timeout": "The workspace didn't answer, so this page stays as it was.",
};
const QUIET = new Set(["busy", "cancelled"]);

export function modeRefusalText(result) {
  if (!result || result.ok !== false || QUIET.has(result.code)) return null;
  return TEXT[result.code] || result.message || "Couldn't switch modes.";
}
