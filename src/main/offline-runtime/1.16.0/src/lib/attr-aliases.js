// clayjs spells its attributes without a prefix, which is the whole pitch:
// <h1 editable> reads like HTML rather than like a framework. No attribute in the
// HTML standard uses these names and no proposal does either, so the risk of the
// spelling being taken is small. It is not zero, and a saved document hardcodes
// the attribute and can never be reached to migrate it.
//
// These clay- spellings are read everywhere the bare name is read, and are left
// out of the documentation on purpose. Their only job is to already exist in every
// 1.x build: if a bare name ever stops being ours, a file written today can be
// repaired by adding one attribute instead of needing a migration that cannot
// reach it. An escape hatch added after the collision would be worthless.
export const PERSIST = ":is([persist], [clay-persist])";
export const AUTOSAVE = ":is([autosave], [clay-autosave])";
