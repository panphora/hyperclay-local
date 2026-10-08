const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const yauzl = require('yauzl');

const { exportDocumentZip } = require('../../src/main/export-zip');
const { assetsDirFor } = require('../../src/main/server');

function readZip(zipPath) {
  return new Promise((resolve, reject) => {
    const entries = [];
    yauzl.open(zipPath, { lazyEntries: true }, (openError, zip) => {
      if (openError) return reject(openError);
      zip.on('entry', (entry) => {
        if (entry.fileName.endsWith('/')) {
          zip.readEntry();
          return;
        }
        zip.openReadStream(entry, (streamError, stream) => {
          if (streamError) return reject(streamError);
          const chunks = [];
          stream.on('data', (chunk) => chunks.push(chunk));
          stream.on('error', reject);
          stream.on('end', () => {
            entries.push({ name: entry.fileName, content: Buffer.concat(chunks) });
            zip.readEntry();
          });
        });
      });
      zip.on('end', () => resolve(entries));
      zip.on('error', reject);
      zip.readEntry();
    });
  });
}

describe('exporting a document and its assets as a zip', () => {
  let dir;
  let outPath;

  beforeEach(async () => {
    dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'export-zip-')));
    outPath = path.join(dir, 'out.zip');
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });

  test('the document and its assets folder land under one top folder, hidden entries and symlinks left out', async () => {
    const documentPath = path.join(dir, 'board.html');
    const documentBytes = Buffer.from('<!DOCTYPE html><html><body>board</body></html>');
    await fs.writeFile(documentPath, documentBytes);

    const assets = path.join(dir, 'assets-board');
    await fs.mkdir(path.join(assets, 'sub'), { recursive: true });
    await fs.writeFile(path.join(assets, 'photo-abc.png'), Buffer.from('png-bytes'));
    await fs.writeFile(path.join(assets, 'sub', 'x.pdf'), Buffer.from('pdf-bytes'));
    await fs.writeFile(path.join(assets, '.tmp'), Buffer.from('interrupted upload'));
    const outside = path.join(dir, 'outside.txt');
    await fs.writeFile(outside, 'outside');
    await fs.symlink(outside, path.join(assets, 'link'));

    const result = await exportDocumentZip(documentPath, outPath);
    expect(result).toBe(outPath);

    const entries = await readZip(outPath);
    expect(entries.map((entry) => entry.name).sort()).toEqual([
      'board/assets-board/photo-abc.png',
      'board/assets-board/sub/x.pdf',
      'board/board.html',
    ]);
    const byName = Object.fromEntries(entries.map((entry) => [entry.name, entry.content]));
    expect(byName['board/board.html']).toEqual(documentBytes);
    expect(byName['board/assets-board/photo-abc.png'].toString()).toBe('png-bytes');
    expect(byName['board/assets-board/sub/x.pdf'].toString()).toBe('pdf-bytes');

    await expect(fs.access(`${outPath}.part`)).rejects.toThrow();
  });

  test('a document with no assets folder carries only the document', async () => {
    const documentPath = path.join(dir, 'solo.html');
    await fs.writeFile(documentPath, 'solo');

    await exportDocumentZip(documentPath, outPath);

    const entries = await readZip(outPath);
    expect(entries.map((entry) => entry.name)).toEqual(['solo/solo.html']);
  });

  test('an htmlclay document is named after its stem, so it uses assets-doc', async () => {
    const documentPath = path.join(dir, 'doc.htmlclay');
    await fs.writeFile(documentPath, 'clay');
    const assets = path.join(dir, 'assets-doc');
    await fs.mkdir(assets);
    await fs.writeFile(path.join(assets, 'note.txt'), 'note');

    await exportDocumentZip(documentPath, outPath);

    const entries = await readZip(outPath);
    expect(entries.map((entry) => entry.name).sort()).toEqual([
      'doc/assets-doc/note.txt',
      'doc/doc.htmlclay',
    ]);
  });

  test('assetsDirFor names the uploads folder after the document', () => {
    expect(assetsDirFor('board.html')).toBe('assets-board');
  });
});
