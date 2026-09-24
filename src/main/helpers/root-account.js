/**
 * The account a served root's helper requests are judged under (CONTRACTS §11). Team-ness is
 * the root's kind, not whether it still syncs: a disconnected team folder still holds
 * teammates' documents, so it never falls back to personal grants.
 */
function rootAccountFor(root, settings) {
  if (!root || root.kind !== 'team') return { accountId: null, teamName: null };
  const session = ((settings && settings.syncSessions) || []).find((s) => s.rootId === root.id);
  const former = root.formerAccount || null;
  const accountId = session?.accountId ?? former?.id ?? `root:${root.id}`;
  const teamName = session?.cached?.displayName || session?.cached?.username || former?.username || null;
  return { accountId, teamName };
}

module.exports = { rootAccountFor };
