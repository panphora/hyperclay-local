'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { createRequire } = require('node:module');
const fromCandidate = createRequire(path.resolve('package.json'));
const { S3Client, PutObjectCommand } = fromCandidate('@aws-sdk/client-s3');
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

async function main() {
  const [command, name] = process.argv.slice(2);
  const dir = path.resolve('executables');
  const version = fromCandidate('./package.json').version;
  if (command === 'sign') {
    const { createSigner } = fromCandidate('./build-scripts/update-signing');
    const { appImageArch } = fromCandidate('./src/main/appimage-update');
    const signer = createSigner(process.env.HLOCAL_UPDATE_SEED);
    fs.mkdirSync('signatures', { recursive: true });
    fs.writeFileSync('signatures/policy.json', JSON.stringify({ linuxUpdates: Boolean(signer) }));
    if (signer) {
      for (const file of [`HyperclayLocal-${version}.AppImage`, `HyperclayLocal-${version}-arm64.AppImage`]) {
        const sha512 = crypto.createHash('sha512').update(fs.readFileSync(path.join(dir, file))).digest('base64');
        fs.writeFileSync(`signatures/${file}.sig`, `${signer.sign({ fileName: file, version, arch: appImageArch(file), sha512 })}\n`);
      }
    }
    return;
  }
  if (command === 'feeds') {
    const { macFeed, windowsFeed, linuxFeeds } = fromCandidate('./build-scripts/update-feed');
    const policy = JSON.parse(fs.readFileSync('signatures/policy.json', 'utf8'));
    const options = { dir, version, baseUrl: `https://local.hyperclay.com/releases/${version}`,
      releaseDate: new Date(JSON.parse(fs.readFileSync('.platform-context.json', 'utf8')).releaseDate).toISOString() };
    fs.mkdirSync('feeds', { recursive: true });
    const feeds = [['latest-mac.yml', macFeed(options)], ['latest.yml', windowsFeed(options)]];
    if (policy.linuxUpdates) feeds.push(...linuxFeeds(options));
    for (const [file, content] of feeds) fs.writeFileSync(`feeds/${file}`, content);
    return;
  }
  if (command !== 'retain' || !/^[a-z0-9-]+$/.test(name)) throw new Error('Invalid output command');
  const outputDir = name === 'linux-update-signing' ? 'signatures' : name === 'update-feed' ? 'feeds' : 'executables';
  const files = fs.readdirSync(outputDir).filter(file =>
    file !== 'SHA256SUMS.json' && fs.statSync(path.join(outputDir, file)).isFile() &&
    (outputDir !== 'executables' || /\.(dmg|exe|AppImage|zip|blockmap)$/.test(file)));
  if (!files.length) throw new Error('No outputs');
  const hashes = Object.fromEntries(files.map(file => [file, digest(fs.readFileSync(path.join(outputDir, file)))]));
  fs.writeFileSync(`${outputDir}/SHA256SUMS.json`, JSON.stringify(hashes));
  fs.mkdirSync('../retained', { recursive: true });
  const archive = path.resolve(`../retained/${name}.tar.gz`);
  execFileSync('tar', ['-czf', archive, '-C', outputDir, '.'], { stdio: 'inherit' });
  const key = process.env.CANDIDATE_KEY;
  if (!key || !key.includes('/') || key.endsWith('/')) throw new Error('Candidate key needs a parent prefix');
  const prefix = `${key.slice(0, key.lastIndexOf('/'))}/out`;
  const client = new S3Client({ region: 'auto', endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com` });
  for (const [file, filePath] of [[`${name}.tar.gz`, archive], ...files.map(file => [file, path.join(outputDir, file)])]) {
    const body = fs.readFileSync(filePath);
    await client.send(new PutObjectCommand({ Bucket: 'hyperclay-candidates', Key: `${prefix}/${file}`,
      Body: body, Metadata: { sha256: digest(body) } }));
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
