import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(repo, '../hyperclay/public-assets/core-apps');
const destination = join(repo, 'src/main/document-templates');
const ids = ['page', 'blank', 'devlog', 'kanban', 'landing'];

await mkdir(destination, { recursive: true });
const manifest = [];
for (const id of ids) {
  const file = `${id}.html`;
  const bytes = await readFile(join(source, file));
  await writeFile(join(destination, file), bytes);
  manifest.push({ id, file, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
}
await writeFile(join(destination, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
