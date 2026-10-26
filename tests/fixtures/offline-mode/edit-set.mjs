// The files an edit boot of one document loads from a bundled ClayJS release, read with the
// release's own load plan: node edit-set.mjs <release dir> <plugins query>. Prints the public
// paths as JSON. A switch to edit is a reload into this boot (src/core/edit-mode.js).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [release, query] = process.argv.slice(2);
const load = (path) => import(pathToFileURL(join(release, path)).href);
const { resolveModules } = await load('src/loader-logic.js');
const { BOOT_IMPORTS, EDIT_BOOT_IMPORTS, EDITOR_BOOT_IMPORTS } = await load('src/lib/boot-imports.js');
const { FEATURES } = await load('src/page/features/registry.js');
const manifest = JSON.parse(readFileSync(join(release, 'm/manifest.json'), 'utf8'));
const supplement = (await load(`m/${manifest.edit}`)).default;
const entries = { ...supplement.entries, ...manifest.entries };

const plan = resolveModules(new URLSearchParams(query), true, { isDraftMode: false, hasSap: false, canEdit: true });
const logical = [...plan.core, ...plan.plugins, ...(plan.late ?? [])];
logical.push(...logical.flatMap((path) => BOOT_IMPORTS[path] ?? []), ...EDIT_BOOT_IMPORTS, 'core/mode-lifecycle.js');
if (plan.plugins.includes('plugins/page.js')) {
  logical.push(...EDITOR_BOOT_IMPORTS, ...Object.values(FEATURES).map((feature) => feature.module));
}

const files = new Set(['clay.js', `m/${manifest.edit}`]);
const missing = [];
const stack = [];
for (const path of logical) {
  if (entries[path]) stack.push(entries[path]);
  else missing.push(path);
}
while (stack.length) {
  const file = stack.pop();
  if (files.has(`m/${file}`)) continue;
  files.add(`m/${file}`);
  const entry = manifest.files[file];
  stack.push(...(entry?.imports ?? []), ...(entry?.dynamicImports ?? []));
}
console.log(JSON.stringify({ files: [...files].sort(), missing, plugins: plan.plugins }));
