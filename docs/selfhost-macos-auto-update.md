# Self-host macOS Desktop auto-update

Self-built Desktop apps must publish and check updates against the same GitHub
repository. For a fork build, the updater feed must point at the fork release
feed, not `multica-ai/multica`.

`apps/desktop/scripts/package.mjs` resolves the feed in this order:

1. `MULTICA_DESKTOP_UPDATE_OWNER` + `MULTICA_DESKTOP_UPDATE_REPO`
2. `MULTICA_DESKTOP_UPDATE_REPOSITORY` (`owner/repo`)
3. `GITHUB_REPOSITORY` from GitHub Actions
4. `git config --get remote.origin.url`

The selected repository is passed to electron-builder as
`-c.publish.owner=<owner>` and `-c.publish.repo=<repo>`. That value is written
into the packaged app's updater config, so installed clients check the same
repository that published the release assets.

## Publishing update assets

Use the fork-only **Self-host macOS Updater** workflow for self-host builds. It
creates or updates a published GitHub Release, then runs electron-builder with
`--publish always`:

```bash
node scripts/package.mjs --mac --arm64 --publish always
```

That publish step must upload all of the assets electron-updater needs:

- `latest-mac.yml`
- `.dmg`
- `.zip`
- `.blockmap`

Uploading only a DMG is not enough. macOS Desktop auto-update reads the
electron-builder metadata file first, then downloads the asset named inside it.

For Apple Silicon self-host installs, keep the workflow default `arm64`. If you
need Intel Macs, run the workflow with `x64` and make sure the installed app was
built for the same architecture.

## Required configuration

At minimum, the workflow needs the default `GITHUB_TOKEN` permission
`contents: write` so electron-builder can upload assets to the release.

Set these repository variables when the packaged Desktop app should default to a
self-hosted server if `~/.multica/desktop.json` is absent:

```text
SELFHOST_DESKTOP_API_URL=https://multica.example.com
SELFHOST_DESKTOP_WS_URL=wss://multica.example.com/ws
SELFHOST_DESKTOP_APP_URL=https://multica.example.com
```

Those URLs configure the Desktop app's backend/frontend target. They do not
configure the Electron updater feed; the updater feed is the GitHub repository
resolved by `MULTICA_DESKTOP_UPDATE_*`, `GITHUB_REPOSITORY`, or `remote.origin`.
A Docker deployment on a host such as `fnos` only affects the server URL unless
you also publish Desktop update assets to GitHub Releases.

For packaged production builds, `SELFHOST_DESKTOP_*` is passed through to the
Electron build as `VITE_*` and becomes the app's built-in default runtime config.
An installed user's `~/.multica/desktop.json` still takes precedence. If no
user config exists and no build-time self-host URL was provided, Desktop falls
back to the official Multica Cloud API.

Unsigned local/fork builds work with:

```text
CSC_IDENTITY_AUTO_DISCOVERY=false
```

Production macOS distribution should use Developer ID signing and notarization.
Set these GitHub secrets when you have Apple credentials:

```text
CSC_LINK
CSC_KEY_PASSWORD
APPLE_ID
APPLE_APP_SPECIFIC_PASSWORD
APPLE_TEAM_ID
```

If the Apple secrets are not present, the package script disables notarization
for that build. Users may need to approve the unsigned app in macOS Gatekeeper.

## Release checklist

1. Push a version tag higher than the installed app version, for example
   `v0.3.19`.
2. Let **Self-host macOS Updater** finish successfully on the fork repository.
3. Confirm the GitHub Release is published, not draft.
4. Confirm the release contains `latest-mac.yml`, a DMG, a ZIP, and blockmaps.
5. Confirm `latest-mac.yml` names an asset that exists on the same release.

Useful checks:

```bash
REPO=bulai0408/multica
TAG=v0.3.19

gh release view "$TAG" --repo "$REPO" \
  --json isDraft,isPrerelease,assets \
  --jq '{isDraft, isPrerelease, assets: [.assets[].name]}'

gh release download "$TAG" --repo "$REPO" \
  --pattern latest-mac.yml \
  --output /tmp/latest-mac.yml

cat /tmp/latest-mac.yml
```

If Desktop still says `No published versions on GitHub`, check these first:

- The installed app was built after the feed fix and points at the fork release
  repository.
- The target release is published, not draft.
- The target release version is higher than `app.getVersion()` in the installed
  app.
- `latest-mac.yml` exists and points at an existing `.dmg` or `.zip` asset.
- You are not testing a prerelease while the installed app is on the stable
  default channel.
