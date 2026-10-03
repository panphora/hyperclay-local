const fs = require('fs').promises;
const path = require('path');
const os = require('os');

jest.mock('../../src/main/utils/data-extractor', () => ({
  extractData: jest.fn(),
  extractViaTag: jest.fn(),
  parseExtractionRules: jest.fn()
}));

const { extractData, parseExtractionRules } = require('../../src/main/utils/data-extractor');
const { extractSiteDataLocal } = require('../../src/main/utils/data-api');
const { documentEtag } = require('../../src/main/spec-wire');

describe('extractSiteDataLocal (?data=)', () => {
  let dir;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'api-query-'));
    extractData.mockReset();
    parseExtractionRules.mockReset();
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  const writeSite = (name, html) => fs.writeFile(path.join(dir, name), html);

  test('happy path → 200 JSON', async () => {
    await writeSite('index.html', '<html><h1>Hi</h1></html>');
    parseExtractionRules.mockResolvedValue({ title: 'h1' });
    extractData.mockResolvedValue({ title: 'Hi' });
    const r = await extractSiteDataLocal(dir, 'index.html', '{title:"h1"}');
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ title: 'Hi' });
  });

  test('present-but-empty data param → 400 with example', async () => {
    const r = await extractSiteDataLocal(dir, 'index.html', '');
    expect(r.status).toBe(400);
    expect(r.json.error).toBe('Missing data parameter');
    expect(r.json.example).toBeDefined();
  });

  test('source file missing → 404', async () => {
    const r = await extractSiteDataLocal(dir, 'nope.html', '{title:"h1"}');
    expect(r.status).toBe(404);
    expect(r.json.error).toBe('Site content not found');
  });

  test('JSON parse error → 400 "Invalid extraction rules"', async () => {
    await writeSite('index.html', '<html></html>');
    parseExtractionRules.mockRejectedValue(new Error('Unexpected token in JSON'));
    const r = await extractSiteDataLocal(dir, 'index.html', '{bad');
    expect(r.status).toBe(400);
    expect(r.json.error).toBe('Invalid extraction rules');
  });

  test('selector error → 400 "Invalid CSS selector"', async () => {
    await writeSite('index.html', '<html></html>');
    parseExtractionRules.mockResolvedValue({ x: ':::' });
    extractData.mockRejectedValue(new Error('invalid selector :::'));
    const r = await extractSiteDataLocal(dir, 'index.html', '{x:":::"}');
    expect(r.status).toBe(400);
    expect(r.json.error).toBe('Invalid CSS selector');
  });

  // The relaxed parser reports its own syntax failures as RulesParseError and its
  // message never contains "JSON", so the name is what has to catch them.
  test('a named RulesParseError → 400 even when the message does not say JSON', async () => {
    await writeSite('index.html', '<html></html>');
    parseExtractionRules.mockRejectedValue(
      Object.assign(new Error('Invalid extraction rules syntax: Unexpected token }'), { name: 'RulesParseError' })
    );
    const r = await extractSiteDataLocal(dir, 'index.html', '{bad}');
    expect(r.status).toBe(400);
    expect(r.json.error).toBe('Invalid extraction rules');
    expect(r.json.details).toContain('Invalid extraction rules syntax');
    expect(r.json.example).toBeDefined();
  });

  test('an unmapped extraction failure keeps the 500 shape', async () => {
    await writeSite('index.html', '<html></html>');
    parseExtractionRules.mockResolvedValue({ x: 'body' });
    extractData.mockRejectedValue(Object.assign(new Error('boom'), { name: 'TypeError' }));
    const r = await extractSiteDataLocal(dir, 'index.html', '{x:"body"}');
    expect(r.status).toBe(500);
    expect(r.json.error).toBe('Extraction failed');
  });

  // Repeated parameters arrive as an array; the success path must never see one.
  test('repeated ?data= parameters are a 400, not a guess', async () => {
    const r = await extractSiteDataLocal(dir, 'index.html', ['{title:"h1"}', '{title:"h2"}']);
    expect(r.status).toBe(400);
    expect(r.json.error).toBe('Invalid extraction rules');
    expect(parseExtractionRules).not.toHaveBeenCalled();
  });

  test('the ETag covers the stored bytes, not a re-encoded copy of them', async () => {
    // 0xFF is not valid UTF-8, so a stamp taken over the decoded string would name
    // bytes that are not on disk — and a caller could never If-Match them back.
    const bytes = Buffer.concat([
      Buffer.from('<html><h1>Hi</h1>', 'utf8'),
      Buffer.from([0xff]),
      Buffer.from('</html>', 'utf8')
    ]);
    await fs.writeFile(path.join(dir, 'index.html'), bytes);
    parseExtractionRules.mockResolvedValue({ title: 'h1' });
    extractData.mockResolvedValue({ title: 'Hi' });

    const r = await extractSiteDataLocal(dir, 'index.html', '{title:"h1"}');

    expect(r.status).toBe(200);
    expect(r.headers.ETag).toBe(documentEtag(bytes));
    expect(r.headers.ETag).not.toBe(documentEtag(Buffer.from(bytes.toString('utf8'), 'utf8')));
    expect(extractData).toHaveBeenCalledWith(bytes.toString('utf8'), { title: 'h1' });
  });
});
