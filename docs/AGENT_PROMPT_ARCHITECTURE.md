# Agent Prompt Architecture

Gilbert Codex uses a modular prompt stack instead of one large always-on system prompt.

## Goals

- Keep stable core instructions short and cache-friendly.
- Load detailed skills only when the request needs them.
- Use a local vector index for prompt chunk retrieval.
- Keep runtime rules accurate while provider tool-bridge actions, host-attached context, and web-search context are selectively available.
- Preserve enough instruction strength for coding work without spending unnecessary tokens on unrelated prompt text.

## Runtime Flow

1. `buildAgentSystemPrompt` receives provider settings and the messages about to be sent.
2. `createAgentPromptRetrievalContext` builds a retrieval query from the latest user request, recent messages, mode, web-search state, thinking state, and whether prior activity evidence is present.
3. `selectPromptChunks` embeds that query and ranks prompt chunks from the catalog.
4. Mandatory core instructions are always included. Coding, research, planning, review, and frontend chunks are selected only when relevant or forced by active context.
5. `createRuntimeToolPrompt` adds provider tool-bridge guardrails and web-search guidance.
6. The provider clients send the composed prompt as the system prompt or Responses API `instructions`.

## Folder Map

- `src/prompts/agent/instructions/core.md`
  Stable assistant identity and senior-engineering operating rules.
- `src/prompts/agent/instructions/**/SKILL.md`
  Skill-style instruction files with name/description front matter.
- `src/prompts/agent/promptCatalog.ts`
  Registry of prompt chunks, keywords, priorities, and per-chunk budgets.
- `src/prompts/agent/promptEmbedding.ts`
  Deterministic local vector embedding and cosine similarity.
- `src/prompts/agent/promptRetrieval.ts`
  Query construction, scoring, forced chunk selection, and token budgeting.
- `src/prompts/agent/runtimeToolPrompt.ts`
  Runtime guidance for provider-attached tools, host-managed web search, permission boundaries, and unavailable tool families.
- `src/prompts/agent/agentPrompt.ts`
  Final prompt assembly and total prompt budget enforcement.

## Embeddings

The first version uses deterministic local embeddings so prompt retrieval works offline and does not spend model-provider tokens. Each prompt chunk is embedded once in memory, then the current request is embedded and ranked by cosine similarity plus keyword and context boosts.

This can later be swapped for provider embeddings if the app adds a server-side embedding cache. The retrieval boundary should stay the same: a query vector, chunk vectors, a score, and a token budget.

## Prompt Token Discipline

The core prompt is always first. This keeps stable instructions at the top of the request and leaves task-specific content later. Optional chunks have individual token caps and the complete system prompt has a final cap. If a chunk is too large, it is trimmed with a clear marker instead of silently overrunning the budget.

## Adding A New Skill

1. Add a new `SKILL.md` under `src/prompts/agent/instructions`.
2. Register it in `promptCatalog.ts` with strong trigger keywords, a priority, and a max token budget.
3. Add a forced-selection rule in `promptRetrieval.ts` only if the skill must load for a reliable runtime condition.
4. Keep runtime-specific tool guidance in `runtimeToolPrompt.ts` rather than duplicating it inside every skill.
