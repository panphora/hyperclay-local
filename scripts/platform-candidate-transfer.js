'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function attemptPrefix() {
  const { APP, CANDIDATE_SHA256, ATTEMPT } = process.env;
  if (APP !== 'hyperclay-local' || !/^[a-f0-9]{64}$/.test(CANDIDATE_SHA256 || '') ||
      !ATTEMPT || /[/\\]/.test(ATTEMPT) || ['.', '..'].includes(ATTEMPT)) {
    throw new Error('Invalid candidate transfer identity');
  }
  return `candidates/${APP}/${CANDIDATE_SHA256}/${ATTEMPT}`;
}

function transfer(command, name, file) {
  if (!['upload', 'download'].includes(command) || !/^[a-zA-Z0-9.-]+$/.test(name || '') || !file) {
    throw new Error('Use upload|download <name> <file>');
  }
  const key = `${attemptPrefix()}/transfer/${name}`;
  const aws = (...args) => execFileSync('aws', ['--endpoint-url',
    `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`, '--region', 'auto',
    's3api', ...args, '--bucket', 'hyperclay-candidates', '--key', key], { encoding: 'utf8' });
  if (command === 'upload') {
    const bytes = fs.readFileSync(file);
    aws('put-object', '--body', file, '--metadata', JSON.stringify({ sha256: digest(bytes) }));
    return;
  }
  const object = JSON.parse(aws('head-object'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  aws('get-object', file);
  const bytes = fs.readFileSync(file);
  if (object.ContentLength !== bytes.length || !/^[a-f0-9]{64}$/.test(object.Metadata?.sha256 || '') ||
      digest(bytes) !== object.Metadata.sha256) {
    throw new Error(`Candidate transfer sha256 or ContentLength mismatch: ${name}`);
  }
}

module.exports = { attemptPrefix, transfer };

if (require.main === module) {
  try {
    transfer(...process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
