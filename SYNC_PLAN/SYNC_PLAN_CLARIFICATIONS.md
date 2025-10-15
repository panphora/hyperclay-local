# Sync Plan Clarifications

## Overall Assessment

I do think this project is challenging, but I don't think it's as challenging as you think it will be. I think the core challenge is going to be doing the OAuth redirect and defining the endpoints in the Hyperclay production platform.

## Architecture Mismatch

The architecture mismatch is not really an issue. I think the only thing we really need to change is to allow people to create folders and allow people to put files into those folders and then automatically serve those files. If those files are HTML files, then treat them as HTML apps—just serve them by name. If you access `localhost/whatever`, then you can access the `whatever.html` file that is in any nested directory. I think that's pretty simple, to be honest.

It's not really a problem that there's no authentication, because the local app is meant to work without authentication. Users don't need to sign in to use it. They don't need to sync to the platform to use it. They are supposed to have simple backups on their local machine because this is a totally independent system that optionally syncs with the actual platform.

## Uploads

As for uploads, we don't really need to enable that on local because users can literally just copy and paste a file into a folder and then that file should just be served. So there's not really a point to allowing uploads, at least right now. Maybe in the future it'll make more sense.

However, I don't want to skip uploads initially. I think uploaded files are pretty core to the experience. But like I said, I think we don't really need to implement uploads on the client side. We just need to sync them to the server. They're just nodes as well, so I think they're going to actually be just as complicated as the apps. Once we get the HTML file syncing working, I think uploads are going to be super similar to that.

## Change Tracking & Folders

We definitely need to implement a change tracking API with cursors. We do need to have folder sync.

Here's the key: for HTML files, the name of the file should be synced with the app on the platform, no matter which folder it's in on local. It should sync to the one that has the same name on production. So the folder only matters if the app doesn't exist on production yet. If it doesn't exist, then we do actually want to use the folder structure it's in, and we want to create that on the platform in order to put the app in the right location.

But even there, I don't really care that much about that. If we placed apps that don't exist yet into the base directory on the platform, that wouldn't really be that bad. Then we could just sync with that app in the base directory, and if the user wants to move it, they can move it on the hosted platform. I really don't want to create too much complication around that.

For folder synchronization, honestly, just treat the platform as the source of truth. If we're trying to sync a new file or a new app, then the folder structure matters and we should create that on the remote. We might need a helper for that to create a folder path, and especially if it's deeply nested, might need some recursion there. But then we can just place the node or the upload into that location.

## Authentication

The auth system on the platform is complicated. I really don't want to interfere with that too much. I guess I would prefer to just have a separate token. It would be nice if we could just pass an auth token from the Electron app and it will just interpret the JSON web token as that same OAuth token. If we just passed in the resource name and the auth token, then the platform should be able to handle that.

We don't need cross-domain auth, actually, for custom domains, because we should always just sync with the Hyperclay version of the app, which is just a node that goes by a name. So we really don't need cross-domain auth at all. I would explicitly say this in the plan: we do not need cross-domain auth at all.

I would like more of an explanation about why OAuth in Electron with token management is going to be tricky. Anything you know about why that is tricky would be good.

## Deletion Handling

We never delete. It doesn't create zombie files because the platform is the source of truth. If you delete something on the platform, then that's when it's really deleted on the platform, because the platform is where things live on the internet. But it should be non-destructive in general. It should default to being non-destructive.

If you delete something on your local machine, it doesn't delete it on the platform. If you delete something on the platform, it shouldn't delete it on your local app. You can handle deletion yourself because that's a really sensitive issue. If you want to delete a site locally, delete it locally. If you want to delete it on remote, delete it on remote. There's no deleted marker file, there's no trash folder, there's no warning users about deletions, except for the warnings we already have in the platform.

## Rename Detection

For rename detection: if you rename on the platform, we already handle that. We actually just rename the node, so that's fine. On local, if you sync that file, it should just sync as a new file. Again, we're not going to delete anything that's synced from the platform.

If you rename something on local, it's going to be the same thing. It creates the new file, it uploads that new file to the platform, and nothing is deleted on the platform. The old app remains on the platform.

## Multi-Tenant Apps

For multi-tenant apps, they're just regular nodes because that's how they're treated on the platform. They should sync the same way as any other node. You can overwrite them from local and they store a backup of themselves every time they're overwritten. If they're edited on the platform, they store a backup of themselves. If they're edited on local and then they sync to the platform, then they store a backup of themselves. So we have backups and they just have the unique flag of having signups enabled. Otherwise they're the same as any other node.

## Sync Strategy

For the sync strategy, it would be great to do resumable uploads, but chunked uploads are fine. I think whatever is simplest to implement for this first version, let's just do that. Let's check the file size using the local app before we upload something and just show a warning in that single error message area that we have in the local app if something doesn't upload.

If the user has 100 sites with assets, we don't want any progress indication, we don't want any cancellation, we don't want any selective sync. That is very complicated. This is a new platform and we're just trying to get to the minimum viable product stage. So you enable syncing and then you just wait. Everything from the platform will be downloaded to your system and compared, and it will be overwritten if it needs to be. Vice versa, everything from your local system will be uploaded.

They're compared somewhere—I think probably compared on local. So I think first, we probably download to a temporary directory and then we compare the cursors to see which one takes priority. Then with whatever changes are remaining on local that we didn't receive from the remote, we should send back up to the remote. But I'm open to whatever syncing strategy makes sense. This is one of my first times implementing syncing, so any advice is appreciated.

The last modified timestamp needs to be consistent. We should use some kind of cursor or something for that so that we can have a consistent last modified field that's going to work between any type of local system and the platform that we have. So we can have a definitive idea of when the last edit to a file was made. Again, I don't have a ton of experience with this, but whatever the best practice is around implementing a system like this that consistently knows what the last modified time is, that's what I want to start with. I'm okay with overwriting things because everything's going to be backed up anyways, like I already explained.

## Conflict Resolution

I don't want any kind of conflict resolution UI. Just the most recent one should overwrite. I could use some advice about how to determine that in some kind of absolute way.

## UI Simplicity

We don't want anything more than the minimal UI. We just want the sync icon and whether the sync is on or off. I think we could rotate the sync icon if a sync is currently in progress.

I think we have one error message area in the local app, and I would just like to use that for whatever the most important error to resolve is and just show one error at a time. Some kind of error stack would be great where it auto-prioritizes the most important error.

No, I don't want a dry-run mode. That's, again, too complicated. I just want to keep this as simple as possible.

## Risk Assessment

All of the things you mentioned in the high-risk list, I don't really care about:

- **Both sides editing simultaneously**: That's just not an issue. We have a single-user kind of platform right now, so we should only expect one person to be editing at a time.

- **Token expiry during long operations**: I'm not worried about this because we have a 10-day window and if they're using that app, that token should be refreshed for another 10 days. If they're currently syncing or currently editing files, then that token should be automatically refreshed and the expiration shouldn't be an issue.

- **File watcher missing rapid saves**: Sure, that can be debounced.

- **Network failures**: I'm not really worried about that. It can be worked out manually. For now, this is a minimum viable product.

- **SQLite database locks**: We're not really worried about this because this is a small platform right now. We're not really at that scale yet.

We do need some kind of coordination system for the timing, as I've mentioned before.

## Implementation Strategy

The key message here is: let's just keep things minimal and simple.

The OAuth handling and the token storage is definitely going to be a major issue. Creating the API for overwriting and creating files from the local sync is going to be an issue. But I think if we create a simple pipeline where we can just pass the file and then the remote kind of figures out what to do with it:

- If it's an HTML file, treat it as an app
- If it's a different type of file, treat it as an upload
- If it's more than 20 megabytes, ignore it
- If it's in a nested folder and it's a new asset, then create that nested path and then create it

I think we should probably not integrate this into the existing API. The way that we currently have the routes defined, I think it should be relatively easy to split out a new route with new middleware and just have this be a special case where we sync things to an API for syncing.

I think we can keep this really simple and manageable while having it be really performant and amazing for users.
