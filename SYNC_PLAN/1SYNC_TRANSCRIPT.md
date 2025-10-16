# Sync Feature Requirements & Decisions

**Date:** October 13, 2025
**Status:** Requirements Definition

---

## Philosophy & Core Approach

I want to keep this feature really simple and straightforward to implement with elegant code. The primary use case is: you want to develop locally on your machine using your own file system and your own code editor, and then you want those changes to be really easy to sync to production.

I do want auto-syncing because I would like the ability to develop locally and see your changes in production live right away. We want to encourage and allow people to develop locally and see their changes live on the internet immediately. So as quickly as we can sync, the better.

---

## Core Sync Strategy

### Local to Remote (Push)

For syncing local to remote, we will watch the file system. **No debounce** - if you save a file, its changes should be synced to the server immediately.

### Remote to Local (Pull)

For getting changes from the remote to the local system, we should use polling. We can grab the metadata of all the remote files maybe every 10 seconds or so. If it finds a file that's been updated recently, then it will pull it down and overwrite any file locally with those changes. If it pulls and doesn't find any changes or updates since the last poll, then it won't do anything.

### Session-Based Sync

The endpoint that it calls should list all of the files, all of the folders, and all of the apps. In a single session, when the session starts and it pulls the first time, maybe it gets everything. But then on subsequent polls, it only gets the changed files.

The session is defined between when the connection was made between the local and the remote host.

---

## File Operations & Deletion Policy

### File Types

- **HTML files** are assumed to be applications
- **Every other file type** is assumed to just be an asset or an upload

### Deletion Policy

**We won't allow deleting.** If you delete a file locally, it won't be deleted on the remote. The user will have to manually go into the remote and delete it there. This is to keep things safe and make sure nothing gets accidentally deleted, because it's very easy to delete a file on your local system and not realize that you're affecting the remote.

**No files are removed from the remote, even if they're deleted on local.**

### Rename Policy

If you rename a file locally, it will create a new app in production. Same for rename - if you rename something on local, it's treated as creating a new file on the remote.

### Folder Structure

Because apps have a unique name across all of Hyperclay, on local you don't have to put them in a specific folder. If you have an app named "Hello World" and you have it in your root folder on local, and in the remote platform you have it inside a double-nested folder, it should still sync with the right application that's in the double-nested folder if they have the same file name.

When syncing: everything from local will be synced back up to the remote and placed in the folder that it was in on local. But if there's a conflict - like if a local app that has a certain name gets synced to the remote - the remote's location of that file will take precedence.

---

## Conflict Resolution

I don't really care about complex conflict resolution. I think we should just ignore that. **Last write wins** and we have backups on local and we have backups on the remote.

The conflict issue shouldn't really be an issue, especially because (at least right now) it's one owner per site. So they're in complete control of their application, and if they make a change on the remote, they should wait for it to sync to their local before they continue.

We're not dealing with merges. We're not going to use Git. We're not going to use any other technology. We're just using a very simple API that provides metadata since the latest change and tracks that in a session, and then we are syncing all the files back and forth based on the last updated date.

---

## Offline Handling

If they are offline, I don't think we should do anything initially.

When they reconnect to being online, I would want them to call the metadata endpoint remotely and get all the information locally about which files have changed. **If files have changed more recently on the remote, then overwrite the local. If they have changed more recently on local, then overwrite the remote.** Just keep it really simple.

I really don't want to implement a queue system where changes pile up - it just feels kind of complicated, especially if we're resolving the queue against what the remote is saying.

We definitely need to monitor the network state, and if we're offline and we don't have access to the network, then there's no point in retrying. We shouldn't try to sync at all. Then as soon as they connect to the internet, we should go through the sync policy described above.

---

## What to Sync

We're syncing everything down when we enable syncing at the start of a session. Then we're continuously polling and using the latest change timestamp to determine what to sync.

We should sync all files - basically everything, every type of file on the remote will be synced down to the local and will be placed in its appropriate folder. Everything from local will be synced back up to the remote.

For the initial sync, I'm not opposed to zipping up the remote contents and then unzipping them on local (and same for syncing everything back up). But I think for now, let's avoid zip files and just sync each asset individually. I think that will be simpler to implement and will keep this service really simple.

---

## Authentication

It's only paid subscribers who can access this feature.

I would prefer to have the authentication go to a browser window and then basically send some kind of callback to the local Electron app behind the scenes that just tells it, "Hey, this app is validated and it can now write and read from this user's account."

That's probably going to require some kind of OAuth setup, and maybe we have a local JWT token - just something that basically works like cookie authentication. A JSON Web Token that just says, "Hey, yeah, this user's authenticated."

### Single Account

We're going to allow a single connected account.

### Token Refresh

Whenever the user calls the API or interacts with the local app, their token should be refreshed. Maybe we do that once a day. So if the user is using the app consistently, their token is auto-refreshed indefinitely. But if they don't use it for, let's say, 10 days, then the token can expire and they have to log in again.

---

## Token Storage

The tokens should just be stored as a JSON Web Token on the local machine. Nothing too fancy. If the user's system is compromised, I don't think that's something we can do much about.

We don't want to encrypt local HTML backups.

---

## UI Design

The UI should be really simple. It should just be a single button in the local Electron app that says "Sync." If they click it, then they're taken to `hyperclay.com/[whatever URL]` to authenticate their local app.

When they're taken back, there should be a sync icon that is green. It should have an icon that looks like a sync icon, and then it says "Sync: On." They can click it to turn it off and then click it to turn it back on. As long as they're authenticated, they can toggle that back and forth.

### Additional Buttons

We'll need one more button: a **logout button**. If you decide to sync and turn that on, we will also need a logout button so they are free to disconnect from the remote.

### Minimal Status Display

The sync UI is super minimal. We don't really want to show the status of each app. We don't really want a status bar per site. We don't want to notify on every sync event. We just want it to work and to just show whether syncing is turned on or not. Everything else should just feel automatic.

There's not going to be a synchronization log visible in the UI, although there should be a plain text log file stored on disk. Just keep it simple - just in case people are running into issues, we can ask them to send us that log and we can help them debug.

---

## Environment Configuration

When I'm developing the Electron app locally, I want it to connect to `localhyperclay.com`. When it's being distributed for other people (during the build process), I want to change that to `hyperclay.com`. Maybe we use environment variables inside of a `.env` file to specify that.

---

## Backup Strategy

We're going to keep the backup strategy for local, so it will go into the `sites-versions` folder. The remote will also have its own backups.

### Critical: Always Backup Before Overwriting

**This is very important:** We need to keep all the changes, so we need to back up everything, whether we're syncing to local or syncing to remote.

- **If the latest save was on the remote** and that's coming down to the local, we need to save a local backup first
- **If we're pushing to the remote** because the local is the source of truth (it's the latest change), then we need to save a remote backup

Whenever a save is triggered by the remote on the local system, the local system treats that as a save process and it has to go through the standard app save process. Same thing: if the local triggers a change on the remote, it has to go through the save process and a backup will be created on the remote.

Both systems should go through their respective backup systems, so no matter what, they have backups both on remote and on local all the time.

---

## API & Implementation Details

For the endpoints that we use, I think it makes sense to make new endpoints for this, but they should work very similar to the current save endpoint that we have.

### Metadata Only

For the metadata that we send to the remote, I think we only need to send the raw content. I just want to keep this very simple.

### File Size Limits

For large payloads, maybe refuse anything that's over **20 megabytes**.

---

## Error Handling

### Upload Failures

If an upload fails, we can use a backoff strategy where we retry after a second, then after two seconds, then after three seconds, something like that. If it doesn't work after a five-second backoff, then we can just stop.

### Resource Limits

If they're running out of resources in their account - like they've reached the maximum amount of sites that they can have - then we should show an error in the local app. It should be an error message near the sync icon that says "You've run out of sites. We can't sync any more sites." We don't need to specify the site that's causing the issue. Again, I just want to keep this really simple and keep the UI very minimal.

---

## Simplicity Constraints

### What We're NOT Implementing

- No sync-specific rate limiting
- No resource usage monitoring
- No complex conflict resolution or merges
- No debouncing (sync immediately on save)
- No queue system for offline changes
- No status per app/site
- No notifications for every sync event
- No kill switch
- No remote command that pauses sync
- No real-time collaboration
- No plug-ins
- No third-party storage
- No UI for this on the hosted dashboard
- No triggering sync from the hosted dashboard
- No multi-owner sites support (not right now)
- No multiple device coordination
- We're not going to use Git or any complex sync technology

### What We Assume

- Single user machines
- Latest desktop app version only
- One owner per site (at least for now)

---

## Rollout & Support

### Release Strategy

We're going to release to **100% of users immediately**. Only paid subscribers can access this feature.

### Version Support

We're only going to support the latest desktop app version.

### Hosted Dashboard

There's not going to be any UI for this on the hosted dashboard. The hosted app will look the same as it does right now. Everything is going to be enabled in the local app. Once you authenticate, you're going to be able to enable the syncing.

### Debugging

There should be a synchronization log - a plain text log file stored on disk, just in case people are running into issues. We can ask them to send us that log and we can help them debug.

---

## Summary

This sync feature prioritizes simplicity and immediacy. Last write wins, backups everywhere, no complex conflict resolution, and the user stays in full control through simple on/off toggles. The goal is to make local development feel seamless while maintaining safety through comprehensive backup systems on both sides.
