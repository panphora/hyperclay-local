const SyncQueue = require('../../src/sync-engine/sync-queue');

describe('SyncQueue', () => {
  let queue;

  beforeEach(() => {
    queue = new SyncQueue();
  });

  afterEach(() => {
    queue.clear();
  });

  describe('add', () => {
    test('accepts .html files', () => {
      expect(queue.add('add', 'site.html')).toBe(true);
      expect(queue.length()).toBe(1);
    });

    test('accepts files in folders with .html extension', () => {
      expect(queue.add('add', 'folder/site.html')).toBe(true);
      expect(queue.add('add', 'a/b/c/site.html')).toBe(true);
      expect(queue.length()).toBe(2);
    });

    test('accepts upload: prefixed files', () => {
      expect(queue.add('add', 'upload:image.png')).toBe(true);
      expect(queue.add('add', 'upload:folder/document.pdf')).toBe(true);
      expect(queue.length()).toBe(2);
    });

    test('rejects non-.html files without upload: prefix', () => {
      expect(queue.add('add', 'image.png')).toBe(false);
      expect(queue.add('add', 'styles.css')).toBe(false);
      expect(queue.add('add', 'script.js')).toBe(false);
      expect(queue.length()).toBe(0);
    });

    test('rejects duplicate entries', () => {
      expect(queue.add('add', 'site.html')).toBe(true);
      expect(queue.add('add', 'site.html')).toBe(false);
      expect(queue.add('change', 'site.html')).toBe(false);
      expect(queue.length()).toBe(1);
    });

    test('stores correct item structure', () => {
      queue.add('add', 'site.html');
      const item = queue.next();

      expect(item).toHaveProperty('type', 'add');
      expect(item).toHaveProperty('filename', 'site.html');
      expect(item).toHaveProperty('queuedAt');
      expect(typeof item.queuedAt).toBe('number');
    });
  });

  describe('next', () => {
    test('returns items in FIFO order', () => {
      queue.add('add', 'first.html');
      queue.add('add', 'second.html');
      queue.add('add', 'third.html');

      expect(queue.next().filename).toBe('first.html');
      expect(queue.next().filename).toBe('second.html');
      expect(queue.next().filename).toBe('third.html');
    });

    test('returns undefined when empty', () => {
      expect(queue.next()).toBeUndefined();
    });

    test('removes item from queue', () => {
      queue.add('add', 'site.html');
      expect(queue.length()).toBe(1);

      queue.next();
      expect(queue.length()).toBe(0);
    });
  });

  describe('isEmpty', () => {
    test('returns true for empty queue', () => {
      expect(queue.isEmpty()).toBe(true);
    });

    test('returns false when items present', () => {
      queue.add('add', 'site.html');
      expect(queue.isEmpty()).toBe(false);
    });
  });

  describe('length', () => {
    test('returns correct count', () => {
      expect(queue.length()).toBe(0);

      queue.add('add', 'a.html');
      expect(queue.length()).toBe(1);

      queue.add('add', 'b.html');
      expect(queue.length()).toBe(2);

      queue.next();
      expect(queue.length()).toBe(1);
    });
  });

  describe('processing state', () => {
    test('isProcessingQueue starts false', () => {
      expect(queue.isProcessingQueue()).toBe(false);
    });

    test('setProcessing changes state', () => {
      queue.setProcessing(true);
      expect(queue.isProcessingQueue()).toBe(true);

      queue.setProcessing(false);
      expect(queue.isProcessingQueue()).toBe(false);
    });
  });

  describe('clear', () => {
    test('empties queue', () => {
      queue.add('add', 'a.html');
      queue.add('add', 'b.html');
      expect(queue.length()).toBe(2);

      queue.clear();
      expect(queue.length()).toBe(0);
      expect(queue.isEmpty()).toBe(true);
    });

    test('resets processing state', () => {
      queue.setProcessing(true);
      queue.clear();
      expect(queue.isProcessingQueue()).toBe(false);
    });

    test('clears retry queue', () => {
      // Simulate a retry entry
      queue.add('add', 'site.html');
      const item = queue.next();
      const error = new Error('Network error');
      error.code = 'ECONNREFUSED';
      queue.scheduleRetry(item, error, () => {});

      expect(queue.getRetryInfo('site.html')).toBeDefined();

      queue.clear();
      expect(queue.getRetryInfo('site.html')).toBeUndefined();
    });
  });

  describe('clearRetry', () => {
    test('removes retry info for specific file', () => {
      queue.add('add', 'site.html');
      const item = queue.next();
      const error = new Error('Network error');
      error.code = 'ECONNREFUSED';
      queue.scheduleRetry(item, error, () => {});

      expect(queue.getRetryInfo('site.html')).toBeDefined();

      queue.clearRetry('site.html');
      expect(queue.getRetryInfo('site.html')).toBeUndefined();
    });
  });

  describe('getQueuedItems', () => {
    test('returns copy of queue', () => {
      queue.add('add', 'a.html');
      queue.add('add', 'b.html');

      const items = queue.getQueuedItems();
      expect(items).toHaveLength(2);
      expect(items[0].filename).toBe('a.html');
      expect(items[1].filename).toBe('b.html');

      // Verify it's a copy
      items.pop();
      expect(queue.length()).toBe(2);
    });
  });
});
