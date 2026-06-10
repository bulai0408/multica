import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { UpdateNotification } from "./update-notification";

const updater = {
  cleanup: vi.fn(),
  installUpdate: vi.fn(),
  onUpdateAvailable: vi.fn(),
  onUpdateDownloaded: vi.fn(),
  onUpdateError: vi.fn(),
};

const desktopAPI = {
  openExternal: vi.fn(),
};

beforeEach(() => {
  updater.cleanup.mockClear();
  updater.installUpdate.mockReset();
  updater.onUpdateAvailable.mockReset();
  updater.onUpdateDownloaded.mockReset();
  updater.onUpdateError.mockReset();
  desktopAPI.openExternal.mockReset();
  updater.onUpdateAvailable.mockReturnValue(updater.cleanup);
  updater.onUpdateDownloaded.mockImplementation((callback) => {
    callback({ version: "0.1.30" });
    return updater.cleanup;
  });
  updater.onUpdateError.mockReturnValue(updater.cleanup);

  Object.defineProperty(window, "updater", {
    configurable: true,
    value: updater,
  });
  Object.defineProperty(window, "desktopAPI", {
    configurable: true,
    value: desktopAPI,
  });
});

describe("UpdateNotification", () => {
  it("requests installation when restart is clicked", async () => {
    updater.installUpdate.mockResolvedValue({ ok: true });

    render(<UpdateNotification />);

    fireEvent.click(screen.getByRole("button", { name: "Restart now" }));

    await waitFor(() => expect(updater.installUpdate).toHaveBeenCalledOnce());
  });

  it("keeps the update prompt visible and shows an error when install fails", async () => {
    updater.installUpdate.mockResolvedValue({
      ok: false,
      error: "Squirrel failed",
    });

    render(<UpdateNotification />);

    fireEvent.click(screen.getByRole("button", { name: "Restart now" }));

    expect(
      screen.getByRole("button", { name: "Restarting..." }),
    ).toBeDisabled();
    await screen.findByText("Squirrel failed");
    expect(screen.getByRole("button", { name: "Restart now" })).toBeEnabled();
  });

  it("opens the release download page for manual updates", async () => {
    updater.onUpdateDownloaded.mockReturnValue(updater.cleanup);
    updater.onUpdateAvailable.mockImplementation((callback) => {
      callback({
        version: "0.1.31",
        releaseUrl: "https://github.com/bulai0408/multica/releases/tag/v0.1.31",
      });
      return updater.cleanup;
    });
    desktopAPI.openExternal.mockResolvedValue(undefined);

    render(<UpdateNotification />);

    expect(screen.getByText("Update available")).toBeInTheDocument();
    expect(screen.getByText("v0.1.31 is ready to download.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Download" }));

    await waitFor(() =>
      expect(desktopAPI.openExternal).toHaveBeenCalledWith(
        "https://github.com/bulai0408/multica/releases/tag/v0.1.31",
      ),
    );
    expect(updater.installUpdate).not.toHaveBeenCalled();
  });
});
