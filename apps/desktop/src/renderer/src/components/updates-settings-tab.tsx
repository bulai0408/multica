import { useCallback, useState } from "react";
import { AlertCircle, ArrowDownToLine, Check, ExternalLink, Loader2 } from "lucide-react";
import { Button } from "@multica/ui/components/ui/button";
import { useT } from "@multica/views/i18n";

type CheckState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "up-to-date" }
  | {
      status: "available";
      latestVersion: string;
      updateMode: "automatic" | "manual";
      releaseUrl?: string;
    }
  | { status: "error"; message: string };

export function UpdatesSettingsTab() {
  const { t } = useT("settings");
  const [state, setState] = useState<CheckState>({ status: "idle" });
  const currentVersion = window.desktopAPI.appInfo.version;

  const handleCheck = useCallback(async () => {
    setState({ status: "checking" });
    const result = await window.updater.checkForUpdates();
    if (!result.ok) {
      setState({ status: "error", message: result.error });
      return;
    }
    setState(
      result.available
        ? {
            status: "available",
            latestVersion: result.latestVersion,
            updateMode: result.updateMode,
            releaseUrl: result.releaseUrl,
          }
        : { status: "up-to-date" },
    );
  }, []);

  const handleOpenDownload = useCallback(() => {
    if (state.status !== "available" || !state.releaseUrl) return;
    void window.desktopAPI.openExternal(state.releaseUrl);
  }, [state]);

  return (
    <div>
      <h2 className="text-lg font-semibold">{t(($) => $.desktop.updates.title)}</h2>
      <p className="text-sm text-muted-foreground mt-1">
        {t(($) => $.desktop.updates.description)}
      </p>

      <div className="mt-6 divide-y">
        <div className="flex items-center justify-between gap-6 py-4">
          <div className="min-w-0">
            <p className="text-sm font-medium">{t(($) => $.desktop.updates.current_version)}</p>
            <p className="text-sm text-muted-foreground mt-0.5 font-mono">
              v{currentVersion}
            </p>
          </div>
        </div>

        <div className="flex items-start justify-between gap-6 py-4">
          <div className="min-w-0">
            <p className="text-sm font-medium">{t(($) => $.desktop.updates.check_section_title)}</p>
            <p className="text-sm text-muted-foreground mt-0.5">
              {t(($) => $.desktop.updates.check_section_description)}
            </p>
            {state.status === "up-to-date" && (
              <p className="text-sm text-muted-foreground mt-2 inline-flex items-center gap-1.5">
                <Check className="size-3.5 text-success" />
                {t(($) => $.desktop.updates.up_to_date)}
              </p>
            )}
            {state.status === "available" && (
              <p className="text-sm text-muted-foreground mt-2 inline-flex items-center gap-1.5">
                <ArrowDownToLine className="size-3.5 text-primary" />
                {state.updateMode === "manual"
                  ? t(($) => $.desktop.updates.manual_available, {
                      version: state.latestVersion,
                    })
                  : t(($) => $.desktop.updates.downloading, {
                      version: state.latestVersion,
                    })}
              </p>
            )}
            {state.status === "error" && (
              <p className="text-sm text-destructive mt-2 inline-flex items-center gap-1.5">
                <AlertCircle className="size-3.5" />
                {state.message}
              </p>
            )}
          </div>
          <div className="shrink-0">
            <Button
              variant="outline"
              size="sm"
              onClick={
                state.status === "available" &&
                state.updateMode === "manual" &&
                state.releaseUrl
                  ? handleOpenDownload
                  : handleCheck
              }
              disabled={state.status === "checking"}
            >
              {state.status === "checking" ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" />
                  {t(($) => $.desktop.updates.checking)}
                </>
              ) : state.status === "available" &&
                state.updateMode === "manual" &&
                state.releaseUrl ? (
                <>
                  <ExternalLink className="size-3.5" />
                  {t(($) => $.desktop.updates.open_download)}
                </>
              ) : (
                t(($) => $.desktop.updates.check_now)
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
