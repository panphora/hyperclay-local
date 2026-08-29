#!/usr/bin/env node
// Drive host-test.html against a live host and exit non-zero on any failed check.
//
// The page has to run IN A BROWSER and FROM THE HOST'S OWN ORIGIN: the spec requires
// exact origin validation on every save, so a save can only be proven from the origin
// that will be allowed to make it, and the cross-origin check needs a real sandboxed
// iframe with a real opaque origin. Neither survives being reimplemented in node.
//
// So this does three things and nothing else: copy the page into the host's document
// root, open it there, and read back the rows the page produces. Everything specific
// to a host -- how it boots, where its document root is, whether it mints a token --
// belongs to that host's own CI step, which passes the answers in as flags.
//
//   node scripts/host-test.mjs --url http://127.0.0.1:4321 --root /tmp/served-folder
//   node scripts/host-test.mjs --url http://127.0.0.1:7311 --page doc.htmlclay --token-from-page
//   node scripts/host-test.mjs --url https://site.localhost --page doc.html --cookie auth_token=… --insecure
//
// --root copies the page in; omit it when the host has to prepare the page itself.
// A token host mints the token at serve time and binds it to ONE file, so the page
// has to be registered with the host before it is served, which only the host can do.
// There the host puts the page in place, --page names where it landed, and
// --token-from-page takes the token the host injected rather than inventing one.
//
// --cookie is for a cookie host, where logging in is the host's own flow and a
// conformance runner has no business knowing anybody's credentials. --insecure is for
// a dev host whose certificate no store trusts; it is never on by default.
//
// A `skip` is not a failure. A host that never announces `upload` is conforming, and
// treating its skips as red would make the gate unusable on exactly the hosts it is
// meant to protect. Only `fail` fails.

import { readFile, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// Two layouts, because this file is synced out of its home repo. Canonically it sits
// in scripts/ with the page one level up. In a host repo both land side by side in one
// conformance directory, so the sibling is checked FIRST: resolving only the canonical
// shape would make every copied runner look for the page in the host repo's parent
// directory and fail somewhere far from the cause.
const PAGE = [
  path.join(HERE, 'host-test.html'),
  path.join(HERE, '..', 'host-test.html'),
].find((p) => existsSync(p)) || path.join(HERE, '..', 'host-test.html');

// The name is deliberately ugly and prefixed: it lands in someone's document folder,
// and on a token host the page overwrites ITSELF as the test target, so it must never
// collide with a document a person cares about.
const SERVED_NAME = '_mhf-host-test.html';
const SCRATCH_NAME = '_mhf-host-test-scratch.html';

function parseArgs(argv) {
  const out = { token: '', target: '', page: '', root: '', cookies: [], tokenFromPage: false, keep: false, insecure: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--url') out.url = argv[++i];
    else if (a === '--root') out.root = argv[++i];
    else if (a === '--page') out.page = argv[++i];
    else if (a === '--token') out.token = argv[++i];
    else if (a === '--target') out.target = argv[++i];
    else if (a === '--cookie') out.cookies.push(argv[++i]);
    else if (a === '--token-from-page') out.tokenFromPage = true;
    else if (a === '--keep') out.keep = true;
    else if (a === '--insecure') out.insecure = true;
    else throw new Error(`unknown flag ${a}`);
  }
  if (!out.url) throw new Error('--url is required (the host\'s origin, e.g. http://127.0.0.1:4321)');
  if (!out.root && !out.page) throw new Error('one of --root (copy the page in) or --page (the host already serves it) is required');
  if (!out.page) out.page = SERVED_NAME;
  return out;
}

// Resolved from the CALLER'S directory, not this script's. The runner lives in the
// spec repo but is meant to be invoked from whichever host repo is being gated, and
// that repo is where playwright is installed. A bare `import('playwright')` resolves
// against this file and would only ever find a copy this package does not have.
async function loadChromium() {
  try {
    const require = createRequire(path.join(process.cwd(), 'package.json'));
    const mod = await import(pathToFileURL(require.resolve('playwright')).href);
    // Imported by absolute path, playwright's CJS entry lands its real exports under
    // `default`; imported by bare name, node's interop hoists them. Take either.
    return mod.chromium || mod.default?.chromium;
  } catch {
    throw new Error(
      'playwright is not resolvable from ' + process.cwd() + '. Run this from a repo that ' +
      'has it, or `npm i -D playwright && npx playwright install chromium` there first.'
    );
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const chromium = await loadChromium();

  const served = args.root ? path.join(args.root, args.page) : null;
  if (served) await writeFile(served, await readFile(PAGE));

  const browser = await chromium.launch();
  // --insecure is opt-in and never a default. A dev host commonly serves HTTPS with a
  // certificate no store trusts, and Chromium then refuses the page outright, which
  // surfaces as the run timing out waiting for results rather than as anything about
  // a certificate. Turning it on silently would be worse: this runner is pointed at
  // whatever URL a CI step names, and a gate that quietly accepts any certificate is
  // not a gate. So the caller says so.
  const context = await browser.newContext(args.insecure ? { ignoreHTTPSErrors: true } : {});

  // A cookie host authorizes a save by session, so the run needs one. Passed in
  // rather than obtained here: logging in is the host's own flow, it differs per
  // host, and a conformance runner has no business knowing anybody's credentials.
  if (args.cookies.length) {
    const origin = new URL(args.url);
    await context.addCookies(args.cookies.map((pair) => {
      const eq = pair.indexOf('=');
      if (eq < 1) throw new Error(`--cookie wants name=value, got ${JSON.stringify(pair)}`);
      return {
        name: pair.slice(0, eq),
        value: pair.slice(eq + 1),
        domain: origin.hostname,
        path: '/'
      };
    }));
  }

  const page = await context.newPage();

  // Surfaced, not swallowed: a page error is the difference between "the host failed a
  // check" and "the check never ran", and the row list alone cannot tell them apart.
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') pageErrors.push(m.text()); });

  let rows;
  try {
    const url = new URL(args.page, args.url.endsWith('/') ? args.url : args.url + '/').href;
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.__hostTest, null, { timeout: 15000 });

    const defaults = await page.evaluate(() => window.__hostTest.defaults);
    // --token-from-page is the honest way to test a token host: the token is minted by
    // the host at serve time and binds to THIS file, so it cannot be known in advance
    // and must not be invented by the caller.
    const token = args.tokenFromPage ? defaults.token : (args.token || defaults.token);
    if (args.tokenFromPage && !token) {
      throw new Error('--token-from-page was given but the host served no save token attribute');
    }

    rows = await page.evaluate(
      ([target, token]) => window.__hostTest.run({ target, token }),
      [args.target || undefined, token]
    );
  } finally {
    await browser.close();
    // Only what this runner put there. A page the HOST placed is the host's to clean
    // up, and deleting it would take the token binding with it.
    if (served && !args.keep) {
      await rm(served, { force: true });
      await rm(path.join(args.root, SCRATCH_NAME), { force: true });
    }
  }

  const width = Math.max(...rows.map((r) => r.status.length));
  for (const r of rows) {
    console.log(`${r.status.toUpperCase().padEnd(width)}  ${r.name}\n${' '.repeat(width + 2)}${r.reason}`);
  }

  const failed = rows.filter((r) => r.status === 'fail');
  const skipped = rows.filter((r) => r.status === 'skip' || r.status === 'na');
  console.log(
    `\n${rows.length - failed.length - skipped.length} passed, ` +
    `${failed.length} failed, ${skipped.length} skipped`
  );

  if (pageErrors.length) {
    console.log('\nPage errors during the run:');
    for (const e of pageErrors) console.log('  ' + e);
  }
  // A run that produced no rows is a broken harness, not a clean host. Without this a
  // page that failed to boot would report zero failures and pass the gate.
  if (rows.length === 0) {
    console.error('\nThe page produced no results at all. The run did not happen.');
    process.exit(2);
  }
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(2);
});
