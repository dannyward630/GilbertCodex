import { describe, expect, it } from "vitest";
import {
  createAutomationRuntimeToolOverrides,
  createAutomationSimulationSummary,
  createAutomationTaskFromDraft,
  createAutomationToolScope,
  computeAutomationSchedulerDelayMs,
  formatAutomationNotificationSummary,
  isAutomationTaskDue,
  normalizeAutomationState,
} from "./automationScheduler";
import type { AutomationRun } from "../types/automation";

describe("automationScheduler", () => {
  it("normalizes tasks and computes due interval schedules", () => {
    const state = normalizeAutomationState({
      tasks: [
        {
          id: "task-1",
          prompt: "Check Gmail",
          runCount: 0,
          status: "enabled",
          title: "Inbox",
          trigger: { everyMinutes: 30, kind: "interval" },
        },
      ],
    }, "2026-05-21T10:00:00.000Z");

    expect(state.tasks).toHaveLength(1);
    expect(state.tasks[0].nextRunAt).toBe("2026-05-21T10:30:00.000Z");
    expect(isAutomationTaskDue(state.tasks[0], "2026-05-21T10:29:59.000Z")).toBe(false);
    expect(isAutomationTaskDue(state.tasks[0], "2026-05-21T10:30:00.000Z")).toBe(true);
  });

  it("schedules the next runtime tick at the nearest due task", () => {
    const state = normalizeAutomationState({
      tasks: [
        {
          id: "task-1",
          prompt: "Soon",
          runCount: 0,
          status: "enabled",
          title: "Soon task",
          trigger: { everyMinutes: 10, kind: "interval" },
          nextRunAt: "2026-05-21T10:00:05.000Z",
        },
        {
          id: "task-2",
          prompt: "Later",
          runCount: 0,
          status: "enabled",
          title: "Later task",
          trigger: { everyMinutes: 10, kind: "interval" },
          nextRunAt: "2026-05-21T10:01:00.000Z",
        },
      ],
    }, "2026-05-21T10:00:00.000Z");

    expect(computeAutomationSchedulerDelayMs(state, Date.parse("2026-05-21T10:00:00.000Z"))).toBe(5_000);
    expect(computeAutomationSchedulerDelayMs(state, Date.parse("2026-05-21T10:00:06.000Z"))).toBe(1_000);
  });

  it("builds scoped tool allowlists from capabilities", () => {
    const task = createAutomationTaskFromDraft({
      capabilityScope: {
        autonomyLevel: "scoped",
        capabilities: ["gmail.read", "gmail.send", "web.search"],
      },
      prompt: "Read Gmail and send a summary if needed.",
      title: "Inbox monitor",
    }, "2026-05-21T10:00:00.000Z");
    const scope = createAutomationToolScope(task);

    expect(scope.autonomous).toBe(true);
    expect(scope.allowedToolIds).toContain("gmail_search_messages");
    expect(scope.allowedToolIds).toContain("gmail_send_message");
    expect(scope.allowedToolIds).toContain("web_search");
    expect(scope.maxToolCalls).toBe(task.runLimits.maxToolCalls);
  });

  it("keeps a task-specific provider and model on the normalized task", () => {
    const task = createAutomationTaskFromDraft({
      model: "gpt-5.5",
      prompt: "Run with the paid model.",
      provider: "openai",
      title: "Model override",
    }, "2026-05-21T10:00:00.000Z");

    expect(task.provider).toBe("openai");
    expect(task.model).toBe("gpt-5.5");
  });

  it("enables runtime web search only when requested by task scope", () => {
    const task = createAutomationTaskFromDraft({
      capabilityScope: {
        autonomyLevel: "scoped",
        capabilities: ["web.search"],
      },
      prompt: "Search current sources.",
      title: "Scout",
    });

    expect(createAutomationRuntimeToolOverrides(task).webSearch).toBe(true);
  });

  it("formats private notifications without leaking the summary", () => {
    const task = createAutomationTaskFromDraft({
      notificationPolicy: {
        privacy: "private",
      },
      prompt: "Check sensitive inbox details.",
      title: "Private inbox",
    });
    const run: AutomationRun = {
      finalSummary: "A very sensitive message from someone important needs a reply.",
      id: "run-1",
      notificationAttempts: [],
      reason: "manual",
      startedAt: "2026-05-21T10:00:00.000Z",
      status: "completed",
      taskId: task.id,
      updatedAt: "2026-05-21T10:01:00.000Z",
    };

    expect(formatAutomationNotificationSummary(task, run)).toBe("Private inbox: run ready in Tasks.");
  });

  it("simulates without claiming tools ran", () => {
    const task = createAutomationTaskFromDraft({
      capabilityScope: {
        autonomyLevel: "review",
        capabilities: ["calendar.read"],
      },
      prompt: "Prep my calendar.",
      title: "Calendar prep",
    });

    expect(createAutomationSimulationSummary(task)).toContain("No tools ran");
    expect(createAutomationSimulationSummary(task)).toContain("Calendar read");
  });
});
