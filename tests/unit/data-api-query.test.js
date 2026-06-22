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
});
