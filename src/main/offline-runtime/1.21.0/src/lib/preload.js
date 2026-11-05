// A reader fetched only the manifest; an editable page also fetched the supplement.
// Both are hint lists, so a boot holding one still runs and defers the other's hints.
export function mergeManifests(manifest, supplement) {
  if (!manifest || !supplement) return manifest;
  const both = { ...supplement, ...manifest };
  for (const key of ["entries", "imports", "bootImports"]) both[key] = { ...supplement[key], ...manifest[key] };
  return both;
}

// The chunked build's files that a boot plan will import, fetched in parallel before
// boot() imports them one at a time in its load-bearing order. clay="no-save" keeps
// the links out of every save and out of live sync's merge.
const PAGE_PLUGIN = "plugins/page.js";

export function preloadEntries(manifest, paths, { isEditMode = false, isDraftMode = false, hasSapJs = false } = {}, doc = document) {
  if (!manifest?.entries) return 0;
  const seeds = [...paths];
  for (const path of paths) {
    for (const file of manifest.bootImports?.[path] ?? []) {
      if (hasSapJs && file === "vendor/sap-core.vendor.js") continue;
      seeds.push(file);
    }
  }
  if (isEditMode && !isDraftMode) seeds.push(...(manifest.editBootImports ?? []));
  // The editor is fetched beside the room join, so a plan that runs the page plugin
  // preloads it and another template's edit boot does not.
  if (isEditMode && !isDraftMode && paths.includes(PAGE_PLUGIN)) seeds.push(...(manifest.editorBootImports ?? []));
  const want = new Set();
  const add = (file) => {
    if (!file || want.has(file)) return;
    want.add(file);
    for (const dep of manifest.imports?.[file] ?? []) add(dep);
  };
  for (const p of seeds) add(manifest.entries[p]);
  const have = new Set([...doc.querySelectorAll('link[rel="modulepreload"]')].map((link) => link.href));
  let added = 0;
  for (const file of want) {
    const href = new URL(file, manifest.base).href;
    if (have.has(href)) continue;
    const link = doc.createElement("link");
    link.rel = "modulepreload";
    link.href = href;
    link.setAttribute("clay", "no-save");
    doc.head.append(link);
    added++;
  }
  return added;
}
