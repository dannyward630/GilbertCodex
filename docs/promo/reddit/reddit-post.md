# Reddit Launch Kit

Use this as a human-sounding launch post for asking people to try Gilbert Codex, file issues, and contribute. Keep the tone modest: early alpha, real screenshots, clear asks, no hype.

## Best Title

I built an open-source desktop coding agent with Tauri, React, and Rust. Looking for testers and contributors.

## Backup Titles

- I made a local-first desktop agent workspace for coding. It is MIT licensed and I could use testers.
- Open-source Windows alpha: local desktop coding agent with Git, GitHub, web search, terminal, and tool runs
- Looking for feedback on Gilbert Codex, an open-source Tauri/React/Rust coding agent workspace
- I am building a desktop alternative-style agent workspace and need help testing the public alpha

## Main Post

Hey everyone, I have been building **Gilbert Codex**, an open-source desktop workspace for coding with AI agents.

Repo: https://github.com/UrbanWafflezz/GilbertCodex  
Windows alpha release: https://github.com/UrbanWafflezz/GilbertCodex/releases/tag/v0.2.3

The short version: it is a local-first desktop app built with **Tauri 2, React, TypeScript, and Rust**. The goal is to give agent coding work a focused GUI instead of scattering everything across a browser tab, terminal window, notes, and Git client.

What is already in the alpha:

- chat workspace with local projects, pinned chats, markdown, attachments, and local persistence
- model routing for OpenRouter, OpenAI, Anthropic, Gemini, xAI, LM Studio, Ollama, Groq, Mistral, and DeepSeek
- thinking controls, planning mode, regeneration, stop, and visible activity/progress state
- local Git tools for status, diff, stage, commit, push, pull, branches, and review-style prompts
- GitHub tools for repo/file reads, code search, branches, releases, pull requests, and workflow runs
- DuckDuckGo-backed web search with source cards
- terminal sessions, browser preview, local file tools, tool toggles, and settings
- SQL-backed local app state for auth, chats, projects, settings, integrations, preview state, and agent runs

What I need help with right now:

- testing the Windows installer and setup flow
- trying real coding tasks and opening issues for confusing/broken behavior
- testing macOS and Linux from source, since Windows is the only packaged target right now
- reviewing the Rust/Tauri command layer, especially anything around local files, terminal, Git, permissions, and app data
- improving docs, first-run setup, contribution flow, and good-first-issue breakdowns

A few honest caveats:

- this is an early public alpha
- the Windows installer is unsigned, so SmartScreen may complain
- provider keys and local endpoints are still local user settings; moving sensitive tokens into OS-backed secure storage is on the roadmap
- macOS/Linux need real contributors with those machines before I can call them supported

If you try it, the most useful feedback is a GitHub issue with your OS, install/run steps, what you expected, what happened, and sanitized screenshots/logs if possible. Pull requests are welcome too. I am especially interested in practical feedback from people who actually use coding agents and know where these tools get annoying in day-to-day work.

Thanks for taking a look.

## Shorter Version

I have been building **Gilbert Codex**, an MIT-licensed desktop coding agent workspace built with Tauri 2, React, TypeScript, and Rust.

Repo: https://github.com/UrbanWafflezz/GilbertCodex  
Windows alpha: https://github.com/UrbanWafflezz/GilbertCodex/releases/tag/v0.2.3

It has a chat workspace, local projects, multi-provider model routing, planning/thinking controls, DuckDuckGo source cards, local Git/GitHub tools, terminal sessions, browser preview, tool toggles, and SQL-backed local state.

I am looking for testers and contributors, especially for Windows installer feedback, real coding-task bugs, macOS/Linux source testing, Rust/Tauri review, and docs/setup polish. It is early alpha and unsigned on Windows, so expect rough edges.

## Deep-Dive Comment

Some extra detail for people who want to know how it is put together:

The app is split into a React/TypeScript frontend and a Tauri 2/Rust host layer. The frontend owns the workspace UI, chat surfaces, settings, tool panels, model/provider controls, and persisted app state. The Rust side owns native commands for auth/app info, local computer access, GitHub API calls, terminal sessions, Discord integration pieces, web search, and database-backed desktop state.

The project is intentionally local-first for the public alpha. There is no hosted backend required for the core app. Chats, projects, settings, integrations, browser preview state, and agent runs are stored locally. Provider requests go to whatever provider the user configures. The security-sensitive parts I want more review on are provider keys/tokens, terminal execution, local file writes, Git/GitHub mutating actions, and permission boundaries.

The bigger product idea is a desktop workspace where an agent can work across chat, code context, local Git, GitHub, terminal output, web sources, and browser preview without hiding all of its activity. I want the tool progress, sources, and review steps to stay visible so the user can steer or stop the work instead of waiting on a black box.

The areas most open for contribution right now are platform testing, source-control UX, safer review cards for mutating actions, provider/runtime tests, local model polish, durable long-running jobs, docs, and eventually signed releases/updates.

## Expected Replies

**Is this supposed to replace Cursor/Codex/etc.?**  
Not really. It is a desktop workspace for agent-style coding work. The focus is local project context, visible tool activity, Git/GitHub flows, terminal/browser surfaces, and a GUI around the work.

**Does it send my code anywhere?**  
There is no hosted Gilbert backend in the alpha. If you use a cloud model provider, your prompts/context go to that configured provider. Local app data is stored locally. Do not paste private secrets into issues or screenshots.

**Can it use local models?**  
LM Studio and Ollama are part of the provider/runtime path, but this is still alpha quality and needs more testing.

**Why only Windows installer right now?**  
Windows x64 is the target I can verify today. macOS and Linux have partial source support, but I need people on those platforms to test, package, and help fix native issues.

**What kind of PRs would help most?**  
Small, reproducible fixes are best right now: setup bugs, platform fixes, docs improvements, clearer error states, tests around provider/tool behavior, and safety improvements around local files, terminal, Git, and tokens.

## Image Upload Order

Use the real UI screenshots first. They look more trustworthy than a generic promo graphic.

1. `images/01-overview-chat-workspace.png`  
   Caption: Main chat workspace with projects, history, composer controls, and local workspace state.

2. `images/02-live-activity-tools-sources.png`  
   Caption: Live activity rail with tool calls, reasoning state, artifacts, and sources.

3. `images/03-toolbox-tool-toggles.png`  
   Caption: Toolbox for enabling/disabling tool groups.

4. `images/04-local-settings-providers.png`  
   Caption: Local settings for providers, model/runtime behavior, integrations, and permissions.

5. `images/05-readme-demo.gif`  
   Caption: Short animated preview. Use only if the subreddit supports GIF uploads cleanly.

Optional:

- `images/00-reddit-cover-collage.png`  
  Use this only in broader communities where a first-slide title card helps. For technical subreddits, lead with the actual app screenshot instead.

## Suggested Subreddit Fit

Check each community's self-promotion rules before posting.

- `r/opensource`: best general fit for tester/contributor ask.
- `r/rust`: use the Rust/Tauri angle and ask for native command-layer feedback.
- `r/reactjs`: use the React desktop-app architecture angle.
- `r/tauri`: likely the strongest technical fit if project posts are allowed.
- `r/selfhosted`: only post here if you emphasize local-first/local-model possibilities and are clear that cloud model providers are optional configuration, not self-hosted by default.

## Posting Notes

- Do not oversell it as stable.
- Mention the unsigned installer before someone else does.
- Ask for issues and PRs, not stars.
- Keep the first comment technical; keep the post readable.
- Use sanitized screenshots only. No API keys, local paths with personal details, terminal secrets, private repo names, or provider errors with tokens.
