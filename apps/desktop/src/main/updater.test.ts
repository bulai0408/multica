import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserWindow, WebContents } from "electron";

type Handler = (...args: unknown[]) => unknown;

const ctx = vi.hoisted(() => ({
  handlers: new Map<string, Handler[]>(),
  ipcHandle: vi.fn(),
  autoUpdater: {
    autoDownload: false,
    autoInstallOnAppQuit: false,
    channel: undefined as string | undefined,
    on: vi.fn(),
    checkForUpdates: vi.fn(async () => ({
      updateInfo: { version: "0.3.18" },
      isUpdateAvailable: false,
    })),
    downloadUpdate: vi.fn(),
    quitAndInstall: vi.fn(),
  },
  checkForUpdates: vi.fn(async () => ({
    updateInfo: { version: "0.3.18" },
    isUpdateAvailable: false,
  })),
  downloadUpdate: vi.fn(),
  quitAndInstall: vi.fn(),
  getVersion: vi.fn(() => "0.3.17"),
}));

vi.mock("electron-updater", () => {
  ctx.autoUpdater.on.mockImplementation((event: string, handler: Handler) => {
      const handlers = ctx.handlers.get(event) ?? [];
      handlers.push(handler);
      ctx.handlers.set(event, handlers);
      return ctx.autoUpdater;
    });
  ctx.autoUpdater.checkForUpdates = ctx.checkForUpdates;
  ctx.autoUpdater.downloadUpdate = ctx.downloadUpdate;
  ctx.autoUpdater.quitAndInstall = ctx.quitAndInstall;
  return { autoUpdater: ctx.autoUpdater };
});

vi.mock("electron", () => ({
  app: {
    getVersion: ctx.getVersion,
  },
  BrowserWindow: class BrowserWindow {},
  ipcMain: {
    handle: ctx.ipcHandle,
  },
}));

import { setupAutoUpdater } from "./updater";

function emitUpdater(event: string, ...args: unknown[]) {
  for (const handler of ctx.handlers.get(event) ?? []) {
    handler(...args);
  }
}

function makeWindow() {
  const send = vi.fn();
  return {
    win: {
      isDestroyed: () => false,
      webContents: {
        isDestroyed: () => false,
        send,
      },
    } as unknown as BrowserWindow,
    send,
  };
}

function makeDestroyedWindow() {
  return {
    isDestroyed: () => true,
    get webContents(): WebContents {
      throw new TypeError("Object has been destroyed");
    },
  } as unknown as BrowserWindow;
}

function makeWindowWithDestroyedWebContents() {
  const send = vi.fn(() => {
    throw new TypeError("Object has been destroyed");
  });
  return {
    win: {
      isDestroyed: () => false,
      webContents: {
        isDestroyed: () => true,
        send,
      },
    } as unknown as BrowserWindow,
    send,
  };
}

function makeWindowWithThrowingSend(error: Error) {
  const send = vi.fn(() => {
    throw error;
  });
  return {
    win: {
      isDestroyed: () => false,
      webContents: {
        isDestroyed: () => false,
        send,
      },
    } as unknown as BrowserWindow,
    send,
  };
}

describe("setupAutoUpdater", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    ctx.handlers.clear();
    ctx.ipcHandle.mockClear();
    ctx.checkForUpdates.mockClear();
    ctx.downloadUpdate.mockClear();
    ctx.quitAndInstall.mockClear();
    ctx.getVersion.mockClear();
    ctx.autoUpdater.autoDownload = false;
    ctx.autoUpdater.autoInstallOnAppQuit = false;
    ctx.autoUpdater.channel = undefined;
    ctx.autoUpdater.on.mockClear();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("forwards update progress to a live renderer", () => {
    const { win, send } = makeWindow();
    setupAutoUpdater(() => win);

    emitUpdater("download-progress", { percent: 42 });

    expect(send).toHaveBeenCalledWith("updater:download-progress", {
      percent: 42,
    });
  });

  it("opens self-host macOS updates manually by forwarding a release page URL", async () => {
    const { win, send } = makeWindow();
    setupAutoUpdater(() => win, {
      updateConfig: {
        mode: "manual",
        repository: { owner: "bulai0408", repo: "multica" },
      },
    });

    emitUpdater("update-available", {
      version: "0.1.30",
      releaseNotes: "Release notes",
    });

    expect(ctx.autoUpdater.autoDownload).toBe(false);
    expect(ctx.autoUpdater.autoInstallOnAppQuit).toBe(false);
    expect(send).toHaveBeenCalledWith("updater:update-available", {
      version: "0.1.30",
      releaseNotes: "Release notes",
      releaseUrl: "https://github.com/bulai0408/multica/releases/tag/v0.1.30",
    });

    ctx.checkForUpdates.mockResolvedValueOnce({
      updateInfo: { version: "0.1.30" },
      isUpdateAvailable: true,
    });
    const checkHandler = ctx.ipcHandle.mock.calls.find(
      ([channel]) => channel === "updater:check",
    )?.[1] as Handler | undefined;

    await expect(checkHandler?.()).resolves.toEqual({
      ok: true,
      currentVersion: "0.3.17",
      latestVersion: "0.1.30",
      available: true,
      updateMode: "manual",
      releaseUrl: "https://github.com/bulai0408/multica/releases/tag/v0.1.30",
    });
  });

  it("keeps signed updater builds on the automatic install path", () => {
    const { win, send } = makeWindow();
    setupAutoUpdater(() => win, {
      updateConfig: {
        mode: "automatic",
        repository: { owner: "multica-ai", repo: "multica" },
      },
    });

    emitUpdater("update-available", { version: "0.1.30" });

    expect(ctx.autoUpdater.autoDownload).toBe(true);
    expect(ctx.autoUpdater.autoInstallOnAppQuit).toBe(true);
    expect(send).toHaveBeenCalledWith("updater:update-available", {
      version: "0.1.30",
      releaseNotes: undefined,
    });
  });

  it("skips update progress when the BrowserWindow has already been destroyed", () => {
    setupAutoUpdater(() => makeDestroyedWindow());

    expect(() => emitUpdater("download-progress", { percent: 42 })).not.toThrow();
  });

  it("skips update progress when the BrowserWindow webContents has already been destroyed", () => {
    const { win, send } = makeWindowWithDestroyedWebContents();
    setupAutoUpdater(() => win);

    expect(() => emitUpdater("download-progress", { percent: 42 })).not.toThrow();
    expect(send).not.toHaveBeenCalled();
  });

  it("skips update progress when webContents.send loses a destroy race", () => {
    const { win, send } = makeWindowWithThrowingSend(
      new TypeError("Object has been destroyed"),
    );
    setupAutoUpdater(() => win);

    expect(() => emitUpdater("download-progress", { percent: 42 })).not.toThrow();
    expect(send).toHaveBeenCalledWith("updater:download-progress", {
      percent: 42,
    });
  });

  it("rethrows non-destroy errors from webContents.send", () => {
    const { win } = makeWindowWithThrowingSend(new Error("boom"));
    setupAutoUpdater(() => win);

    expect(() => emitUpdater("download-progress", { percent: 42 })).toThrow(
      "boom",
    );
  });

  it("returns success after requesting update installation", () => {
    setupAutoUpdater(() => null);

    const installHandler = ctx.ipcHandle.mock.calls.find(
      ([channel]) => channel === "updater:install",
    )?.[1] as Handler | undefined;

    expect(installHandler?.()).toEqual({ ok: true });
    expect(ctx.quitAndInstall).toHaveBeenCalledWith(false, true);
  });

  it("returns an install error when quitAndInstall throws", () => {
    ctx.quitAndInstall.mockImplementationOnce(() => {
      throw new Error("Squirrel failed");
    });
    setupAutoUpdater(() => null);

    const installHandler = ctx.ipcHandle.mock.calls.find(
      ([channel]) => channel === "updater:install",
    )?.[1] as Handler | undefined;

    expect(installHandler?.()).toEqual({ ok: false, error: "Squirrel failed" });
  });
});
