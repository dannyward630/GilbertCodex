import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultProviderSettings } from "../lib/appStorage";
import type { ChatMessage } from "../types/chat";
import type { ProviderSettings } from "../types/settings";
import { streamProviderMessage } from "./modelProviderClient";

function createSettings(): ProviderSettings {
  return {
    ...defaultProviderSettings,
    apiKeys: {
      ...defaultProviderSettings.apiKeys,
      openai: "test-key",
    },
    model: "gpt-test",
    provider: "openai",
    thinking: {
      effort: "minimal",
      enabled: false,
    },
  };
}

function createMessage(): ChatMessage {
  return {
    content: "write a file",
    createdAt: new Date(0).toISOString(),
    id: "message-1",
    role: "user",
  };
}

function streamResponse(lines: string[]) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      lines.forEach((line) => {
        controller.enqueue(encoder.encode(`${line}\n\n`));
      });
      controller.close();
    },
  });

  return new Response(stream, {
    headers: { "content-type": "text/event-stream" },
    status: 200,
  });
}

function openAiToolCallChunk(argumentsDelta: string, options: { id?: string; name?: string } = {}) {
  return `data: ${JSON.stringify({
    choices: [{
      delta: {
        tool_calls: [{
          function: {
            arguments: argumentsDelta,
            name: options.name,
          },
          id: options.id,
          index: 0,
          type: "function",
        }],
      },
    }],
  })}`;
}

describe("streamProviderMessage tool call parsing", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("preserves parsed streaming tool-call arguments", async () => {
    vi.stubGlobal("window", {
      clearTimeout: globalThis.clearTimeout,
      setTimeout: globalThis.setTimeout,
    });
    vi.stubGlobal("fetch", vi.fn(async () => streamResponse([
      openAiToolCallChunk("{\"path\":\"index.html\"", { id: "call-write", name: "files_write" }),
      openAiToolCallChunk(",\"content\":\"hello\"}"),
      "data: [DONE]",
    ])));

    const response = await streamProviderMessage(createSettings(), [createMessage()], vi.fn());

    expect(response.toolCalls?.[0]).toMatchObject({
      arguments: { content: "hello", path: "index.html" },
      id: "call-write",
      name: "files_write",
    });
    expect(response.toolCalls?.[0]?.argumentsParseError).toBeUndefined();
  });

  it("preserves streaming JSON parse errors instead of passing raw strings to validation", async () => {
    vi.stubGlobal("window", {
      clearTimeout: globalThis.clearTimeout,
      setTimeout: globalThis.setTimeout,
    });
    vi.stubGlobal("fetch", vi.fn(async () => streamResponse([
      openAiToolCallChunk("{\"path\":\"index.html\",\"content\":\"line 1\nline 2\"}", { id: "call-write", name: "files_write" }),
      "data: [DONE]",
    ])));

    const response = await streamProviderMessage(createSettings(), [createMessage()], vi.fn());

    expect(response.toolCalls?.[0]).toMatchObject({
      arguments: {},
      id: "call-write",
      name: "files_write",
    });
    expect(response.toolCalls?.[0]?.argumentsParseError).toContain("Could not parse tool arguments as JSON");
  });
});
