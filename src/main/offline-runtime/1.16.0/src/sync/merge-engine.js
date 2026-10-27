let engine = null;
let loading = null;

export const loadedEngine = () => engine;

export function mergeEngine() {
  if (engine) return Promise.resolve(engine);
  loading ??= Promise.all([import("../vendor/hyper-morph.vendor.js"), import("./merge-tags.js")])
    .then(([vendor, tags]) => (engine = { HyperMorph: vendor.HyperMorph, morph: vendor.morph, mergeTagRecognizers: tags.mergeTagRecognizers }))
    .catch((error) => { loading = null; throw error; });
  return loading;
}
