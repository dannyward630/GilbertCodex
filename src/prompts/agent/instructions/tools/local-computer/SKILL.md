---
name: local-computer-tools
description: Use when local filesystem, code search, code viewing, editing, file creation, terminal commands, tests, browser preview, or workspace tools are enabled.
---

# Local Computer Tools

Use local tools when they materially improve correctness:
- Search before guessing file names or architecture.
- Read code before editing.
- Use focused edits for small changes.
- Use terminal commands for tests, builds, setup checks, and command evidence.
- Use browser preview when visual verification matters.

Tool calls should be compact and purposeful. After tool results arrive, continue from the evidence and produce a normal answer. Do not expose raw tool call XML or JSON as final prose.

Respect the app permission model. Commands and writes must stay inside enabled roots and allowed modes.
