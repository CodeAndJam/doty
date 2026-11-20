# The app updates itself from GitHub, without a Developer ID

Doty is ad-hoc signed and not notarized. `electron-updater` is built on Squirrel.Mac, which validates
the incoming bundle's signature against the running app's designated requirement. An ad-hoc
signature has no identity to compare — its requirement is a cdhash, and that changes with every
build — so every update would be rejected. Nothing in the config fixes that; it is a signing
requirement, not a bug.

So Doty checks GitHub itself: one `GET /repos/CodeAndJam/doty/releases` per launch, the newest
non-draft, non-prerelease tag that parses as a version, and its `arm64` DMG. A newer release shows as
a slim bar at the bottom of the window. The DM clicks **Update & restart**; the app downloads the
DMG, verifies the bundle's seal, quits, and a detached script swaps the bundle in place and reopens
it.

Status: accepted

## Why not the browser download path

`com.apple.quarantine` is written by the downloading application — Safari, Chrome, Mail — not by the
filesystem and not by `https`. A DMG streamed to disk by the app carries no quarantine flag, and
neither do the files inside it, so Gatekeeper never assesses the swapped-in bundle and the DM is
never asked to run `xattr -cr` again. The first install still needs it, because that DMG came from a
browser.

## Considered Options

- **`electron-updater` with a zip target.** Rejected: Squirrel's signature validation cannot pass on
  an ad-hoc signed app.
- **Buy a Developer ID and notarize.** Not rejected on merit, only on cost; if one exists later, this
  path keeps working, and it is the only one that keeps working for a DM who never notarizes.
- **Open the DMG in Finder and let the DM drag.** Rejected as the default: the request was that a
  restart be the whole interaction. It stays as the fallback when the swap fails.

## Consequences

- This is the app's one cloud call besides model downloads. It sends nothing, and it is the only way
  to learn about a release without telemetry; `AGENTS.md` names it.
- The swap needs the bundle to be writable. A Doty left on the DMG, or in another user's
  `Applications`, gets a message instead of a quit.
- The previous bundle stays on disk as `.old` until the next launch proves the new one runs, so a
  broken update is recoverable by hand. A kill mid-swap restores it automatically.
- A release that ships a broken seal is refused before the app quits: `codesign --verify` runs on the
  mounted copy.
