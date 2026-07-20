// The artifacts a published HTML body implies: the `/_/api` data sidecar and the
// site's Tailwind CSS. Every writer that publishes HTML must refresh them INSIDE
// the same write-queue critical section that published the HTML.
//
// Outside it, a remote apply leaves an H0 sidecar or an H0 stylesheet serving
// against H1 bytes indefinitely. Worse for the sidecar: the sync writers stamp
// the remote `modifiedAt` onto the file, so an H0 sidecar written now can carry
// a NEWER mtime than the H1 it describes, and readFreshSidecar's freshness check
// then reports it current forever.
//
// Both halves are non-fatal by the same rule the save path already follows: a
// derived-artifact failure must never fail the write that caused it.

const { compileTailwind, getTailwindCssName } = require('tailwind-hyperclay');
const { getConsentRegistry, resolveWritePath, validateSegments } = require('./path-resolver');
const { atomicWriteFile } = require('./write-queue');
const { writeApiSidecar } = require('./api-sidecar');

/**
 * Refresh every derived artifact for `name` from the bytes just published.
 * Callers MUST already hold the write-queue slot for the file's canonical path.
 * @param {string} baseDir - served folder
 * @param {string} name - site name with extension, e.g. "blog/post.html"
 * @param {string} content - the HTML that was just published
 */
async function refreshDerivedArtifacts(baseDir, name, content) {
  // Sidecar first, matching the save path: a Tailwind failure must not be able
  // to skip it and leave stale API data on disk.
  try {
    await writeApiSidecar(baseDir, name, content);
  } catch (error) {
    console.error('[derived] sidecar refresh failed (non-fatal):', error && error.message ? error.message : error);
  }

  try {
    const tailwindName = getTailwindCssName(content);
    if (!tailwindName) return;
    // Same phase-2 + phase-4 pass as user files, so a crafted site name can't
    // steer a generated stylesheet out of the served folder.
    const relPath = `tailwindcss/${tailwindName}.css`;
    validateSegments(relPath);
    const cssPath = await resolveWritePath(getConsentRegistry(baseDir), relPath);
    await atomicWriteFile(cssPath, await compileTailwind(content));
  } catch (error) {
    console.error('[derived] tailwind refresh failed (non-fatal):', error && error.message ? error.message : error);
  }
}

module.exports = { refreshDerivedArtifacts };
