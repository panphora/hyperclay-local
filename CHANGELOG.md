# Changelog

## [1.23.0] - 2026-08-29

### Added
- Conditional saves. Discovery announces `conditional`, every save answer carries an `etag`, and a save sent with `If-Match` is refused with 412, nothing written, when the document changed underneath it. The comparison happens inside the write lock, since a stamp checked against bytes read outside it is the exact race the feature exists to close, and the stamp is computed over the bytes on disk rather than over a decoded copy of them.
- `format` is announced in discovery. This host has always honoured `formathtml="true"`, and a host that does not declare `format` is telling every client its bytes are kept verbatim.

### Changed
- `Document-URL` is read through one helper on `/_/save` and five other routes, so a seventh cannot drift away from the rest. This host was announcing the protocol while refusing the one header the protocol is built around.
- The live-sync relay reads both artifacts instead of half the message: a snapshot goes to the other editors, a document to the viewers. A request to update viewers with no save behind it used to be answered `success` and reach nobody. The relay also forwards `identityMap`, which receivers use to pair elements across a morph, and without which peer live sync lost focus and half-typed input on every frame.

### Fixed
- A document that cannot be read is refused rather than treated as empty. The old path handed back the empty-content stamp and then accepted it on the retry, replacing bytes nothing had backed up.
- `changedBy` reports another tab only when the bytes are this host's own write and the file has not been rewritten since. An editor's undo restores the bytes but not the modification time.
- `npm run release` creates the version tag and pushes it. 1.22.0 through 1.22.6 shipped untagged, so there was no commit on record for what any of those builds contained.

## [1.21.0] - 2026-08-20

### Changed
- License: this and future versions ship under the First Million Stays Yours License; v1.20.1 was the last MIT release and stays MIT forever. This version becomes plain MIT on 2028-02-20.
