import test from "node:test";
import assert from "node:assert/strict";
import {
  createRecoverableLocalEditRetryInstruction,
  isRecoverableLocalEditFailure,
} from "../src/app/toolRecovery.ts";
import { fuseAdjacentLocalFileMutations } from "../src/tools/computer/executor/fuseMutations.ts";
import type { ParsedLocalComputerToolCall } from "../src/tools/computer/executor/types.ts";

function makeWriteCall(path: string, content = "// generated"): ParsedLocalComputerToolCall {
  return { tool: "write_file", args: { path, content }, raw: "" };
}

function makeReadCall(path: string): ParsedLocalComputerToolCall {
  return { tool: "read_file", args: { path }, raw: "" };
}

function makeEditCall(path: string): ParsedLocalComputerToolCall {
  return { tool: "edit_file", args: { path, old_text: "a", new_text: "b" }, raw: "" };
}

function makeCreateCodeCall(path: string, language: string): ParsedLocalComputerToolCall {
  return { tool: "create_code_file", args: { path, content: "// content", language }, raw: "" };
}

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

test("recoverable retry keeps exact nested path and basename search guidance", () => {
  const contextMessage = [
    "\nTOOL 5 [error]: edit_file",
    "Path: C:\\Users\\Kobe Work\\Documents\\GilbertBusiness\\src\\components\\Header\\Header.module.css",
    "Edit failed: edit_file could not find old_text exactly or as a unique whitespace-only drift.",
    "",
    "RECOVERABLE_TOOL_FAILURE",
    "recoverable: true",
    "recoveryKind: edit_retry",
    "retryInstruction: Inspect the current file lines with view_code/read_file using this exact path.",
    "\nTOOL 6 [skipped]: view_code",
    "View code skipped: file not found.",
    "Path: C:\\Users\\Kobe Work\\Documents\\GilbertBusiness\\src\\components\\Header.module.css",
  ].join("\n");

  const instruction = createRecoverableLocalEditRetryInstruction("fix the CSS module import", contextMessage, {
    recoverable: true,
    recoveryKind: "edit_retry",
    retryInstruction: "Inspect the current file lines with view_code/read_file using this exact path.",
    tool: "edit_file",
  });

  assert.match(instruction, /src\\components\\Header\\Header\.module\.css/);
  assert.match(instruction, /preserve exact failed paths/i);
  assert.match(instruction, /search_files for basename/i);
  assert.match(instruction, /Header\.module\.css/);
});

test("read_retry recoverable failure keeps the retry loop alive", () => {
  assert.equal(
    isRecoverableLocalEditFailure("\nTOOL 6 [skipped]: view_code\nView code skipped: file not found.", [], {
      recoverable: true,
      recoveryKind: "read_retry",
      retryInstruction: "Use search_files for Header.module.css before retrying view_code.",
      tool: "view_code",
    }),
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

test("source-file mutation cap message is recognized as recoverable", () => {
  const output = [
    "Skipped Write file: this pass already reached the source-file mutation limit of 12.",
    "Use create_files for brand-new multi-file batches and edit_files for batched edits to existing files; verify the current state before emitting more edits in the next pass.",
  ].join("\n");

  const contextMessage = [
    "\nTOOL 7 [skipped]: write_file",
    output,
    "",
    "RECOVERABLE_TOOL_FAILURE",
    "recoverable: true",
    "recoveryKind: mutation_retry",
    "retryInstruction: Inspect the current file state, then retry the remaining change in the next tool pass with one precise edit_file call.",
  ].join("\n");

  assert.equal(isRecoverableLocalEditFailure(contextMessage, []), true);
});

test("fuses 8 adjacent write_file calls into a single create_files batch", () => {
  const calls = Array.from({ length: 8 }, (_, index) => makeWriteCall(`src/component-${index + 1}.tsx`, `export const C${index + 1} = null;`));
  const fused = fuseAdjacentLocalFileMutations(calls);

  assert.equal(fused.length, 1, "8 adjacent writes should fuse into one batch");
  assert.equal(fused[0].tool, "create_files");
  const parsed = JSON.parse(fused[0].args.files);
  assert.ok(Array.isArray(parsed));
  assert.equal(parsed.length, 8);
  for (let index = 0; index < 8; index += 1) {
    assert.equal(parsed[index].path, `src/component-${index + 1}.tsx`);
  }
});

test("fusion respects intervening read_file calls and emits two batches", () => {
  const calls = [
    ...Array.from({ length: 4 }, (_, i) => makeWriteCall(`src/a-${i}.tsx`)),
    makeReadCall("src/lookup.ts"),
    ...Array.from({ length: 4 }, (_, i) => makeWriteCall(`src/b-${i}.tsx`)),
  ];
  const fused = fuseAdjacentLocalFileMutations(calls);

  assert.equal(fused.length, 3, "expected: batch + read + batch");
  assert.equal(fused[0].tool, "create_files");
  assert.equal(fused[1].tool, "read_file");
  assert.equal(fused[2].tool, "create_files");

  assert.equal(JSON.parse(fused[0].args.files).length, 4);
  assert.equal(JSON.parse(fused[2].args.files).length, 4);
});

test("fusion does NOT swallow edit_file calls (they break the buffer)", () => {
  const calls = [
    makeWriteCall("src/a.tsx"),
    makeWriteCall("src/b.tsx"),
    makeEditCall("src/c.tsx"),
    makeWriteCall("src/d.tsx"),
    makeWriteCall("src/e.tsx"),
  ];
  const fused = fuseAdjacentLocalFileMutations(calls);

  assert.equal(fused.length, 3, "expected: batch + edit_file + batch");
  assert.equal(fused[0].tool, "create_files");
  assert.equal(fused[1].tool, "edit_file");
  assert.equal(fused[2].tool, "create_files");
});

test("fusion dedupes duplicate paths within a single buffer (keeps latest)", () => {
  const first = makeWriteCall("src/dup.tsx", "first");
  const second = makeWriteCall("src/dup.tsx", "second");
  const other = makeWriteCall("src/other.tsx", "other");
  const fused = fuseAdjacentLocalFileMutations([first, second, other]);

  assert.equal(fused.length, 1);
  assert.equal(fused[0].tool, "create_files");
  const parsed = JSON.parse(fused[0].args.files);
  assert.equal(parsed.length, 2);
  const dup = parsed.find((entry: { path: string }) => entry.path === "src/dup.tsx");
  assert.ok(dup);
  assert.equal(dup.content, "second", "latest write wins on duplicate path");
});

test("fusion mixes write_file and create_code_file in the same batch", () => {
  const calls = [
    makeWriteCall("src/a.tsx", "// raw write"),
    makeCreateCodeCall("src/b.ts", "ts"),
    makeWriteCall("src/c.tsx", "// another"),
  ];
  const fused = fuseAdjacentLocalFileMutations(calls);

  assert.equal(fused.length, 1);
  assert.equal(fused[0].tool, "create_files");
  const parsed = JSON.parse(fused[0].args.files);
  assert.equal(parsed.length, 3);
  const codeEntry = parsed.find((entry: { path: string }) => entry.path === "src/b.ts");
  assert.equal(codeEntry.kind, "code");
  assert.equal(codeEntry.language, "ts");
});

test("fusion is a no-op for a single fusable call", () => {
  const calls = [makeWriteCall("src/only.tsx")];
  const fused = fuseAdjacentLocalFileMutations(calls);
  assert.equal(fused.length, 1);
  assert.equal(fused[0].tool, "write_file");
});
