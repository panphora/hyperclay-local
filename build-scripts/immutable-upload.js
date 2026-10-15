const crypto = require('crypto');
const { HeadObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');

function sha512Hex(bytes) {
  return crypto.createHash('sha512').update(bytes).digest('hex');
}

function isNotFound(error) {
  return !!error && (error.name === 'NotFound' || error.name === 'NoSuchKey' || (error.$metadata && error.$metadata.httpStatusCode === 404));
}

// A versioned object is immutable once a feed may name it: a published feed points at
// its exact bytes, and clients cache it for a year. Re-uploading the same bytes is a
// no-op; different bytes under the same version fail the release instead of replacing it.
async function putImmutable({ client, bucket, key, body, contentType, cacheControl }) {
  const sha512 = sha512Hex(body);
  let existing = null;
  try {
    existing = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }
  if (existing) {
    const recorded = existing.Metadata && existing.Metadata.sha512;
    if (recorded === sha512) return 'unchanged';
    throw new Error(`${key} already exists with ${recorded ? 'different bytes' : 'no recorded sha512'}. A rebuilt version needs a new version number.`);
  }
  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: body,
    ContentType: contentType,
    CacheControl: cacheControl,
    Metadata: { sha512 }
  }));
  return 'uploaded';
}

module.exports = { putImmutable, sha512Hex };
