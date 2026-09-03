#!/usr/bin/env node

/**
 * Replace the AppImage runtime electron-builder writes with the AppImage project's
 * static type2 runtime.
 *
 * electron-builder's runtime (its appimage-12.0.1 tool) is dynamically linked. The
 * arm64 build needs libz.so, the unversioned link that only zlib1g-dev provides, so
 * every arm64 AppImage aborts on a stock Ubuntu with "error while loading shared
 * libraries: libz.so". Both arches dlopen libfuse2, which Ubuntu 22.04+ no longer
 * installs. The static runtime has neither dependency and mounts through libfuse3.
 *
 * An AppImage is the runtime ELF followed by a squashfs payload, and the runtime
 * locates the payload at its own ELF size, so swapping means: measure the old
 * runtime, keep everything after it, and prepend the new one.
 *
 * Usage: node build-scripts/appimage-runtime.js   (rewrites every dist/*.AppImage)
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const RUNTIME_RELEASE = '20251108';
const RUNTIMES = {
  0xb7: { asset: 'runtime-aarch64', sha256: '00cbdfcf917cc6c0ff6d3347d59e0ca1f7f45a6df1a428a0d6d8a78664d87444' },
  0x3e: { asset: 'runtime-x86_64', sha256: '2fca8b443c92510f1483a883f60061ad09b46b978b2631c807cd873a47ec260d' },
};

const distDir = path.join(__dirname, '..', 'dist');

function elfSize(buf) {
  if (buf.readUInt32BE(0) !== 0x7f454c46) throw new Error('not an ELF file');
  if (buf[4] !== 2 || buf[5] !== 1) throw new Error('expected a little-endian ELF64');
  const phoff = Number(buf.readBigUInt64LE(0x20));
  const shoff = Number(buf.readBigUInt64LE(0x28));
  const phentsize = buf.readUInt16LE(0x36);
  const phnum = buf.readUInt16LE(0x38);
  const shentsize = buf.readUInt16LE(0x3a);
  const shnum = buf.readUInt16LE(0x3c);
  let end = Math.max(phoff + phentsize * phnum, shoff + shentsize * shnum);
  for (let i = 0; i < shnum; i++) {
    const header = shoff + i * shentsize;
    const SHT_NOBITS = 8;
    if (buf.readUInt32LE(header + 4) === SHT_NOBITS) continue;
    end = Math.max(end, Number(buf.readBigUInt64LE(header + 0x18)) + Number(buf.readBigUInt64LE(header + 0x20)));
  }
  return end;
}

async function fetchRuntime({ asset, sha256 }) {
  const url = `https://github.com/AppImage/type2-runtime/releases/download/${RUNTIME_RELEASE}/${asset}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const runtime = Buffer.from(await res.arrayBuffer());
  const digest = crypto.createHash('sha256').update(runtime).digest('hex');
  if (digest !== sha256) throw new Error(`${asset}: sha256 ${digest}, expected ${sha256}`);
  return runtime;
}

async function swapRuntime(file) {
  const image = fs.readFileSync(file);
  const machine = image.readUInt16LE(0x12);
  const spec = RUNTIMES[machine];
  if (!spec) throw new Error(`${path.basename(file)}: no static runtime for ELF machine 0x${machine.toString(16)}`);
  const payloadOffset = elfSize(image);
  if (image.toString('latin1', payloadOffset, payloadOffset + 4) !== 'hsqs') {
    throw new Error(`${path.basename(file)}: no squashfs payload at byte ${payloadOffset}`);
  }
  const runtime = await fetchRuntime(spec);
  const runtimeEnd = elfSize(runtime);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, Buffer.concat([runtime.subarray(0, runtimeEnd), image.subarray(payloadOffset)]));
  fs.chmodSync(tmp, 0o755);
  fs.renameSync(tmp, file);
  console.log(`  ✓ ${path.basename(file)}: runtime ${payloadOffset} → ${runtimeEnd} bytes (${spec.asset} ${RUNTIME_RELEASE})`);
}

async function main() {
  const files = fs.existsSync(distDir) ? fs.readdirSync(distDir).filter(f => f.endsWith('.AppImage')) : [];
  if (files.length === 0) throw new Error(`no .AppImage in ${distDir}`);
  console.log('📦 Installing the static AppImage runtime...');
  for (const file of files) await swapRuntime(path.join(distDir, file));
}

main().catch(err => {
  console.error(`✗ ${err.message}`);
  process.exit(1);
});
