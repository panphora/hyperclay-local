function createNewTeamNotifier({ settings, saveSettings, notify }) {
  return function onDiscovery(accounts, { firstDiscoveryForKey }) {
    const seen = new Set(settings.seenTeamIds || []);
    const teams = accounts.filter((a) => a.kind === 'team');
    const fresh = teams.filter((a) => !seen.has(a.id));
    if (!fresh.length) return;
    if (!firstDiscoveryForKey) {
      for (const a of fresh) notify(a);
    }
    settings.seenTeamIds = [...seen, ...fresh.map((a) => a.id)];
    saveSettings(settings);
  };
}
module.exports = { createNewTeamNotifier };
