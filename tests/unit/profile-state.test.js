const {
  cleanName,
  cleanPerson,
  newProfileId,
  originOf,
  currentPerson,
  cachedCloudPerson,
  withDiscoveredActor,
  withoutCloudPerson,
  withProfile
} = require('../../src/main/profile-state');

const SERVER = 'https://hyperclay.com';
const LOCAL_ID = 'L0c4lPr0f1l3Id0000000';
const CLOUD_ID = 'q8Zr2mKx0vTn4yWb7cLd1e';
const OTHER_ID = 'p9Ys3nLw1xUo5zXc8dMe2f';

const connected = (extra = {}) => ({ apiKey: 'key-1', serverUrl: SERVER, profile: { enabled: true }, ...extra });
const localProfile = { enabled: true, id: LOCAL_ID, name: 'Ada Chen' };
const cachedPerson = (person, origin = SERVER) => ({ origin, actorId: 42, person });

const deepFreeze = (value) => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
};

describe('cleanName', () => {
  test('collapses whitespace and rejects empty input', () => {
    expect(cleanName('  Ada   Chen  ')).toEqual({ name: 'Ada Chen' });
    expect(cleanName('')).toEqual({ error: 'Enter a name.' });
    expect(cleanName('   ')).toEqual({ error: 'Enter a name.' });
    expect(cleanName(undefined)).toEqual({ error: 'Enter a name.' });
    expect(cleanName(42)).toEqual({ error: 'Enter a name.' });
  });

  test('rejects an email address', () => {
    expect(cleanName('a@b.co')).toEqual({ error: 'Use a name, not an email address.' });
  });

  test('counts length in UTF-16 units, not code points', () => {
    expect(cleanName('a'.repeat(120))).toEqual({ name: 'a'.repeat(120) });
    expect(cleanName('a'.repeat(121))).toEqual({ error: 'Use a name of 120 characters or fewer.' });
    expect(cleanName('😀'.repeat(60))).toEqual({ name: '😀'.repeat(60) });
    expect(cleanName('😀'.repeat(61))).toEqual({ error: 'Use a name of 120 characters or fewer.' });
  });
});

describe('cleanPerson', () => {
  test('accepts an id ClayJS will take and a clean name', () => {
    expect(cleanPerson({ id: CLOUD_ID, name: '  Ada   Chen ' })).toEqual({ id: CLOUD_ID, name: 'Ada Chen' });
  });

  test('rejects a bad id, a missing name, or an email for a name', () => {
    expect(cleanPerson({ id: 'short', name: 'Ada' })).toBeNull();
    expect(cleanPerson({ id: CLOUD_ID })).toBeNull();
    expect(cleanPerson({ id: CLOUD_ID, name: 'a@b.co' })).toBeNull();
    expect(cleanPerson(null)).toBeNull();
    expect(cleanPerson('nope')).toBeNull();
  });
});

describe('newProfileId and originOf', () => {
  test('mints a 22-character unpadded base64url id', () => {
    const id = newProfileId();
    expect(id).toHaveLength(22);
    expect(id).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(newProfileId()).not.toBe(id);
  });

  test('normalizes an origin and gives null for a non-URL', () => {
    expect(originOf('https://hyperclay.com/dashboard/?x=1')).toBe(SERVER);
    expect(originOf('https://hyperclay.com/')).toBe(SERVER);
    expect(originOf('not a url')).toBeNull();
    expect(originOf(undefined)).toBeNull();
  });
});

describe('currentPerson state table', () => {
  test('no profile, or sharing disabled, means nobody', () => {
    expect(currentPerson({})).toEqual({ me: null });
    expect(currentPerson(undefined)).toEqual({ me: null });
    expect(currentPerson({ profile: { enabled: false, id: LOCAL_ID, name: 'Ada Chen' } })).toEqual({ me: null });
    expect(currentPerson({ profile: { id: LOCAL_ID, name: 'Ada Chen' } })).toEqual({ me: null });
  });

  test('signed out with sharing enabled uses the local profile, or nobody without one', () => {
    expect(currentPerson({ profile: localProfile })).toEqual({ me: { id: LOCAL_ID, name: 'Ada Chen' } });
    expect(currentPerson({ profile: { enabled: true } })).toEqual({ me: null });
    expect(currentPerson({ profile: { enabled: true, name: 'Ada Chen' } })).toEqual({ me: null });
    expect(currentPerson({ profile: { enabled: true, id: LOCAL_ID } })).toEqual({ me: null });
  });

  test('connected with a valid cache for this origin uses the cloud person, not the local one', () => {
    const settings = connected({ profile: localProfile, cloudPerson: cachedPerson({ id: CLOUD_ID, name: 'Ada Cloud' }) });
    expect(currentPerson(settings)).toEqual({ me: { id: CLOUD_ID, name: 'Ada Cloud' } });
    expect(currentPerson(settings).me.id).not.toBe(LOCAL_ID);
    expect(cachedCloudPerson(settings)).toEqual({ id: CLOUD_ID, name: 'Ada Cloud' });
  });

  test('a hasApiKey flag alone counts as connected', () => {
    const settings = { hasApiKey: true, serverUrl: SERVER, profile: localProfile, cloudPerson: cachedPerson({ id: CLOUD_ID, name: 'Ada Cloud' }) };
    expect(currentPerson(settings)).toEqual({ me: { id: CLOUD_ID, name: 'Ada Cloud' } });
  });

  test('no stored server means the default server, and never the local profile', () => {
    const upgraded = { hasApiKey: true, apiKey: 'hcsk_x', profile: localProfile };
    expect(currentPerson(upgraded)).toEqual({ unavailable: true });

    const discovered = { ...upgraded, cloudPerson: cachedPerson({ id: CLOUD_ID, name: 'Ada Cloud' }) };
    expect(currentPerson(discovered)).toEqual({ me: { id: CLOUD_ID, name: 'Ada Cloud' } });
  });

  test('connected but unresolved is unavailable, and never falls back to the local profile', () => {
    const local = localProfile;
    const otherOrigin = connected({ profile: local, cloudPerson: cachedPerson({ id: CLOUD_ID, name: 'Ada Cloud' }, 'https://other.example') });
    expect(currentPerson(otherOrigin)).toEqual({ unavailable: true });

    const noCache = connected({ profile: local });
    expect(currentPerson(noCache)).toEqual({ unavailable: true });

    const invalidCache = connected({ profile: local, cloudPerson: cachedPerson({ id: 'nope', name: 'Ada Cloud' }) });
    expect(currentPerson(invalidCache)).toEqual({ unavailable: true });

    for (const result of [currentPerson(otherOrigin), currentPerson(noCache), currentPerson(invalidCache)]) {
      expect(result.me).toBeUndefined();
      expect(result.me).not.toEqual({ id: LOCAL_ID, name: 'Ada Chen' });
    }
  });

  test('matches the cache origin across a path and a trailing slash', () => {
    const settings = connected({ serverUrl: 'https://hyperclay.com/', cloudPerson: cachedPerson({ id: CLOUD_ID, name: 'Ada Cloud' }) });
    expect(currentPerson(settings)).toEqual({ me: { id: CLOUD_ID, name: 'Ada Cloud' } });

    const withPath = connected({ serverUrl: 'https://hyperclay.com/dashboard/', cloudPerson: cachedPerson({ id: CLOUD_ID, name: 'Ada Cloud' }) });
    expect(currentPerson(withPath)).toEqual({ me: { id: CLOUD_ID, name: 'Ada Cloud' } });
  });
});

describe('withDiscoveredActor', () => {
  test('caches { origin, actorId, person } and returns the identical object for the same answer', () => {
    const settings = deepFreeze(connected());
    const discovery = { actor: { id: 42, person: { id: CLOUD_ID, name: 'Ada Chen' } } };

    const cached = withDiscoveredActor(settings, discovery);
    expect(cached).not.toBe(settings);
    expect(cached.cloudPerson).toEqual({ origin: SERVER, actorId: 42, person: { id: CLOUD_ID, name: 'Ada Chen' } });
    expect('cloudPerson' in settings).toBe(false);
    expect(settings).toEqual(connected());

    expect(withDiscoveredActor(cached, discovery)).toBe(cached);
    expect(withDiscoveredActor(cached, { actor: { id: 42, person: { id: CLOUD_ID, name: '  Ada   Chen ' } } })).toBe(cached);
  });

  test('an answer with no valid person drops the cache', () => {
    const cached = withDiscoveredActor(connected(), { actor: { id: 42, person: { id: CLOUD_ID, name: 'Ada Chen' } } });

    expect('cloudPerson' in withDiscoveredActor(cached, { actor: { id: 42 } })).toBe(false);
    expect('cloudPerson' in withDiscoveredActor(cached, { actor: { id: 42, person: { id: 'nope', name: 'Ada' } } })).toBe(false);
    expect('cloudPerson' in withDiscoveredActor(cached, { actor: { id: 42, person: { id: CLOUD_ID, name: 'a@b.co' } } })).toBe(false);
    expect('cloudPerson' in withDiscoveredActor(cached, {})).toBe(false);
    expect('cloudPerson' in withDiscoveredActor(cached, null)).toBe(false);
  });

  test('writes cloudPerson only, and leaves settings.actor to sync', () => {
    const person = { id: CLOUD_ID, name: 'Ada Chen' };
    const settings = { actor: { id: null, username: 'ada' }, hasApiKey: true };

    const cached = withDiscoveredActor(settings, { actor: { id: 42, person } });
    expect(cached.actor).toEqual({ id: null, username: 'ada' });
    expect(cached.cloudPerson).toEqual({ origin: SERVER, actorId: 42, person });
    expect(settings.cloudPerson).toBeUndefined();

    const dropped = withDiscoveredActor(cached, { actor: { id: 42 } });
    expect(dropped.actor).toEqual({ id: null, username: 'ada' });
    expect('cloudPerson' in dropped).toBe(false);

    const forgotten = withoutCloudPerson(cached);
    expect(forgotten.actor).toEqual({ id: null, username: 'ada' });
    expect('cloudPerson' in forgotten).toBe(false);
  });

  test('does not mutate a deep-frozen input and returns a copy only when something changes', () => {
    const settings = deepFreeze(connected({ cloudPerson: cachedPerson({ id: CLOUD_ID, name: 'Ada Cloud' }) }));
    const before = JSON.stringify(settings);

    const unchanged = withDiscoveredActor(settings, { actor: { id: 42, person: { id: CLOUD_ID, name: 'Ada Cloud' } } });
    expect(unchanged).toBe(settings);

    const changed = withDiscoveredActor(settings, { actor: { id: 7, person: { id: OTHER_ID, name: 'Bo' } } });
    expect(changed).not.toBe(settings);
    expect(JSON.stringify(settings)).toBe(before);
    expect(changed.cloudPerson).toEqual({ origin: SERVER, actorId: 7, person: { id: OTHER_ID, name: 'Bo' } });
  });
});

describe('identity transitions', () => {
  test('the same human keeps their id when the key rotates', () => {
    const key1 = connected({ apiKey: 'key-1', profile: localProfile });
    const cached = withDiscoveredActor(key1, { actor: { id: 42, person: { id: CLOUD_ID, name: 'Ada Chen' } } });
    const me1 = currentPerson(cached).me;

    const key2 = { ...cached, apiKey: 'key-2' };
    expect(currentPerson(key2).me).toEqual(me1);

    const refreshed = withDiscoveredActor(key2, { actor: { id: 42, person: { id: CLOUD_ID, name: 'Ada Chen' } } });
    expect(currentPerson(refreshed).me).toEqual(me1);
    expect(currentPerson(refreshed).me.id).toBe(me1.id);
  });

  test('the same numeric actor id on another server is unavailable until that server answers', () => {
    const A = 'https://a.example';
    const B = 'https://b.example';
    const onA = withDiscoveredActor(connected({ serverUrl: A }), { actor: { id: 42, person: { id: CLOUD_ID, name: 'Ada' } } });

    const onB = { ...onA, serverUrl: B };
    expect(currentPerson(onB)).toEqual({ unavailable: true });

    const discoveredOnB = withDiscoveredActor(onB, { actor: { id: 42, person: { id: OTHER_ID, name: 'Bo' } } });
    expect(currentPerson(discoveredOnB)).toEqual({ me: { id: OTHER_ID, name: 'Bo' } });
  });
});

describe('withoutCloudPerson', () => {
  test('removes only the cloud person cache', () => {
    const settings = connected({ profile: localProfile, actor: { id: null, username: 'ada' }, cloudPerson: cachedPerson({ id: CLOUD_ID, name: 'Ada Cloud' }) });
    const signedOut = withoutCloudPerson(settings);

    expect('cloudPerson' in signedOut).toBe(false);
    expect(signedOut.actor).toEqual({ id: null, username: 'ada' });
    expect(signedOut.apiKey).toBe('key-1');
    expect(signedOut.serverUrl).toBe(SERVER);
    expect(signedOut.profile).toEqual(localProfile);
    expect('cloudPerson' in settings).toBe(true);

    expect(withoutCloudPerson(signedOut)).toBe(signedOut);
    expect(currentPerson({ profile: signedOut.profile })).toEqual({ me: { id: LOCAL_ID, name: 'Ada Chen' } });
  });
});

describe('withProfile', () => {
  test('mints a 22-character id the first time a name is set, and never changes it', () => {
    const empty = {};
    const first = withProfile(empty, { name: 'Ada Chen', enabled: true });
    expect(first.error).toBeUndefined();
    expect(first.settings.profile.name).toBe('Ada Chen');
    expect(first.settings.profile.enabled).toBe(true);
    expect(first.settings.profile.id).toHaveLength(22);
    expect(empty).toEqual({});

    const id = first.settings.profile.id;

    const renamed = withProfile(first.settings, { name: 'Ada C.' });
    expect(renamed.settings.profile.id).toBe(id);
    expect(renamed.settings.profile.name).toBe('Ada C.');
    expect(renamed.settings.profile.enabled).toBe(true);

    const toggled = withProfile(renamed.settings, { enabled: false });
    expect(toggled.settings.profile.id).toBe(id);
    expect(toggled.settings.profile.enabled).toBe(false);
    expect(toggled.settings.profile.name).toBe('Ada C.');
  });

  test('keeps other settings untouched', () => {
    const settings = connected({ deviceId: 'device-1' });
    const next = withProfile(settings, { name: 'Ada Chen' });
    expect(next.settings.apiKey).toBe('key-1');
    expect(next.settings.deviceId).toBe('device-1');
  });

  test('an email returns the error and no settings', () => {
    const result = withProfile(connected(), { name: 'a@b.co' });
    expect(result.settings).toBeUndefined();
    expect(result.error).toBe('Use a name, not an email address.');
  });

  test('enabling alone is allowed and signs out to nobody', () => {
    const result = withProfile({}, { enabled: true });
    expect(result.error).toBeUndefined();
    expect(result.settings.profile).toEqual({ enabled: true });
    expect(currentPerson(result.settings)).toEqual({ me: null });
  });
});
