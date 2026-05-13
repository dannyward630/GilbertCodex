/**
 * Best-effort pre-write syntax check. Runs in the renderer, so we deliberately
 * avoid importing heavyweight parsers (typescript ~15MB, acorn ~150KB) — the
 * goal is to catch the dominant class of agent-edit failures (unbalanced
 * braces/brackets/quotes, JSON parse errors) before the bytes hit disk. The
 * existing post-write build check still runs and will surface deeper errors.
 *
 * Rule: never block on pre-existing brokenness. If the original file already
 * had unbalanced delimiters, the new file is allowed to have the same count
 * — we only reject when the agent introduced NEW issues.
 */

export interface SyntaxIssue {
  code: string;
  detail?: string;
  message: string;
}

export interface SyntaxValidationResult {
  diagnostics: SyntaxIssue[];
  ok: boolean;
}

export type ValidatorFn = (content: string) => SyntaxIssue[];

const JS_LIKE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".mts",
  ".cts",
]);

const JSON_EXTENSIONS = new Set([".json", ".jsonc"]);

function getExtension(path: string): string {
  const lastSlash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  const tail = lastSlash >= 0 ? path.slice(lastSlash + 1) : path;
  const dot = tail.lastIndexOf(".");
  if (dot < 0 || dot === tail.length - 1) {
    return "";
  }
  return tail.slice(dot).toLowerCase();
}

function pickValidator(path: string): ValidatorFn | null {
  const ext = getExtension(path);
  if (JSON_EXTENSIONS.has(ext)) {
    return validateJson;
  }
  if (JS_LIKE_EXTENSIONS.has(ext)) {
    return validateJsLikeDelimiters;
  }
  return null;
}

export function validateSyntaxBeforeWrite(
  path: string,
  newContent: string,
  options: { originalContent?: string } = {},
): SyntaxValidationResult {
  const validator = pickValidator(path);
  if (!validator) {
    return { diagnostics: [], ok: true };
  }

  const newDiagnostics = validator(newContent);
  if (newDiagnostics.length === 0) {
    return { diagnostics: [], ok: true };
  }

  // Net-new gating: if the original file was already broken, only reject when
  // the new content makes it *worse*. A file the agent inherited as broken
  // should still be editable.
  if (typeof options.originalContent === "string") {
    const originalDiagnostics = validator(options.originalContent);
    if (newDiagnostics.length <= originalDiagnostics.length) {
      return { diagnostics: [], ok: true };
    }
  }

  return { diagnostics: newDiagnostics, ok: false };
}

function validateJson(content: string): SyntaxIssue[] {
  // Allow whitespace-only or empty JSON files — JSON.parse rejects "" but we
  // don't want to refuse the agent legitimately clearing a file.
  if (content.trim().length === 0) {
    return [];
  }
  try {
    JSON.parse(content);
    return [];
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return [{ code: "json_parse_error", message }];
  }
}

interface BalanceCounters {
  brackets: number;
  parens: number;
}

interface BalanceState {
  counters: BalanceCounters;
  inBlockComment: boolean;
  inLineComment: boolean;
  // Mismatched closers we've observed (e.g., `}` with no opener) — counted
  // separately because they're a different failure shape from a missing
  // closer.
  mismatched: number;
  stringChar: '"' | "'" | "`" | null;
  templateDepth: number;
}

function validateJsLikeDelimiters(content: string): SyntaxIssue[] {
  const state: BalanceState = {
    counters: { brackets: 0, parens: 0 },
    inBlockComment: false,
    inLineComment: false,
    mismatched: 0,
    stringChar: null,
    templateDepth: 0,
  };

  // Use a brace-stack so we can pair `${` inside template literals correctly.
  const braceStack: Array<"code" | "template-expr"> = [];

  for (let i = 0; i < content.length; i += 1) {
    const ch = content[i];
    const next = content[i + 1];

    if (state.inLineComment) {
      if (ch === "\n") {
        state.inLineComment = false;
      }
      continue;
    }

    if (state.inBlockComment) {
      if (ch === "*" && next === "/") {
        state.inBlockComment = false;
        i += 1;
      }
      continue;
    }

    if (state.stringChar) {
      if (ch === "\\") {
        i += 1; // skip the escaped char
        continue;
      }
      if (state.stringChar === "`" && ch === "$" && next === "{") {
        // Enter a template-literal expression — back to code-mode but on a
        // stack so we know to pop into template-mode again.
        state.stringChar = null;
        braceStack.push("template-expr");
        state.counters.brackets += 1;
        i += 1;
        continue;
      }
      if (ch === state.stringChar) {
        state.stringChar = null;
      }
      continue;
    }

    if (ch === "/" && next === "/") {
      state.inLineComment = true;
      i += 1;
      continue;
    }

    if (ch === "/" && next === "*") {
      state.inBlockComment = true;
      i += 1;
      continue;
    }

    if (ch === '"' || ch === "'" || ch === "`") {
      state.stringChar = ch as '"' | "'" | "`";
      continue;
    }

    if (ch === "{") {
      braceStack.push("code");
      state.counters.brackets += 1;
      continue;
    }

    if (ch === "}") {
      const popped = braceStack.pop();
      if (!popped) {
        state.mismatched += 1;
        continue;
      }
      state.counters.brackets -= 1;
      if (popped === "template-expr") {
        // Re-enter the surrounding template literal.
        state.stringChar = "`";
      }
      continue;
    }

    if (ch === "(") {
      state.counters.parens += 1;
      continue;
    }

    if (ch === ")") {
      if (state.counters.parens === 0) {
        state.mismatched += 1;
        continue;
      }
      state.counters.parens -= 1;
      continue;
    }
  }

  const issues: SyntaxIssue[] = [];

  if (state.counters.brackets !== 0) {
    issues.push({
      code: "unbalanced_braces",
      detail: `delta=${state.counters.brackets}`,
      message: state.counters.brackets > 0
        ? `Missing ${state.counters.brackets} closing '}'.`
        : `Found ${Math.abs(state.counters.brackets)} extra closing '}'.`,
    });
  }

  if (state.counters.parens !== 0) {
    issues.push({
      code: "unbalanced_parens",
      detail: `delta=${state.counters.parens}`,
      message: state.counters.parens > 0
        ? `Missing ${state.counters.parens} closing ')'.`
        : `Found ${Math.abs(state.counters.parens)} extra closing ')'.`,
    });
  }

  if (state.mismatched > 0) {
    issues.push({
      code: "mismatched_closer",
      detail: `count=${state.mismatched}`,
      message: `Found ${state.mismatched} closing bracket(s) with no matching opener.`,
    });
  }

  if (state.stringChar) {
    issues.push({
      code: "unterminated_string",
      detail: `quote=${state.stringChar}`,
      message: `Unterminated string literal (${state.stringChar} never closed).`,
    });
  }

  if (state.inBlockComment) {
    issues.push({
      code: "unterminated_comment",
      message: "Unterminated /* ... */ block comment.",
    });
  }

  return issues;
}

export function formatSyntaxIssues(path: string, issues: SyntaxIssue[]): string {
  if (issues.length === 0) {
    return "";
  }
  const header = `Pre-write syntax check rejected ${path} (${issues.length} issue${issues.length === 1 ? "" : "s"}):`;
  const body = issues.map((issue) => `- ${issue.message}${issue.detail ? ` [${issue.detail}]` : ""}`).join("\n");
  return `${header}\n${body}\nFix the indicated problem, then re-emit a narrower edit. Do not rewrite the whole file unless the original was already invalid.`;
}

function isSyntaxCheckDisabled(): boolean {
  const raw = (import.meta as unknown as { env?: Record<string, string | undefined> }).env
    ?.VITE_GILBERT_CODEX_SKIP_SYNTAX_CHECK;
  return raw === "1" || raw === "true" || raw === "TRUE";
}

/**
 * Convenience wrapper: validates and, when invalid, throws an Error whose
 * message is the formatted issue list. Designed to drop in immediately
 * before any writeComputerTextFile call.
 */
export function assertSyntaxBeforeWrite(
  path: string,
  newContent: string,
  options: { originalContent?: string } = {},
): void {
  if (isSyntaxCheckDisabled()) {
    return;
  }
  const result = validateSyntaxBeforeWrite(path, newContent, options);
  if (!result.ok) {
    throw new Error(formatSyntaxIssues(path, result.diagnostics));
  }
}
