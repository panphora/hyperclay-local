const {
  calculateChecksum,
  isLocalNewer,
  isFutureFile
} = require('../../src/sync-engine/utils');

describe('calculateChecksum', () => {
  test('returns 16-character hex string', async () => {
    const checksum = await calculateChecksum('test content');
    expect(checksum).toMatch(/^[a-f0-9]{16}$/);
  });

  test('returns consistent checksum for same content', async () => {
    const content = 'hello world';
    const checksum1 = await calculateChecksum(content);
    const checksum2 = await calculateChecksum(content);
    expect(checksum1).toBe(checksum2);
  });

  test('returns different checksum for different content', async () => {
    const checksum1 = await calculateChecksum('content A');
    const checksum2 = await calculateChecksum('content B');
    expect(checksum1).not.toBe(checksum2);
  });

  test('handles empty string', async () => {
    const checksum = await calculateChecksum('');
    expect(checksum).toMatch(/^[a-f0-9]{16}$/);
  });

  test('handles unicode content', async () => {
    const checksum = await calculateChecksum('こんにちは 🎉');
    expect(checksum).toMatch(/^[a-f0-9]{16}$/);
  });
});

describe('isLocalNewer', () => {
  test('returns true when local is newer than server', () => {
    const localMtime = new Date('2024-01-15T12:00:00Z');
    const serverTime = '2024-01-15T11:00:00Z';

    expect(isLocalNewer(localMtime, serverTime, 0)).toBe(true);
  });

  test('returns false when server is newer than local', () => {
    const localMtime = new Date('2024-01-15T10:00:00Z');
    const serverTime = '2024-01-15T11:00:00Z';

    expect(isLocalNewer(localMtime, serverTime, 0)).toBe(false);
  });

  test('returns false when times are within 10-second buffer', () => {
    const localMtime = new Date('2024-01-15T12:00:05Z');
    const serverTime = '2024-01-15T12:00:00Z';

    // Only 5 seconds difference - within buffer
    expect(isLocalNewer(localMtime, serverTime, 0)).toBe(false);
  });

  test('returns true when local is beyond 10-second buffer', () => {
    const localMtime = new Date('2024-01-15T12:00:15Z');
    const serverTime = '2024-01-15T12:00:00Z';

    // 15 seconds difference - beyond buffer
    expect(isLocalNewer(localMtime, serverTime, 0)).toBe(true);
  });

  test('applies clock offset correctly when local clock is ahead', () => {
    const localMtime = new Date('2024-01-15T12:00:00Z');
    const serverTime = '2024-01-15T11:30:00Z';
    const clockOffset = -1800000; // Local clock is 30 min ahead

    // After adjustment: local = 11:30, server = 11:30, so local NOT newer
    expect(isLocalNewer(localMtime, serverTime, clockOffset)).toBe(false);
  });

  test('applies clock offset correctly when local clock is behind', () => {
    const localMtime = new Date('2024-01-15T11:00:00Z');
    const serverTime = '2024-01-15T11:30:00Z';
    const clockOffset = 1800000; // Local clock is 30 min behind

    // After adjustment: local = 11:30, server = 11:30, so local NOT newer
    expect(isLocalNewer(localMtime, serverTime, clockOffset)).toBe(false);
  });
});

describe('isFutureFile', () => {
  test('returns true for file dated in the future', () => {
    const futureDate = new Date(Date.now() + 86400000); // 1 day ahead
    expect(isFutureFile(futureDate, 0)).toBe(true);
  });

  test('returns false for file dated in the past', () => {
    const pastDate = new Date(Date.now() - 86400000); // 1 day ago
    expect(isFutureFile(pastDate, 0)).toBe(false);
  });

  test('returns false for recent file (within tolerance)', () => {
    const recentDate = new Date(Date.now() + 30000); // 30 seconds ahead
    // Should be within the tolerance
    expect(isFutureFile(recentDate, 0)).toBe(false);
  });

  test('accounts for clock offset', () => {
    const futureDate = new Date(Date.now() + 3600000); // 1 hour ahead
    const clockOffset = -3600000; // Local clock is 1 hour behind server

    // After adjustment, the file should be considered current, not future
    expect(isFutureFile(futureDate, clockOffset)).toBe(false);
  });
});
