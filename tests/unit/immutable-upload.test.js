const { HeadObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
const { putImmutable, sha512Hex } = require('../../build-scripts/immutable-upload');

// A fake bucket that answers HeadObject and PutObject the way R2's S3 API does.
function fakeBucket(objects = new Map()) {
  const sent = [];
  const client = {
    send: jest.fn(async (command) => {
      sent.push(command);
      const { Key } = command.input;
      if (command instanceof HeadObjectCommand) {
        if (!objects.has(Key)) throw Object.assign(new Error('NotFound'), { name: 'NotFound', $metadata: { httpStatusCode: 404 } });
        return { Metadata: objects.get(Key).Metadata };
      }
      if (command instanceof PutObjectCommand) {
        objects.set(Key, command.input);
        return {};
      }
      throw new Error('unexpected command');
    })
  };
  return { client, objects, sent };
}

const put = (client, body) => putImmutable({
  client, bucket: 'b', key: 'releases/1.31.0/HyperclayLocal-Setup-1.31.0.exe', body: Buffer.from(body), contentType: 'application/x-msdos-program', cacheControl: 'public, max-age=31536000, immutable'
});

describe('immutable versioned uploads', () => {
  test('a new key is uploaded with its sha512 recorded', async () => {
    const { client, objects } = fakeBucket();
    await expect(put(client, 'installer')).resolves.toBe('uploaded');
    const stored = objects.get('releases/1.31.0/HyperclayLocal-Setup-1.31.0.exe');
    expect(stored.Metadata).toEqual({ sha512: sha512Hex(Buffer.from('installer')) });
    expect(stored.CacheControl).toBe('public, max-age=31536000, immutable');
  });

  test('the same bytes again are left as they are', async () => {
    const { client, sent } = fakeBucket();
    await put(client, 'installer');
    await expect(put(client, 'installer')).resolves.toBe('unchanged');
    expect(sent.filter((command) => command instanceof PutObjectCommand)).toHaveLength(1);
  });

  test('different bytes under the same version fail and replace nothing', async () => {
    const { client, objects } = fakeBucket();
    await put(client, 'installer');
    await expect(put(client, 'rebuilt installer')).rejects.toThrow(/different bytes\. A rebuilt version needs a new version number/);
    expect(objects.get('releases/1.31.0/HyperclayLocal-Setup-1.31.0.exe').Body.toString()).toBe('installer');
  });

  test('an existing object with no recorded sha512 is never overwritten', async () => {
    const { client } = fakeBucket(new Map([['releases/1.31.0/HyperclayLocal-Setup-1.31.0.exe', { Metadata: {} }]]));
    await expect(put(client, 'installer')).rejects.toThrow(/no recorded sha512/);
  });

  test('a HeadObject failure other than not found stops the upload', async () => {
    const client = { send: jest.fn().mockRejectedValue(Object.assign(new Error('AccessDenied'), { name: 'AccessDenied', $metadata: { httpStatusCode: 403 } })) };
    await expect(put(client, 'installer')).rejects.toThrow(/AccessDenied/);
    expect(client.send).toHaveBeenCalledTimes(1);
  });
});
