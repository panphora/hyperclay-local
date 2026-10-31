/**
 * wire-profile.js — the two live-sync wires, and the rule for choosing between them.
 *
 * Spec §10 puts both halves on `/_/sync`. Not every host serves that yet, and the
 * ones that do not cannot be upgraded on our schedule: hyperclay-local ships behind
 * Apple notarization, while this library reaches every document within one 10-minute
 * cache TTL. So the client is the half that has to know both.
 *
 * The choice is DISCOVERED, never guessed. Spec §5 makes `/_/meta` the only way to
 * learn what a host can do, and §10 says a client that has not discovered `sync`
 * never opens either half of the route. Probing is also a bad instrument here: an
 * EventSource reports a 404, an auth refusal and an offline browser through one
 * error path, so a failed connection cannot tell you which address was wrong.
 *
 * One profile is chosen once and used for BOTH directions for the life of the page.
 * Letting send and receive decide independently is exactly the bug this replaces: a
 * client that posted to the spec address while streaming from the legacy one.
 *
 * Both stream addresses carry `client-id`, in the same kebab spelling as the rest of
 * the query. It is the tab's own sender id — the one every outbound frame already
 * carries — so a host that reads it at admission knows this connection by the value
 * its frames arrive under, and can tell two tabs of one cookie-less guest apart. A
 * host that does not read it ignores an unknown parameter.
 */

import { hostMeta } from '../core/host-meta.js';

export const WIRE_PROFILES = {
  spec: {
    name: 'spec',
    relayPath: '/_/sync',
    documentHeader: 'Document-URL',
    snapshotKey: 'snapshot',
    streamPath: (href, lane, resumeId, clientId) =>
      `/_/sync?document-url=${encodeURIComponent(href)}&lane=${lane}&resume-id=${resumeId}&client-id=${encodeURIComponent(clientId)}`,
  },
  // What every published clayjs speaks, and what hyperclayjs and the inline script in
  // every Collection dashboard hardcode. Hosts keep these addresses permanently.
  legacy: {
    name: 'legacy',
    relayPath: '/_/live-sync/save',
    documentHeader: 'Page-URL',
    snapshotKey: 'html',
    streamPath: (href, lane, resumeId, clientId) =>
      `/_/live-sync/stream?page-url=${encodeURIComponent(href)}&lane=${lane}&resume-id=${resumeId}&client-id=${encodeURIComponent(clientId)}`,
  },
};

/**
 * Which wire this host speaks, and which of the current worker transports it can
 * carry. Absence of `sync` selects the legacy wire rather than disabling live sync.
 * That is deliberate transition debt (§10 says an undiscovered capability is not
 * opened at all), but both deployed first-party hosts ran live sync for a long time
 * without advertising anything, and refusing them would regress every published
 * version. A malformed answer, a 404 or a timeout all land on legacy too.
 *
 * @returns {Promise<{profile: Object, sharedSync: boolean, sharedData: boolean, liveData: boolean}>}
 */
export function resolveWireProfile() {
  return hostMeta()
    .then((meta) => {
      const extensions = meta?.extensions || [];
      const hasSync = extensions.includes('sync');
      const hasLiveData = extensions.includes('live-data');
      const hasPresence = extensions.includes('presence');
      const sharedData = hasSync && hasLiveData && extensions.includes('sync-worker-data') && !hasPresence;
      const sharedSync = hasSync && !hasPresence && (sharedData || (extensions.includes('sync-worker') && !hasLiveData));
      return {
        profile: hasSync ? WIRE_PROFILES.spec : WIRE_PROFILES.legacy,
        sharedSync,
        sharedData,
        liveData: hasLiveData,
      };
    })
    .catch(() => ({
      profile: WIRE_PROFILES.legacy,
      sharedSync: false,
      sharedData: false,
      liveData: false,
    }));
}
