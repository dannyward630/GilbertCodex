import test from "node:test";
import assert from "node:assert/strict";
import { isRecoverableLocalEditFailure } from "../src/app/toolRecovery.ts";

test("terminal direct source-write rejection is recoverable", () => {
  const output = [
    "Skipped terminal command: it appears to write or edit source/text files through the shell.",
    "Use view_code plus edit_file for existing source edits, write_file/create_files for new files, then use run_terminal for tests, builds, package installs, formatters, or command evidence.",
  ].join("\n");

  assert.equal(
    isRecoverableLocalEditFailure(`\nTOOL 1 [skipped]: run_terminal\n${output}`, [
      {
        label: "Run terminal",
        output,
        status: "skipped",
      },
    ]),
    true,
  );
});

test("write_file existing-file refusal is recoverable", () => {
  const output = [
    "Skipped because write_file is create-only by default for existing files: C:\\repo\\src\\App.tsx",
    "Use edit_file/inline_edit with old_text/new_text, start_line/end_line/content, insert_at_line/content, or start_char/end_char/content for normal code edits.",
  ].join("\n");

  assert.equal(
    isRecoverableLocalEditFailure(`\nTOOL 1 [skipped]: write_file\n${output}`, [
      {
        label: "Write file",
        output,
        status: "skipped",
      },
    ]),
    true,
  );
});

test("edit_file old_text misses are recoverable", () => {
  const output = "Could not find old_text in C:\\repo\\src\\App.tsx. Inspect current lines and retry with a narrower match.";

  assert.equal(
    isRecoverableLocalEditFailure(`\nTOOL 1 [error]: edit_file\n${output}`, [
      {
        label: "Edit file",
        output,
        status: "error",
      },
    ]),
    true,
  );
});

test("expected SHA mismatches are recoverable", () => {
  const output = [
    "Skipped because expected_sha256 does not match the current file: C:\\repo\\src\\App.tsx",
    "Re-read the file before retrying, or switch to edit_file with exact current text.",
  ].join("\n");

  assert.equal(
    isRecoverableLocalEditFailure(`\nTOOL 1 [skipped]: write_file\n${output}`, [
      {
        label: "Write file",
        output,
        status: "skipped",
      },
    ]),
    true,
  );
});

test("true access blockers are not recoverable", () => {
  const output = "Blocked by read-only mode.";

  assert.equal(
    isRecoverableLocalEditFailure(`\nTOOL 1 [skipped]: edit_file\n${output}`, [
      {
        label: "Edit file",
        output,
        status: "skipped",
      },
    ]),
    false,
  );
});

test("structured recovery metadata is enough to continue tooling", () => {
  const contextMessage = [
    "\nTOOL 1 [skipped]: write_file",
    "Skipped because write_file requires both path and content.",
    "",
    "RECOVERABLE_TOOL_FAILURE",
    "recoverable: true",
    "recoveryKind: write_retry",
    "retryInstruction: Retry with both path and content.",
  ].join("\n");

  assert.equal(isRecoverableLocalEditFailure(contextMessage, []), true);
});
