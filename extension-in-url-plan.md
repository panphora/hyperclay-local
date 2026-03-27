# Plan: Always include file extension in URL path

## Problem
- Extensionless URLs make it impossible to distinguish file path from SPA route
- Save path always resolves to `.html`, breaking `.htmlclay` round-trip editing (issue #1)

## Solution
URLs always include the file extension. The extension acts as the boundary between file path and SPA route:
- `/blog/blog.html/dashboard/settings` → file: `blog/blog.html`, SPA route: `/dashboard/settings`
- `/notes.htmlclay/edit` → file: `notes.htmlclay`, SPA route: `/edit`

## Changes

### 1. Serving middleware (server.js ~line 362-476)
Replace the entire `serveWithFallback` logic with:
- Scan URL segments for the first one ending in `.html` or `.htmlclay`
- If found: everything up to and including that segment = file path, rest = SPA route. Serve the file.
- If not found: serve static files (CSS, images, etc.) or directory listings as-is
- Remove the extensionless `.html`/`.htmlclay` fallback (lines 418-434)
- Remove the first-segment client-side routing hack (lines 436-468)
- Root `/` and all directory paths always show directory listings (never auto-serve index.html)

### 2. `validateAndResolvePath` (server.js ~line 39-68)
- Accept the full filename with extension instead of appending `.html`
- Support both `.html` and `.htmlclay` extensions
- Reject names that don't end in either

### 3. `resolveResourceFromHref` (server.js ~line 77-93)
- Currently strips `.html` to get a bare name, then `validateAndResolvePath` adds it back
- Now: keep the extension, strip any SPA route suffix (everything after `.html`/`.htmlclay`)
- Return the relative file path with extension (e.g. `blog/blog.html`)
- `/` → `index.html` as a special case. Directory/extensionless URLs return as-is and fail validation (correct — only extension-based URLs are saveable)

### 4. Save route (server.js ~line 234)
- No structural change needed — `resolveResourceFromHref` now returns the correct path with extension
- `validateAndResolvePath` now uses that extension directly
- Fixes issue #1 automatically

### 5. Directory listing (already works)
- `serveDirListing` already builds `file.path` with the full filename including extension (line 576)
- Template links: `href="/<%= file.path %>"` already points to e.g. `/blog/blog.html`
- No changes needed

### 6. Live-sync endpoints
- `/live-sync/stream?file=` and `/live-sync/save` both use `resolveResourceFromHref`
- Will get the fix for free from change #3

## Not in scope
- `appname` injection (being removed separately)
- htmlclay (Go server) changes — already uses full extension in URLs
