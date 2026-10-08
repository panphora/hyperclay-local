const fs = require('fs');
const fsPromises = require('fs/promises');
const path = require('path');
const yazl = require('yazl');
const { assetsDirFor } = require('./server');

// The document and its uploads folder, under one top folder named after the
// document, so unzipping anywhere gives back a folder whose relative links still
// resolve. Hidden entries (an interrupted upload's temp file) and symlinks are
// left out. The zip is written beside its final name and renamed into place.
async function exportDocumentZip(documentPath, outPath) {
  const stat = await fsPromises.stat(documentPath);
  if (!stat.isFile()) throw new Error('not-a-file');
  const folder = path.basename(assetsDirFor(path.basename(documentPath)));
  const top = folder.slice('assets-'.length);
  const assetsPath = path.join(path.dirname(documentPath), folder);

  const zip = new yazl.ZipFile();
  zip.addFile(documentPath, `${top}/${path.basename(documentPath)}`);
  for (const file of await listAssetFiles(assetsPath)) {
    zip.addFile(path.join(assetsPath, file), `${top}/${folder}/${file.split(path.sep).join('/')}`);
  }
  zip.end();

  const part = `${outPath}.part`;
  await new Promise((resolve, reject) => {
    const out = fs.createWriteStream(part, { flags: 'wx' });
    zip.outputStream.on('error', reject).pipe(out).on('error', reject).on('close', resolve);
  }).catch(async (error) => {
    await fsPromises.rm(part, { force: true });
    throw error;
  });
  await fsPromises.rename(part, outPath);
  return outPath;
}

async function listAssetFiles(root, rel = '') {
  let entries;
  try {
    entries = await fsPromises.readdir(path.join(root, rel), { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT' && rel === '') return [];
    throw error;
  }
  const files = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const child = path.join(rel, entry.name);
    if (entry.isDirectory()) files.push(...await listAssetFiles(root, child));
    else if (entry.isFile()) files.push(child);
  }
  return files.sort();
}

module.exports = { exportDocumentZip };
