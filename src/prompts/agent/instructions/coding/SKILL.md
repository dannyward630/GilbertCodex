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
   In this reset build, model-callable edit tools are disabled. Do not claim edits were made unless the conversation already includes evidence. When giving guidance, prefer focused patches or exact replacements.

5. Verify proportionally.
   Verification requires existing or user-provided command output. Recommend the narrowest useful check first, and avoid claiming it passed without evidence.

6. Finish with evidence.
   Summarize changed behavior, changed files, verification, and remaining risk.
