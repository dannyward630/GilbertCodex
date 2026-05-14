import { describe, expect, it, vi } from "vitest";
import { executeToolBridgeCalls, resolveToolPermission, ToolRegistry } from "../index";
import {
  createBrowserPreviewTool,
  createTerminalRunTool,
  createWebSearchTool,
  type BrowserPreviewBackend,
  type TerminalBackend,
  type WebSearchToolBackend,
} from "../index";
import type {
  TerminalCreateSessionRequest,
  TerminalCreateSessionResponse,
  TerminalDrainResponse,
  TerminalRunCommandRequest,
  TerminalRunCommandResponse,
} from "../../types/terminal";
import type { ToolExecutionContext } from "../types";

const ROOT = "/workspace/project";

function makeContext(overrides: Partial<ToolExecutionContext> = {}): ToolExecutionContext {
  return {
    model: "test-model",
    permissionMode: "default",
    provider: "openai",
    workspaceRoots: [ROOT],
    ...overrides,
  };
}

function makeTerminalBackend(overrides: Partial<TerminalBackend> = {}): TerminalBackend {
  return {
    createSession: overrides.createSession ?? (async (request: TerminalCreateSessionRequest): Promise<TerminalCreateSessionResponse> => ({
      initialOutput: [],
      sessionId: "terminal-1",
      shell: request.shell ?? "powershell",
      startedAt: 1_700_000_000_000,
      workingDirectory: request.workingDirectory ?? ROOT,
    })),
    drainSession: overrides.drainSession ?? (async (): Promise<TerminalDrainResponse> => ({
      chunks: [],
      commandRunning: false,
      lastCommandCompleted: true,
      lastCommandExitCode: 0,
      workingDirectory: ROOT,
    })),
    isAvailable: overrides.isAvailable ?? (() => true),
    registerBackgroundSession: overrides.registerBackgroundSession ?? vi.fn(),
    runCommand: overrides.runCommand ?? (async (request: TerminalRunCommandRequest): Promise<TerminalRunCommandResponse> => ({
      durationMs: 12,
      exitCode: 0,
      outputTruncated: false,
      shell: request.shell ?? "powershell",
      stderr: "",
      stdout: "ok\n",
      timedOut: false,
      workingDirectory: request.workingDirectory ?? ROOT,
    })),
    writeSession: overrides.writeSession ?? vi.fn(),
  };
}

describe("terminal_run", () => {
  it("is visible to the model only as an approval-pending hard-gated bridge tool", () => {
    const tool = createTerminalRunTool(makeTerminalBackend());

    expect(resolveToolPermission(tool, makeContext({ permissionMode: "full-access" }))).toMatchObject({
      allowed: false,
      requiresApproval: true,
    });
  });

  it("runs a buffered command with cwd, timeout, output, and terminal metadata after approval", async () => {
    const runCommand = vi.fn(makeTerminalBackend().runCommand);
    const tool = createTerminalRunTool(makeTerminalBackend({ runCommand }));
    const registry = new ToolRegistry([tool]);

    const batch = await executeToolBridgeCalls({
      approval: async () => ({ approved: true }),
      calls: [
        {
          arguments: { command: "npm test", cwd: ".", timeoutMs: 3000 },
          id: "call-terminal",
          name: "terminal_run",
          provider: "openai",
        },
      ],
      context: makeContext(),
      registry,
    });

    expect(runCommand).toHaveBeenCalledWith({
      command: "npm test",
      shell: undefined,
      timeoutMs: 3000,
      workingDirectory: ROOT,
    });
    expect(batch.toolCalls[0]).toMatchObject({
      status: "complete",
      terminal: {
        command: "npm test",
        exitCode: 0,
        live: false,
        workingDirectory: ROOT,
      },
    });
    expect(batch.resultMessages[0]?.result.content).toContain("Exit code: 0");
  });

  it("creates a background terminal session and normalizes detected localhost preview URLs", async () => {
    const registerBackgroundSession = vi.fn();
    const backend = makeTerminalBackend({
      drainSession: async () => ({
        chunks: [{
          id: "chunk-1",
          stream: "stdout",
          text: "Vite ready at http://127.0.0.1:5173/\n",
          timestamp: 1,
        }],
        commandRunning: true,
        lastCommandCompleted: false,
        workingDirectory: ROOT,
      }),
      registerBackgroundSession,
    });
    const tool = createTerminalRunTool(backend);

    const result = await tool.execute({
      background: true,
      backgroundWaitMs: 250,
      command: "npm run dev",
      cwd: ".",
    }, makeContext());

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      browserPreviewUrl: "http://localhost:5173/",
      terminal: {
        command: "npm run dev",
        live: true,
        sessionId: "terminal-1",
        workingDirectory: ROOT,
      },
    });
    expect(registerBackgroundSession).toHaveBeenCalledWith(expect.objectContaining({
      browserPreviewUrl: "http://localhost:5173/",
      command: "npm run dev",
      sessionId: "terminal-1",
    }));
  });
});

describe("browser_preview_open", () => {
  it("opens the latest background terminal preview URL when no URL is supplied", async () => {
    const backend: BrowserPreviewBackend = {
      getBackgroundPreviewUrls: () => ["http://127.0.0.1:5173/"],
      getCurrentAppUrl: () => "tauri://localhost/",
    };
    const tool = createBrowserPreviewTool(backend);
    const result = await tool.execute({}, makeContext());

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      browserPreviewUrl: "http://localhost:5173/",
    });
  });

  it("blocks private network and current-app preview targets", async () => {
    const tool = createBrowserPreviewTool({
      getBackgroundPreviewUrls: () => [],
      getCurrentAppUrl: () => "http://localhost:1420/",
    });

    await expect(await tool.execute({ url: "http://localhost:1420/" }, makeContext())).toMatchObject({
      ok: false,
    });
    await expect(await tool.execute({ url: "https://192.168.1.12/" }, makeContext())).toMatchObject({
      ok: false,
    });
  });
});

describe("web_search", () => {
  it("returns source cards from the configured web provider without approval", async () => {
    const search = vi.fn<WebSearchToolBackend["search"]>(async (query, settings, options) => ({
      primaryProvider: settings.provider,
      provider: settings.provider,
      results: [
        {
          snippet: `Docs for ${query}`,
          title: "Brave Search API docs",
          url: "https://api-dashboard.search.brave.com/documentation/guides/authentication",
        },
      ],
    }));
    const tool = createWebSearchTool({ search });
    const registry = new ToolRegistry([tool]);
    const context = makeContext({
      webSearchMaxResults: 6,
      webSearchSettings: {
        brave: {
          apiKey: "test",
          apiVersion: "",
          answersMaxCompletionTokens: 700,
          answersModel: "brave",
          cacheControlNoCache: false,
          country: "US",
          enableAnswers: false,
          enableImageSearch: false,
          enableNewsSearch: false,
          enablePlaceSearch: false,
          enableRichCallback: false,
          enableSemanticRerank: true,
          enableVideoSearch: false,
          extraSnippets: true,
          freshness: "any",
          freshnessEndDate: "",
          freshnessStartDate: "",
          goggles: "",
          imageResultCount: 6,
          includeFetchMetadata: false,
          locationCity: "",
          locationCountry: "",
          locationLatitude: "",
          locationLongitude: "",
          locationPostalCode: "",
          locationState: "",
          locationStateName: "",
          locationTimezone: "",
          newsResultCount: 6,
          offset: 0,
          operators: true,
          placeLocation: "",
          placeRadiusMeters: 2500,
          placeResultCount: 6,
          requestMethod: "get",
          resultFilter: [],
          safesearch: "moderate",
          searchLang: "en",
          showImageResults: false,
          spellcheck: true,
          summary: false,
          textDecorations: false,
          uiLang: "en-US",
          units: "imperial",
          videoResultCount: 4,
        },
        enabled: true,
        maxResults: 6,
        provider: "brave",
      },
    });

    const batch = await executeToolBridgeCalls({
      calls: [{ arguments: { freshness: "pw", maxResults: 3, query: "Brave auth" }, id: "call-web", name: "web_search", provider: "openai" }],
      context,
      registry,
    });

    expect(search).toHaveBeenCalledWith("Brave auth", expect.objectContaining({
      brave: expect.objectContaining({ freshness: "pw" }),
      maxResults: 3,
      provider: "brave",
    }), expect.objectContaining({ includeVisualResults: false, maxResults: 3 }));
    expect(batch.toolCalls[0]).toMatchObject({ status: "complete", toolId: "web_search" });
    expect(batch.resultMessages[0]?.result.content).toContain("WEB SEARCH TOOL RESULTS - Brave Search");
    expect(batch.resultMessages[0]?.result.data).toMatchObject({
      provider: "brave",
      resultCount: 1,
      sources: [
        expect.objectContaining({
          title: "Brave Search API docs",
          url: "https://api-dashboard.search.brave.com/documentation/guides/authentication",
        }),
      ],
    });
  });
});
