import { loadPersistentString, savePersistentString } from "../lib/appStorage";
import { createEmptyAutomationState, normalizeAutomationState } from "../lib/automationScheduler";
import type { AutomationState } from "../types/automation";

const AUTOMATION_STATE_KEY = "gilbert-codex.automation-tasks.v1";

export function loadAutomationState(): AutomationState {
  const raw = loadPersistentString(AUTOMATION_STATE_KEY);

  if (!raw) {
    return createEmptyAutomationState();
  }

  try {
    return normalizeAutomationState(JSON.parse(raw));
  } catch {
    return createEmptyAutomationState();
  }
}

export function saveAutomationState(state: AutomationState) {
  savePersistentString(AUTOMATION_STATE_KEY, JSON.stringify(normalizeAutomationState(state)));
}
