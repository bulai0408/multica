import { useEffect, useState } from "react";
import { AlertCircle, Download, RefreshCw, X } from "lucide-react";

type UpdateState =
  | { status: "idle" }
  | { status: "available"; version: string; releaseUrl: string }
  | { status: "ready"; version: string };

export function UpdateNotification() {
  const [state, setState] = useState<UpdateState>({ status: "idle" });
  const [dismissed, setDismissed] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);

  useEffect(() => {
    const cleanupAvailable = window.updater.onUpdateAvailable((info) => {
      if (!info.releaseUrl) return;
      setState({
        status: "available",
        version: info.version,
        releaseUrl: info.releaseUrl,
      });
      setDismissed(false);
      setInstalling(false);
      setInstallError(null);
    });
    const cleanupDownloaded = window.updater.onUpdateDownloaded((info) => {
      setState({ status: "ready", version: info.version });
      setDismissed(false);
      setInstalling(false);
      setInstallError(null);
    });
    return () => {
      cleanupAvailable();
      cleanupDownloaded();
    };
  }, []);

  useEffect(() => {
    return window.updater.onUpdateError((info) => {
      setInstallError(info.error);
      setInstalling(false);
      setDismissed(false);
    });
  }, []);

  async function installUpdate() {
    setInstalling(true);
    setInstallError(null);

    try {
      const result = await window.updater.installUpdate();
      if (!result.ok) {
        setInstallError(result.error);
        setInstalling(false);
      }
    } catch (err) {
      setInstallError(err instanceof Error ? err.message : String(err));
      setInstalling(false);
    }
  }

  async function openDownloadPage() {
    if (state.status !== "available") return;
    setInstalling(true);
    setInstallError(null);

    try {
      await window.desktopAPI.openExternal(state.releaseUrl);
      setInstalling(false);
    } catch (err) {
      setInstallError(err instanceof Error ? err.message : String(err));
      setInstalling(false);
    }
  }

  if (state.status === "idle") return null;
  if (dismissed) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 w-80 rounded-lg border border-border bg-background p-4 shadow-lg animate-in slide-in-from-bottom-2 fade-in duration-300">
      <button
        type="button"
        onClick={() => setDismissed(true)}
        className="absolute top-2 right-2 rounded-md p-1 text-muted-foreground hover:text-foreground transition-colors"
      >
        <X className="size-3.5" />
      </button>

      <div className="flex items-start gap-3">
        <div className="mt-0.5 rounded-md bg-success/10 p-1.5">
          {state.status === "available" ? (
            <Download className="size-4 text-success" />
          ) : (
            <RefreshCw className="size-4 text-success" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium">
            {state.status === "available" ? "Update available" : "Update ready"}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {state.status === "available"
              ? `v${state.version} is ready to download.`
              : `v${state.version} will be applied on next launch.`}
          </p>
          {installError && (
            <p className="mt-2 flex items-start gap-1.5 text-xs text-destructive">
              <AlertCircle className="mt-0.5 size-3 shrink-0" />
              <span>{installError}</span>
            </p>
          )}
          <div className="mt-2 flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setDismissed(true)}
              disabled={installing}
              className="inline-flex items-center rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent transition-colors"
            >
              Later
            </button>
            <button
              type="button"
              onClick={
                state.status === "available" ? openDownloadPage : installUpdate
              }
              disabled={installing}
              className="inline-flex items-center rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60 transition-colors"
            >
              {state.status === "available"
                ? installing
                  ? "Opening..."
                  : "Download"
                : installing
                  ? "Restarting..."
                  : "Restart now"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
