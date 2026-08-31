# Changelog

## [1.23.0] - 2026-08-29

### Added
- Conditional saves. Discovery announces `conditional`, every save answer carries an `etag`, and a save sent with `If-Match` is refused with 412, nothing written, when the document changed underneath it. The comparison happens inside the write lock, since a stamp checked against bytes read outside it is the exact race the feature exists to close, and the stamp is computed over the bytes on disk rather than over a decoded copy of them.
- `format` is announced in discovery. This host has always honoured `formathtml="true"`, and a host that does not declare `format` is telling every client its bytes are kept verbatim.

### Changed
- `Document-URL` is read through one helper on `/_/save` and five other routes, so a seventh cannot drift away from the rest. This host was announcing the protocol while refusing the one header the protocol is built around.
- The live-sync relay reads both artifacts instead of half the message: a snapshot goes to the other editors, a document to the viewers. A request to update viewers with no save behind it used to be answered `success` and reach nobody. The relay also forwards `identityMap`, which receivers use to pair elements across a morph, and without which peer live sync lost focus and half-typed input on every frame.
- The relay forwards `etag` on the editor lane, so the tab that just saved can hand the other editors the stamp along with the bytes it saved. A tab may then adopt a stamp only as part of applying the content that stamp describes, rather than on the strength of a bare message that can outrun its own content. The viewer lane drops it: a viewer holds a whole document rather than a pre-strip snapshot, and has no save to condition.
- The 415 on a save that is not a document answers `unsupported-type`. It was `unsupported-media-type`, which the spec's registry lists nowhere; this host's upload route already answered the registered name.

### Fixed
- No save credential reaches disk, and none is handed to another tab. Both save-token spellings are stripped from the opening `<html>` tag on the save route, before the etag is computed so the stamp describes the bytes actually stored, and on the live-sync relay. This host injects no token of its own, which is why it was missed and why it matters anyway: a document that has been served by a host that does inject one carries the attribute in the bytes the browser posts back. A token on disk is permanent, and it also poisons the file for every later client, since a current client reads a document carrying only the pre-rename spelling as an out-of-date HTML Clay and takes editing away naming a product that is not running. The strip is scoped to the opening tag, so a document that merely writes *about* the attribute keeps what it wrote.
- A document that cannot be read is refused rather than treated as empty. The old path handed back the empty-content stamp and then accepted it on the retry, replacing bytes nothing had backed up.
- `changedBy` reports another tab only when the bytes are this host's own write and the file has not been rewritten since. An editor's undo restores the bytes but not the modification time.
- `npm run release` creates the version tag and pushes it. 1.22.0 through 1.22.6 shipped untagged, so there was no commit on record for what any of those builds contained.

## [1.21.0] - 2026-08-20

### Changed
- License: this and future versions ship under the First Million Stays Yours License; v1.20.1 was the last MIT release and stays MIT forever. This version becomes plain MIT on 2028-02-20.
