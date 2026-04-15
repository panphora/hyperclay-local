const { scopeTailwindLink } = require('../../src/main/utils/tailwind-scoping.js');
const { getTailwindCssName } = require('tailwind-hyperclay');

// Covers the /save handler's tailwindcss URL scoping + implied disk nesting.
// Unit-level because hyperclay-local's /save endpoint is bound to a hardcoded
// port 4321 that collides with a running dev instance; the helper captures the
// scoping logic the handler actually invokes.

describe('scopeTailwindLink — /save tailwindcss URL scoping', () => {
  test('nested site scopes tailwindcss URL to the folder path', () => {
    const input = '<html><head><link data-tailwind rel="stylesheet" href="/tailwindcss/post.css"></head><body></body></html>';
    const scoped = scopeTailwindLink('blog/post.html', input);

    expect(scoped).toContain('href="/tailwindcss/blog/post.css"');
    // getTailwindCssName returns path + baseName (no extension), which path.join
    // in the /save handler then nests under tailwindcss/ on disk.
    expect(getTailwindCssName(scoped)).toBe('blog/post');
  });

  test('deeply nested site scopes tailwindcss URL to the full folder path', () => {
    const input = '<html><head><link data-tailwind rel="stylesheet" href="/tailwindcss/deep.css"></head></html>';
    const scoped = scopeTailwindLink('a/b/c/deep.html', input);

    expect(scoped).toContain('href="/tailwindcss/a/b/c/deep.css"');
    expect(getTailwindCssName(scoped)).toBe('a/b/c/deep');
  });

  test('root site keeps a flat tailwindcss path', () => {
    const input = '<html><head><link data-tailwind rel="stylesheet" href="/tailwindcss/idx.css"></head></html>';
    const scoped = scopeTailwindLink('index.html', input);

    expect(scoped).toContain('href="/tailwindcss/index.css"');
    expect(getTailwindCssName(scoped)).toBe('index');
  });

  test('content without a tailwind link passes through unchanged', () => {
    const input = '<html><head></head><body><p>no tailwind here</p></body></html>';
    expect(scopeTailwindLink('blog/post.html', input)).toBe(input);
  });

  test('.htmlclay extension is handled identically', () => {
    const input = '<html><head><link data-tailwind rel="stylesheet" href="/tailwindcss/notes.css"></head></html>';
    const scoped = scopeTailwindLink('notebooks/notes.htmlclay', input);

    expect(scoped).toContain('href="/tailwindcss/notebooks/notes.css"');
    expect(getTailwindCssName(scoped)).toBe('notebooks/notes');
  });
});
