const { stripSystemRouteMarker } = require('../../src/main/server.js');

// The local Express server forwards `/_/`-prefixed requests to the bare route so
// URLs emitted by newer hyperclayjs (`/_/save`, `/_/live-sync/*`) resolve to the
// same handlers, while older apps emitting bare URLs keep working.
describe('stripSystemRouteMarker — /_/ forwarding for the local server', () => {
  test('strips the marker for save', () => {
    expect(stripSystemRouteMarker('/_/save')).toBe('/save');
  });

  test('strips the marker for live-sync routes, preserving the query string', () => {
    expect(stripSystemRouteMarker('/_/live-sync/stream?page-url=/blog/post.html'))
      .toBe('/live-sync/stream?page-url=/blog/post.html');
    expect(stripSystemRouteMarker('/_/live-sync/save')).toBe('/live-sync/save');
  });

  test('leaves bare routes unchanged (old clients still work)', () => {
    expect(stripSystemRouteMarker('/save')).toBe('/save');
    expect(stripSystemRouteMarker('/live-sync/stream?page-url=/x.html'))
      .toBe('/live-sync/stream?page-url=/x.html');
    expect(stripSystemRouteMarker('/f/index.html')).toBe('/f/index.html');
    expect(stripSystemRouteMarker('/')).toBe('/');
  });

  test('only strips a full `/_/` prefix, not paths that merely start with `_`', () => {
    expect(stripSystemRouteMarker('/_foo')).toBe('/_foo');
    expect(stripSystemRouteMarker('/_')).toBe('/_');
    expect(stripSystemRouteMarker('/file_with_underscore.html')).toBe('/file_with_underscore.html');
  });
});
