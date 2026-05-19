import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultProviderSettings } from "../lib/appStorage";
import type { ChatAttachment } from "../types/chat";
import { createFallbackChatTitle, generateChatTitle, normalizeGeneratedChatTitle } from "./chatTitleClient";
import { sendProviderMessage } from "./modelProviderClient";

vi.mock("./modelProviderClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./modelProviderClient")>();

  return {
    ...actual,
    sendProviderMessage: vi.fn(),
  };
});

const mockedSendProviderMessage = vi.mocked(sendProviderMessage);

function imageAttachment(name = "screenshot.png"): ChatAttachment {
  return {
    createdAt: new Date(0).toISOString(),
    dataUrl: "data:image/png;base64,aW1hZ2U=",
    id: "attachment-1",
    kind: "image",
    mimeType: "image/png",
    name,
    size: 1024,
  };
}

function fileAttachment(name = "quarterly-roadmap.pdf"): ChatAttachment {
  return {
    createdAt: new Date(0).toISOString(),
    id: "attachment-2",
    kind: "file",
    mimeType: "application/pdf",
    name,
    size: 2048,
  };
}

describe("chat title generation", () => {
  afterEach(() => {
    mockedSendProviderMessage.mockReset();
  });

  it("parses structured JSON title responses", () => {
    expect(normalizeGeneratedChatTitle("{\"title\":\"Fix Terminal Reconnect\"}", "Fallback Title")).toBe("Fix Terminal Reconnect");
  });

  it("falls back to plain text title cleanup when providers ignore JSON", () => {
    expect(normalizeGeneratedChatTitle("Title: \"Fix terminal reconnect.\"", "Fallback Title")).toBe("Fix terminal reconnect");
  });

  it("parses JSON inside code fences", () => {
    expect(normalizeGeneratedChatTitle("```json\n{\"title\":\"Review API Errors\"}\n```", "Fallback Title")).toBe("Review API Errors");
  });

  it("rejects visible tool-call garbage and generic titles", () => {
    expect(normalizeGeneratedChatTitle("<tool_call>{}</tool_call>", "Improve Chat Naming")).toBe("Improve Chat Naming");
    expect(normalizeGeneratedChatTitle("New chat", "Improve Chat Naming")).toBe("Improve Chat Naming");
  });

  it("limits long generated titles to the sidebar title budget", () => {
    const title = normalizeGeneratedChatTitle(
      "{\"title\":\"Investigate Provider Aware Chat Naming Regression Across Every Runtime\"}",
      "Fallback Title",
    );

    expect(title.length).toBeLessThanOrEqual(54);
    expect(title.endsWith("...")).toBe(true);
  });

  it("creates a better text fallback than copying the first sentence", () => {
    expect(createFallbackChatTitle({
      attachments: [],
      content: "please look into our chat naming system which ai named the chats but its not good",
    })).toBe("Chat Naming System");
  });

  it("uses useful attachment names for attachment-only chats", () => {
    expect(createFallbackChatTitle({
      attachments: [fileAttachment()],
      content: "",
    })).toBe("Quarterly Roadmap");
    expect(createFallbackChatTitle({
      attachments: [imageAttachment()],
      content: "",
    })).toBe("Image Upload");
  });

  it("preserves non-English generated titles instead of translating them", () => {
    expect(normalizeGeneratedChatTitle("{\"title\":\"Error de Inicio de Sesion\"}", "Fallback Title")).toBe("Error de Inicio de Sesion");
  });

  it("requests provider structured output for title helper calls", async () => {
    mockedSendProviderMessage.mockResolvedValueOnce({ content: "{\"title\":\"Improve Chat Naming\"}" });

    const title = await generateChatTitle(defaultProviderSettings, {
      attachments: [],
      content: "look into our chat naming system",
    });

    expect(title).toBe("Improve Chat Naming");
    expect(mockedSendProviderMessage).toHaveBeenCalledTimes(1);
    expect(mockedSendProviderMessage.mock.calls[0]?.[2]?.structuredOutput).toMatchObject({
      name: "chat_title",
      schema: {
        required: ["title"],
      },
    });
  });

  it("retries without structured output when a provider rejects the schema option", async () => {
    mockedSendProviderMessage
      .mockRejectedValueOnce(new Error("response_format is not supported"))
      .mockResolvedValueOnce({ content: "{\"title\":\"Improve Chat Naming\"}" });

    const title = await generateChatTitle(defaultProviderSettings, {
      attachments: [],
      content: "look into our chat naming system",
    });

    expect(title).toBe("Improve Chat Naming");
    expect(mockedSendProviderMessage).toHaveBeenCalledTimes(2);
    expect(mockedSendProviderMessage.mock.calls[0]?.[2]?.structuredOutput).toBeTruthy();
    expect(mockedSendProviderMessage.mock.calls[1]?.[2]?.structuredOutput).toBeUndefined();
  });
});
