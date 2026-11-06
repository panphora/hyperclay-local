// The checklist's keys: `Mod-Shift-o` and `Mod-Shift-d` open an item's owner and
// due popovers. The controls are a decoration the view part draws and opens, so
// this asks the parts it finds for a loaded editor and stays out of the rest.
import { state } from "../vendor/prosemirror.vendor.js";
import { viewHooks } from "./view-hooks.js";

export const checklistKeys = new state.Plugin({
  props: {
    handleKeyDown(view, event) {
      if (!(event.metaKey || event.ctrlKey) || !event.shiftKey || event.altKey) return false;
      const name = event.key.toLowerCase() === "o" ? "owner" : event.key.toLowerCase() === "d" ? "date" : null;
      if (!name) return false;
      if (view.dom.getAttribute(name === "owner" ? "data-assignees" : "data-dates") === "false") return false;
      for (const hook of viewHooks.get(view) ?? []) if (hook.focusControl?.(view, name)) return true;
      return false;
    },
  },
});
