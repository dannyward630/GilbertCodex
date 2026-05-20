import { describe, expect, it } from "vitest";

import { createPlainTextRevisionBridgeCalls, parsePlainTextEmailRevision } from "./approvalRevisionFallback";
import type { ToolCallRequest } from "../../../toolBridge";

describe("approval revision fallback", () => {
  it("turns a prose Gmail revision back into revised tool arguments", () => {
    const originalCall: ToolCallRequest = {
      arguments: {
        accountEmail: "sender@example.com",
        body: "Original body",
        inReplyTo: "-",
        references: "-",
        subject: "About Google Codex",
        threadId: "-",
        to: ["recipient@example.com"],
      },
      id: "call-1",
      name: "gmail_send_message",
      provider: "openai",
    };

    const revised = createPlainTextRevisionBridgeCalls(
      [originalCall],
      [
        "Please approve the revised email before I send it:",
        "",
        "To: recipient@example.com",
        "Subject: Gilbert Codex",
        "Body:",
        "Hi Recipient,",
        "",
        "I wanted to share a quick note about Gilbert Codex.",
        "",
        "Best,",
        "[Your Name]",
        "",
        "Reply send if this looks good.",
      ].join("\n"),
      () => "gmail",
    );

    expect(revised[0]?.arguments).toMatchObject({
      accountEmail: "sender@example.com",
      body: "Hi Recipient,\n\nI wanted to share a quick note about Gilbert Codex.\n\nBest,\n[Your Name]",
      subject: "Gilbert Codex",
      to: ["recipient@example.com"],
    });
    expect(revised[0]?.arguments).not.toHaveProperty("threadId");
    expect(revised[0]?.arguments).not.toHaveProperty("inReplyTo");
    expect(revised[0]?.arguments).not.toHaveProperty("references");
  });

  it("parses labeled revised email content without the final prose instruction", () => {
    const parsed = parsePlainTextEmailRevision("To: dev@example.com\nSubject: Update\nBody:\nHello\n\nPlease confirm if this is okay.");

    expect(parsed).toEqual({
      body: "Hello",
      subject: "Update",
      to: ["dev@example.com"],
    });
  });
});
