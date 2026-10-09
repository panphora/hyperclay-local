jest.mock('../../src/main/utils/data-extractor', () => ({
  extractData: jest.fn(),
  extractViaTag: jest.fn().mockResolvedValue(null),
  parseExtractionRules: jest.fn()
}));

const fsSync = require('fs');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const { Readable } = require('stream');
const yauzl = require('yauzl');
const request = require('supertest');

const { exportDocumentZip, hostUploadRefs } = require('../../src/main/export-zip');
const { assetsDirFor, createApp } = require('../../src/main/server');
const { listenLoopback, closeLoopback } = require('../helpers/loopback');

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

async function partFiles(directory) {
  return (await fs.readdir(directory)).filter((name) => name.endsWith('.part'));
}

describe('exporting a document and its assets as a zip', () => {
  let dir;
  let outPath;

  beforeEach(async () => {
    dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'export-zip-')));
    outPath = path.join(dir, 'out.zip');
  });

  afterEach(async () => {
    jest.restoreAllMocks();
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

  test('a failed export keeps the zip that was already there, and leaves no part file', async () => {
    const documentPath = path.join(dir, 'board.html');
    await fs.writeFile(documentPath, 'board');
    const oldBytes = Buffer.from('the zip from last time');
    await fs.writeFile(outPath, oldBytes);

    const denied = Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' });
    jest.spyOn(fs, 'rename').mockRejectedValue(denied);

    await expect(exportDocumentZip(documentPath, outPath)).rejects.toThrow('EPERM');

    expect(await fs.readFile(outPath)).toEqual(oldBytes);
    expect(await partFiles(dir)).toEqual([]);
  });

  test('an asset that cannot be read rejects instead of hanging, and leaves no part file', async () => {
    const documentPath = path.join(dir, 'board.html');
    await fs.writeFile(documentPath, 'board');
    const assets = path.join(dir, 'assets-board');
    await fs.mkdir(assets);
    const assetPath = path.join(assets, 'photo-abc.png');
    await fs.writeFile(assetPath, 'png-bytes');

    const realCreateReadStream = fsSync.createReadStream;
    jest.spyOn(fsSync, 'createReadStream').mockImplementation((target, options) => {
      if (target !== assetPath) return realCreateReadStream.call(fsSync, target, options);
      const stream = new Readable({ read() {} });
      setImmediate(() => stream.destroy(new Error('asset vanished')));
      return stream;
    });

    const started = Date.now();
    await expect(exportDocumentZip(documentPath, outPath)).rejects.toThrow('asset vanished');
    expect(Date.now() - started).toBeLessThan(2000);

    expect(await partFiles(dir)).toEqual([]);
  });

  test('a part file belonging to another export is left untouched', async () => {
    const documentPath = path.join(dir, 'board.html');
    await fs.writeFile(documentPath, 'board');
    const otherPart = `${outPath}.part`;
    await fs.writeFile(otherPart, 'another export in flight');

    await expect(exportDocumentZip(documentPath, outPath)).resolves.toBe(outPath);

    expect((await fs.readFile(otherPart)).toString()).toBe('another export in flight');
    expect(await partFiles(dir)).toEqual(['out.zip.part']);
  });

  test('a symlinked assets folder is skipped, so nothing outside the folder is packaged', async () => {
    const documentPath = path.join(dir, 'board.html');
    await fs.writeFile(documentPath, 'board');
    const outside = path.join(dir, 'outside');
    await fs.mkdir(outside);
    await fs.writeFile(path.join(outside, 'secret.txt'), 'secret');
    await fs.symlink(outside, path.join(dir, 'assets-board'));

    await exportDocumentZip(documentPath, outPath);

    const entries = await readZip(outPath);
    expect(entries.map((entry) => entry.name)).toEqual(['board/board.html']);
  });

  test('a document that links uploads carries those files and links them relatively', async () => {
    const documentPath = path.join(dir, 'board.html');
    const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff]);
    const text = [
      '<img src="/_/uploads/assets-board/a.png">',
      '<a href="/_/uploads/assets-board/b%20c.pdf">b</a>',
    ].join('\n');
    await fs.writeFile(documentPath, text);
    const uploadsDir = path.join(dir, 'uploads');
    await fs.mkdir(path.join(uploadsDir, 'assets-board'), { recursive: true });
    await fs.writeFile(path.join(uploadsDir, 'assets-board', 'a.png'), pngBytes);
    await fs.writeFile(path.join(uploadsDir, 'assets-board', 'b c.pdf'), 'pdf-bytes');
    const before = await fs.readFile(documentPath);

    const result = await exportDocumentZip(documentPath, outPath, { uploadsDir });
    expect(result).toBe(outPath);

    const entries = await readZip(outPath);
    expect(entries.map((entry) => entry.name).sort()).toEqual([
      'board/board.html',
      'board/uploads/assets-board/a.png',
      'board/uploads/assets-board/b c.pdf',
    ]);
    const byName = Object.fromEntries(entries.map((entry) => [entry.name, entry.content]));
    expect(byName['board/uploads/assets-board/a.png']).toEqual(pngBytes);
    expect(byName['board/uploads/assets-board/b c.pdf'].toString()).toBe('pdf-bytes');

    const zipped = byName['board/board.html'].toString();
    expect(zipped).toContain('src="uploads/assets-board/a.png"');
    expect(zipped).toContain('href="uploads/assets-board/b%20c.pdf"');
    expect(zipped).not.toContain('/_/uploads/');

    expect(await fs.readFile(documentPath)).toEqual(before);
  });

  test('an upload linked twice lands in the zip once', async () => {
    const documentPath = path.join(dir, 'board.html');
    await fs.writeFile(documentPath, '<img src="/_/uploads/assets-board/a.png"><img src="/_/uploads/assets-board/a.png">');
    const uploadsDir = path.join(dir, 'uploads');
    await fs.mkdir(path.join(uploadsDir, 'assets-board'), { recursive: true });
    await fs.writeFile(path.join(uploadsDir, 'assets-board', 'a.png'), 'png-bytes');

    await exportDocumentZip(documentPath, outPath, { uploadsDir });

    const entries = await readZip(outPath);
    expect(entries.map((entry) => entry.name).sort()).toEqual([
      'board/board.html',
      'board/uploads/assets-board/a.png',
    ]);
    expect(entries.find((entry) => entry.name === 'board/board.html').content.toString()).toBe(
      '<img src="uploads/assets-board/a.png"><img src="uploads/assets-board/a.png">'
    );
  });

  test('a host path on another site is left alone', async () => {
    const documentPath = path.join(dir, 'board.html');
    const text = '<img src="https://x.hyperclay.com/_/uploads/assets-board/a.png">';
    await fs.writeFile(documentPath, text);
    const uploadsDir = path.join(dir, 'uploads');
    await fs.mkdir(path.join(uploadsDir, 'assets-board'), { recursive: true });
    await fs.writeFile(path.join(uploadsDir, 'assets-board', 'a.png'), 'png-bytes');

    await exportDocumentZip(documentPath, outPath, { uploadsDir });

    const entries = await readZip(outPath);
    expect(entries.map((entry) => entry.name)).toEqual(['board/board.html']);
    expect(entries[0].content).toEqual(Buffer.from(text));
  });

  test('a traversal, a symlink out of uploads and a missing file add nothing outside uploads', async () => {
    const documentPath = path.join(dir, 'board.html');
    const text = [
      '<img src="/_/uploads/../secret.txt">',
      '<img src="/_/uploads/assets-board/%2e%2e/x">',
      '<img src="/_/uploads/assets-board/escape.txt">',
      '<img src="/_/uploads/assets-board/gone.png">',
    ].join('\n');
    await fs.writeFile(documentPath, text);
    await fs.writeFile(path.join(dir, 'secret.txt'), 'secret');
    const uploadsDir = path.join(dir, 'uploads');
    await fs.mkdir(path.join(uploadsDir, 'assets-board'), { recursive: true });
    await fs.symlink(path.join(dir, 'secret.txt'), path.join(uploadsDir, 'assets-board', 'escape.txt'));
    const logged = jest.spyOn(console, 'log').mockImplementation(() => {});

    await expect(exportDocumentZip(documentPath, outPath, { uploadsDir })).resolves.toBe(outPath);

    const entries = await readZip(outPath);
    expect(entries.map((entry) => entry.name)).toEqual(['board/board.html']);
    const zipped = entries[0].content.toString();
    expect(zipped).toContain('/_/uploads/../secret.txt');
    expect(zipped).toContain('/_/uploads/assets-board/%2e%2e/x');
    expect(logged).toHaveBeenCalledWith('[export] 2 linked uploads were not found');
  });

  test('a document with no host path exports byte-identical', async () => {
    const documentPath = path.join(dir, 'solo.html');
    const bytes = Buffer.from('<img src="https://example.com/pic.png"><a href="assets-solo/x.png">x</a>');
    await fs.writeFile(documentPath, bytes);
    const uploadsDir = path.join(dir, 'uploads');
    await fs.mkdir(path.join(uploadsDir, 'assets-board'), { recursive: true });
    await fs.writeFile(path.join(uploadsDir, 'assets-board', 'a.png'), 'png-bytes');

    await exportDocumentZip(documentPath, outPath, { uploadsDir });

    const entries = await readZip(outPath);
    expect(entries.map((entry) => entry.name)).toEqual(['solo/solo.html']);
    expect(entries[0].content).toEqual(bytes);
  });
});

// The link a document carries comes from the upload route, so the round trip runs
// through the real endpoint: upload, link the url that came back, export.
describe('exporting a document that links an answered upload url', () => {
  let dir;
  let app;
  let outPath;

  beforeEach(async () => {
    dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'export-zip-roundtrip-')));
    outPath = path.join(dir, 'out.zip');
    jest.spyOn(console, 'log').mockImplementation(() => {});
    app = await listenLoopback(createApp(dir));
    await fs.writeFile(path.join(dir, 'board.html'), '<html>board</html>');
  });

  afterEach(async () => {
    await closeLoopback();
    jest.restoreAllMocks();
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });

  test('a name with the characters encodeURIComponent leaves raw is packaged whole', async () => {
    const bytes = Buffer.from('PNGDATA');
    const res = await request(app)
      .post('/_/upload')
      .set('Host', 'localhost')
      .set('Origin', 'http://localhost:4321')
      .set('Document-URL', 'http://localhost/board.html')
      .attach('file', bytes, "image (1)'s!*.png");
    expect(res.status).toBe(200);
    const [file] = res.body.uploads;
    expect(file.url.split('/').pop()).not.toMatch(/[!'()*]/);

    const documentPath = path.join(dir, 'board.html');
    await fs.writeFile(documentPath, `<img src="${file.url}">`);

    await exportDocumentZip(documentPath, outPath, { uploadsDir: path.join(dir, 'uploads') });

    const entries = await readZip(outPath);
    const inside = `board/uploads/assets-board/${file.name}`;
    expect(entries.map((entry) => entry.name).sort()).toEqual(['board/board.html', inside]);
    const byName = Object.fromEntries(entries.map((entry) => [entry.name, entry.content]));
    expect(byName[inside]).toEqual(bytes);
    expect(byName['board/board.html'].toString()).toBe(`<img src="uploads/assets-board/${file.url.split('/').pop()}">`);
  });
});

describe('finding the host upload paths in a document', () => {
  const found = (text) => hostUploadRefs(text).map((ref) => ({ text: text.slice(ref.start, ref.end), segments: ref.segments }));
  const ref = { text: '/_/uploads/assets-board/a.png', segments: ['assets-board', 'a.png'] };

  test('a reference is free on the left and stops at the first character that is not part of a path', () => {
    expect(found('/_/uploads/assets-board/a.png')).toEqual([ref]);
    expect(found('src=/_/uploads/assets-board/a.png')).toEqual([ref]);
    for (const stop of ['"', "'", ')', ' ', '?', '#']) {
      expect(found(`/_/uploads/assets-board/a.png${stop}tail`)).toEqual([ref]);
    }
  });

  test('a reference inside a longer token belongs to that host', () => {
    expect(hostUploadRefs('https://x.hyperclay.com/_/uploads/assets-board/a.png')).toEqual([]);
    expect(hostUploadRefs('x./_/uploads/assets-board/a.png')).toEqual([]);
    expect(hostUploadRefs('%/_/uploads/assets-board/a.png')).toEqual([]);
  });

  test('a reference names at least two plain segments, decoded once each', () => {
    expect(hostUploadRefs('/_/uploads/a.png')).toEqual([]);
    expect(hostUploadRefs('/_/uploads/')).toEqual([]);
    expect(hostUploadRefs('/_/uploads/../secret.txt')).toEqual([]);
    expect(hostUploadRefs('/_/uploads/assets-board/%2e%2e/x')).toEqual([]);
    expect(hostUploadRefs('/_/uploads/assets-board/.hidden')).toEqual([]);
    expect(hostUploadRefs('/_/uploads/assets-board/%2fetc')).toEqual([]);
    expect(hostUploadRefs('/_/uploads/assets-board/%')).toEqual([]);
    expect(found('/_/uploads/assets-board/b%20c.pdf')).toEqual([
      { text: '/_/uploads/assets-board/b%20c.pdf', segments: ['assets-board', 'b c.pdf'] },
    ]);
  });
});
