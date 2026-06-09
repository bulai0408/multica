import { autoUpdater, type UpdateDownloadedEvent } from "electron-updater";
import { app, type BrowserWindow, ipcMain } from "electron";
import { readFileSync } from "node:fs";
import { join } from "node:path";

type UpdateMode = "automatic" | "manual";
type UpdateRepository = { owner: string; repo: string };
type UpdateConfig = { mode: UpdateMode; repository: UpdateRepository | null };

// Windows arm64 ships its own update metadata channel because
// electron-builder's `latest.yml` is not arch-suffixed on Windows — both
// arches would otherwise collide on the same file in the GitHub Release.
// See scripts/package.mjs (builderArgsForTarget) for the publish-side half
// of this pact. Pin the channel here so arm64 clients fetch
// `latest-arm64.yml` instead of the x64 metadata.
if (process.platform === "win32" && process.arch === "arm64") {
  autoUpdater.channel = "latest-arm64";
}

const STARTUP_CHECK_DELAY_MS = 5_000;
const PERIODIC_CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

export type ManualUpdateCheckResult =
  | {
      ok: true;
      currentVersion: string;
      latestVersion: string;
      available: boolean;
      updateMode: UpdateMode;
      releaseUrl?: string;
    }
  | { ok: false; error: string };

export type InstallUpdateResult = { ok: true } | { ok: false; error: string };

type RendererChannel =
  | "updater:update-available"
  | "updater:download-progress"
  | "updater:update-downloaded"
  | "updater:error";

type PackagedMetadata = {
  multicaUpdateMode?: unknown;
  multicaUpdateRepository?: unknown;
  repository?: unknown;
};

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function cleanGitHubPathSegment(value: string): string | null {
  const segment = value.trim().replace(/\.git$/, "");
  if (!/^[A-Za-z0-9_.-]+$/.test(segment)) return null;
  return segment;
}

function parseGitHubRepository(value: unknown): UpdateRepository | null {
  if (!value) return null;

  if (typeof value === "object" && "url" in value) {
    return parseGitHubRepository((value as { url?: unknown }).url);
  }

  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw) return null;

  const shorthand = raw.match(/^([^/\s]+)\/([^/\s]+)$/);
  const https = raw.match(
    /^https?:\/\/github\.com\/([^/\s]+)\/([^/\s?#]+)(?:[?#].*)?$/,
  );
  const sshScp = raw.match(/^git@github\.com:([^/\s]+)\/([^/\s]+)$/);
  const sshUrl = raw.match(/^ssh:\/\/git@github\.com\/([^/\s]+)\/([^/\s]+)$/);
  const match = https ?? sshScp ?? sshUrl ?? shorthand;
  if (!match) return null;

  const owner = cleanGitHubPathSegment(match[1]);
  const repo = cleanGitHubPathSegment(match[2]);
  if (!owner || !repo) return null;
  return { owner, repo };
}

function readPackagedMetadata(): PackagedMetadata {
  try {
    const raw = readFileSync(join(app.getAppPath(), "package.json"), "utf8");
    const parsed = JSON.parse(raw) as PackagedMetadata;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function resolvePackagedUpdateConfig(): UpdateConfig {
  const metadata = readPackagedMetadata();
  const mode: UpdateMode =
    metadata.multicaUpdateMode === "manual" ? "manual" : "automatic";
  return {
    mode,
    repository: parseGitHubRepository(
      metadata.multicaUpdateRepository ?? metadata.repository,
    ),
  };
}

function applyUpdateMode(mode: UpdateMode): void {
  const automatic = mode === "automatic";
  autoUpdater.autoDownload = automatic;
  autoUpdater.autoInstallOnAppQuit = automatic;
}

function releaseUrlForUpdate(
  repository: UpdateRepository | null,
  version: string | undefined,
): string | undefined {
  if (!repository || !version) return undefined;
  const tag = version.startsWith("v") ? version : `v${version}`;
  return `https://github.com/${repository.owner}/${repository.repo}/releases/tag/${encodeURIComponent(tag)}`;
}

function isDestroyedObjectError(err: unknown): boolean {
  return err instanceof Error && err.message.includes("Object has been destroyed");
}

function sendToLiveRenderer(
  win: BrowserWindow | null,
  channel: RendererChannel,
  payload: unknown,
): void {
  if (!win || win.isDestroyed()) return;

  try {
    const { webContents } = win;
    if (webContents.isDestroyed()) return;
    webContents.send(channel, payload);
  } catch (err) {
    if (isDestroyedObjectError(err)) return;
    throw err;
  }
}

// Single-flight guard around checkForUpdates(). With autoDownload=true the
// startup, periodic, and manual triggers can all kick off downloads, and
// overlapping calls have caused duplicate download warnings in the past
// (see electronjs.org/docs/latest/api/auto-updater). Coalesce concurrent
// callers onto the same in-flight promise.
let inFlightCheck: Promise<unknown> | null = null;
function checkForUpdatesOnce(): Promise<unknown> {
  if (inFlightCheck) return inFlightCheck;
  const p = autoUpdater
    .checkForUpdates()
    .then((result) => {
      // checkForUpdates resolves as soon as metadata is fetched; the actual
      // download (when autoDownload=true) is exposed on result.downloadPromise.
      // Without a handler a download failure becomes an unhandled rejection
      // in the main process — Node may terminate it on future versions.
      void (result as { downloadPromise?: Promise<unknown> } | null)?.downloadPromise?.catch(
        (err) => {
          console.error("Failed to download update:", err);
        },
      );
      return result;
    })
    .finally(() => {
      if (inFlightCheck === p) inFlightCheck = null;
    });
  inFlightCheck = p;
  return p;
}

export function setupAutoUpdater(
  getMainWindow: () => BrowserWindow | null,
  options: { updateConfig?: UpdateConfig } = {},
): void {
  const updateConfig = options.updateConfig ?? resolvePackagedUpdateConfig();
  applyUpdateMode(updateConfig.mode);

  autoUpdater.on("update-available", (info) => {
    const releaseUrl =
      updateConfig.mode === "manual"
        ? releaseUrlForUpdate(updateConfig.repository, info.version)
        : undefined;
    sendToLiveRenderer(getMainWindow(), "updater:update-available", {
      version: info.version,
      releaseNotes: info.releaseNotes,
      ...(releaseUrl ? { releaseUrl } : {}),
    });
  });

  autoUpdater.on("download-progress", (progress) => {
    sendToLiveRenderer(getMainWindow(), "updater:download-progress", {
      percent: progress.percent,
    });
  });

  autoUpdater.on("update-downloaded", (info: UpdateDownloadedEvent) => {
    sendToLiveRenderer(getMainWindow(), "updater:update-downloaded", {
      version: info.version,
      releaseNotes: info.releaseNotes,
    });
  });

  autoUpdater.on("error", (err) => {
    console.error("Auto-updater error:", err);
    sendToLiveRenderer(getMainWindow(), "updater:error", {
      error: errorMessage(err),
    });
  });

  // Retained for IPC back-compat with older renderer bundles. With
  // autoDownload=true the renderer no longer triggers this path.
  ipcMain.handle("updater:download", () => {
    return autoUpdater.downloadUpdate();
  });

  ipcMain.handle("updater:install", (): InstallUpdateResult => {
    try {
      autoUpdater.quitAndInstall(false, true);
      return { ok: true };
    } catch (err) {
      console.error("Failed to install update:", err);
      return { ok: false, error: errorMessage(err) };
    }
  });

  ipcMain.handle("updater:check", async (): Promise<ManualUpdateCheckResult> => {
    try {
      const result = (await checkForUpdatesOnce()) as
        | { updateInfo: { version: string }; isUpdateAvailable?: boolean }
        | null;
      const currentVersion = app.getVersion();
      // Trust electron-updater's own decision rather than re-deriving it from
      // a version-string compare. The two diverge for pre-release channels,
      // staged rollouts, downgrades, and minimum-system-version gates — in
      // those cases updateInfo.version differs from app.getVersion() but no
      // `update-available` event fires, so showing "available" here would
      // promise a download prompt that never appears.
      return {
        ok: true,
        currentVersion,
        latestVersion: result?.updateInfo.version ?? currentVersion,
        available: result?.isUpdateAvailable ?? false,
        updateMode: updateConfig.mode,
        releaseUrl:
          updateConfig.mode === "manual" && result?.isUpdateAvailable
            ? releaseUrlForUpdate(updateConfig.repository, result.updateInfo.version)
            : undefined,
      };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });

  // Initial check shortly after startup so we don't block boot.
  setTimeout(() => {
    checkForUpdatesOnce().catch((err) => {
      console.error("Failed to check for updates:", err);
    });
  }, STARTUP_CHECK_DELAY_MS);

  // Background poll so long-running sessions still pick up new releases
  // without requiring the user to restart the app.
  setInterval(() => {
    checkForUpdatesOnce().catch((err) => {
      console.error("Periodic update check failed:", err);
    });
  }, PERIODIC_CHECK_INTERVAL_MS);
}
