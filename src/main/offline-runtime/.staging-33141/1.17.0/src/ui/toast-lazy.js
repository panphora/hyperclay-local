// The toast stack is fetched the first time a toast shows, so the page editor does
// not download it to become ready. Calls made before it arrives run in order once it has.
let loading = null;
const load = () => (loading ??= import("./toast.js"));
const later = (name) => (...args) => { load().then((m) => (name ? m[name] : m.default)(...args)); };

export default later(null);
export const toastPersistent = later("toastPersistent");
// Dismissing a toast nobody showed does nothing, so it never fetches the stack: a page
// that tears down without having shown one keeps it unloaded.
export const dismissPersistent = (...args) => { if (loading) later("dismissPersistent")(...args); };
