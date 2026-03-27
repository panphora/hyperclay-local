const { resolveResourceFromHref, validateAndResolvePath } = require('../../src/main/server');
const path = require('path');
const os = require('os');

const baseDir = path.join(os.tmpdir(), 'url-routing-test');

describe('resolveResourceFromHref', () => {
  test('root resolves to index.html', () => {
    expect(resolveResourceFromHref('http://localhost:4321/')).toBe('index.html');
  });

  test('extension-based URLs return file path with extension', () => {
    expect(resolveResourceFromHref('http://localhost:4321/app.html')).toBe('app.html');
    expect(resolveResourceFromHref('http://localhost:4321/notes.htmlclay')).toBe('notes.htmlclay');
    expect(resolveResourceFromHref('http://localhost:4321/blog/post.html')).toBe('blog/post.html');
  });

  test('SPA suffixes are stripped', () => {
    expect(resolveResourceFromHref('http://localhost:4321/app.html/dashboard')).toBe('app.html');
    expect(resolveResourceFromHref('http://localhost:4321/blog/app.htmlclay/settings/profile')).toBe('blog/app.htmlclay');
  });

  test('directory paths return as-is (not resolvable for saves)', () => {
    expect(resolveResourceFromHref('http://localhost:4321/blog')).toBe('blog');
    expect(resolveResourceFromHref('http://localhost:4321/blog/')).toBe('blog/');
  });
});

describe('validateAndResolvePath', () => {
  test('accepts .html files', () => {
    const result = validateAndResolvePath('app.html', baseDir);
    expect(result.error).toBeUndefined();
  });

  test('accepts .htmlclay files', () => {
    const result = validateAndResolvePath('notes.htmlclay', baseDir);
    expect(result.error).toBeUndefined();
  });

  test('rejects extensionless names', () => {
    const result = validateAndResolvePath('blog', baseDir);
    expect(result.error).toBe('Invalid file path');
  });

  test('rejects trailing-slash directory paths', () => {
    const result = validateAndResolvePath('blog/', baseDir);
    expect(result.error).toBe('Invalid file path');
  });
});

describe('directory listing policy', () => {
  test('directory URLs are not saveable — resolves to extensionless name that fails validation', () => {
    const name = resolveResourceFromHref('http://localhost:4321/blog');
    const result = validateAndResolvePath(name, baseDir);
    expect(result.error).toBeDefined();
  });

  test('trailing-slash URLs are not saveable', () => {
    const name = resolveResourceFromHref('http://localhost:4321/blog/');
    const result = validateAndResolvePath(name, baseDir);
    expect(result.error).toBeDefined();
  });

  test('explicit file URLs are saveable', () => {
    const name = resolveResourceFromHref('http://localhost:4321/blog/index.html');
    const result = validateAndResolvePath(name, baseDir);
    expect(result.error).toBeUndefined();
  });
});
