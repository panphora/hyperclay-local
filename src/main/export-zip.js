const fs = require('fs');
const fsPromises = require('fs/promises');
const path = require('path');
const yazl = require('yazl');
const { assetsDirFor } = require('./server');

// Where a document links an upload, and the characters a link is made of.
// hyperclay.com finds its references with the same rule, so both sides agree on
// where a reference starts and ends.
const HOST_UPLOAD_PREFIX = '/_/uploads/';
const REF_CHAR = /[A-Za-z0-9._~%/-]/;

// Every host path in the text: an occurrence of `/_/uploads/` that does not sit
// inside a longer token (`https://elsewhere/_/uploads/` names another host's
// file, not this root's) and that extends right over path characters only.
// Decoding happens per segment, so an escaped `%2e%2e` is seen as the `..` it is.
function hostUploadRefs(text) {
  const refs = [];
  let from = 0;
  for (;;) {
    const start = text.indexOf(HOST_UPLOAD_PREFIX, from);
    if (start === -1) break;
    from = start + HOST_UPLOAD_PREFIX.length;
    if (start > 0 && REF_CHAR.test(text[start - 1])) continue;
    let end = from;
    while (end < text.length && REF_CHAR.test(text[end])) end += 1;
    const segments = uploadSegments(text.slice(from, end));
    if (segments) refs.push({ start, end, segments });
  }
  return refs;
}

// The segments a reference names, or null when it does not name a plain path
// inside `uploads/`: at least two segments, no empties, no dot segments, and no
// separator smuggled in through an escape.
function uploadSegments(ref) {
  const parts = ref.split('/');
  if (parts.length < 2) return null;
  const segments = [];
  for (const part of parts) {
    let segment;
    try {
      segment = decodeURIComponent(part);
    } catch (error) {
      return null;
    }
    if (!segment || segment === '.' || segment === '..' || segment.startsWith('.') || segment.includes('/') || segment.includes('\\')) return null;
    segments.push(segment);
  }
  return segments;
}

// The document and its uploads folder, under one top folder named after the
// document, so unzipping anywhere gives back a folder whose relative links still
// resolve. Hidden entries (an interrupted upload's temp file) and symlinks are
// left out. The zip is written beside its final name and renamed into place.
async function exportDocumentZip(documentPath, outPath, { uploadsDir } = {}) {
  const stat = await fsPromises.stat(documentPath);
  if (!stat.isFile()) throw new Error('not-a-file');
  const folder = path.basename(assetsDirFor(path.basename(documentPath)));
  const top = folder.slice('assets-'.length);
  const assetsPath = path.join(path.dirname(documentPath), folder);
  const assets = await assetsFolderIsReal(assetsPath) ? await listAssetFiles(assetsPath) : [];
  const linked = await linkedUploads(await fsPromises.readFile(documentPath), uploadsDir);

  // A name only this call uses, so two exports to the same place never remove
  // each other's work, and a failure removes only what this call wrote.
  const part = `${outPath}.${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.part`;
  const zip = new yazl.ZipFile();
  try {
    await new Promise((resolve, reject) => {
      zip.on('error', reject);
      const out = fs.createWriteStream(part, { flags: 'wx' });
      out.on('error', reject).on('close', resolve);
      zip.outputStream.on('error', reject).pipe(out);
      // A document that links uploads is packaged from the rewritten text, so the
      // copy in the zip reaches its files relatively and opens anywhere. The file
      // on disk is only ever read. A document with no such link keeps its bytes.
      if (linked.text === null) zip.addFile(documentPath, `${top}/${path.basename(documentPath)}`);
      else zip.addBuffer(Buffer.from(linked.text, 'utf8'), `${top}/${path.basename(documentPath)}`);
      for (const file of assets) {
        zip.addFile(path.join(assetsPath, file), `${top}/${folder}/${file.split(path.sep).join('/')}`);
      }
      for (const file of linked.files) {
        zip.addFile(file.source, `${top}/${uploadsRelPath(file.segments)}`);
      }
      zip.end();
    });
    await fsPromises.rename(part, outPath);
  } catch (error) {
    zip.outputStream.unpipe();
    await fsPromises.rm(part, { force: true });
    throw error;
  }
  if (linked.missing) console.log(`[export] ${linked.missing} linked uploads were not found`);
  return outPath;
}

function uploadsRelPath(segments) {
  return `uploads/${segments.join('/')}`;
}

// The uploads a document links, the text to package it as, and how many links had
// nothing to package. A link that is missing or refused is left out and counted:
// one broken link never costs the whole export.
async function linkedUploads(documentBytes, uploadsDir) {
  const text = documentBytes.toString('utf8');
  const refs = hostUploadRefs(text);
  if (!refs.length) return { text: null, files: [], missing: 0 };
  const realUploadsDir = await realUploadsFolder(uploadsDir);
  const files = [];
  const seen = new Set();
  let missing = 0;
  for (const ref of refs) {
    const key = uploadsRelPath(ref.segments);
    if (seen.has(key)) continue;
    seen.add(key);
    const source = await uploadFileFor(uploadsDir, realUploadsDir, ref.segments);
    if (source) files.push({ segments: ref.segments, source });
    else missing += 1;
  }
  return { text: relativeUploadLinks(text, refs), files, missing };
}

// The text with the host prefix of every accepted reference replaced by the
// relative one, so the link resolves from the document, which is where the zip
// puts both. The segments themselves are left as written.
function relativeUploadLinks(text, refs) {
  let result = '';
  let cursor = 0;
  for (const ref of refs) {
    result += text.slice(cursor, ref.start) + 'uploads/' + text.slice(ref.start + HOST_UPLOAD_PREFIX.length, ref.end);
    cursor = ref.end;
  }
  return result + text.slice(cursor);
}

async function realUploadsFolder(uploadsDir) {
  if (!uploadsDir) return null;
  try {
    return await fsPromises.realpath(uploadsDir);
  } catch (error) {
    return null;
  }
}

// A regular file inside `uploads/`, never a symlink and never a path that leaves
// the folder, or null when there is no such file.
async function uploadFileFor(uploadsDir, realUploadsDir, segments) {
  if (!realUploadsDir) return null;
  const candidate = path.join(uploadsDir, ...segments);
  try {
    const real = await fsPromises.realpath(candidate);
    const prefix = realUploadsDir.endsWith(path.sep) ? realUploadsDir : `${realUploadsDir}${path.sep}`;
    if (real !== realUploadsDir && !real.startsWith(prefix)) return null;
    if (!(await fsPromises.lstat(candidate)).isFile()) return null;
    return candidate;
  } catch (error) {
    return null;
  }
}

// The assets folder itself must be a real folder, not a link to somewhere else:
// export packages what sits beside the document, nothing more.
async function assetsFolderIsReal(assetsPath) {
  try {
    return (await fsPromises.lstat(assetsPath)).isDirectory();
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
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

module.exports = { exportDocumentZip, hostUploadRefs };
