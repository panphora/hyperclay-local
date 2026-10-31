import { state } from "../vendor/prosemirror.vendor.js";

// The update hooks and decorations a loaded view part registers for its editor
// view. The plugin below calls the hooks on every document change and collects the
// decorations on every draw, so a part keeps its blocks fresh without the editor
// importing it: the part adds its hook when it installs and removes it on dispose.
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
  let editorView = null;
  const mounted = new WeakMap();
  return new state.Plugin({
    view: (view) => {
      editorView = view;
      mounted.set(view, (mounted.get(view) ?? 0) + 1);
      return {
        update: (next) => { for (const hook of viewHooks.get(next) ?? []) hook.update?.(next); },
        destroy: () => {
          mounted.set(view, mounted.get(view) - 1);
          if (editorView === view) editorView = null;
          // A reconfigure destroys this plugin view and mounts a new one for the same editor in
          // the same task; only an editor that stays without one is really going away.
          queueMicrotask(() => {
            if (mounted.get(view)) return;
            const hooks = viewHooks.get(view);
            if (!hooks) return;
            for (const hook of hooks) hook.destroy?.(view);
            hooks.clear();
          });
        },
      };
    },
    props: {
      decorations(st) {
        const hooks = editorView ? viewHooks.get(editorView) : null;
        if (!hooks) return null;
        let found = null;
        for (const hook of hooks) {
          const set = hook.decorations?.(st);
          if (!set) continue;
          found = found ? found.add(st.doc, set.find()) : set;
        }
        return found;
      },
    },
  });
}
