/**
 * Self-heal substrate barrel. Phase 1.
 *
 * What this package gives the rest of the app:
 *   - `classifyToolFailure(...)` — turn raw stderr/exit codes into a stable cause.
 *   - `recordToolFailure(...)` / `recordToolSuccess(...)` — drive the streak counter.
 *   - `buildAdaptationRecommendation(...)` — render the agent-facing recommendation.
 *   - `readToolOverrides(...)` / `writeToolOverrides(...)` — manifest I/O.
 *
 * What this package deliberately does NOT do yet (Phase 2):
 *   - Apply overlay args at dispatch time.
 *   - Auto-synthesize shadow scripts.
 *   - Surface per-workspace tool variants in the Toolbox UI.
 */

export { buildAdaptationRecommendation, summariesForTool } from "./adaptationPrompt";
export { classifyToolFailure } from "./causeClassifier";
export type { ClassifyToolFailureInput } from "./causeClassifier";
export {
  ensureWorkspaceFailuresLoaded,
  getRecentFailures,
  recordToolFailure,
  recordToolSuccess,
  resetFailureLedgerForTests,
  workspaceKey,
} from "./failureLedger";
export type { RecordedFailure } from "./failureLedger";
export { resetFailurePersistenceForTests } from "./failurePersistence";
export { emptyProjectToolsSnapshot, loadProjectToolsSnapshot } from "./projectToolsSnapshot";
export type {
  ProjectFailureSummary,
  ProjectShadowTool,
  ProjectToolsSnapshot,
} from "./projectToolsSnapshot";
export {
  clearOverridesCacheForTests,
  lookupOverlay,
  readToolOverrides,
  removeToolOverlay,
  upsertToolOverlay,
  writeToolOverrides,
} from "./overrides";
export { clearShadowProbeCacheForTests, findShadowForTool, invalidateShadowProbe } from "./shadowTools";
export type {
  ClassifiedFailure,
  ToolFailureCause,
  ToolFailureRecord,
  ToolOverlay,
  ToolOverridesManifest,
} from "./types";
export { emptyToolOverridesManifest, NON_ADAPTABLE_CAUSES } from "./types";
