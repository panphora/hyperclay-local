# Changelog

## [Unreleased]

## [1.31.1] - 2026-10-17

### Changed
- No user-facing changes.

## [1.31.0] - 2026-10-15

### Added
- A writable macOS install updates in place. The new version downloads in the background and the popover offers Restart to update once it is ready, and the click waits for sync to go idle and shuts down cleanly first.
- A Windows install updates in place too. A per-user install downloads the update and restarts into it, and a machine-wide install keeps the download link.
- A Linux AppImage updates itself from a signed feed. The new image is checked against its sha512 and its signature, kept beside the running one, swapped in once the old process exits, and the old image is put back and the version remembered if the new one does not come up within 30 seconds.
- An install that cannot update in place takes its download link from the published release instead of from the package registry.

### Changed
- An update is refused while sync still has unsent work, with a message instead of discarding it. Any failure after the app has shut down for the update brings the current version back.
- A released version can no longer be published again with different bytes. Identical uploads are skipped, different ones ask for a new version number, and download links carry the sha512 so a cache never serves stale bytes.
- The app refuses an update feed older than one it has already seen.

## [1.30.3] - 2026-10-14

### Fixed
- A Windows installer's signature carries a timestamp, so Windows keeps trusting the download after the signing certificate expires.

## [1.30.2] - 2026-10-14

### Changed
- No user-facing changes.

## [1.30.1] - 2026-10-12

### Changed
- No user-facing changes.

## [1.30.0] - 2026-10-09

### Changed
- Renames, moves, new files and deletes are read from one comparison of the folder against its record, half a second after the changes stop, instead of from the order the watcher saw them. A rename stays a rename, and two folders moved at once keep their own identity.
- Under `uploads/`, a delete waits 3 seconds before it is sent, a move out is sent as a move, a mass delete waits for your choice in the popover, and a file that comes back within 7 days returns to where it was. Nothing else under `uploads/` can be deleted, moved or renamed.

### Fixed
- An upload name drops the characters Windows cannot store (`< > : " | ? *` and control characters), so a file gets one name on the web, the Mac and Windows instead of failing to upload on Windows.

## [1.29.0] - 2026-10-08

### Added
- Export a File as Zip in a folder's menu writes a document and the files it links through `/_/uploads/` as one zip, with the files linked relatively so the copy opens anywhere with its attachments.
- Use my profile in files, under Options, puts one person in every file: the Hyperclay account's public person when signed in, cached so it works offline, or a display name kept on this computer when signed out. Every folder answers it as `document.people.me` on `/_/meta`, and only to its own origin.
- A folder with attachments that cannot sync says how many instead of reading synced, and Notices lists each one with its size, the plan's limit and a Show File button. The rows clear when the file syncs, shrinks or is deleted.

### Changed
- Attachments live in `uploads/assets-<name>/` inside the folder and are linked as `/_/uploads/` paths, the same layout hyperclay.com uses, so a synced folder is byte-identical on both sides and moving a document never strands its files.
- An attachment over the plan's file-size cap stays on this computer instead of being sent, and is recorded so it is asked about again when the cap rises. A file that shrinks, or a cap that grows, clears it on its own.
- An AI edit falls back to Codex when Claude Code is not installed, instead of failing.

### Fixed
- Uploads refuse web-page types and every served file carries `nosniff`, so an attachment can no longer run script on the app's origin. A page type inside an uploads folder is served as a download, and an upload name is read the way it is stored.
- `/_/uploads/` serves only files inside the real uploads folder, and every byte of a name outside the unreserved set is escaped, so a name like `image (1).png` reads whole and a symlink out of the folder reaches nothing.
- Sync never deletes, renames or moves the `uploads/` folder itself. A Finder rename or move is renamed back, a delete is restored from the server, and the files inside stay fully syncable.
- A zip export survives a failed read. An error rejects instead of hanging, each export writes and removes its own temporary file, an existing zip is replaced only once the new one is complete, and a symlinked attachments folder is left out.

## [1.28.1] - 2026-10-04

### Added
- A served document carries `documentetag` on its root element, the stamp of the bytes being served, so a page can tell whether the version it holds is still the one on disk. The file on disk is untouched, and the stamp never reaches a save or another tab.

## [1.28.0] - 2026-10-03

### Added
- The JSON data API takes its rules from the request: a `data` parameter of `{title:h1}` shape, on `/_/api/<file>` or on the file's own address, for reads and writes, with no tag in the page. Supplied rules replace the page's `api` tag for that request and are never saved into the file.

### Changed
- Each complete source filename keeps its own data API cache, so `soup.html` and `soup.htmlclay` answer independently, and a request with its own rules skips the cache.

## [1.27.0] - 2026-10-01

### Changed
- AI editing is on by default. A settings file written before the switch existed reads as on, and turning it off in the tray still sticks.
- Every built-in agent runs with no tools. Claude Code runs with `--strict-mcp-config` in an empty scratch folder, so the MCP servers in your own Claude config no longer load for an AI edit. Codex runs with its shell and other tool features disabled and receives the prompt on standard input. `@agy` is refused as unsupported, because agy can read files without asking and has no switch to stop that.
- The agent is told to keep every attribute of the element it rewrites, and that a reply adding code is refused.
- A missing agent CLI names the agent and says how to pick another one.
- The prompt tells the agent where your selection sits in the page, so an edit can be asked about the part you picked.

### Fixed
- A page's `Document-URL` can no longer name a file outside the served folder. The browser lane now applies the same segment rules as the process lane and the static route.
- `@file` context follows symlinks only within the served folder, and is limited to 8 files, 256 KB each and 1 MB in total.
- One AI edit runs per document at a time, and a request that reuses a running request's id is refused.
- `@file` context refuses hidden files and folders, by name and after symlinks.
- Stopping an AI edit ends the agent's whole process, on macOS and Linux too, so nothing keeps running behind the popover.
- A leading `@notes.md` in a prompt is read as a file, not as an agent named `@note`.

## [1.26.0] - 2026-09-28

### Added
- The JSON data API takes writes: a `POST` of a JSON body to `/_/api/<file>` applies the body through the page's `api` rules and saves it through the same path as a save, content only, and a bare `/_/api` writes `index.html`. `GET` answers an `ETag`, and a `POST` sent with `If-Match` is refused with 412 when the document changed underneath it.
- A write through the data API reaches open edit tabs as an external change, with the same protection for a region someone is typing in.

### Fixed
- The data API refuses a document that is not UTF-8 rather than corrupting the bytes outside the edit, answers a JSON error for a body over its limit, and reads a file once so its `ETag` and its data describe the same bytes.
- A folder whose contents were replaced since it was set up pauses and says the folder changed, and sends no delete. Putting the original folder back resumes it.

## [1.25.0] - 2026-09-24

### Added
- A folder's menu shows the folder's path and has Copy Address.

### Changed
- The popover leads with the address, with labelled Serve and Sync switches above the footer and one line per folder. A folder gains a second line only when it needs attention, and activity sits in a tab beside Notices.

## [1.24.2] - 2026-09-24

### Fixed
- Sync falls back to hyperclay.com when no server address is stored, so a copy upgraded from an earlier version can discover and sync again.

## [1.24.1] - 2026-09-24

### Changed
- No user-facing changes.

## [1.24.0] - 2026-09-24

### Added
- Each synced account gets its own folder and its own local port. Settings from the single-folder version migrate on first start, and the folder that version synced stays where it is.
- The popover shows one card per folder with its status, the changes waiting, any conflict, when it last synced and the last error, and one activity feed covers every folder.
- The popover has one switch for the server and one for sync, and each applies to every folder.
- The tray menu lists each folder with its own menu. A folder can be opened in the browser, revealed, retried, given another port, disconnected or removed from there.
- A team you are added to arrives as a single notification.
- Team setup checks that the folder is empty and that there is room on disk, and picks up where it left off after a quit.
- A conflict is recorded and shown with a choice, instead of one side overwriting the other.
- Opening a document with Hyperclay Local from Finder serves it from the folder it is in. A document outside every folder says so and offers to open it in HTML Clay or show the personal folder.
- A `served-roots.json` file in the app's data folder lists every served folder and its port, for scripts and the command line.

### Changed
- Sync decides by checksum and the server's etag, never by clocks, and the calibrated clock offset is gone.
- A teammate's rename or move is applied here as a rename or move rather than read as a delete, and a destination that is already taken is moved aside.
- An edit made while a session is paused or offline is picked up when it resumes, and a launch with no network starts offline instead of failing.

### Fixed
- An expired or revoked key pauses every session and says so, and adding a new key resumes them.
- A missing folder, or records belonging to another account, pauses the session and sends no delete. A download never overwrites an edit made while it was fetching.
- Stopping a session cancels its first bind, even while it waits for a slot.

## [1.23.0] - 2026-08-29

### Added
- Save receipts. A save may carry a `Save-ID`, an opaque id a client mints for that one attempt, and this host remembers which id belongs to the bytes it currently stores, reporting it as `saveId` in discovery, on every accepted save, and on every 412. A client whose save timed out can then ask whether its own write is what landed, rather than guessing and either overwriting somebody else's work or showing a conflict notice over a few seconds of bad wifi. The id is kept beside the stamp of the bytes that save wrote and reported only while that stamp still matches what is on disk, so a write from a text editor, a git checkout, or the sync engine pulling a newer copy down invalidates it without any of them knowing it exists. An id is never minted here and is never a credential.
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
- The AWS S3 client is a build dependency, not an app dependency. Three release scripts use it to upload builds to R2 and nothing under `src/` imports it, but it sat in `dependencies`, and electron-builder bundles the production tree regardless of the `files` allowlist, so all 102 packages went into every download. One of them was a `fast-xml-parser` carrying a critical advisory, which is what a scanner reported. No code path in the app could reach it: `build-scripts/` is not in the archive, and the only window is sandboxed and loads a local file. Moving the client out and bringing it current removes the parser from the tree rather than pinning it, since current `@aws-sdk/xml-builder` no longer depends on it at all. `@floating-ui/react` left with it, a production dependency nothing in the repo ever imported.
- `express` moves to 4.22.2, which admits the fixed `qs`, `path-to-regexp` and `body-parser` it pins. These are the advisories here a user could actually reach: the server parses the query string on any request, and a page in the browser can send it one, since a `GET` carries a loopback `Host` and skips the origin check that guards the writing methods. The reachable ones are all denial of service against the local server, and the route table has no path where the `path-to-regexp` backtracking applies, so this is worth taking rather than urgent.
- The production dependency tree audits clean. `npm audit --omit=dev` reported 27 findings including one critical before this, and CI now runs that check as a gate so the next one is ours to find rather than a stranger's to report.

## [1.21.0] - 2026-08-20

### Changed
- License: this and future versions ship under the First Million Stays Yours License; v1.20.1 was the last MIT release and stays MIT forever. This version becomes plain MIT on 2028-02-20.
