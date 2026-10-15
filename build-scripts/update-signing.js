#!/usr/bin/env node

/**
 * Signs Linux AppImage updates with ed25519, the seed coming from HLOCAL_UPDATE_SEED.
 *
 *   node build-scripts/update-signing.js keygen   prints a new seed and public key, both base64
 *
 * The seed is the signing key: it goes only into 1Password and the GitHub secret. The
 * public key goes into src/main/update-keys.js.
 */

const crypto = require('crypto');
const { signedMessage } = require('../src/main/appimage-update');
const { UPDATE_PUBLIC_KEYS } = require('../src/main/update-keys');

const PKCS8_ED25519_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

function privateKeyFromSeed(seedBase64) {
  const seed = Buffer.from(seedBase64, 'base64');
  if (seed.length !== 32) throw new Error('HLOCAL_UPDATE_SEED must be a base64 32-byte ed25519 seed');
  return crypto.createPrivateKey({ key: Buffer.concat([PKCS8_ED25519_PREFIX, seed]), format: 'der', type: 'pkcs8' });
}

function rawPublicKey(key) {
  return Buffer.from(crypto.createPublicKey(key).export({ format: 'jwk' }).x, 'base64url').toString('base64');
}

// No seed means no signer: the release goes out without a Linux update feed. A seed whose
// public half the app does not know would publish updates every client rejects, so that
// fails the release before anything is uploaded.
function createSigner(seedBase64, publicKeys = UPDATE_PUBLIC_KEYS) {
  if (!seedBase64) return null;
  const key = privateKeyFromSeed(seedBase64);
  const publicKey = rawPublicKey(key);
  if (!publicKeys.includes(publicKey)) {
    throw new Error(`The HLOCAL_UPDATE_SEED public key ${publicKey} is not in src/main/update-keys.js, so installed apps would reject its signatures.`);
  }
  return {
    publicKey,
    sign: (fileName, sha512) => crypto.sign(null, signedMessage(fileName, sha512), key).toString('base64')
  };
}

function keygen() {
  const { privateKey } = crypto.generateKeyPairSync('ed25519');
  const seed = privateKey.export({ format: 'der', type: 'pkcs8' }).subarray(-32).toString('base64');
  return { seed, publicKey: rawPublicKey(privateKey) };
}

if (require.main === module) {
  if (process.argv[2] !== 'keygen') {
    console.error('usage: node build-scripts/update-signing.js keygen');
    process.exit(2);
  }
  const { seed, publicKey } = keygen();
  console.log(`seed:   ${seed}`);
  console.log(`public: ${publicKey}`);
}

module.exports = { createSigner, keygen, privateKeyFromSeed, rawPublicKey };
