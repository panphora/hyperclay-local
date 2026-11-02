/**
 * Autosave Debug Utility
 *
 * Provides conditional logging for the autosave system.
 * Enable by setting localStorage.setItem('clay:debug:autosave', 'true')
 *
 * When enabled, dynamically imports a diff library to show exactly
 * what changed between DOM states.
 */

const DEBUG_KEY = 'clay:debug:autosave';

let diffModule = null;
let diffLoadPromise = null;

/**
 * Check if autosave debug mode is enabled
 */
export function isDebugEnabled() {
  try {
    return localStorage.getItem(DEBUG_KEY) === 'true';
  } catch {
    return false;
  }
}

/**
 * Lazily load the diff library only when needed
 * Uses esm.sh for zero-install dynamic import
 */
async function loadDiff() {
  if (diffModule) return diffModule;
  if (diffLoadPromise) return diffLoadPromise;

  diffLoadPromise = import('https://esm.sh/diff@5.2.0')
    .then(mod => {
      diffModule = mod;
      return mod;
    })
    .catch(err => {
      console.warn('[autosave-debug] Failed to load diff library:', err);
      return null;
    });

  return diffLoadPromise;
}

/**
 * Log a brief one-liner for save operations
 */
export function logSaveCheck(label, matches) {
  if (!isDebugEnabled()) return;

  const status = matches ? '✓ matches' : '✗ differs';
  console.log(`[autosave] ${label}: ${status}`);
}

/**
 * Log when baseline is captured/updated
 */
export function logBaseline(event, details = '') {
  if (!isDebugEnabled()) return;

  console.log(`[autosave] baseline ${event}${details ? `: ${details}` : ''}`);
}

/**
 * Log and diff two HTML strings (async, for unload warning)
 * Returns a promise that resolves when logging is complete
 */
export async function logUnloadDiff(currentContents, lastSaved) {
  if (!isDebugEnabled()) return;

  console.group('[autosave] Unload warning triggered - content differs from last save');
  console.log('Current length:', currentContents.length);
  console.log('Last saved length:', lastSaved.length);
  console.log('Difference:', currentContents.length - lastSaved.length, 'characters');

  const diff = await loadDiff();

  if (diff) {
    const changes = diff.diffLines(lastSaved, currentContents);

    console.log('\n--- DIFF (last saved → current) ---');

    let hasChanges = false;
    changes.forEach(part => {
      if (part.added || part.removed) {
        hasChanges = true;
        const prefix = part.added ? '+++ ' : '--- ';
        const lines = part.value.split('\n').filter(l => l.length > 0);

        // Truncate very long diffs
        const maxLines = 20;
        const displayLines = lines.slice(0, maxLines);

        displayLines.forEach(line => {
          // Truncate very long lines
          const displayLine = line.length > 200
            ? line.substring(0, 200) + '...[truncated]'
            : line;
          console.log(prefix + displayLine);
        });

        if (lines.length > maxLines) {
          console.log(`... and ${lines.length - maxLines} more lines`);
        }
      }
    });

    if (!hasChanges) {
      console.log('(No line-level differences found - may be whitespace or inline changes)');
      // Fall back to character diff for small differences
      if (Math.abs(currentContents.length - lastSaved.length) < 500) {
        const charChanges = diff.diffChars(lastSaved, currentContents);
        console.log('\n--- CHARACTER DIFF ---');
        charChanges.forEach(part => {
          if (part.added || part.removed) {
            const prefix = part.added ? '+++ ' : '--- ';
            const value = part.value.length > 100
              ? part.value.substring(0, 100) + '...[truncated]'
              : part.value;
            console.log(prefix + JSON.stringify(value));
          }
        });
      }
    }
  } else {
    console.log('(diff library not available - showing raw comparison)');
    console.log('First 500 chars of current:', currentContents.substring(0, 500));
    console.log('First 500 chars of last saved:', lastSaved.substring(0, 500));
  }

  console.groupEnd();
}

/**
 * Synchronous version for beforeunload (can't await in event handler)
 * Logs what it can immediately, diff loads async but may not complete before unload
 */
export function logUnloadDiffSync(currentContents, lastSaved) {
  if (!isDebugEnabled()) return;

  console.group('[autosave] Unload warning triggered - content differs from last save');
  console.log('Current length:', currentContents.length);
  console.log('Last saved length:', lastSaved.length);
  console.log('Difference:', currentContents.length - lastSaved.length, 'characters');

  // If diff is already loaded, use it synchronously
  if (diffModule) {
    const changes = diffModule.diffLines(lastSaved, currentContents);

    console.log('\n--- DIFF (last saved → current) ---');

    let hasChanges = false;
    changes.forEach(part => {
      if (part.added || part.removed) {
        hasChanges = true;
        const prefix = part.added ? '+++ ' : '--- ';
        const lines = part.value.split('\n').filter(l => l.length > 0);

        const maxLines = 20;
        const displayLines = lines.slice(0, maxLines);

        displayLines.forEach(line => {
          const displayLine = line.length > 200
            ? line.substring(0, 200) + '...[truncated]'
            : line;
          console.log(prefix + displayLine);
        });

        if (lines.length > maxLines) {
          console.log(`... and ${lines.length - maxLines} more lines`);
        }
      }
    });

    if (!hasChanges) {
      console.log('(No line-level differences - checking character diff)');
      if (Math.abs(currentContents.length - lastSaved.length) < 500) {
        const charChanges = diffModule.diffChars(lastSaved, currentContents);
        charChanges.forEach(part => {
          if (part.added || part.removed) {
            const prefix = part.added ? '+++ ' : '--- ';
            const value = part.value.length > 100
              ? part.value.substring(0, 100) + '...[truncated]'
              : part.value;
            console.log(prefix + JSON.stringify(value));
          }
        });
      }
    }
  } else {
    // Kick off async load for next time, show basic info now
    loadDiff();
    console.log('(diff library loading - run localStorage.setItem("clay:debug:autosave", "true") and reload for full diff)');

    // Find first difference position
    let diffPos = 0;
    const minLen = Math.min(currentContents.length, lastSaved.length);
    while (diffPos < minLen && currentContents[diffPos] === lastSaved[diffPos]) {
      diffPos++;
    }

    console.log('First difference at position:', diffPos);
    console.log('Context around difference:');
    console.log('  Last saved:', JSON.stringify(lastSaved.substring(Math.max(0, diffPos - 50), diffPos + 100)));
    console.log('  Current:', JSON.stringify(currentContents.substring(Math.max(0, diffPos - 50), diffPos + 100)));
  }

  console.groupEnd();
}

/**
 * Pre-load the diff library if debug is enabled
 * Call this early to ensure diff is ready for unload events
 */
export function preloadIfEnabled() {
  if (isDebugEnabled()) {
    loadDiff();
    console.log('[autosave-debug] Debug mode enabled - diff library loading');
  }
}
