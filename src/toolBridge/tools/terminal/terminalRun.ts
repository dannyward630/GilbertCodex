import type { TerminalDrainResponse, TerminalShellId } from "../../../types/terminal";
import { PathResolutionError, tryResolveAllowedPath } from "../../paths";
import type { JsonValue, ToolDefinition, ToolExecutionContext, ToolExecutionResult } from "../../types";
import { defaultTerminalBackend, type TerminalBackend } from "./backend";

const DEFAULT_TERMINAL_TIMEOUT_MS = 45_000;
const MAX_TERMINAL_TIMEOUT_MS = 600_000;
const DEFAULT_BACKGROUND_WAIT_MS = 2_000;
const MAX_BACKGROUND_WAIT_MS = 10_000;
const BACKGROUND_POLL_INTERVAL_MS = 160;

const TERMINAL_SHELLS: TerminalShellId[] = ["powershell", "cmd", "bash", "zsh", "sh"];

export function createTerminalRunTool(backend: TerminalBackend = defaultTerminalBackend): ToolDefinition {
  return {
    description:
      "Run a local shell command inside the selected workspace. Use this for tests, builds, package installs, formatters, and command evidence after file/Git tools are the better fit for source inspection or edits. " +
      "The command always has an explicit cwd, captures stdout/stderr, has a bounded timeout, and requires user approval before execution. " +
      "Set background true only for dev servers or watchers that should keep running and be attachable in the in-app terminal.",
    execute: async (args, context) => {
      const command = stringArg(args.command);

      if (!command) {
        return createErrorResult("terminal_run requires a non-empty command.");
      }

      const cwd = resolveTerminalCwd(args, context);
      if (typeof cwd !== "string") {
        return cwd;
      }

      const shell = terminalShellArg(args.shell);
      const timeoutMs = integerArg(args.timeoutMs, DEFAULT_TERMINAL_TIMEOUT_MS, 1_000, MAX_TERMINAL_TIMEOUT_MS);
      const background = booleanArg(args.background);
      const previewUrl = normalizePreviewUrl(stringArg(args.previewUrl));

      if (booleanArg(args.dryRun)) {
        return {
          content: [
            background ? "Dry run: would start a background terminal command." : "Dry run: would run a terminal command.",
            `cwd: ${cwd}`,
            `shell: ${shell ?? "default"}`,
            `timeoutMs: ${timeoutMs}`,
            `command: ${command}`,
            "Terminal commands are approval-gated and should be used for tests, builds, installs, formatters, and command evidence.",
          ].join("\n"),
          data: {
            dryRun: true,
            terminal: {
              command,
              live: background,
              shell: shell ?? null,
              timedOut: false,
              workingDirectory: cwd,
            },
          } as JsonValue,
          ok: true,
        };
      }

      if (!backend.isAvailable()) {
        return createErrorResult("terminal_run is available only in the Tauri desktop app.");
      }

      if (context.signal?.aborted) {
        return createErrorResult("Tool bridge run was aborted before terminal_run could start.");
      }

      return background
        ? runBackgroundCommand(backend, {
            command,
            cwd,
            previewUrl,
            shell,
            waitMs: integerArg(args.backgroundWaitMs, DEFAULT_BACKGROUND_WAIT_MS, 250, MAX_BACKGROUND_WAIT_MS),
          })
        : runBufferedCommand(backend, {
            command,
            cwd,
            shell,
            timeoutMs,
          });
    },
    executorMetadata: { family: "terminal", version: 1 },
    id: "terminal_run",
    inputSchema: {
      additionalProperties: false,
      properties: {
        background: {
          description: "Set true for a dev server or watcher that should keep running in an attachable terminal session.",
          type: "boolean",
        },
        backgroundWaitMs: {
          description: "For background commands, how long to collect startup output before returning. Defaults to 2000.",
          maximum: MAX_BACKGROUND_WAIT_MS,
          minimum: 250,
          type: "integer",
        },
        command: {
          description: "Shell command to run.",
          minLength: 1,
          type: "string",
        },
        cwd: {
          description: "Working directory inside the selected workspace. Defaults to the first workspace root.",
          minLength: 1,
          type: "string",
        },
        dryRun: {
          description: "Preview the terminal action without running it. Used for approval cards.",
          type: "boolean",
        },
        previewUrl: {
          description: "Optional localhost URL to associate with a background dev server.",
          minLength: 1,
          type: "string",
        },
        shell: {
          description: "Optional shell override. Defaults to PowerShell on Windows and the user's Unix shell on macOS/Linux.",
          enum: TERMINAL_SHELLS,
          type: "string",
        },
        timeoutMs: {
          description: "Buffered command timeout in milliseconds. Defaults to 45000 and is capped at 600000.",
          maximum: MAX_TERMINAL_TIMEOUT_MS,
          minimum: 1000,
          type: "integer",
        },
        workingDirectory: {
          description: "Alias for cwd. Must resolve inside the selected workspace.",
          minLength: 1,
          type: "string",
        },
      },
      required: ["command"],
      type: "object",
    },
    permission: "terminal",
    risk: "terminal",
    title: "Run terminal command",
  };
}

async function runBufferedCommand(
  backend: TerminalBackend,
  request: {
    command: string;
    cwd: string;
    shell?: TerminalShellId;
    timeoutMs: number;
  },
): Promise<ToolExecutionResult> {
  try {
    const response = await backend.runCommand({
      command: request.command,
      shell: request.shell,
      timeoutMs: request.timeoutMs,
      workingDirectory: request.cwd,
    });
    const output = formatBufferedTerminalOutput(request.command, response);
    const ok = response.exitCode === 0 && !response.timedOut;

    return {
      content: output,
      data: {
        durationMs: response.durationMs,
        exitCode: response.exitCode ?? null,
        outputTruncated: response.outputTruncated,
        shell: response.shell,
        stderr: response.stderr,
        stdout: response.stdout,
        terminal: {
          command: request.command,
          exitCode: response.exitCode ?? null,
          live: false,
          outputTruncated: response.outputTruncated,
          shell: response.shell,
          timedOut: response.timedOut,
          workingDirectory: response.workingDirectory,
        },
        timedOut: response.timedOut,
        workingDirectory: response.workingDirectory,
      } as JsonValue,
      error: ok ? undefined : response.timedOut ? "Terminal command timed out." : `Terminal command exited with code ${response.exitCode ?? "unknown"}.`,
      ok,
    };
  } catch (error) {
    return createErrorResult(readErrorMessage(error, "Could not run terminal command."));
  }
}

async function runBackgroundCommand(
  backend: TerminalBackend,
  request: {
    command: string;
    cwd: string;
    previewUrl?: string;
    shell?: TerminalShellId;
    waitMs: number;
  },
): Promise<ToolExecutionResult> {
  try {
    const session = await backend.createSession({
      mode: "command",
      shell: request.shell,
      workingDirectory: request.cwd,
    });
    await backend.writeSession(session.sessionId, `${request.command}\r\n`);

    const startedAt = Date.now();
    const chunks: string[] = [formatTerminalChunks(session.initialOutput)];
    let latestDrain: TerminalDrainResponse | undefined;

    while (Date.now() - startedAt < request.waitMs) {
      await sleep(BACKGROUND_POLL_INTERVAL_MS);
      latestDrain = await backend.drainSession(session.sessionId);
      chunks.push(formatTerminalChunks(latestDrain.chunks));

      if (!latestDrain.commandRunning && latestDrain.lastCommandCompleted) {
        break;
      }
    }

    const outputPreview = chunks.join("").trim();
    const detectedPreviewUrl = request.previewUrl ?? findLocalPreviewUrl(outputPreview);
    const exitCode = latestDrain?.lastCommandCompleted ? latestDrain.lastCommandExitCode ?? null : null;
    const live = latestDrain?.lastCommandCompleted ? false : true;
    const ok = live || exitCode === 0;

    backend.registerBackgroundSession({
      browserPreviewUrl: detectedPreviewUrl,
      command: request.command,
      outputPreview,
      sessionId: session.sessionId,
      shell: session.shell,
      startedAt: session.startedAt,
      workingDirectory: latestDrain?.workingDirectory ?? session.workingDirectory,
    });

    const content = [
      live ? "Background session: running" : `Background command exited with code ${exitCode ?? "unknown"}.`,
      `Session: ${session.sessionId}`,
      `cwd: ${latestDrain?.workingDirectory ?? session.workingDirectory}`,
      `shell: ${session.shell}`,
      `command: ${request.command}`,
      detectedPreviewUrl ? `Browser preview URL: ${detectedPreviewUrl}` : "",
      outputPreview ? ["", "Startup output:", outputPreview].join("\n") : "",
    ].filter(Boolean).join("\n");

    return {
      content,
      data: {
        browserPreviewUrl: detectedPreviewUrl ?? null,
        exitCode,
        outputPreview,
        terminal: {
          command: request.command,
          exitCode,
          live,
          sessionId: session.sessionId,
          shell: session.shell,
          timedOut: false,
          workingDirectory: latestDrain?.workingDirectory ?? session.workingDirectory,
        },
      } as JsonValue,
      error: ok ? undefined : `Background command exited with code ${exitCode ?? "unknown"}.`,
      ok,
    };
  } catch (error) {
    return createErrorResult(readErrorMessage(error, "Could not start background terminal command."));
  }
}

function resolveTerminalCwd(args: Record<string, unknown>, context: Pick<ToolExecutionContext, "workspaceRoots">) {
  const requested = stringArg(args.cwd) || stringArg(args.workingDirectory) || ".";
  const resolution = tryResolveAllowedPath(context, requested);

  if (!resolution.ok) {
    return resolutionToResult(resolution.error);
  }

  return resolution.path.resolved;
}

function formatBufferedTerminalOutput(command: string, response: Awaited<ReturnType<TerminalBackend["runCommand"]>>) {
  return [
    `Terminal command: ${command}`,
    `cwd: ${response.workingDirectory}`,
    `shell: ${response.shell}`,
    `Exit code: ${response.exitCode ?? "unknown"}`,
    `Duration: ${response.durationMs} ms${response.timedOut ? " (timed out)" : ""}${response.outputTruncated ? " (output truncated)" : ""}`,
    response.stdout.trim() ? ["", "stdout:", response.stdout.trim()].join("\n") : "",
    response.stderr.trim() ? ["", "stderr:", response.stderr.trim()].join("\n") : "",
  ].filter(Boolean).join("\n");
}

function formatTerminalChunks(chunks: TerminalDrainResponse["chunks"]) {
  return chunks.map((chunk) => chunk.text).join("");
}

function stringArg(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function terminalShellArg(value: unknown): TerminalShellId | undefined {
  return TERMINAL_SHELLS.includes(value as TerminalShellId) ? value as TerminalShellId : undefined;
}

function booleanArg(value: unknown) {
  return value === true;
}

function integerArg(value: unknown, fallback: number, min: number, max: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(min, Math.min(max, Math.floor(value)));
}

function normalizePreviewUrl(value: string | undefined) {
  if (!value) {
    return undefined;
  }

  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return undefined;
    }
    if (isLoopbackHostname(url.hostname)) {
      url.hostname = "localhost";
    }
    return url.href;
  } catch {
    return undefined;
  }
}

function findLocalPreviewUrl(text: string) {
  const match = text.match(/https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::\d+)?(?:\/[^\s"'<>)]*)?/i)?.[0];
  return normalizePreviewUrl(match);
}

function isLoopbackHostname(hostname: string) {
  const host = hostname.toLowerCase();
  return host === "127.0.0.1" || host === "0.0.0.0" || host === "::1" || host === "[::1]";
}

function createErrorResult(message: string): ToolExecutionResult {
  return {
    content: message,
    error: message,
    ok: false,
  };
}

function resolutionToResult(error: PathResolutionError): ToolExecutionResult {
  return createErrorResult(error.message);
}

function readErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
