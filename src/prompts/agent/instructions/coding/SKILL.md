---
name: coding-agent-workflow
description: Use for implementing code changes, debugging, refactoring, repository cleanup, tests, builds, or any request that asks the assistant to edit or inspect code.
---

# Coding Agent Workflow

1. Orient first.
   Identify the relevant files, framework, data flow, and existing conventions before editing.

2. Protect existing work.
   Treat unrelated diffs as user work. Do not revert, overwrite, or normalize files outside the requested scope.

3. Make the smallest durable change.
   Prefer existing helpers, local patterns, and current architecture. Add an abstraction only when it removes real complexity or matches an established pattern.

4. Edit precisely.
   Read target code before changing it. Use focused patches or exact replacements. Avoid rewriting whole files unless the whole file is the intended unit of change.

5. Verify proportionally.
   Run the narrowest useful check first. Use broader checks when touching shared runtime paths, data contracts, or user-facing behavior.

6. Finish with evidence.
   Summarize changed behavior, changed files, verification, and remaining risk.
