const fs = require('node:fs');
const path = require('node:path');
const {
  checkPageWriteAdmission, documentEtag, ifMatchSatisfied, PageConversionError
} = require('@panphora/clayjs/server/rooms');
const { createDocument } = require('../../src/main/page-rebase.js');

const version = require('@panphora/clayjs/package.json').version;
const packageRoot = path.dirname(require.resolve('@panphora/clayjs/package.json'));
const fixturePath = path.join(packageRoot, 'tests', 'fixtures', 'offline-runtime', 'page-lineage.json');
console.log('clayjs under test:', version, require.resolve('@panphora/clayjs/server/rooms'));

let hasLineage = true;
try { require.resolve('@panphora/clayjs/src/page/ybind/lineage.js'); } catch { hasLineage = false; }
const maybeDescribe = hasLineage ? describe : describe.skip;
const suiteName = hasLineage
  ? 'page lineage admission over the shared vectors'
  : 'page lineage admission over the shared vectors (skipped until the installed ClayJS ships page lineage)';
if (!hasLineage) console.log('skipped until the installed ClayJS ships page lineage; installed', version);

// A release that ships the lineage rule must ship the vectors it was built
// against: their absence is a packaging fault, not a reason to pass quietly.
function vectors() {
  if (!fs.existsSync(fixturePath)) {
    throw new Error(`@panphora/clayjs ${version} does not ship ${fixturePath}, the page lineage vectors this suite judges`);
  }
  return JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
}

const writes = () => {
  const loaded = vectors();
  return Array.isArray(loaded.writes) ? loaded.writes : [];
};

const currentOf = (name) => {
  const found = writes().find((write) => write.name === name);
  if (!found) throw new Error(`the page lineage vectors have no write named ${name}`);
  return found.current;
};

// The stamp a vector sends: the document's own, the stored article's, or none.
function ifMatchFor(write) {
  if (write.ifMatchOf === 'current') return documentEtag(write.current);
  if (write.ifMatchOf === 'T') return documentEtag(currentOf('seed-only-v1'));
  return undefined;
}

function admit(write) {
  const current = write.current;
  const ifMatch = ifMatchFor(write);
  if (ifMatch !== undefined && !ifMatchSatisfied(ifMatch, current)) return '412';
  try {
    return checkPageWriteAdmission({
      currentHtml: current, html: write.body, ifMatch,
      pageWrite: write.pageWrite ?? null, createDocument
    });
  } catch (error) {
    if (error instanceof PageConversionError) return error.reason;
    throw error;
  }
}

maybeDescribe(suiteName, () => {
  test('the vectors carry cases to judge', () => {
    expect(writes().length).toBeGreaterThan(0);
  });

  test('every write is admitted exactly as the vectors expect', () => {
    const results = writes().map((write) => ({ name: write.name, result: admit(write) }));
    expect(results).toEqual(writes().map((write) => ({ name: write.name, result: write.expect.js })));
  });
});
