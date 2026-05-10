import { invoke } from "@tauri-apps/api/core";
import type { AgentRun } from "../types/agentRun";
import { isTauriDesktopRuntime } from "./tauriClient";

const FALLBACK_AGENT_RUNS_KEY = "gilbert-codex.agent-runs.v1";

export async function listAgentRuns(): Promise<AgentRun[]> {
  if (isTauriDesktopRuntime()) {
    try {
      return await invoke<AgentRun[]>("agent_runs_list");
    } catch {
      return readFallbackAgentRuns();
    }
  }

  return readFallbackAgentRuns();
}

export async function saveAgentRun(run: AgentRun): Promise<AgentRun> {
  const normalizedRun = normalizeAgentRun(run);

  if (isTauriDesktopRuntime()) {
    try {
      return await invoke<AgentRun>("agent_run_save", { run: normalizedRun });
    } catch {
      writeFallbackAgentRun(normalizedRun);
      return normalizedRun;
    }
  }

  writeFallbackAgentRun(normalizedRun);
  return normalizedRun;
}

export async function deleteAgentRun(id: string): Promise<void> {
  if (isTauriDesktopRuntime()) {
    try {
      await invoke<void>("agent_run_delete", { id });
      return;
    } catch {
      deleteFallbackAgentRun(id);
      return;
    }
  }

  deleteFallbackAgentRun(id);
}

function normalizeAgentRun(run: AgentRun): AgentRun {
  return {
    ...run,
    approvals: Array.isArray(run.approvals) ? run.approvals : [],
    artifacts: Array.isArray(run.artifacts) ? run.artifacts : [],
    events: Array.isArray(run.events) ? run.events : [],
    sources: Array.isArray(run.sources) ? run.sources : [],
    steps: Array.isArray(run.steps) ? run.steps : [],
    toolCalls: Array.isArray(run.toolCalls) ? run.toolCalls : [],
    updatedAt: run.updatedAt || new Date().toISOString(),
  };
}

function readFallbackAgentRuns(): AgentRun[] {
  try {
    const rawRuns = window.localStorage.getItem(FALLBACK_AGENT_RUNS_KEY);
    const parsedRuns = rawRuns ? JSON.parse(rawRuns) : [];
    return Array.isArray(parsedRuns) ? parsedRuns.map((run) => normalizeAgentRun(run as AgentRun)) : [];
  } catch {
    return [];
  }
}

function writeFallbackAgentRun(run: AgentRun) {
  const runs = readFallbackAgentRuns();
  const existingIndex = runs.findIndex((existingRun) => existingRun.id === run.id);

  if (existingIndex >= 0) {
    runs[existingIndex] = run;
  } else {
    runs.unshift(run);
  }

  writeFallbackAgentRuns(runs.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)));
}

function deleteFallbackAgentRun(id: string) {
  writeFallbackAgentRuns(readFallbackAgentRuns().filter((run) => run.id !== id));
}

function writeFallbackAgentRuns(runs: AgentRun[]) {
  try {
    window.localStorage.setItem(FALLBACK_AGENT_RUNS_KEY, JSON.stringify(runs.slice(0, 200)));
  } catch {
    return;
  }
}
