const { profilePatch, accountSettingsUrl, profileErrorMessage } = require('../../src/main/ui/main-ipc');

describe('profilePatch keeps only what set-profile accepts', () => {
  test('enabled alone is kept', () => {
    expect(profilePatch({ enabled: true })).toEqual({ enabled: true });
    expect(profilePatch({ enabled: false })).toEqual({ enabled: false });
  });

  test('name alone is kept', () => {
    expect(profilePatch({ name: 'Ada' })).toEqual({ name: 'Ada' });
  });

  test('both are kept', () => {
    expect(profilePatch({ enabled: true, name: 'Ada' })).toEqual({ enabled: true, name: 'Ada' });
  });

  test('extra keys are dropped', () => {
    expect(profilePatch({ enabled: true, id: 'x' })).toEqual({ enabled: true });
  });

  test('a name of 1000 characters is kept, 1001 is not', () => {
    expect(profilePatch({ name: 'a'.repeat(1000) })).toEqual({ name: 'a'.repeat(1000) });
    expect(profilePatch({ name: 'a'.repeat(1001) })).toBeNull();
  });

  test('a wrong type anywhere rejects the whole patch', () => {
    expect(profilePatch({ enabled: 'yes' })).toBeNull();
    expect(profilePatch({ name: 5 })).toBeNull();
    expect(profilePatch({ enabled: true, name: 5 })).toBeNull();
  });

  test('nothing to change is null', () => {
    expect(profilePatch({})).toBeNull();
    expect(profilePatch(null)).toBeNull();
    expect(profilePatch(undefined)).toBeNull();
    expect(profilePatch({ other: 1 })).toBeNull();
    expect(profilePatch('enabled')).toBeNull();
  });
});

describe('accountSettingsUrl points at the connected server, never a page-supplied URL', () => {
  test('a hyperclay https server answers its own dashboard', () => {
    expect(accountSettingsUrl('https://hyperclay.com')).toBe('https://hyperclay.com/dashboard');
    expect(accountSettingsUrl('https://hyperclay.com/some/path')).toBe('https://hyperclay.com/dashboard');
  });

  test('a local server over http is allowed', () => {
    expect(accountSettingsUrl('http://localhost:4321')).toBe('http://localhost:4321/dashboard');
  });

  test('anything else is blocked', () => {
    expect(accountSettingsUrl('http://evil.example')).toBeNull();
    expect(accountSettingsUrl('javascript:alert(1)')).toBeNull();
    expect(accountSettingsUrl('file:///etc')).toBeNull();
    expect(accountSettingsUrl('')).toBeNull();
    expect(accountSettingsUrl(undefined)).toBeNull();
  });
});

describe('profileErrorMessage is user-facing', () => {
  test('each known code has its own text', () => {
    expect(profileErrorMessage('offline')).toBe("Couldn't reach Hyperclay to check your account. Try again when you're online.");
    expect(profileErrorMessage('changed')).toBe('Your account changed while checking. Try again.');
    expect(profileErrorMessage('server-update-required')).toBe('Update the server to use your account profile.');
    expect(profileErrorMessage('save-failed')).toBe("Couldn't save your profile settings.");
    expect(profileErrorMessage('credentials-rejected')).toBe('Hyperclay rejected your sync key. Reconnect it in Options > Sync Key.');
  });

  test('a name rule message passes through', () => {
    expect(profileErrorMessage('Use a name, not an email address.')).toBe('Use a name, not an email address.');
  });

  test('an unknown error falls back to the generic text', () => {
    expect(profileErrorMessage(undefined)).toBe("Couldn't save your profile settings.");
  });
});
