import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { PanelBottomClose, Play, RotateCw, Square, SquareTerminal, Trash2 } from "lucide-react";
import { createTerminalSession, drainTerminalSession, killTerminalSession, writeTerminalSession } from "../../app/tauriClient";
import type { TerminalOutputChunk, TerminalShellId } from "../../types/terminal";

interface TerminalPanelProps {
  desktopRuntime: boolean;
  height: number;
  open: boolean;
  onClose: () => void;
  onHeightChange: (height: number) => void;
  workingDirectory?: string;
}

type TerminalStatus = "connected" | "error" | "exited" | "starting" | "stopped" | "unavailable";

const MIN_TERMINAL_HEIGHT = 184;
const MAX_TERMINAL_HEIGHT = 640;
const OUTPUT_CHUNK_LIMIT = 8_000;
const ACTIVE_POLL_INTERVAL_MS = 120;
const IDLE_POLL_INTERVAL_MS = 650;
const RESIZE_STEP = 28;

export function TerminalPanel({ desktopRuntime, height, open, onClose, onHeightChange, workingDirectory }: TerminalPanelProps) {
  const [command, setCommand] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [, setHistoryIndex] = useState<number | null>(null);
  const [output, setOutput] = useState<TerminalOutputChunk[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [shell, setShell] = useState<TerminalShellId>("powershell");
  const [status, setStatus] = useState<TerminalStatus>(desktopRuntime ? "stopped" : "unavailable");
  const [sessionWorkingDirectory, setSessionWorkingDirectory] = useState(workingDirectory ?? "");
  const [sessionCommandRunning, setSessionCommandRunning] = useState(false);
  const localOutputIdRef = useRef(0);
  const autoStartedRef = useRef(false);
  const outputRef = useRef<HTMLDivElement>(null);
  const startingRef = useRef(false);

  const statusLabel = useMemo(() => {
    if (!desktopRuntime) {
      return "Desktop required";
    }

    if (status === "starting") {
      return "Starting";
    }

    if (status === "connected" && sessionCommandRunning) {
      return "Running";
    }

    if (status === "connected") {
      return "Local sandbox";
    }

    if (status === "exited") {
      return "Exited";
    }

    if (status === "error") {
      return "Needs attention";
    }

    return "Stopped";
  }, [desktopRuntime, sessionCommandRunning, status]);

  const appendOutput = useCallback((chunks: TerminalOutputChunk[]) => {
    if (!chunks.length) {
      return;
    }

    setOutput((currentOutput) => {
      const nextOutput = [...currentOutput, ...chunks];
      return nextOutput.slice(Math.max(0, nextOutput.length - OUTPUT_CHUNK_LIMIT));
    });
  }, []);

  const createLocalOutput = useCallback((stream: TerminalOutputChunk["stream"], text: string): TerminalOutputChunk => {
    localOutputIdRef.current += 1;

    return {
      id: `local-terminal-output-${Date.now()}-${localOutputIdRef.current}`,
      stream,
      text,
      timestamp: Date.now(),
    };
  }, []);

  const startSession = useCallback(
    async (replace = false) => {
      if (startingRef.current) {
        return;
      }

      if (!desktopRuntime) {
        setStatus("unavailable");
        appendOutput([createLocalOutput("system", "Terminal commands are available in the Tauri desktop app.\n")]);
        return;
      }

      startingRef.current = true;
      setStatus("starting");

      const previousSessionId = replace ? sessionId : null;

      if (previousSessionId) {
        try {
          await killTerminalSession(previousSessionId);
        } catch {
          // The session may already be gone; starting a fresh one is still the useful path.
        }

        setSessionId(null);
        setOutput([]);
      }

      try {
        const response = await createTerminalSession({
          shell,
          workingDirectory: sessionWorkingDirectory.trim() || undefined,
        });

        setSessionId(response.sessionId);
        setSessionWorkingDirectory(response.workingDirectory);
        setStatus("connected");
        appendOutput(response.initialOutput);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        setStatus("error");
        appendOutput([createLocalOutput("system", `Could not start terminal: ${detail}\n`)]);
      } finally {
        startingRef.current = false;
      }
    },
    [appendOutput, createLocalOutput, desktopRuntime, sessionId, sessionWorkingDirectory, shell],
  );

  useEffect(() => {
    if (!sessionId && workingDirectory) {
      setSessionWorkingDirectory(workingDirectory);
    }
  }, [sessionId, workingDirectory]);

  useEffect(() => {
    if (!open || !desktopRuntime || sessionId || autoStartedRef.current) {
      return;
    }

    autoStartedRef.current = true;
    void startSession(false);
  }, [desktopRuntime, open, sessionId, startSession]);

  useEffect(() => {
    if (!open || !sessionId) {
      return;
    }

    let canceled = false;
    const activeSessionId = sessionId;
    let timeoutId: number | undefined;

    async function drain() {
      let nextPollIntervalMs = IDLE_POLL_INTERVAL_MS;

      try {
        const response = await drainTerminalSession(activeSessionId);

        if (canceled) {
          return;
        }

        const commandRunning = Boolean(response.commandRunning);
        nextPollIntervalMs = commandRunning ? ACTIVE_POLL_INTERVAL_MS : IDLE_POLL_INTERVAL_MS;
        appendOutput(response.chunks);
        setSessionCommandRunning(commandRunning);

        if (response.exitCode !== null && response.exitCode !== undefined) {
          setStatus("exited");
        } else if (response.commandRunning || response.lastCommandCompleted) {
          setStatus("connected");
        }
      } catch (error) {
        if (canceled) {
          return;
        }

        const detail = error instanceof Error ? error.message : String(error);
        setStatus("error");
        appendOutput([createLocalOutput("system", `Terminal disconnected: ${detail}\n`)]);
      }

      if (!canceled) {
        timeoutId = window.setTimeout(drain, nextPollIntervalMs);
      }
    }

    void drain();

    return () => {
      canceled = true;
      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [appendOutput, createLocalOutput, open, sessionId]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const outputElement = outputRef.current;

    if (outputElement) {
      outputElement.scrollTo({
        top: outputElement.scrollHeight,
      });
    }
  }, [open, output]);

  async function submitCommand() {
    const nextCommand = command.trimEnd();

    if (!nextCommand) {
      return;
    }

    if (!sessionId || status === "exited" || status === "stopped") {
      appendOutput([createLocalOutput("system", "Start a terminal session before running a command.\n")]);
      return;
    }

    setCommand("");
    setHistoryIndex(null);
    setHistory((currentHistory) => [...currentHistory.filter((item) => item !== nextCommand), nextCommand].slice(-100));
    appendOutput([createLocalOutput("stdin", `${shell === "powershell" ? "PS" : "CMD"}> ${nextCommand}\n`)]);

    if (nextCommand.toLowerCase() === "clear" || nextCommand.toLowerCase() === "cls") {
      setOutput([]);
    }

    try {
      await writeTerminalSession(sessionId, nextCommand);
      setStatus("connected");
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setStatus("error");
      appendOutput([createLocalOutput("system", `Command failed: ${detail}\n`)]);
    }
  }

  async function stopSession() {
    if (!sessionId) {
      return;
    }

    try {
      await killTerminalSession(sessionId);
    } catch {
      // Closing a dead session should still leave the UI in a clean stopped state.
    }

    setSessionId(null);
    setStatus("stopped");
    appendOutput([createLocalOutput("system", "Terminal session stopped.\n")]);
  }

  function handleCommandKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setHistoryIndex((currentIndex) => {
        const nextIndex = currentIndex === null ? history.length - 1 : Math.max(0, currentIndex - 1);
        setCommand(history[nextIndex] ?? command);
        return history.length ? nextIndex : null;
      });
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHistoryIndex((currentIndex) => {
        if (currentIndex === null) {
          return null;
        }

        const nextIndex = currentIndex + 1;

        if (nextIndex >= history.length) {
          setCommand("");
          return null;
        }

        setCommand(history[nextIndex] ?? "");
        return nextIndex;
      });
    }
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
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      onHeightChange(clamp(height - RESIZE_STEP, MIN_TERMINAL_HEIGHT, MAX_TERMINAL_HEIGHT));
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
        </div>
        <label className="terminal-shell-select">
          <span className="sr-only">Shell</span>
          <select value={shell} onChange={(event) => setShell(event.target.value as TerminalShellId)} disabled={Boolean(sessionId)}>
            <option value="powershell">PowerShell</option>
            <option value="cmd">cmd</option>
          </select>
        </label>
        <label className="terminal-cwd-field">
          <span>cwd</span>
          <input
            value={sessionWorkingDirectory}
            spellCheck={false}
            disabled={Boolean(sessionId)}
            onChange={(event) => setSessionWorkingDirectory(event.target.value)}
          />
        </label>
        <div className="terminal-actions">
          <button type="button" aria-label="Restart terminal session" title="Restart terminal session" onClick={() => void startSession(true)}>
            <RotateCw size={16} aria-hidden="true" />
          </button>
          <button type="button" aria-label="Stop terminal session" title="Stop terminal session" disabled={!sessionId} onClick={() => void stopSession()}>
            <Square size={15} aria-hidden="true" />
          </button>
          <button type="button" aria-label="Clear terminal output" title="Clear terminal output" onClick={() => setOutput([])}>
            <Trash2 size={16} aria-hidden="true" />
          </button>
          <button type="button" aria-label="Close terminal" title="Close terminal" onClick={onClose}>
            <PanelBottomClose size={17} aria-hidden="true" />
          </button>
        </div>
      </header>
      <div className="terminal-output" ref={outputRef} role="log" aria-live="polite" aria-atomic="false">
        {output.map((chunk, index) => (
          <span className="terminal-output-chunk" data-stream={chunk.stream} key={`${chunk.id}-${index}`}>
            {chunk.text.replace(/\r\n/g, "\n")}
          </span>
        ))}
      </div>
      <form
        className="terminal-command-row"
        onSubmit={(event) => {
          event.preventDefault();
          void submitCommand();
        }}
      >
        <span className="terminal-prompt">{shell === "powershell" ? "PS" : "CMD"}</span>
        <input
          aria-label="Terminal command"
          value={command}
          spellCheck={false}
          autoComplete="off"
          placeholder={desktopRuntime ? "npm run build" : "Open the desktop app to run commands"}
          disabled={!desktopRuntime || status === "starting"}
          onChange={(event) => setCommand(event.target.value)}
          onKeyDown={handleCommandKeyDown}
        />
        <button type="submit" aria-label="Run command" title="Run command" disabled={!desktopRuntime || status === "starting" || !command.trim()}>
          <Play size={16} aria-hidden="true" />
        </button>
      </form>
    </section>
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}
