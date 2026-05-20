# Gilbert Codex Progress

This file tracks the current product state for collaborators. It should describe what is live now, what is being hardened, and what remains open for the next alpha releases.

## Current Phase: v0.5.0 Advanced Desktop Alpha

Status: v0.5.0 moves Gilbert Codex from the earlier basic public alpha into a much more complete desktop AI workspace. The app now has local users, a modularized app runtime, stronger subscription account routing, image-generation artifacts, safer deletion/review flows, a support page, and release automation aligned around signed updater artifacts.

Delivered:

- Tauri 2 desktop shell with custom window chrome, local app metadata, branded installer assets, and update-ready release configuration.
- React chat workspace with project grouping, searchable history, pinned chats, attachments, planning mode, thinking controls, queued sends, queued steering behavior, and local persistence.
- Multi-provider model routing for OpenRouter, OpenAI, Anthropic, Google Gemini, xAI, LM Studio, Ollama, Groq, Mistral, and DeepSeek.
- Subscription account routing for Codex / ChatGPT, Claude Code, Gemini CLI / Cloud Code, Antigravity, GitHub Copilot, Kiro, Kilo Code, Cline, Qwen Code, iFlow, Qoder, Kimi Coding, and CodeBuddy where the local subscription runtime supports them.
- Codex / ChatGPT subscription sign-in with browser OAuth handoff, local callback handling, account status, and subscription model selection.
- Image generation through attached media tooling, with composer controls, model-facing prompt guidance, progress cards, generated image grids, lightbox preview, and downloads.
- Host-managed local action runtime with schema adapters for OpenAI-compatible chat, OpenAI Responses, and Anthropic Messages requests.
- Local capability families for diagnostics, file reads/search/listing, editing, terminal execution, browser preview, local Git, GitHub API surfaces, web search, and MCP server discovery/tool calls where settings and permissions allow them.
- Permission filtering that keeps read-only work smoother while gating terminal, destructive, credential, publish, and outside-scope actions.
- Tool result finalization that prevents raw tool output from leaking into final assistant answers and pushes the model toward a synthesized response when needed.
- Host-managed DuckDuckGo/Brave web search with source cards and a six-source cap.
- SQL-backed local database for desktop auth, chats, settings, integrations, browser preview state, and agent-run records, with database work shifted off the UI path.
- Discord slash-command bridge setup/runtime for forwarding requests into Gilbert chat.
- GitHub OAuth device-flow setup, account state, repository actions, and release/workflow surfaces.
- Voluntary support/funding page using public hosted links only, with secret-like values rejected before display.
- Apps page with live Gmail account management and MCP server management, plus a clear coming-next state for Skills.
- Documentation refreshed for the v0.5.0 public alpha story, updater release path, and contributor readiness.

Known alpha limits:

- Tool reliability still varies by provider and model, especially around malformed or incomplete tool calls.
- Approval UX and activity grouping need more polish before the bridge feels final.
- Image generation is first-class for the Codex / ChatGPT subscription path, while broader provider image routes still need more field testing.
- The Apps page still needs the Skills catalog and broader plugin marketplace polish.
- macOS and Linux source support exists, but official releases need native verification.
- The Windows installer remains unsigned unless a release is built with a valid code-signing configuration.
- Some advanced workflow automation and multimodal surfaces are still roadmap work, not promised release behavior.

## Next Hardening Work

- Add more provider compatibility tests for subscription routes, image generation, tool schemas, tool-result replay, malformed-call recovery, and streaming edge cases.
- Tighten terminal, editing, Git, GitHub, browser preview, and MCP approval flows with clearer review cards.
- Improve activity and inspector presentation so tools, files, approvals, sources, artifacts, and retries scan cleanly.
- Keep provider-visible request accounting aligned with the exact serialized request body each provider receives.
- Continue GitHub/source-control UI polish with diff review, PR handoff, release workflows, and CI visibility.
- Finish the Skills catalog and plugin marketplace polish now that Gmail and MCP have live Apps-page surfaces.
- Finish macOS and Linux native verification, packaging, and platform-specific fixes.
- Add public alpha validation notes after each packaged release is built and installed on a real machine.

## Open Questions

- Which tool families should be enabled by default for first-time users once the bridge has more field data.
- Whether high-impact GitHub release and workflow actions should require a dedicated confirmation card even in full-access mode.
- How much provider-native tool behavior should be exposed versus normalized through the app bridge.
- Which voice and multimodal capabilities should land before the next larger public milestone.
- Which license should remain final if MIT is not the long-term project choice.
