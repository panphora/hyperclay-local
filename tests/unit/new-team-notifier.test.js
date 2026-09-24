const { createNewTeamNotifier } = require('../../src/main/new-team-notifier');

const acme = { id: 42, kind: 'team', username: 'acme', displayName: 'Acme' };
const beta = { id: 51, kind: 'team', username: 'beta', displayName: 'Beta' };
const alex = { id: 17, kind: 'personal', username: 'alex', displayName: 'alex' };

function harness(settings = {}) {
  const saveSettings = jest.fn();
  const notify = jest.fn();
  const onDiscovery = createNewTeamNotifier({ settings, saveSettings, notify });
  return { onDiscovery, settings, saveSettings, notify };
}

describe('createNewTeamNotifier', () => {
  test('first discovery for a key with two teams notifies nothing and saves both ids', () => {
    const { onDiscovery, settings, saveSettings, notify } = harness({ seenTeamIds: [] });

    onDiscovery([acme, beta], { firstDiscoveryForKey: true });

    expect(notify).not.toHaveBeenCalled();
    expect(settings.seenTeamIds).toEqual([42, 51]);
    expect(saveSettings).toHaveBeenCalledWith(settings);
  });

  test('later discovery with one new team notifies once with that account and saves its id', () => {
    const { onDiscovery, settings, saveSettings, notify } = harness({ seenTeamIds: [42] });

    onDiscovery([acme, beta], { firstDiscoveryForKey: false });

    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(beta);
    expect(settings.seenTeamIds).toEqual([42, 51]);
    expect(saveSettings).toHaveBeenCalledWith(settings);
  });

  test('the same new team seen again notifies nothing', () => {
    const { onDiscovery, saveSettings, notify } = harness({ seenTeamIds: [42] });

    onDiscovery([acme], { firstDiscoveryForKey: false });

    expect(notify).not.toHaveBeenCalled();
    expect(saveSettings).not.toHaveBeenCalled();
  });

  test('personal accounts never notify and are never saved', () => {
    const { onDiscovery, settings, saveSettings, notify } = harness({ seenTeamIds: [] });

    onDiscovery([alex], { firstDiscoveryForKey: false });
    onDiscovery([alex, acme], { firstDiscoveryForKey: false });

    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(acme);
    expect(settings.seenTeamIds).toEqual([42]);
    expect(saveSettings).toHaveBeenCalledTimes(1);
  });

  test('saveSettings is not called when nothing is new', () => {
    const { onDiscovery, saveSettings, notify } = harness({ seenTeamIds: [42, 51] });

    onDiscovery([acme, beta], { firstDiscoveryForKey: false });

    expect(notify).not.toHaveBeenCalled();
    expect(saveSettings).not.toHaveBeenCalled();
  });
});
