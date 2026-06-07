# Self-host macOS Desktop DMG

The canonical `multica-ai/multica` release workflow publishes CLI binaries,
container images, Helm charts, and Linux/Windows Desktop installers. macOS
Desktop is intentionally not part of that CI release yet: official macOS builds
still need Apple Developer signing and notarization credentials, so upstream
ships them through a manual Desktop release path.

Fork/self-host users usually need a different flow: periodically build the
latest upstream Desktop app with their own deployment URLs and download a macOS
DMG. The `Self-host macOS DMG` workflow covers that case.

## What the workflow builds

`.github/workflows/selfhost-macos-dmg.yml` runs only outside the canonical
`multica-ai` repository. It packages the Electron Desktop app on a GitHub-hosted
macOS runner and uploads:

- `multica-desktop-<version>-mac-x64.dmg`
- `multica-desktop-<version>-mac-arm64.dmg`

Scheduled and manual runs upload the DMGs as GitHub Actions artifacts. Tag runs
also upload the DMGs to the matching GitHub Release in the fork.

Pushes to the fork's `main` branch build the fork checkout as-is. Scheduled and
manual runs can instead build a fresh upstream ref by leaving `sync_upstream`
enabled.

## Configure self-host URLs

Set these in the fork repository under **Settings > Secrets and variables >
Actions**. Plain URLs can be repository variables; use secrets if the hostnames
or values are private.

| Name | Required | Purpose |
| --- | --- | --- |
| `SELFHOST_DESKTOP_API_URL` | Recommended | Backend API URL, for example `https://api.example.com`. |
| `SELFHOST_DESKTOP_WS_URL` | Optional | WebSocket URL. If omitted, Desktop derives it from the API URL by appending `/ws`. |
| `SELFHOST_DESKTOP_APP_URL` | Recommended | Web app URL used for login and share links, for example `https://app.example.com`. |
| `MULTICA_UPSTREAM_REF` | Optional | Default upstream ref for scheduled/manual sync builds. Defaults to `latest`, which means the newest upstream release tag. |

The workflow also accepts legacy `VITE_API_URL`, `VITE_WS_URL`, and
`VITE_APP_URL` variables/secrets, but the `SELFHOST_DESKTOP_*` names are
preferred because they are scoped to Desktop release builds.

Packaged Desktop builds use those values as production defaults when the user's
local `~/.multica/desktop.json` file is absent. A local `desktop.json` still
wins, so users can override the packaged defaults per machine.

## Run it

Manual run:

1. Open **Actions > Self-host macOS DMG** in the fork.
2. Choose **Run workflow**.
3. Leave `sync_upstream` enabled to build from `multica-ai/multica`.
4. Leave `upstream_ref` as `latest` to build the newest upstream release tag,
   or set it to `main`, a release tag, or another upstream ref.
5. Download the `selfhost-macos-dmg-*` artifact after the run finishes.

Scheduled run:

- The workflow runs daily and builds `MULTICA_UPSTREAM_REF`, or the newest
  upstream release tag when that variable is not set.

Fork sync run:

- Push or merge into the fork's `main` branch after syncing upstream. The
  workflow builds that fork commit and uploads the DMGs as Actions artifacts.

Release run:

```bash
git tag v0.3.16-selfhost.1
git push origin v0.3.16-selfhost.1
```

A tag push builds from the fork tag itself and uploads the DMGs to that tag's
GitHub Release. This path is useful when you want a durable downloadable release
instead of an expiring Actions artifact.

## Signing and notarization

By default the workflow disables certificate auto-discovery, so fork builds can
produce unsigned DMGs without Apple Developer credentials. macOS may warn on
first launch because the app is not signed and notarized by a Developer ID
certificate.

To produce signed/notarized DMGs, add these repository secrets:

- `CSC_LINK`
- `CSC_KEY_PASSWORD`
- `APPLE_ID`
- `APPLE_APP_SPECIFIC_PASSWORD`
- `APPLE_TEAM_ID`

Then set repository variable `CSC_IDENTITY_AUTO_DISCOVERY=true`. The existing
Desktop packaging script will keep notarization enabled when `APPLE_TEAM_ID` is
present.
