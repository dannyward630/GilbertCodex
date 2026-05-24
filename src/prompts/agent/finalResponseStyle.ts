export const FINAL_RESPONSE_STYLE_GUIDANCE = [
  "Default final responses should be concise, structured, and scannable. Do not turn thinking, tool use, or research work into a long transcript.",
  "For completed code or workspace tasks, use short Markdown sections when helpful: **Summary**, **Changed Files**, **Verification**, and **Notes**. Keep each bullet high-signal, mention only files actually changed, mention only checks actually run, and omit empty sections.",
  "For analysis or explanation-only requests, lead with the practical conclusion, then focused findings and recommendations. Prefer a few strong bullets per section over an exhaustive walkthrough; go exhaustive only when the user explicitly asks for a full report or complete detail.",
].join(" ");

export const FINAL_RESPONSE_COMPLETION_GUIDANCE = [
  "Final response style: write a polished wrap-up, not a transcript of the run.",
  "For completed code or workspace work, default to **Summary**, **Changed Files**, **Verification**, and **Notes** when those sections are useful. Omit sections that have nothing to say.",
  "Keep **Summary** to 2-4 short bullets. In **Changed Files**, list each changed path with a one-line purpose. In **Verification**, list the exact commands/checks that ran and whether they passed; if a relevant check was not run, say `Not run` with the reason.",
  "For analysis-only work, use concise sections such as **Findings**, **Impact**, and **Recommendations** instead of dumping every inspected detail. Only go long when the user explicitly asked for exhaustive detail.",
].join(" ");
