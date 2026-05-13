import test from "node:test";
import assert from "node:assert/strict";
import { prepareFileCreationWritePlan } from "../src/tools/fileCreation/index.ts";
import {
  createLocalComputerToolRequestContent,
  parseJsonToolCalls,
  parseLocalComputerToolCalls,
  stripDirectXmlToolCalls,
} from "../src/tools/computer/executor/parser.ts";
import {
  normalizeLocalGitToolName,
  normalizeToolName,
} from "../src/tools/computer/executor/toolNames.ts";
import {
  effectiveTerminalTimeoutMs,
  isLikelyDevServerCommand,
  looksLikeProcessManagementCommand,
  shouldUseBufferedTerminalCommand,
} from "../src/tools/computer/executor/terminalPolicy.ts";
import { parseBatchEdits } from "../src/tools/computer/executor/tools/editFiles.ts";

test("parses direct XML edit tool calls", () => {
  const calls = parseLocalComputerToolCalls(
    '<edit_file><path>src/App.tsx</path><old_text>old</old_text><new_text>new</new_text></edit_file>',
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0].tool, "edit_file");
  assert.equal(calls[0].args.path, "src/App.tsx");
  assert.equal(calls[0].args.old_text, "old");
});

test("parses Anthropic invoke XML batches after model switches", () => {
  const raw = String.raw`Let me read everything first so I know exactly what I'm working with.
<function_calls>
<invoke name="list_directory">
<parameter name="path">C:\Users\Kobe Work\Documents\GilbertBusiness\src</parameter>
</invoke>
<invoke name="read_file">
<parameter name="path">C:\Users\Kobe Work\Documents\GilbertBusiness\src\App.jsx</parameter>
</invoke>
<invoke name="read_file">
<parameter name="path">C:\Users\Kobe Work\Documents\GilbertBusiness\src\components\Header.jsx</parameter>
</invoke>
</function_calls>`;
  const calls = parseLocalComputerToolCalls(raw);

  assert.equal(calls.length, 3);
  assert.equal(calls[0].tool, "list_directory");
  assert.equal(calls[0].args.path, String.raw`C:\Users\Kobe Work\Documents\GilbertBusiness\src`);
  assert.equal(calls[0].args.parameter, undefined);
  assert.equal(calls[1].tool, "read_file");
  assert.equal(calls[1].args.path, String.raw`C:\Users\Kobe Work\Documents\GilbertBusiness\src\App.jsx`);
  assert.equal(calls[2].tool, "read_file");
  assert.equal(calls[2].args.path, String.raw`C:\Users\Kobe Work\Documents\GilbertBusiness\src\components\Header.jsx`);
});

test("strips Anthropic invoke XML batches from visible assistant text", () => {
  const raw = String.raw`Let me check that path.
<function_calls>
<invoke name="read_file">
<parameter name="path">C:\repo\src\App.jsx</parameter>
</invoke>
</function_calls>`;
  const stripped = stripDirectXmlToolCalls(raw);

  assert.match(stripped, /Let me check that path/);
  assert.doesNotMatch(stripped, /<function_calls|<invoke|<parameter/i);
});

test("uses Anthropic thinking XML as executable tool request content", () => {
  const reasoning = String.raw`<function_calls>
<invoke name="read_file">
<parameter name="path">C:\repo\src\App.jsx</parameter>
</invoke>
</function_calls>`;
  const content = createLocalComputerToolRequestContent("", reasoning);
  const calls = parseLocalComputerToolCalls(content);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].tool, "read_file");
  assert.equal(calls[0].args.path, String.raw`C:\repo\src\App.jsx`);
});

test("parses JSON create_files calls with native files arrays", () => {
  const calls = parseJsonToolCalls(JSON.stringify({
    tool: "create_files",
    files: [
      { path: "src/App.tsx", content: "export default function App() { return null; }" },
    ],
  }));

  assert.equal(calls.length, 1);
  assert.equal(calls[0].tool, "create_files");
  assert.match(calls[0].args.files, /src\/App\.tsx/);
});

test("normalizes edit and Git aliases", () => {
  assert.equal(normalizeToolName("inline_edit", { path: "src/App.tsx", old_text: "a", new_text: "b" }), "edit_file");
  assert.equal(normalizeLocalGitToolName("git.add"), "git_stage");
  assert.equal(normalizeLocalGitToolName("git.switch"), "git_checkout");
});

test("classifies terminal fast path and long-running commands", () => {
  assert.equal(shouldUseBufferedTerminalCommand("git status --short", 45_000), true);
  assert.equal(shouldUseBufferedTerminalCommand("npm run dev", 45_000), false);
  assert.equal(isLikelyDevServerCommand("pnpm exec vite --host localhost"), true);
  assert.equal(looksLikeProcessManagementCommand("Get-NetTCPConnection | Stop-Process"), true);
});

test("caps quick evidence timeouts and extends package setup", () => {
  assert.equal(effectiveTerminalTimeoutMs("rg \"needle\" src", 45_000), 20_000);
  assert.equal(effectiveTerminalTimeoutMs("npm install", 45_000), 300_000);
  assert.equal(effectiveTerminalTimeoutMs("npm install", 45_000, true), 45_000);
});

test("edit_files parser accepts the canonical {edits: [...]} shape", () => {
  const entries = parseBatchEdits({
    edits: JSON.stringify([
      { path: "src/A.tsx", old_text: "old", new_text: "new" },
      { path: "src/B.tsx", content: "// rewritten" },
    ]),
  });

  assert.equal(entries.length, 2);
  assert.equal(entries[0].path, "src/A.tsx");
  assert.equal(entries[0].old_text, "old");
  assert.equal(entries[0].new_text, "new");
  assert.equal(entries[1].path, "src/B.tsx");
  assert.equal(entries[1].content, "// rewritten");
});

test("edit_files parser accepts the parallel-array shape with broadcast text (the real failure)", () => {
  // This is the exact shape the model sent in the failure report:
  //   paths: ["a.jsx", "b.jsx", "c.jsx"]
  //   old_texts: "import styles from './Header.module.css';"   (scalar, broadcast)
  //   new_texts: "import styles from './Renamed.module.css';"  (scalar, broadcast)
  const entries = parseBatchEdits({
    paths: JSON.stringify([
      "C:/repo/src/Header.jsx",
      "C:/repo/src/About.jsx",
      "C:/repo/src/Skills.jsx",
    ]),
    old_texts: "import styles from './Header.module.css';",
    new_texts: "import styles from './Renamed.module.css';",
  });

  assert.equal(entries.length, 3);
  for (const entry of entries) {
    assert.equal(entry.old_text, "import styles from './Header.module.css';");
    assert.equal(entry.new_text, "import styles from './Renamed.module.css';");
  }
  assert.equal(entries[0].path, "C:/repo/src/Header.jsx");
  assert.equal(entries[2].path, "C:/repo/src/Skills.jsx");
});

test("edit_files parser accepts singular old_text/new_text alongside paths", () => {
  const entries = parseBatchEdits({
    paths: JSON.stringify(["a.tsx", "b.tsx"]),
    old_text: "Foo",
    new_text: "Bar",
  });

  assert.equal(entries.length, 2);
  assert.equal(entries[0].old_text, "Foo");
  assert.equal(entries[1].new_text, "Bar");
});

test("edit_files parser accepts per-file arrays via old_texts/new_texts when lengths align", () => {
  const entries = parseBatchEdits({
    paths: JSON.stringify(["a.tsx", "b.tsx"]),
    old_texts: JSON.stringify(["A_OLD", "B_OLD"]),
    new_texts: JSON.stringify(["A_NEW", "B_NEW"]),
  });

  assert.equal(entries.length, 2);
  assert.equal(entries[0].old_text, "A_OLD");
  assert.equal(entries[0].new_text, "A_NEW");
  assert.equal(entries[1].old_text, "B_OLD");
  assert.equal(entries[1].new_text, "B_NEW");
});

test("edit_files parser broadcasts when text-array length doesn't match paths length", () => {
  // Length mismatch: 3 paths, 2 texts → safer to broadcast the raw string than
  // to silently shift entries.
  const entries = parseBatchEdits({
    paths: JSON.stringify(["a", "b", "c"]),
    old_texts: JSON.stringify(["X", "Y"]),
    new_texts: "Z",
  });

  assert.equal(entries.length, 3);
  // Falls back to broadcasting the raw stringified array because lengths differ.
  assert.equal(entries[0].old_text, '["X","Y"]');
  assert.equal(entries[2].old_text, '["X","Y"]');
  assert.equal(entries[0].new_text, "Z");
});

test("edit_files parser routes paths+content (full-file rewrite broadcast) without old_text", () => {
  const entries = parseBatchEdits({
    paths: JSON.stringify(["a.tsx", "b.tsx"]),
    content: "// shared rewrite",
  });

  assert.equal(entries.length, 2);
  assert.equal(entries[0].content, "// shared rewrite");
  assert.equal(entries[1].content, "// shared rewrite");
  assert.equal(entries[0].old_text, undefined);
});

test("edit_files parser rejects paths without any edit instruction", () => {
  assert.throws(
    () => parseBatchEdits({ paths: JSON.stringify(["a.tsx"]) }),
    /old_text\/new_text/i,
  );
});

test("normalizeToolName routes paths+old_text/new_text to edit_files even when name is a placeholder", () => {
  // The real call had `function` as the placeholder name and parallel-array args.
  assert.equal(
    normalizeToolName("function", {
      paths: JSON.stringify(["a.jsx", "b.jsx"]),
      old_text: "import 'foo'",
      new_text: "import 'bar'",
    }),
    "edit_files",
  );
});

test("normalizeToolName routes guarded full-file replacement aliases to write_file", () => {
  assert.equal(
    normalizeToolName("function", {
      expected_sha256: "abc123",
      new_text: "body { color: red; }\n",
      path: "src/styles.css",
      replace_entire_file: "true",
    }),
    "write_file",
  );

  assert.equal(
    normalizeToolName("function", {
      css: ":root { --brand: #00f; }\n",
      path: "src/styles.css",
    }),
    "write_file",
  );
});

test("normalizeToolName keeps line-range content as edit_file", () => {
  assert.equal(
    normalizeToolName("function", {
      content: ".app { display: grid; }",
      end_line: "20",
      path: "src/styles.css",
      start_line: "10",
    }),
    "edit_file",
  );
});

test("prepares create_files arrays and reports malformed batch items", () => {
  const roots = ["C:\\repo"];
  const goodPlan = prepareFileCreationWritePlan(
    {
      tool: "create_files",
      args: {
        files: JSON.stringify([
          { path: "src/App.tsx", content: "export default function App() { return null; }" },
        ]),
      },
    },
    roots,
  );

  assert.equal(goodPlan.failures.length, 0);
  assert.equal(goodPlan.writes.length, 1);
  assert.equal(goodPlan.writes[0].path, "C:\\repo\\src\\App.tsx");

  const badPlan = prepareFileCreationWritePlan(
    {
      tool: "create_files",
      args: {
        files: JSON.stringify([null]),
      },
    },
    roots,
  );

  assert.equal(badPlan.writes.length, 0);
  assert.equal(badPlan.failures.length, 1);
  assert.match(badPlan.failures[0].reason, /object/i);
});
