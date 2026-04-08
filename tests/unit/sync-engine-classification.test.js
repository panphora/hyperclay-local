jest.mock('electron', () => ({
  safeStorage: { isEncryptionAvailable: () => false, encryptString: (s) => s }
}));

jest.mock('eventsource', () => ({
  EventSource: jest.fn()
}));

jest.mock('livesync-hyperclay', () => ({
  liveSync: {
    markBrowserSave: jest.fn(),
    wasBrowserSave: jest.fn(() => false),
    notify: jest.fn(),
    broadcast: jest.fn(),
    subscribeUser: jest.fn(),
    unsubscribeUser: jest.fn(),
    broadcastFileSaved: jest.fn(),
    broadcastToUser: jest.fn()
  }
}));

jest.mock('../../src/main/utils/backup', () => ({
  createBackupIfExists: jest.fn(),
  createBinaryBackupIfExists: jest.fn()
}));

jest.mock('../../src/main/utils/utils', () => ({
  getServerBaseUrl: (url) => url || 'http://localhyperclay.com'
}));

jest.mock('../../src/sync-engine/file-operations');
jest.mock('../../src/sync-engine/api-client');
jest.mock('../../src/sync-engine/node-map');

const { classifyPath } = require('../../src/sync-engine');

describe('classifyPath', () => {
  describe('folder events always return folder', () => {
    it('classifies addDir as folder regardless of path', () => {
      expect(classifyPath('projects', 'addDir')).toBe('folder');
      expect(classifyPath('projects/nested', 'addDir')).toBe('folder');
      expect(classifyPath('looks-like-a-file.html', 'addDir')).toBe('folder');
    });

    it('classifies unlinkDir as folder', () => {
      expect(classifyPath('projects', 'unlinkDir')).toBe('folder');
      expect(classifyPath('anything.txt', 'unlinkDir')).toBe('folder');
    });
  });

  describe('file events classify by extension', () => {
    it('classifies .html as site', () => {
      expect(classifyPath('index.html', 'add')).toBe('site');
      expect(classifyPath('projects/index.html', 'change')).toBe('site');
      expect(classifyPath('nested/deeply/foo.html', 'unlink')).toBe('site');
    });

    it('classifies .htmlclay as site', () => {
      expect(classifyPath('foo.htmlclay', 'add')).toBe('site');
    });

    it('classifies uppercase extensions as site (case-insensitive)', () => {
      expect(classifyPath('Index.HTML', 'add')).toBe('site');
      expect(classifyPath('FOO.HtmlClay', 'change')).toBe('site');
    });

    it('classifies non-HTML files as upload', () => {
      expect(classifyPath('image.png', 'add')).toBe('upload');
      expect(classifyPath('doc.pdf', 'change')).toBe('upload');
      expect(classifyPath('projects/photo.jpg', 'add')).toBe('upload');
      expect(classifyPath('no-extension', 'add')).toBe('upload');
    });

    it('classifies .html.bak as upload (extension must match strictly)', () => {
      expect(classifyPath('index.html.bak', 'add')).toBe('upload');
    });

    it('classifies paths with dots in directories correctly', () => {
      expect(classifyPath('old.version/index.html', 'add')).toBe('site');
      expect(classifyPath('old.version/image.png', 'add')).toBe('upload');
    });
  });

  describe('edge cases', () => {
    it('handles empty path gracefully', () => {
      expect(classifyPath('', 'add')).toBe('upload');
      expect(classifyPath('', 'addDir')).toBe('folder');
    });

    it('handles paths with leading slashes', () => {
      expect(classifyPath('/index.html', 'add')).toBe('site');
    });
  });
});
