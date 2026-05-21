# Chat And Provider Runtime Audit

Last updated: 2026-05-21

## Priority Findings

1. Core workspace runtime modules were partly hidden from TypeScript.
   - `src/app/workspace/runtimeTypes.ts` used `WorkspaceRuntimeDeps extends Record<string, any>`, which let extracted runtime modules ask for any dependency without a compile-time contract.
   - `src/app/workspace/providers/providerStreaming.tsx` had `@ts-nocheck` even though it owns provider retry, empty-response recovery, usage accounting, and steering progress.
   - `src/app/workspace/chat/sendActions.tsx` had `@ts-nocheck` even though it owns new sends, queued sends, planning-mode research, Discord response streaming, and app-owned agent dispatch.
   - The remaining highest-risk unchecked modules are generation queue, planning/regeneration, message context, context window, local tool streaming, app-owned agent runtime, approval actions, route rendering, and workspace state modules.

2. Chat send and provider streaming are still tightly coupled to a large runtime object.
   - `WorkspaceApp.tsx` passes a mutable `runtime` object through many `(impl as any)(runtime, ...)` wrappers.
   - This makes it too easy for a moved helper to silently depend on a missing or renamed function until a runtime path hits it.
   - The repair path should continue replacing catch-all dependencies with module-specific contracts before broad behavior changes.

3. Provider/model routing is mostly covered, but freshness must be verified before changing defaults.
   - Current provider defaults and endpoint constants live in `src/lib/models.ts`.
   - Request serialization lives in `src/services/modelProviderClient.ts`.
   - OpenRouter free routing lives in `src/services/openRouterRouting.ts`.
   - Do not change default model IDs, endpoint paths, or provider reasoning parameters without checking current official provider docs or live provider catalogs.

4. Tool attachment remains a request-shape risk, not only a prompt risk.
   - The important boundaries are `src/toolBridge/selection.ts`, `src/toolBridge/capabilityPlan.ts`, `src/toolBridge/adapters/*`, and `src/prompts/agent/runtimeToolPrompt.ts`.
   - Regressions here can make the model say tools are unavailable even when settings show them enabled.

5. Build and performance are healthy enough to defer until correctness work lands.
   - Baseline verification passed for typecheck, focused Vitest, Rust check, and production build.
   - The production build still reports large `index` and `mapbox` chunks, so code-splitting remains an optimization item after runtime correctness.

## Completed In This Repair Slice

- Removed the catch-all `Record<string, any>` inheritance from `WorkspaceRuntimeDeps`.
- Added an explicit `ProviderStreamingDeps` contract for provider retry, usage accounting, message updates, and steering helpers.
- Removed `@ts-nocheck` from `src/app/workspace/providers/providerStreaming.tsx`.
- Added an explicit `SendActionsDeps` contract for chat send, queued send, planning-mode research, Discord streaming, and app-owned agent dispatch.
- Removed `@ts-nocheck` from `src/app/workspace/chat/sendActions.tsx` and fixed the queued-send signature to match the optional caller path.
- Replaced the provider-streaming and send-action implementation-level `any` wrappers in `WorkspaceApp.tsx` with narrow runtime-contract casts.
- Added focused regression tests for provider retry/evidence behavior and chat queued-steering behavior.
- Kept public APIs, storage shape, provider settings shape, and user-visible behavior unchanged.

## Next Repair Slices

1. Split generation queue dependencies next, because queued sends, stop/restore behavior, and steering are core chat correctness paths.
2. Type the context-window and message-context modules so compaction, local context, memory, source-control context, and web-search context are checked.
3. Type planning/regeneration next so approval handoff, plan revision, and retry/regenerate paths cannot drift.
4. Verify provider defaults against official docs/live catalogs before making any model or endpoint changes.
5. Add tests for planning research evidence, regeneration, provider serialization, and tool attachment as each unchecked module is typed.
