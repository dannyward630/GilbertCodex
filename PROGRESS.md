# Gilbert Codex Progress

This file tracks the product state so collaborators can see what has actually been built, what is still prototype-grade, and where the next work should land.

## Current Phase: First Public Alpha

Status: Windows public alpha v0.3.0 is being published as the next major collaboration update. macOS and Linux have partial source support, but still need contributors on those operating systems to test, package, and finish the port before they are official release targets.

Delivered:

- Tauri 2 desktop shell with custom window chrome and local app metadata.
- React app structure split into app, pages, components, services, tools, styles, lib, and types.
- Local account creation and sign-in with namespaced app state.
- Chat-first workspace with project grouping, searchable history, pinned chats, and local persistence.
- Multi-provider model routing for OpenRouter, OpenAI, Anthropic, Google Gemini, xAI, LM Studio, Ollama, Groq, Mistral, and DeepSeek with current default model IDs, streaming, thinking controls, and live catalogs where available.
- Planning mode with bounded planning passes and user-input checkpoints.
- Markdown assistant rendering with GitHub-flavored markdown support.
- File and image attachment flow with local previews, attachment status, and image-capable model routing.
- Web search path backed by DuckDuckGo context and source cards.
- Source-control path with local Git status, diff, log, stage, unstage, commit, push, pull, fetch, branch, and switch tools, plus GitHub Settings browser login, repository listing, branch/tree/file reads, code search, branch creation, API-backed commits, draft pull requests, releases, release notes, and workflow runs.
- Discord slash-command bridge setup and runtime with chat-mode selection, Discord application fields, signed interaction receiver, ngrok-backed public URL discovery, incoming channel webhook storage, and setup checklist copying.
- Local computer workspace context with folder selection, browser folder fallback, file indexing, file search, read helpers, structured edits, guarded writes, delete-file safety, rename/move helpers, and workspace-bound mutation policies.
- Typed file creation tools for TXT, Markdown, code, React, HTML, PDF, notes, duplicate-safe writes, and multi-file batches.
- Modular local tool executor with explicit parser, registry, approvals, policy, terminal, workspace, result-formatting, file-change, Git, GitHub, MCP, browser, weather, web-search, and file-mutation modules.
- Workflow layer with `workflow_run`, xstate-backed sequencing, parallel step support, branch/retry reporting, workflow definitions for audits, plan-patch-verify, research-backed patches, repo health sweeps, branch/PR prep, MCP usage, and monitor briefs.
- Provider compatibility path that forces the shared XML tool protocol for now and disables provider-native local tool calls until native tool-call IDs and provider-native tool-result messages can be persisted across turns.
- Terminal panel for desktop PowerShell/cmd on Windows and Bash/Zsh/sh on macOS and Linux.
- Toolbox feature toggles for provider, planning, thinking, web search, local Git/GitHub source control, local computer, terminal, browser preview, and future tools.
- Confirmation dialogs for destructive chat deletion and settings reset flows.
- Right-side activity rail for tool-call ledger status, approvals, planning input, terminal detail, artifacts, and run progress.
- Browser preview panel with local URL detection, resize controls, expanded mode, and keyboard resizing.
- Settings page for appearance, provider configuration, GitHub account connection, Discord bridge setup, model, generation, thinking, and web-search controls.
- Tauri security hardening with a configured CSP and least-privilege notification permissions.
- Rust host commands for auth, app info, computer files, Discord interactions, GitHub API operations, terminal, and web search.
- SQL-backed Gilbert Database for desktop auth, chats, settings, integrations, browser preview state, and agent runs, plus Settings inspection, legacy cleanup, and reset controls.
- Source documentation standards plus JSDoc/Rust doc coverage for key runtime, tool, GitHub, web-search, and workspace APIs.
- Repository hygiene for generated outputs, logs, local secrets, local databases, dependency folders, and build output.
- First public Windows x64 alpha packaged with a Tauri NSIS installer, GitHub release notes, and SHA-256 checksum details.
- Customer-facing Windows installer path with branded light/dark-safe NSIS artwork, WebView2 runtime checks, install-scope selection, Start menu metadata, license metadata, and a documented `npm.cmd run app:installer` build flow.
- Version 0.3.0 major alpha prep for the expanded model/runtime flow, modular tool runtime, workflow automation layer, MCP surface, weather and Mapbox settings, PDF/library support, precise local editing tools, browser-preview polish, stronger terminal/session handling, provider/tool compatibility tests, self-healing tool metadata, release-note automation, and open-source hygiene around local-only artifacts.
- Version 0.2.3 Terminal Stability Pack prep for PowerShell compatibility helpers, npm shim handling, live background command attachment, buffered command progress, longer verification timeouts, approval-resume dedupe, workspace-aware prompt context, Node/Python project recipes, browser-preview probing, pasted-image attachments, and external-link handoff hardening.
- Version 0.2.2 Stability Pack 1 prep for signed updater follow-through, interactive PTY/xterm terminal stability, account-scoped database storage, safer GitHub token isolation, richer Git review/commit/push controls, web-search timeout hardening, generated chat titles, targeted response stopping, and provider stream snapshot handling.
- Version 0.2.1 hotfix prep for GitHub browser auth reliability, clearer OAuth setup, safer missing-update-feed handling, release workflow tag resolution, and tool-run continuation fixes.
- Version 0.0.2 release prep for local Git review UX, broader GitHub release/workflow tooling, update checks, contributor infrastructure, and refreshed README media.
- macOS/Linux port groundwork documented in `docs/platform/README.md`, with native verification still outstanding.

## UI Completed So Far

- Application shell with sidebar, header, top bar, custom window controls, and terminal dock.
- Primary navigation for Chat, Workflows, Toolbox, and Settings.
- Chat thread layout with assistant and user message treatments.
- Composer with attachments, voice-control placeholder state, thinking toggles, planning mode, review mode, model picker, web search, local workspace controls, and send affordance.
- Conversation header with pinning, inspector, terminal, and browser-preview controls.
- Search dialog for chats and project navigation.
- Project, inspector, activity, browser preview, and terminal panels.
- Tool-call ledger UI for active, skipped, failed, waiting-approval, and completed local tool calls.
- Settings cards for appearance, provider configuration, GitHub browser login and account connection, model, generation, thinking, and web search.
- App, notice, confirm, and text-input dialogs.
- Empty, loading, streaming, success, warning, disabled, and unavailable states across the main flows.

## Next Hardening Work

- Move provider secrets and stored GitHub access tokens to OS-backed secure storage.
- Add unit tests around chat utilities, storage normalization, provider request creation, attachment handling, and tool-call parsing.
- Add more provider-contract tests for reasoning payloads, model fallback normalization, live catalog merging, and model-specific tool-call compatibility.
- Expand review cards for source-control operations with richer diffs before remote commits.
- Add durable job state for long-running agent tasks.
- Add the Discord bot-gateway runtime for DM, mention, and approved message-content flows.
- Improve ignored-folder handling in local workspace indexing.
- Add model/provider profiles for local, OpenRouter, and future backends.
- Re-enable provider-native local tools only after native tool-call IDs and provider-native tool-result messages are persisted safely.
- Revamp the model selector with capability badges, context-window hints, local/cloud filters, and task-focused presets.
- Add image generation and editing as first-class chat tools with saved artifacts and multi-turn refinement.
- Add video generation job tracking, preview thumbnails, and generated-media library controls.
- Research WhatsApp Business Platform support for compliant user-approved messaging workflows.
- Add exportable conversation and task summaries.
- Add code signing, signed automatic update artifacts, and multi-platform release artifacts.
- Finish macOS and Linux native verification, packaging, and any required platform-specific fixes.

## Open Questions

- Which license should remain final if MIT is not the long-term project choice.
- Whether OpenRouter remains the default provider once local-model support arrives.
- Which tool permissions should be available in the first public contributor build.
- Which native command-layer features should be promoted from alpha to stable first.
