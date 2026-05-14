import { describe, expect, it, vi } from "vitest";
import { executeToolBridgeCalls } from "../orchestrator";
import { ToolRegistry, createDefaultToolRegistry } from "../registry";
import {
  createEditingTools,
  createFilesAppendTool,
  createFilesApplyPatchTool,
  createFilesExactReplaceTool,
  createFilesInsertAtLineTool,
  createFilesMoveTool,
  createFilesReplaceRangeTool,
  createFilesWriteTool,
  type EditingBackend,
} from "../tools/editing";
import type { ToolExecutionContext } from "../types";

const ROOT = "/workspace/project";

function makeContext(overrides: Partial<ToolExecutionContext> = {}): ToolExecutionContext {
  return {
    model: "test-model",
    permissionMode: "full-access",
    provider: "openai",
    workspaceRoots: [ROOT],
    ...overrides,
  };
}

function makeBackend(files: Record<string, { content: string; sha256?: string }> = {}): EditingBackend {
  return {
    movePath: async (fromPath, toPath) => {
      const file = files[fromPath];

      if (!file) {
        throw new Error("file not found");
      }

      delete files[fromPath];
      files[toPath] = file;

      return {
        fromPath,
        kind: "file",
        moved: true,
        toPath,
      };
    },
    readTextFile: async (path) => {
      const file = files[path];

      if (!file) {
        throw new Error("file not found");
      }

      return {
        content: file.content,
        name: path.split("/").pop() ?? "file",
        path,
        sha256: file.sha256 ?? `sha-${file.content.length}`,
        size: file.content.length,
        truncated: false,
      };
    },
    writeTextFile: async (path, content) => {
      files[path] = { content, sha256: `sha-${content.length}` };
      return {
        bytesWritten: content.length,
        created: false,
        path,
        sha256: `sha-${content.length}`,
      };
    },
  };
}

describe("editing bridge tools", () => {
  it("applies an exact replacement and returns file-change metadata", async () => {
    const path = `${ROOT}/src/app.ts`;
    const backend = makeBackend({ [path]: { content: "const value = 1;\n" } });
    const tool = createFilesExactReplaceTool(backend);
    const result = await tool.execute({ newText: "value = 2", oldText: "value = 1", path: "src/app.ts" }, makeContext());
    const data = result.data as { fileChanges: Array<{ additions: number; deletions: number; path: string }> };

    expect(result.ok).toBe(true);
    expect(result.content).toContain("Applied exact replacement");
    expect(data.fileChanges[0]).toMatchObject({ additions: 1, deletions: 1, path });
    await expect(backend.readTextFile(path)).resolves.toMatchObject({ content: "const value = 2;\n" });
  });

  it("supports dry-run exact replacement without writing", async () => {
    const path = `${ROOT}/src/app.ts`;
    const backend = makeBackend({ [path]: { content: "alpha\nbeta\n" } });
    const tool = createFilesExactReplaceTool(backend);
    const result = await tool.execute({ dryRun: true, newText: "gamma", oldText: "beta", path }, makeContext());

    expect(result.ok).toBe(true);
    expect(result.content).toContain("Dry run");
    await expect(backend.readTextFile(path)).resolves.toMatchObject({ content: "alpha\nbeta\n" });
  });

  it("creates a file through files_write and overwrites existing files by default", async () => {
    const path = `${ROOT}/src/new.ts`;
    const backend = makeBackend({ [path]: { content: "old" } });
    const tool = createFilesWriteTool(backend);
    const overwritten = await tool.execute({ content: "export const x = 1;\n", path }, makeContext());
    const blocked = await tool.execute({ content: "blocked", overwrite: false, path }, makeContext());

    expect(overwritten.ok).toBe(true);
    await expect(backend.readTextFile(path)).resolves.toMatchObject({ content: "export const x = 1;\n" });
    expect(blocked.ok).toBe(false);
    expect(blocked.error).toContain("overwrite is false");
  });

  it("treats string path-not-found inspect errors as a creatable new file", async () => {
    const path = `${ROOT}/new-folder/index.html`;
    const files: Record<string, string> = {};
    const backend: EditingBackend = {
      readTextFile: async () => {
        throw "Could not read /workspace/project/new-folder/index.html: The system cannot find the path specified. (os error 3)";
      },
      writeTextFile: async (writePath, content) => {
        files[writePath] = content;
        return {
          bytesWritten: content.length,
          created: true,
          path: writePath,
          sha256: "sha-created",
        };
      },
    };
    const tool = createFilesWriteTool(backend);
    const result = await tool.execute({ content: "<!doctype html>", path }, makeContext());

    expect(result.ok).toBe(true);
    expect(result.content).toContain("Created");
    expect(files[path]).toBe("<!doctype html>");
  });

  it("applies a verified unified diff patch", async () => {
    const path = `${ROOT}/src/app.ts`;
    const backend = makeBackend({ [path]: { content: "one\ntwo\nthree\n" } });
    const tool = createFilesApplyPatchTool(backend);
    const patch = [
      "--- a/src/app.ts",
      "+++ b/src/app.ts",
      "@@ -1,3 +1,3 @@",
      " one",
      "-two",
      "+TWO",
      " three",
      "",
    ].join("\n");
    const result = await tool.execute({ patch }, makeContext());

    expect(result.ok).toBe(true);
    await expect(backend.readTextFile(path)).resolves.toMatchObject({ content: "one\nTWO\nthree\n" });
  });

  it("matches exact replacements across CRLF and LF line endings", async () => {
    const path = `${ROOT}/src/app.ts`;
    const backend = makeBackend({ [path]: { content: "one\r\ntwo\r\nthree\r\n" } });
    const tool = createFilesExactReplaceTool(backend);
    const result = await tool.execute({ newText: "two\nTWO", oldText: "two\nthree", path: "src/app.ts" }, makeContext());

    expect(result.ok).toBe(true);
    await expect(backend.readTextFile(path)).resolves.toMatchObject({ content: "one\r\ntwo\r\nTWO\r\n" });
  });

  it("inserts text at a precise 1-based line", async () => {
    const path = `${ROOT}/src/app.ts`;
    const backend = makeBackend({ [path]: { content: "one\ntwo\nthree\n" } });
    const tool = createFilesInsertAtLineTool(backend);
    const result = await tool.execute({ content: "inserted", line: 2, path: "src/app.ts" }, makeContext());

    expect(result.ok).toBe(true);
    expect(result.content).toContain("Inserted text at line 2");
    await expect(backend.readTextFile(path)).resolves.toMatchObject({ content: "one\ninserted\ntwo\nthree\n" });
  });

  it("replaces an inclusive line range and allows empty replacement", async () => {
    const path = `${ROOT}/src/app.ts`;
    const backend = makeBackend({ [path]: { content: "one\ntwo\nthree\nfour\n" } });
    const tool = createFilesReplaceRangeTool(backend);
    const result = await tool.execute({ content: "TWO\nTHREE", endLine: 3, path: "src/app.ts", startLine: 2 }, makeContext());
    const deleteResult = await tool.execute({ content: "", endLine: 3, path: "src/app.ts", startLine: 3 }, makeContext());

    expect(result.ok).toBe(true);
    expect(deleteResult.ok).toBe(true);
    await expect(backend.readTextFile(path)).resolves.toMatchObject({ content: "one\nTWO\nfour\n" });
  });

  it("appends text without merging onto the last line", async () => {
    const path = `${ROOT}/src/app.ts`;
    const backend = makeBackend({ [path]: { content: "export const one = 1;" } });
    const tool = createFilesAppendTool(backend);
    const result = await tool.execute({ content: "export const two = 2;\n", path: "src/app.ts" }, makeContext());

    expect(result.ok).toBe(true);
    await expect(backend.readTextFile(path)).resolves.toMatchObject({ content: "export const one = 1;\nexport const two = 2;\n" });
  });

  it("moves a workspace path and reports move metadata", async () => {
    const fromPath = `${ROOT}/src/app.ts`;
    const toPath = `${ROOT}/src/main.ts`;
    const backend = makeBackend({ [fromPath]: { content: "one\n" } });
    const tool = createFilesMoveTool(backend);
    const result = await tool.execute({ fromPath: "src/app.ts", toPath: "src/main.ts" }, makeContext());
    const data = result.data as { fileChanges: Array<{ kind: string; path: string }> };

    expect(result.ok).toBe(true);
    expect(data.fileChanges[0]).toMatchObject({ kind: "move", path: `${fromPath} -> ${toPath}` });
    await expect(backend.readTextFile(toPath)).resolves.toMatchObject({ content: "one\n" });
    await expect(backend.readTextFile(fromPath)).rejects.toThrow("file not found");
  });

  it("routes mutating tools through bridge approval in default mode", async () => {
    const path = `${ROOT}/src/app.ts`;
    const backend = makeBackend({ [path]: { content: "one\n" } });
    const registry = new ToolRegistry(createEditingTools(backend));
    const approval = vi.fn(async () => ({ approved: true }));
    const batch = await executeToolBridgeCalls({
      approval,
      calls: [{
        arguments: { newText: "two", oldText: "one", path: "src/app.ts" },
        id: "call-edit",
        name: "files_exact_replace",
        provider: "openai",
      }],
      context: makeContext({ permissionMode: "default" }),
      registry,
    });

    expect(approval).toHaveBeenCalledOnce();
    expect(batch.toolCalls[0]).toMatchObject({ label: "Edit file by exact replace", status: "complete" });
    expect(batch.toolCalls[0]?.fileChanges?.[0]).toMatchObject({ additions: 1, deletions: 1, path });
  });

  it("registers edit aliases without advertising duplicate tool ids", () => {
    const registry = createDefaultToolRegistry();
    const advertised = registry.listForContext(makeContext({ permissionMode: "full-access" })).map((tool) => tool.id);

    expect(registry.get("edit_file")?.id).toBe("files_exact_replace");
    expect(registry.get("insert_at_line")?.id).toBe("files_insert_at_line");
    expect(registry.get("replace_range")?.id).toBe("files_replace_range");
    expect(registry.get("append_file")?.id).toBe("files_append");
    expect(registry.get("write_file")?.id).toBe("files_write");
    expect(registry.get("apply_patch")?.id).toBe("files_apply_patch");
    expect(registry.get("move_file")?.id).toBe("files_move");
    expect(advertised).toContain("files_exact_replace");
    expect(advertised).toContain("files_insert_at_line");
    expect(advertised).toContain("files_replace_range");
    expect(advertised).toContain("files_append");
    expect(advertised).toContain("files_write");
    expect(advertised).toContain("files_apply_patch");
    expect(advertised).toContain("files_move");
    expect(advertised).not.toContain("edit_file");
  });
});
