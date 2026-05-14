# Gilbert Codex Roadmap

This roadmap shows the public direction for Gilbert Codex after the v0.3.0 alpha. It is intentionally product-facing: contributors should be able to see what is upcoming, why it matters, and where their work can help.

Roadmap items are not release promises or fixed dates. They are the current areas the project is moving toward.

## Near-Term Focus

### Local Action Runtime Rewrite

The removed local-action system will be rebuilt from a smaller contract so it is stricter, faster, and less surprising before it is exposed to models again.

- Replace permissive XML recovery paths with a smaller schema-driven protocol.
- Generate model-facing instructions from one authoritative runtime schema.
- Improve argument validation so malformed calls become clear retryable errors instead of silent wrong behavior.
- Batch safe actions more confidently while keeping destructive actions behind review.
- Persist action IDs/results cleanly so native provider support can return later without protocol leaks.
- Keep long-running jobs attached to visible progress, terminal output, and resumable state.

### New Voice Mode

Voice should become a first-class chat mode rather than a placeholder control.

- Add push-to-talk and hands-free capture options.
- Let users interrupt, revise, or approve transcript text before sending.
- Support voice replies when a configured provider or local speech backend is available.
- Keep transcript and audio handling local-first by default, with provider use made explicit.
- Make voice mode work naturally with planning, web search, files, and coding tasks after the local-action rebuild.

### Sidebar And Workspace Layout Redo

The navigation needs to scale better as users add more projects, chats, and integrations.

- Redesign the side menu around fast switching between chats, projects, Settings, and integrations.
- Improve pinned chats, recent workspaces, search, collapsed density, and section ordering.
- Make project context clearer before any future local action writes files or runs commands.
- Reduce visual clutter while keeping important controls one click away.

### Activity Card And Inspector Redesign

The activity rail should explain what the agent is doing without showing raw protocol internals.

- Group related activity into readable runs.
- Show approvals, file changes, terminal output, sources, artifacts, and retries in predictable lanes.
- Make failed or skipped work easier to diagnose.
- Give long-running jobs durable progress cards.
- Improve the handoff between chat messages, source cards, browser previews, and generated artifacts.

### Web, Browser, And Research Upgrades

Web context should feel reliable in normal chat, planning mode, and deeper research sessions.

- Improve DuckDuckGo-backed source quality and result normalization.
- Show stronger source cards with titles, snippets, domains, and opened-page context.
- Feed web results into thinking/planning mode without losing citations.
- Improve browser-preview handoff for local apps, docs, and researched pages.
- Add clearer controls for when the model should search, browse, cite, or stay offline.

## Product Areas After That

### Model And Provider Experience

- Provider profiles for local, cloud, free-route, and paid-route setups.
- Model capability badges for images, voice, context length, reasoning, structured output, and speed.
- Task presets for coding, planning, research, review, and multimodal work.
- Better context-window and provider-visible request accounting.
- Safer fallback behavior when hosted routes ignore structured output or return malformed content.

### GitHub And Source Control

- Richer local diff review cards before commits and pushes.
- GitHub issue, branch, pull request, release, and workflow cards in the activity rail.
- Cleaner PR handoff with generated summaries, screenshots, validation commands, and risk notes.
- Contributor-friendly starter issues and roadmap labels.
- Better CI visibility from inside the desktop app.

### Multimodal Creation

- Image generation and image editing with saved artifacts.
- Image-to-code and screenshot-to-fix workflows.
- Video generation job tracking with thumbnails and generated media library controls.
- More useful attachment handling for PDFs, images, code bundles, and local assets.

### Workflows And Automations

- Rebuild the local action runtime from a clean schema and provider-compatibility test suite before adding workflow-style automation again.
- Durable scheduled or long-running jobs with restartable state.
- Cleaner workflow cards that show branch paths, retries, evidence, and final outputs.
- Integration hooks for GitHub, Discord, local terminal work, and future messaging channels.

### Release And Platform Maturity

- Signed updater artifacts and clearer update/install diagnostics.
- Official macOS and Linux verification once contributors can test native packaging.
- Better public alpha validation checklists for Windows installs, source builds, and provider setup.
- More focused issue templates and labels once contributor volume grows.

## Good First Contribution Areas

- Improve docs and screenshots for setup, provider configuration, and local data safety.
- Add focused tests around provider request creation, structured-output parsing, chat utilities, and storage normalization.
- Help verify macOS or Linux source runs and packaging behavior.
- Create small UI polish PRs for empty states, error states, activity cards, settings, and sidebar navigation.
- Add provider compatibility notes when a model works well or fails reliably with structured outputs.

## Current Non-Goals

- No hosted backend is required for the public alpha.
- No secrets, local databases, terminal logs, or private workspace data should be committed.
- No broad rewrite should land without a focused migration path and validation commands.
