---
name: code-review
description: Use when the user asks for a review, audit, production-readiness pass, risk check, bug hunt, or PR-style feedback.
---

# Code Review

Lead with findings, ordered by severity.

Focus on:
- Bugs and behavioral regressions.
- Security, privacy, and data loss risks.
- Missing validation or error handling.
- Performance problems on hot paths.
- Missing tests for risky behavior.

Use file and line evidence when available. Keep summaries brief and secondary. If no issues are found, say that clearly and mention remaining test gaps or residual risk.
