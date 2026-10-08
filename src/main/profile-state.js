const crypto = require('crypto');
const { getServerBaseUrl } = require('./utils/utils');

// The same rules ClayJS applies to a host's person, so a name the app accepts is never
// silently replaced by the browser's own prompt.
const ID = /^[A-Za-z0-9_-]{8,64}$/;
const EMAIL = /\S+@\S+\.\S+/;
const MAX_NAME = 120;

/** `{ name }` with whitespace collapsed, or `{ error }` saying what is wrong. */
function cleanName(value) {
  const name = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  if (!name) return { error: 'Enter a name.' };
  if (name.length > MAX_NAME) return { error: 'Use a name of 120 characters or fewer.' };
  if (EMAIL.test(name)) return { error: 'Use a name, not an email address.' };
  return { name };
}

/** A `{ id, name }` ClayJS will accept, or null. */
function cleanPerson(person) {
  if (!person || typeof person !== 'object' || typeof person.id !== 'string' || !ID.test(person.id)) return null;
  const { name } = cleanName(person.name);
  return name ? { id: person.id, name } : null;
}

/** 16 random bytes as unpadded base64url: 22 characters. */
function newProfileId() {
  return crypto.randomBytes(16).toString('base64url');
}

function originOf(url) {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

// A saved key is a connection. Installs upgraded from v1 never stored a server, and sync
// uses the default one for them, so identity does the same.
function connected(settings) {
  return !!(settings && (settings.hasApiKey || settings.apiKey));
}

function serverOrigin(settings) {
  return originOf(getServerBaseUrl(settings && settings.serverUrl));
}

/**
 * The cloud person cached for this connection, or null. A cache made for another server
 * never answers for this one.
 */
function cachedCloudPerson(settings) {
  const cache = settings && settings.cloudPerson;
  if (!cache || !connected(settings) || cache.origin !== serverOrigin(settings)) return null;
  return cleanPerson(cache.person);
}

/**
 * Who documents served by this app see as `me`.
 *   { me: null }              sharing off, or signed out with no local profile
 *   { me: { id, name } }      the cloud person when connected, else the local profile
 *   { unavailable: true }     sharing on and connected, but no valid cloud person for this
 *                             connection (never stand in the local profile for an account)
 */
function currentPerson(settings) {
  const profile = (settings && settings.profile) || {};
  if (profile.enabled !== true) return { me: null };
  if (connected(settings)) {
    const person = cachedCloudPerson(settings);
    return person ? { me: person } : { unavailable: true };
  }
  return { me: cleanPerson({ id: profile.id, name: profile.name }) };
}

/**
 * The settings to save after a discovery answer. Returns the same object when nothing
 * changes. An answer with no valid `actor.person` drops the cache, so an older server reads
 * as "identity unavailable" rather than as somebody else. Only `cloudPerson` is written:
 * `settings.actor` belongs to sync.
 */
function withDiscoveredActor(settings, discovery) {
  const actor = discovery && discovery.actor;
  const person = actor ? cleanPerson(actor.person) : null;
  const next = person ? { origin: serverOrigin(settings), actorId: actor.id, person } : undefined;
  if (JSON.stringify(next) === JSON.stringify(settings.cloudPerson)) return settings;
  const copy = { ...settings };
  if (next) copy.cloudPerson = next;
  else delete copy.cloudPerson;
  return copy;
}

/** Settings with the cloud person forgotten: sign-out, or a key the server rejected. */
function withoutCloudPerson(settings) {
  if (!('cloudPerson' in settings)) return settings;
  const copy = { ...settings };
  delete copy.cloudPerson;
  return copy;
}

/**
 * Settings with the local profile changed. `patch` may set `enabled` and `name`.
 * Mints an id the first time a name is set; never changes an existing one.
 * Returns `{ settings }` or `{ error }`.
 */
function withProfile(settings, patch = {}) {
  const current = settings.profile || { enabled: false };
  const next = { ...current };
  if ('name' in patch) {
    const result = cleanName(patch.name);
    if (result.error) return { error: result.error };
    next.name = result.name;
    if (!next.id) next.id = newProfileId();
  }
  if ('enabled' in patch) next.enabled = patch.enabled === true;
  return { settings: { ...settings, profile: next } };
}

module.exports = { cleanName, cleanPerson, newProfileId, originOf, currentPerson, cachedCloudPerson, withDiscoveredActor, withoutCloudPerson, withProfile, connected };
