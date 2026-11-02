// Libraries a document asks for by name, loaded the first time it asks. Each is a module in this
// release, so whichever host serves ClayJS serves them too, offline included.
const ASSETS = {
  overtype: () => import("../vendor/overtype.vendor.js"),
  marked: () => import("../vendor/marked.vendor.js"),
  highlight: () => import("../vendor/highlight.vendor.js"),
  "highlight/bash": () => import("../vendor/hljs-bash.vendor.js"),
  "highlight/css": () => import("../vendor/hljs-css.vendor.js"),
  "highlight/javascript": () => import("../vendor/hljs-javascript.vendor.js"),
  "highlight/json": () => import("../vendor/hljs-json.vendor.js"),
  "highlight/python": () => import("../vendor/hljs-python.vendor.js"),
  "highlight/xml": () => import("../vendor/hljs-xml.vendor.js"),
  uimotion: () => import("./uimotion.js"),
};

export function createAssets(table) {
  const loading = new Map();
  function load(name) {
    if (!Object.hasOwn(table, name)) return Promise.reject(new Error(`clay.assets: no asset named "${name}"`));
    if (!loading.has(name)) {
      loading.set(name, table[name]().catch((error) => {
        loading.delete(name);
        throw error;
      }));
    }
    return loading.get(name);
  }
  return { load, names: () => Object.keys(table) };
}

export const assets = createAssets(ASSETS);
