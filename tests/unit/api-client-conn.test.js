/**
 * api-client: every request is built from one connection object
 * ({ serverUrl, syncBase, apiKey, accountId, protocol }).
 */

const apiClient = require('../../src/sync-engine/api-client');

describe('syncUrl', () => {
  test('builds serverUrl + syncBase + suffix', () => {
    expect(apiClient.syncUrl({ serverUrl: 'http://test' }, '/nodes'))
      .toBe('http://test/_/sync/nodes');
    expect(apiClient.syncUrl({ serverUrl: 'http://test', syncBase: '/_/sync' }, '/nodes/42/content'))
      .toBe('http://test/_/sync/nodes/42/content');
  });

  test('accepts a team sync base', () => {
    expect(apiClient.syncUrl({ serverUrl: 'http://test', syncBase: '/_/team/acme/sync' }, '/nodes'))
      .toBe('http://test/_/team/acme/sync/nodes');
  });

  test.each([
    'https://evil/_/sync',
    '/_/../sync',
    '//x',
  ])('refuses the base %s', (syncBase) => {
    expect(() => apiClient.syncUrl({ serverUrl: 'http://test', syncBase }, '/nodes'))
      .toThrow(/Refusing sync base/);
  });
});

describe('authHeaders', () => {
  test('protocol 1 sends only X-API-Key', () => {
    expect(apiClient.authHeaders({ apiKey: 'k', protocol: 1 }))
      .toEqual({ 'X-API-Key': 'k' });
  });

  test('protocol 2 adds X-Sync-Protocol and X-Sync-Account-ID', () => {
    expect(apiClient.authHeaders({ apiKey: 'k', protocol: 2, accountId: 7 }))
      .toEqual({ 'X-API-Key': 'k', 'X-Sync-Protocol': '2', 'X-Sync-Account-ID': '7' });
  });
});

describe('requests through the connection object', () => {
  test('listNodes of a protocol 1 connection sends /_/sync/nodes with only X-API-Key', async () => {
    const originalFetch = global.fetch;
    const fetchMock = jest.fn(async () => ({ ok: true, json: async () => ({ nodes: [] }) }));
    global.fetch = fetchMock;
    try {
      await apiClient.listNodes({ serverUrl: 'http://test', syncBase: '/_/sync', apiKey: 'k', protocol: 1 });
    } finally {
      global.fetch = originalFetch;
    }

    expect(fetchMock).toHaveBeenCalledWith('http://test/_/sync/nodes', {
      headers: { 'X-API-Key': 'k' }
    });
  });

  test('createNode returns the response\'s etag, checksum and structureVersion', async () => {
    const originalFetch = global.fetch;
    const conn = { serverUrl: 'http://test', syncBase: '/_/sync', apiKey: 'k', protocol: 1 };
    const fetchMock = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        node: { id: 901, type: 'site', name: 'a.html', parentId: 0, path: '' },
        etag: '3f9a0c1d2b4e5f60',
        checksum: '3f9a0c1d2b4e5f60',
        structureVersion: 'st1'
      })
    }));
    global.fetch = fetchMock;

    let created;
    try {
      created = await apiClient.createNode(conn, { type: 'site', name: 'a.html', parentId: 0, content: '<h1>a</h1>' });
    } finally {
      global.fetch = originalFetch;
    }

    expect(created).toEqual({
      id: 901,
      type: 'site',
      name: 'a.html',
      parentId: 0,
      path: '',
      etag: '3f9a0c1d2b4e5f60',
      checksum: '3f9a0c1d2b4e5f60',
      structureVersion: 'st1'
    });
  });
});
