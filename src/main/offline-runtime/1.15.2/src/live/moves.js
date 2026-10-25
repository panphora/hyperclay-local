// The moves a store's log holds after `since` ({ epoch, seq }), for a tab that
// already applied everything through since.seq. [] when nothing is newer; null
// when the log no longer reaches back that far (its floor is past since.seq),
// so the tab cannot replay and takes the value as it is. A log may start above
// since.seq + 1 with nothing missing: the seqs between went to other stores.
export function movesSince(store, since) {
  if (!since || !Number.isInteger(since.seq)) return null;
  if (since.seq >= (store.last ?? 0)) return [];
  if (since.seq < (store.floor ?? 0)) return null;
  return store.log.filter((entry) => entry.seq > since.seq).map((entry) => ({ seq: entry.seq, ops: entry.ops }));
}
