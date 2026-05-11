import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, Download, RefreshCw, RotateCcw } from "lucide-react";
import { checkForAppUpdate, installAppUpdate, type AppUpdateCheckResponse } from "../../app/tauriClient";

type AppUpdateStage = "idle" | "checking" | "available" | "not-available" | "downloading" | "restarting" | "error";

interface AppUpdateProgress {
  contentLength: number | null;
  downloaded: number;
}

export interface AppUpdateController {
  busy: boolean;
  checkNow: () => void;
  error: string | null;
  installNow: () => void;
  percent: number | null;
  stage: AppUpdateStage;
  update: AppUpdateCheckResponse | null;
}

const AUTO_CHECK_DELAY_MS = 2_500;
const FOCUS_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1_000;
const TRANSIENT_STATUS_MS = 4_500;

export function useAppUpdateController(desktopRuntime: boolean): AppUpdateController {
  const [stage, setStage] = useState<AppUpdateStage>("idle");
  const [update, setUpdate] = useState<AppUpdateCheckResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<AppUpdateProgress>({
    contentLength: null,
    downloaded: 0,
  });
  const lastCheckRef = useRef(0);
  const busyRef = useRef(false);

  const percent = useMemo(() => {
    if (!progress.contentLength || progress.contentLength <= 0) {
      return null;
    }

    return Math.min(100, Math.max(0, Math.round((progress.downloaded / progress.contentLength) * 100)));
  }, [progress]);

  const runCheck = useCallback(
    async (silent: boolean) => {
      if (!desktopRuntime || busyRef.current) {
        return;
      }

      busyRef.current = true;
      lastCheckRef.current = Date.now();
      setError(null);

      if (!silent) {
        setStage("checking");
      }

      try {
        const result = await checkForAppUpdate();
        setUpdate(result.available ? result : null);
        setStage(result.available ? "available" : silent ? "idle" : "not-available");
      } catch (checkError) {
        setUpdate(null);
        if (!silent) {
          setError(checkError instanceof Error ? checkError.message : "Update check failed.");
          setStage("error");
        } else {
          setStage("idle");
        }
      } finally {
        busyRef.current = false;
      }
    },
    [desktopRuntime],
  );

  const checkNow = useCallback(() => {
    void runCheck(false);
  }, [runCheck]);

  const installNow = useCallback(() => {
    if (!desktopRuntime || busyRef.current || !update?.available) {
      return;
    }

    busyRef.current = true;
    setError(null);
    setProgress({ contentLength: null, downloaded: 0 });
    setStage("downloading");

    void installAppUpdate((event) => {
      if (event.event === "started") {
        setProgress({
          contentLength: event.data.contentLength ?? null,
          downloaded: 0,
        });
      } else if (event.event === "progress") {
        setProgress({
          contentLength: event.data.contentLength ?? null,
          downloaded: event.data.downloaded,
        });
      } else if (event.event === "finished") {
        setStage("restarting");
      }
    }).catch((installError) => {
      busyRef.current = false;
      setError(installError instanceof Error ? installError.message : "Update install failed.");
      setStage("error");
    });
  }, [desktopRuntime, update]);

  useEffect(() => {
    if (!desktopRuntime) {
      return;
    }

    const timer = window.setTimeout(() => {
      void runCheck(true);
    }, AUTO_CHECK_DELAY_MS);

    return () => window.clearTimeout(timer);
  }, [desktopRuntime, runCheck]);

  useEffect(() => {
    if (!desktopRuntime) {
      return;
    }

    function handleFocus() {
      if (Date.now() - lastCheckRef.current >= FOCUS_CHECK_INTERVAL_MS) {
        void runCheck(true);
      }
    }

    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [desktopRuntime, runCheck]);

  useEffect(() => {
    if (stage !== "not-available") {
      return;
    }

    const timer = window.setTimeout(() => setStage("idle"), TRANSIENT_STATUS_MS);
    return () => window.clearTimeout(timer);
  }, [stage]);

  return {
    busy: stage === "checking" || stage === "downloading" || stage === "restarting",
    checkNow,
    error,
    installNow,
    percent,
    stage,
    update,
  };
}

interface AppUpdateIndicatorProps {
  controller: AppUpdateController;
}

export function AppUpdateIndicator({ controller }: AppUpdateIndicatorProps) {
  if (controller.stage === "idle") {
    return null;
  }

  const label = getUpdateLabel(controller);
  const title = getUpdateTitle(controller);
  const actionAvailable = controller.stage === "available";
  const Icon = controller.stage === "not-available" ? CheckCircle2 : controller.stage === "restarting" ? RotateCcw : controller.stage === "checking" ? RefreshCw : Download;

  return (
    <button
      className="app-update-indicator"
      type="button"
      aria-label={title}
      title={title}
      data-stage={controller.stage}
      data-busy={controller.busy}
      data-actionable={actionAvailable}
      disabled={controller.busy || controller.stage === "not-available"}
      onClick={actionAvailable ? controller.installNow : controller.checkNow}
    >
      <Icon size={14} aria-hidden="true" />
      <span>{label}</span>
      {controller.stage === "downloading" && controller.percent !== null ? <em>{controller.percent}%</em> : null}
    </button>
  );
}

function getUpdateLabel(controller: AppUpdateController) {
  if (controller.stage === "checking") {
    return "Checking";
  }

  if (controller.stage === "available") {
    return "Update available";
  }

  if (controller.stage === "not-available") {
    return "Up to date";
  }

  if (controller.stage === "downloading") {
    return "Updating";
  }

  if (controller.stage === "restarting") {
    return "Restarting";
  }

  return "Update failed";
}

function getUpdateTitle(controller: AppUpdateController) {
  if (controller.stage === "available") {
    const version = controller.update?.version ? ` ${controller.update.version}` : "";
    return `Install Gilbert Codex update${version}`;
  }

  if (controller.stage === "error") {
    return controller.error ?? "Update failed. Click to check again.";
  }

  if (controller.stage === "downloading") {
    return controller.percent === null ? "Downloading update" : `Downloading update ${controller.percent}%`;
  }

  return getUpdateLabel(controller);
}
