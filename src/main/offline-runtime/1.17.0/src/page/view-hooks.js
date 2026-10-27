import { state } from "../vendor/prosemirror.vendor.js";

// The update hooks a loaded view part registers for its editor view. The plugin
// below calls them on every document change, so a part keeps its blocks fresh
// without the editor importing it: the part adds its hook when it installs and
// removes it on dispose.
export const viewHooks = new WeakMap();

// The feature loader of each mounted editor, so an insert path can ask for a
// block's part before it draws the block.
export const viewFeatures = new WeakMap();

export function addViewHook(view, hook) {
  const hooks = viewHooks.get(view) ?? new Set();
  viewHooks.set(view, hooks);
  hooks.add(hook);
  return () => hooks.delete(hook);
}

export function viewHookPlugin() {
  return new state.Plugin({
    view: (view) => ({
      update: (next) => { for (const hook of viewHooks.get(next) ?? []) hook.update?.(next); },
      destroy: () => {
        const hooks = viewHooks.get(view);
        if (!hooks) return;
        for (const hook of hooks) hook.destroy?.(view);
        hooks.clear();
      },
    }),
  });
}
