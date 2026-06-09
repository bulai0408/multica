import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { UpdateNotification } from "./update-notification";

const updater = {
  cleanup: vi.fn(),
  installUpdate: vi.fn(),
  onUpdateDownloaded: vi.fn(),
  onUpdateError: vi.fn(),
};

beforeEach(() => {
  updater.cleanup.mockClear();
  updater.installUpdate.mockReset();
  updater.onUpdateDownloaded.mockReset();
  updater.onUpdateError.mockReset();
  updater.onUpdateDownloaded.mockImplementation((callback) => {
    callback({ version: "0.1.30" });
    return updater.cleanup;
  });
  updater.onUpdateError.mockReturnValue(updater.cleanup);

  Object.defineProperty(window, "updater", {
    configurable: true,
    value: updater,
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
});
