/**
 * etag.js — the version stamp this tab last saw on disk (spec §6, `conditional`).
 *
 * One value, and one rule that decides everything about it: this client never
 * computes a stamp, it only ever echoes one the host handed it. The host stamps
 * the bytes it STORED, and on a document carrying formathtml="true" those are not
 * the bytes it was sent, so a stamp computed here would disagree with disk from
 * the first save onward and every later save would be refused against a value it
 * could never have matched.
 *
 * Three things move the stamp, and nothing else does:
 *
 *   - the response that delivered this page seeds it, when the host stamped that
 *     response: the stamp names the bytes the navigation was built from, which is
 *     the only evidence this tab has about the version it is looking at,
 *   - an accepted save replaces it with the one that response carried, and clears
 *     it when a response carries none: after our own write, any stamp still held
 *     here is known to describe bytes the host has stopped storing,
 *   - a disk-sourced live-sync frame replaces it with the stamp that frame
 *     carried, because the file changed under a tab that never saved. A frame
 *     with no stamp on it falls back to clearing and asking the host.
 *
 * Discovery seeds it only for a page that arrived without a stamp of its own. That
 * is not a detail: both hosts read the file AGAIN when they answer discovery, so
 * their answer describes a later moment than the navigation. This tab may have been
 * served A, the file may have become B, and discovery answers B — bytes this tab has
 * never seen. Adopting that would claim the newer version while holding the older
 * bytes, and this tab's next save would pass If-Match and overwrite the update it
 * never received. It would also erase the only evidence that the update is missing.
 * The exception is an explicit overwrite, `seedEtag({ fresh: true })`, which a person
 * asks for by name; that may take whatever the host says now.
 *
 * `represented` rides beside the stamp and answers a different question: which
 * version of the file is the DOM in front of the person? A save compares against
 * `lastSeen`, but discovery moves that without this tab having received anything, so
 * the two only agree when the last change came with content. Startup repair compares
 * the file against `represented` to decide whether this page is still the page the
 * navigation delivered.
 *
 * A peer's SNAPSHOT does not move it. §10 relays never write to disk, so the
 * stamp is still true after one lands, and treating one as a disk change would
 * refetch discovery on every keystroke another editor makes.
 *
 * No stamp means no `If-Match`, which means last write wins for that one save.
 * That is what every save did before this module existed, so an absent stamp is
 * always a step back to the old behaviour and never a new failure.
 */

import { hostMeta } from "./host-meta.js";
import { isEditMode } from "./is-edit-mode.js";
import { servedDocumentEtag } from "./host-attrs.js";

// Both start at the version this response was built from, when the host said which one
// that is, so a page whose file changes before its first discovery answer still knows
// what its own DOM came from.
let lastSeen = servedDocumentEtag;
let represented = servedDocumentEtag;
let conditional = false;
// Bumped by every write. A discovery answer that resolves after a save has
// already recorded a newer stamp must not overwrite it.
let generation = 0;

/** The stamp to send on the next save, or null. */
export function lastSeenEtag() {
  return lastSeen;
}

/** True only when the host announced `conditional` by name (§5). */
export function conditionalSaves() {
  return conditional;
}

/**
 * Take the stamp from a save response. A response with no stamp clears it.
 * @param {?string} value
 */
export function recordEtag(value) {
  lastSeen = typeof value === "string" && value !== "" ? value : null;
  generation++;
  // Whatever this value came from — a save response, a disk frame, a deliberate
  // forget — it describes content this tab has taken, so it is also what the tab
  // represents.
  represented = lastSeen;
}

/** The version of the file this tab's content came from, or null. */
export function representedEtag() {
  return represented;
}

/**
 * Drop the represented stamp without touching the save stamp.
 *
 * For content that arrived with no version on it: the DOM now holds bytes the host
 * never named, so this tab can no longer say which version it is looking at.
 */
export function forgetRepresentedEtag() {
  represented = null;
}

/** Forget the stamp: the next save goes out unconditional. */
export function forgetEtag() {
  recordEtag(null);
}

/**
 * Learn from discovery whether this host offers conditional saves, and what the
 * document's current stamp is.
 *
 * @param {Object} [options]
 * @param {boolean} [options.fresh] - Ask the host again instead of reusing the
 *   memoized answer, and take whatever it says as the whole truth: an answer with
 *   no stamp in it clears the one held here rather than leaving a stale value the
 *   host would refuse forever.
 * @param {boolean} [options.clearIfMissing] - Whether an answer carrying no stamp
 *   drops the one held here. Defaults to `fresh`, which is what a person asking to
 *   overwrite wants: no stamp means the next save goes out unconditional, which is
 *   last write wins, which is what they asked for by name. Pass false for a refresh
 *   nobody requested. Clearing fails OPEN, and a background reseed that quietly
 *   turns the guard off is worse than one that leaves a stale stamp behind, because
 *   a stale stamp only costs a refusal.
 * @returns {Promise<?string>}
 */
export async function seedEtag({ fresh = false, clearIfMissing = fresh } = {}) {
  const at = generation;
  const meta = await hostMeta({ fresh });
  // Only a real answer (spec is a number) says what the host supports: a refresh
  // that failed comes back as a bare host with no extensions, and must not switch
  // conditional saves off for the rest of the page's life.
  if (typeof meta.spec === "number") conditional = meta.extensions.includes("conditional");

  if (generation !== at) return lastSeen;

  // A stamped navigation is provenance, and discovery is not evidence about it. This
  // answer is about a later moment than the response that built this page, so it may
  // neither advance nor clear the stamp while this tab still represents what it was
  // served. Only an explicit overwrite — fresh AND clearing allowed — moves it, and
  // that is also the only case where an empty answer is taken as the truth.
  if (servedDocumentEtag && !(fresh && clearIfMissing)) return lastSeen;

  const seed = meta.document?.etag;
  if (typeof seed === "string" && seed !== "") {
    lastSeen = seed;
    generation++;
  } else if (clearIfMissing) {
    lastSeen = null;
    generation++;
  }
  return lastSeen;
}

// A disk-sourced frame is the one live-sync outcome that changes the file under a
// tab which did not save it. Holding the old stamp would refuse this tab's next
// save against bytes it has already morphed to and is looking at, so the stamp
// has to move.
//
// The frame's own stamp is the right one, and live-sync has already taken it as
// part of applying the frame's content. Nothing is left to do here: this listener
// exists for the frames that carry no stamp.
//
// Asking the host is the fallback and not the rule, because discovery answers
// about whatever is on disk when the ANSWER is built, which is a later moment
// than the frame. If a second write lands in between, the reply describes bytes
// this tab has never seen, and adopting it makes the next save overwrite that
// write silently. The frames without a stamp are an old host, and the fetch
// fallback for a change too large to send, whose body is the served page rather
// than anything the host stamped.
//
// A frame that live-sync HELD is deliberately not covered, because it never
// dispatches this event. That tab has unsaved local edits and has not seen the
// new disk bytes, which is precisely the case a 412 exists for.

// The represented stamp goes first, and in both lanes. An unstamped disk apply leaves
// this tab holding a DOM whose version nobody stated, so neither lane may keep claiming
// the old one — a view-mode tab included, since that is the lane startup repair runs
// in. A stamped frame needs nothing here: live-sync has already recorded it as part of
// applying the content.
document.addEventListener("clay:sync-applied", (event) => {
  if (event.detail?.source !== "disk") return;
  if (typeof event.detail.etag === "string" && event.detail.etag) return;
  forgetRepresentedEtag();
});

// Edit mode goes further: the stamp it SAVES with has to move too, and the host is the
// only source for the value, so it forgets the one it holds and asks again with the
// overwrite flags. A view-mode tab never saves, so its save stamp can stay where it is.
if (isEditMode) {
  document.addEventListener("clay:sync-applied", (event) => {
    if (event.detail?.source !== "disk") return;
    if (typeof event.detail.etag === "string" && event.detail.etag) return;
    forgetEtag();
    seedEtag({ fresh: true });
  });
}
