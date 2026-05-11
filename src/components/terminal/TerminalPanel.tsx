import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { PanelBottomClose, RotateCw, Square, SquareTerminal, Trash2 } from "lucide-react";
import { createTerminalSession, drainTerminalSession, killTerminalSession, resizeTerminalSession, writeTerminalSession } from "../../app/tauriClient";
import { getAvailableTerminalShells, getDefaultTerminalShell, terminalShellLabel } from "../../lib/terminalShells";
import type { TerminalAttachedSession, TerminalOutputChunk, TerminalShellId } from "../../types/terminal";

interface TerminalPanelProps {
  attachedSession?: TerminalAttachedSession | null;
  desktopRuntime: boolean;
  height: number;
  open: boolean;
  onClose: () => void;
  onHeightChange: (height: number) => void;
  workingDirectory?: string;
}

type TerminalStatus = "connected" | "error" | "exited" | "running" | "starting" | "stopped" | "unavailable";

const MIN_TERMINAL_HEIGHT = 184;
const MAX_TERMINAL_HEIGHT = 640;
const POLL_INTERVAL_MS = 90;
const RESIZE_STEP = 28;

const XTERM_THEME = {
  background: "#101215",
  black: "#1c2229",
  blue: "#8fc7ff",
  brightBlack: "#66717d",
  brightBlue: "#add7ff",
  brightCyan: "#9be7ff",
  brightGreen: "#b8e6c8",
  brightMagenta: "#d7c0ff",
  brightRed: "#ffb5ad",
  brightWhite: "#ffffff",
  brightYellow: "#ffe1a3",
  cursor: "#d7ecff",
  cyan: "#7bd8f7",
  foreground: "#e9edf2",
  green: "#91d7a7",
  magenta: "#c7a9ff",
  red: "#ff8f85",
  selectionBackground: "#31506d",
  white: "#d9dee5",
  yellow: "#f2c978",
};

export function TerminalPanel({ attachedSession, desktopRuntime, height, open, onClose, onHeightChange, workingDirectory }: TerminalPanelProps) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [shell, setShell] = useState<TerminalShellId>(() => getDefaultTerminalShell());
  const [status, setStatus] = useState<TerminalStatus>(desktopRuntime ? "stopped" : "unavailable");
  const [activeCommand, setActiveCommand] = useState<string | null>(null);
  const [pendingWorkingDirectory, setPendingWorkingDirectory] = useState<string | null>(null);
  const [sessionWorkingDirectory, setSessionWorkingDirectory] = useState(workingDirectory ?? "");
  const shellOptions = useMemo(() => getAvailableTerminalShells(), []);
  const autoStartedRef = useRef(false);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const lastRequestedWorkingDirectoryRef = useRef((workingDirectory ?? "").trim());
  const ownedSessionIdRef = useRef<string | null>(null);
  const replayedAttachedSessionRef = useRef<string | null>(null);
  const pendingTerminalTextRef = useRef("");
  const pendingWorkingDirectoryRef = useRef<string | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const startingRef = useRef(false);
  const statusRef = useRef(status);
  const terminalHostRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);

  const statusLabel = useMemo(() => {
    if (!desktopRuntime) {
      return "Desktop required";
    }

    if (status === "starting") {
      return "Starting";
    }

    if (status === "connected") {
      return "Ready";
    }

    if (status === "running") {
      return "Running";
    }

    if (status === "exited") {
      return "Exited";
    }

    if (status === "error") {
      return "Needs attention";
    }

    return "Stopped";
  }, [desktopRuntime, status]);

  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  useEffect(() => {
    return () => {
      const activeSessionId = sessionIdRef.current;

      if (activeSessionId && activeSessionId === ownedSessionIdRef.current) {
        void killTerminalSession(activeSessionId).catch(() => undefined);
      }
    };
  }, []);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  const writeTerminalText = useCallback((text: string) => {
    if (!text) {
      return;
    }

    const terminal = terminalRef.current;

    if (!terminal) {
      pendingTerminalTextRef.current += text;
      return;
    }

    terminal.write(text);
  }, []);

  const writeTerminalChunks = useCallback(
    (chunks: TerminalOutputChunk[]) => {
      writeTerminalText(chunks.map((chunk) => chunk.text).join(""));
    },
    [writeTerminalText],
  );

  const writeSystemMessage = useCallback(
    (message: string) => {
      writeTerminalText(`\r\n${message.trimEnd()}\r\n`);
    },
    [writeTerminalText],
  );

  const fitTerminal = useCallback(() => {
    try {
      fitAddonRef.current?.fit();
    } catch {
      // The fit addon can throw while the panel is being mounted or detached.
    }
  }, []);

  useEffect(() => {
    if (!open || !desktopRuntime || !terminalHostRef.current) {
      return;
    }

    const terminal = new Terminal({
      allowProposedApi: false,
      convertEol: true,
      cursorBlink: true,
      cursorStyle: "block",
      disableStdin: false,
      drawBoldTextInBrightColors: true,
      fontFamily: '"Cascadia Code", "SFMono-Regular", Consolas, monospace',
      fontSize: 12.5,
      lineHeight: 1.22,
      scrollback: 12_000,
      theme: XTERM_THEME,
    });
    const fitAddon = new FitAddon();
    const host = terminalHostRef.current;

    terminal.loadAddon(fitAddon);
    terminal.open(host);
    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    const dataDisposable = terminal.onData((data) => {
      const activeSessionId = sessionIdRef.current;

      if (!activeSessionId || statusRef.current === "exited" || statusRef.current === "stopped") {
        return;
      }

      void writeTerminalSession(activeSessionId, data).catch((error) => {
        const detail = error instanceof Error ? error.message : String(error);
        setStatus("error");
        writeSystemMessage(`Terminal input failed: ${detail}`);
      });
    });
    const resizeDisposable = terminal.onResize(({ cols, rows }) => {
      const activeSessionId = sessionIdRef.current;

      if (!activeSessionId) {
        return;
      }

      void resizeTerminalSession(activeSessionId, cols, rows).catch(() => undefined);
    });
    const animationFrame = window.requestAnimationFrame(() => {
      fitTerminal();

      if (pendingTerminalTextRef.current) {
        terminal.write(pendingTerminalTextRef.current);
        pendingTerminalTextRef.current = "";
      }

      terminal.focus();
    });

    return () => {
      window.cancelAnimationFrame(animationFrame);
      dataDisposable.dispose();
      resizeDisposable.dispose();
      fitAddonRef.current = null;
      terminalRef.current = null;
      terminal.dispose();
    };
  }, [desktopRuntime, fitTerminal, open, writeSystemMessage]);

  useEffect(() => {
    if (!open || !desktopRuntime || !terminalHostRef.current) {
      return;
    }

    const observer = new ResizeObserver(() => fitTerminal());
    observer.observe(terminalHostRef.current);
    window.addEventListener("resize", fitTerminal);
    const animationFrame = window.requestAnimationFrame(fitTerminal);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      observer.disconnect();
      window.removeEventListener("resize", fitTerminal);
    };
  }, [desktopRuntime, fitTerminal, height, open]);

  const startSession = useCallback(
    async (replace = false, workingDirectoryOverride?: string) => {
      if (startingRef.current) {
        return;
      }

      if (!desktopRuntime) {
        setStatus("unavailable");
        writeSystemMessage("Terminal commands are available in the Tauri desktop app.");
        return;
      }

      startingRef.current = true;
      setStatus("starting");

      const previousSessionId = replace ? sessionIdRef.current : null;
      const nextWorkingDirectory = (workingDirectoryOverride ?? sessionWorkingDirectory).trim();

      if (previousSessionId) {
        try {
          await killTerminalSession(previousSessionId);
        } catch {
          // The session may already be gone; starting a fresh one is still the useful path.
        }

        sessionIdRef.current = null;
        ownedSessionIdRef.current = null;
        setSessionId(null);
        setActiveCommand(null);
        pendingTerminalTextRef.current = "";
        terminalRef.current?.reset();
        terminalRef.current?.clear();
      }

      try {
        const response = await createTerminalSession({
          mode: "interactive",
          shell,
          workingDirectory: nextWorkingDirectory || undefined,
        });

        sessionIdRef.current = response.sessionId;
        ownedSessionIdRef.current = response.sessionId;
        setSessionId(response.sessionId);
        setActiveCommand(null);
        setSessionWorkingDirectory(response.workingDirectory);
        pendingWorkingDirectoryRef.current = null;
        setPendingWorkingDirectory(null);
        setStatus("connected");
        writeTerminalChunks(response.initialOutput);
        window.requestAnimationFrame(fitTerminal);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        setStatus("error");
        writeSystemMessage(`Could not start terminal: ${detail}`);
      } finally {
        startingRef.current = false;
      }
    },
    [desktopRuntime, fitTerminal, sessionWorkingDirectory, shell, writeSystemMessage, writeTerminalChunks],
  );

  useEffect(() => {
    const nextWorkingDirectory = workingDirectory?.trim() ?? "";

    if (nextWorkingDirectory === lastRequestedWorkingDirectoryRef.current) {
      return;
    }

    lastRequestedWorkingDirectoryRef.current = nextWorkingDirectory;

    if (!nextWorkingDirectory || nextWorkingDirectory === sessionWorkingDirectory.trim()) {
      return;
    }

    if (!sessionIdRef.current) {
      setSessionWorkingDirectory(nextWorkingDirectory);
      return;
    }

    pendingWorkingDirectoryRef.current = nextWorkingDirectory;
    setPendingWorkingDirectory(nextWorkingDirectory);
    writeSystemMessage(`Project changed. Restart the terminal to switch to ${nextWorkingDirectory}.`);
  }, [sessionWorkingDirectory, workingDirectory, writeSystemMessage]);

  useEffect(() => {
    if (!attachedSession?.sessionId || !desktopRuntime) {
      return;
    }

    const previousOwnedSessionId = ownedSessionIdRef.current;
    const switching = sessionIdRef.current !== attachedSession.sessionId;

    if (previousOwnedSessionId && previousOwnedSessionId !== attachedSession.sessionId) {
      void killTerminalSession(previousOwnedSessionId).catch(() => undefined);
    }

    autoStartedRef.current = true;
    ownedSessionIdRef.current = null;
    sessionIdRef.current = attachedSession.sessionId;
    setSessionId(attachedSession.sessionId);
    setStatus("running");
    setActiveCommand(attachedSession.command ?? null);

    if (attachedSession.shell) {
      setShell(attachedSession.shell);
    }

    if (attachedSession.workingDirectory) {
      setSessionWorkingDirectory(attachedSession.workingDirectory);
      pendingWorkingDirectoryRef.current = null;
      setPendingWorkingDirectory(null);
    }

    if (switching) {
      pendingTerminalTextRef.current = "";
      terminalRef.current?.reset();
      terminalRef.current?.clear();
    }

    if (replayedAttachedSessionRef.current !== attachedSession.sessionId) {
      replayedAttachedSessionRef.current = attachedSession.sessionId;
      writeSystemMessage(`Attached to background command: ${attachedSession.command ?? attachedSession.sessionId}`);

      if (attachedSession.initialOutput?.trim()) {
        writeSystemMessage("Recent output captured before attach:");
        writeTerminalText(attachedSession.initialOutput.endsWith("\n") ? attachedSession.initialOutput : `${attachedSession.initialOutput}\n`);
      }
    }
  }, [attachedSession, desktopRuntime, writeSystemMessage, writeTerminalText]);

  useEffect(() => {
    if (!open || !desktopRuntime || sessionId || attachedSession?.sessionId || autoStartedRef.current) {
      return;
    }

    autoStartedRef.current = true;
    void startSession(false);
  }, [attachedSession?.sessionId, desktopRuntime, open, sessionId, startSession]);

  useEffect(() => {
    if (!open || !sessionId) {
      return;
    }

    let canceled = false;
    const activeSessionId = sessionId;
    let timeoutId: number | undefined;

    async function drain() {
      try {
        const response = await drainTerminalSession(activeSessionId);

        if (canceled) {
          return;
        }

        writeTerminalChunks(response.chunks);

        if (response.workingDirectory && !pendingWorkingDirectoryRef.current) {
          setSessionWorkingDirectory(response.workingDirectory);
        }

        setActiveCommand(response.activeCommand ?? null);

        if (response.commandRunning) {
          setStatus("running");
        } else if (response.exitCode !== null && response.exitCode !== undefined) {
          setStatus("exited");
        } else {
          setStatus("connected");
        }
      } catch (error) {
        if (canceled) {
          return;
        }

        const detail = error instanceof Error ? error.message : String(error);
        setStatus("error");
        writeSystemMessage(`Terminal disconnected: ${detail}`);
      }

      if (!canceled) {
        timeoutId = window.setTimeout(drain, POLL_INTERVAL_MS);
      }
    }

    void drain();

    return () => {
      canceled = true;
      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [open, sessionId, writeSystemMessage, writeTerminalChunks]);

  async function stopSession() {
    if (!sessionIdRef.current) {
      return;
    }

    const activeSessionId = sessionIdRef.current;

    try {
      await killTerminalSession(activeSessionId);
    } catch {
      // Closing a dead session should still leave the UI in a clean stopped state.
    }

    setSessionId(null);
    sessionIdRef.current = null;
    ownedSessionIdRef.current = null;
    setStatus("stopped");
    setActiveCommand(null);
    writeSystemMessage("Terminal session stopped.");
  }

  function clearTerminal() {
    terminalRef.current?.clear();
    pendingTerminalTextRef.current = "";
  }

  function handleResizeStart(event: ReactPointerEvent<HTMLElement>) {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);

    const startY = event.clientY;
    const startHeight = height;
    let resizeFrame: number | null = null;
    let pendingClientY = event.clientY;

    function commitHeight() {
      const viewportMax = Math.max(MIN_TERMINAL_HEIGHT, Math.min(MAX_TERMINAL_HEIGHT, window.innerHeight - 156));
      onHeightChange(clamp(startHeight + startY - pendingClientY, MIN_TERMINAL_HEIGHT, viewportMax));
    }

    function updateHeight(clientY: number) {
      pendingClientY = clientY;

      if (resizeFrame !== null) {
        return;
      }

      resizeFrame = window.requestAnimationFrame(() => {
        resizeFrame = null;
        commitHeight();
        fitTerminal();
      });
    }

    function handlePointerMove(moveEvent: PointerEvent) {
      updateHeight(moveEvent.clientY);
    }

    function stopResize() {
      if (resizeFrame !== null) {
        window.cancelAnimationFrame(resizeFrame);
        resizeFrame = null;
        commitHeight();
        fitTerminal();
      }

      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopResize);
      window.removeEventListener("pointercancel", stopResize);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopResize, { once: true });
    window.addEventListener("pointercancel", stopResize, { once: true });
  }

  function handleResizeKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "ArrowUp") {
      event.preventDefault();
      onHeightChange(clamp(height + RESIZE_STEP, MIN_TERMINAL_HEIGHT, MAX_TERMINAL_HEIGHT));
      window.requestAnimationFrame(fitTerminal);
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      onHeightChange(clamp(height - RESIZE_STEP, MIN_TERMINAL_HEIGHT, MAX_TERMINAL_HEIGHT));
      window.requestAnimationFrame(fitTerminal);
    }
  }

  if (!open) {
    return null;
  }

  return (
    <section className="terminal-panel" aria-label="Terminal">
      <div
        className="terminal-resize-handle"
        role="separator"
        aria-label="Resize terminal"
        aria-orientation="horizontal"
        tabIndex={0}
        onKeyDown={handleResizeKeyDown}
        onPointerDown={handleResizeStart}
      />
      <header className="terminal-toolbar">
        <div className="terminal-title">
          <SquareTerminal size={18} aria-hidden="true" />
          <strong>Terminal</strong>
          <span data-status={status}>{statusLabel}</span>
          {activeCommand ? <em title={activeCommand}>{activeCommand}</em> : null}
        </div>
        <label className="terminal-shell-select">
          <span className="sr-only">Shell</span>
          <select value={shell} onChange={(event) => setShell(event.target.value as TerminalShellId)} disabled={Boolean(sessionId)}>
            {shellOptions.map((option) => (
              <option value={option} key={option}>
                {terminalShellLabel(option)}
              </option>
            ))}
          </select>
        </label>
        <label className="terminal-cwd-field">
          <span>cwd</span>
          <input
            value={pendingWorkingDirectory ?? sessionWorkingDirectory}
            spellCheck={false}
            disabled={Boolean(sessionId)}
            onChange={(event) => setSessionWorkingDirectory(event.target.value)}
          />
        </label>
        <div className="terminal-actions">
          <button type="button" aria-label="Restart terminal session" title="Restart terminal session" disabled={Boolean(attachedSession?.sessionId && sessionId === attachedSession.sessionId)} onClick={() => void startSession(true, pendingWorkingDirectoryRef.current ?? undefined)}>
            <RotateCw size={16} aria-hidden="true" />
          </button>
          <button type="button" aria-label="Stop terminal session" title="Stop terminal session" disabled={!sessionId} onClick={() => void stopSession()}>
            <Square size={15} aria-hidden="true" />
          </button>
          <button type="button" aria-label="Clear terminal output" title="Clear terminal output" onClick={clearTerminal}>
            <Trash2 size={16} aria-hidden="true" />
          </button>
          <button type="button" aria-label="Close terminal" title="Close terminal" onClick={onClose}>
            <PanelBottomClose size={17} aria-hidden="true" />
          </button>
        </div>
      </header>
      <div className="terminal-output" ref={terminalHostRef} onClick={() => terminalRef.current?.focus()}>
        {!desktopRuntime ? <div className="terminal-unavailable">Open the desktop app to run commands.</div> : null}
      </div>
    </section>
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}
