const fs = require('fs').promises;
const path = require('upath');

async function exists(target) {
  try {
    await fs.stat(target);
    return true;
  } catch {
    return false;
  }
}

function copyCandidate(stem, extension, index) {
  return index > 1 ? `${stem}-copy-${index}${extension}` : `${stem}-copy${extension}`;
}

function zipCandidate(stem, index) {
  return index > 1 ? `${stem} ${index}.zip` : `${stem}.zip`;
}

async function freeCopyName(dir, source, has = exists) {
  const extension = path.extname(source);
  const stem = extension ? source.slice(0, -extension.length) : source;
  for (let index = 1; ; index += 1) {
    const candidate = copyCandidate(stem, extension, index);
    if (!(await has(path.join(dir, candidate)))) return candidate;
  }
}

async function freeZipName(dir, stem, has = exists) {
  for (let index = 1; ; index += 1) {
    const candidate = zipCandidate(stem, index);
    if (!(await has(path.join(dir, candidate)))) return candidate;
  }
}

module.exports = { freeCopyName, freeZipName };
