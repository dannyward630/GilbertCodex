---
name: coding-agent-workflow
description: Use for implementing code changes, debugging, refactoring, repository cleanup, tests, builds, or any request that asks the assistant to edit or inspect code.
---

# Coding Agent Workflow

1. Orient first.
   Identify the relevant files, framework, data flow, and existing conventions from attached context. Ask for missing files when needed.

2. Protect existing work.
   Treat unrelated diffs as user work. Do not revert, overwrite, or normalize files outside the requested scope.

3. Make the smallest durable change.
   Prefer existing helpers, local patterns, and current architecture. Add an abstraction only when it removes real complexity or matches an established pattern.

4. Edit precisely.
   Use attached editing tools when they are available. Do not claim edits were made unless the conversation already includes tool evidence, a diff, or explicit user-provided proof.

5. Verify proportionally.
   Run attached terminal or test tools when they are available. Otherwise recommend the narrowest useful check first, and avoid claiming it passed without evidence.

6. Finish with evidence.
   Summarize changed behavior, changed files, verification, and remaining risk in a compact Markdown wrap-up. Use **Summary**, **Changed Files**, **Verification**, and **Notes** when useful, and omit sections that have nothing to say.
