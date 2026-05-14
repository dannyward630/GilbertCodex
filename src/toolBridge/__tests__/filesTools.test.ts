import { describe, expect, it } from "vitest";
import type {
  ComputerDirectoryListing,
  ComputerReadFileResult,
} from "../../types/localWorkspace";
import { executeToolBridgeCalls } from "../orchestrator";
import { ToolRegistry } from "../registry";
import { createFilesListTool, createFilesReadTool, createFilesStatTool, type FilesBackend } from "../tools/files";
import type { ToolExecutionContext } from "../types";

const ROOT = "/workspace/project";

function makeBackend(overrides: Partial<FilesBackend> = {}): FilesBackend {
  return {
    listDirectory: overrides.listDirectory ?? (async () => {
      throw new Error("listDirectory not implemented in this test");
    }),
    readTextFile: overrides.readTextFile ?? (async () => {
      throw new Error("readTextFile not implemented in this test");
    }),
  };
}

function makeContext(overrides: Partial<ToolExecutionContext> = {}): ToolExecutionContext {
  return {
    model: "test-model",
    permissionMode: "auto-review",
    provider: "openai",
    workspaceRoots: [ROOT],
    ...overrides,
  };
}

describe("files_read", () => {
  it("reads a text file inside the workspace root", async () => {
    const backend = makeBackend({
      readTextFile: async (path, maxBytes) => {
        expect(path).toBe(`${ROOT}/README.md`);
        expect(maxBytes).toBe(65_536);
        return {
          content: "# Hello",
          extension: "md",
          modifiedAt: 1700000000,
          name: "README.md",
          path,
          sha256: "deadbeef",
          size: 7,
          truncated: false,
        } satisfies ComputerReadFileResult;
      },
    });
    const tool = createFilesReadTool(backend);
    const result = await tool.execute({ path: "README.md" }, makeContext());

    expect(result.ok).toBe(true);
    expect(result.content).toBe("# Hello");
    expect(result.data).toMatchObject({ name: "README.md", size: 7, truncated: false });
  });

  it("rejects a path outside the workspace roots", async () => {
    const tool = createFilesReadTool(makeBackend());
    const result = await tool.execute({ path: "/etc/passwd" }, makeContext());

    expect(result.ok).toBe(false);
    expect(result.error).toContain("outside the configured workspace roots");
  });

  it("rejects '..' traversal that escapes the root", async () => {
    const tool = createFilesReadTool(makeBackend());
    const result = await tool.execute({ path: `${ROOT}/../escape.txt` }, makeContext());

    expect(result.ok).toBe(false);
    expect(result.error).toContain("outside the configured workspace roots");
  });

  it("clamps maxBytes to the hard cap", async () => {
    let observed = -1;
    const backend = makeBackend({
      readTextFile: async (_path, maxBytes) => {
        observed = maxBytes ?? -1;
        return {
          content: "",
          name: "x",
          path: _path,
          size: 0,
          truncated: false,
        } satisfies ComputerReadFileResult;
      },
    });
    const tool = createFilesReadTool(backend);

    await tool.execute({ maxBytes: 999_999_999, path: "x.txt" }, makeContext());
    expect(observed).toBe(1_048_576);
  });

  it("returns a clean error when the backend throws", async () => {
    const backend = makeBackend({
      readTextFile: async () => {
        throw new Error("File looks binary");
      },
    });
    const tool = createFilesReadTool(backend);
    const result = await tool.execute({ path: "image.png" }, makeContext());

    expect(result.ok).toBe(false);
    expect(result.error).toBe("File looks binary");
  });

  it("flows through the orchestrator and surfaces validation errors", async () => {
    const registry = new ToolRegistry([createFilesReadTool(makeBackend())]);

    const batch = await executeToolBridgeCalls({
      calls: [{ arguments: { path: 7 as unknown as string }, id: "call-bad", name: "files_read", provider: "openai" }],
      context: makeContext(),
      registry,
    });

    expect(batch.toolCalls[0]?.status).toBe("error");
    expect(batch.resultMessages[0]?.result.error).toBeTruthy();
  });
});

describe("files_list", () => {
  it("lists a directory inside the workspace root", async () => {
    const backend = makeBackend({
      listDirectory: async (path, limit) => {
        expect(path).toBe(`${ROOT}/src`);
        expect(limit).toBe(100);
        return {
          entries: [
            { kind: "directory", name: "lib", path: `${path}/lib` },
            { extension: "ts", kind: "file", modifiedAt: 1, name: "index.ts", path: `${path}/index.ts`, size: 42 },
          ],
          inaccessibleEntries: 0,
          limited: false,
          parentPath: ROOT,
          path,
        } satisfies ComputerDirectoryListing;
      },
    });
    const tool = createFilesListTool(backend);
    const result = await tool.execute({ path: "src" }, makeContext());

    expect(result.ok).toBe(true);
    const data = result.data as { entries: Array<{ name: string }>; limited: boolean };
    expect(data.entries.map((entry) => entry.name)).toEqual(["lib", "index.ts"]);
    expect(data.limited).toBe(false);
    expect(result.content).toContain("Directory");
  });

  it("rejects an external path before calling the backend", async () => {
    let called = false;
    const backend = makeBackend({
      listDirectory: async () => {
        called = true;
        return { entries: [], inaccessibleEntries: 0, limited: false, path: "" } satisfies ComputerDirectoryListing;
      },
    });
    const tool = createFilesListTool(backend);
    const result = await tool.execute({ path: "/somewhere/else" }, makeContext());

    expect(result.ok).toBe(false);
    expect(called).toBe(false);
  });
});

describe("files_stat", () => {
  it("identifies a directory when listing succeeds", async () => {
    const backend = makeBackend({
      listDirectory: async (path) => ({
        entries: [],
        inaccessibleEntries: 0,
        limited: false,
        parentPath: ROOT,
        path,
      }),
    });
    const tool = createFilesStatTool(backend);
    const result = await tool.execute({ path: "src" }, makeContext());

    expect(result.ok).toBe(true);
    expect((result.data as { kind: string }).kind).toBe("directory");
  });

  it("falls back to a file probe when listing throws", async () => {
    const backend = makeBackend({
      listDirectory: async () => {
        throw new Error("not a directory");
      },
      readTextFile: async (path) => ({
        content: "h",
        extension: "ts",
        modifiedAt: 5,
        name: "foo.ts",
        path,
        size: 1024,
        truncated: true,
      }),
    });
    const tool = createFilesStatTool(backend);
    const result = await tool.execute({ path: "src/foo.ts" }, makeContext());

    expect(result.ok).toBe(true);
    const data = result.data as { kind: string; size: number };
    expect(data.kind).toBe("file");
    expect(data.size).toBe(1024);
  });

  it("reports missing when both probes fail", async () => {
    const backend = makeBackend({
      listDirectory: async () => {
        throw new Error("not a directory");
      },
      readTextFile: async () => {
        throw new Error("file not found");
      },
    });
    const tool = createFilesStatTool(backend);
    const result = await tool.execute({ path: "src/missing.txt" }, makeContext());

    expect(result.ok).toBe(false);
    expect((result.data as { kind: string }).kind).toBe("missing");
    expect(result.error).toContain("not a directory");
    expect(result.error).toContain("file not found");
  });
});

describe("files family permission gating", () => {
  it("denies execution in default permission mode without an approval callback", async () => {
    const tool = createFilesReadTool(makeBackend({
      readTextFile: async () => {
        throw new Error("should not be called");
      },
    }));
    const registry = new ToolRegistry([tool]);

    const batch = await executeToolBridgeCalls({
      calls: [{ arguments: { path: "README.md" }, id: "call", name: "files_read", provider: "openai" }],
      context: makeContext({ permissionMode: "default" }),
      registry,
    });

    expect(batch.toolCalls[0]?.status).toBe("skipped");
    expect(batch.resultMessages[0]?.result.skippedReason).toContain("Default permissions");
  });

  it("auto-allows read-only execution in auto-review mode", async () => {
    const tool = createFilesReadTool(makeBackend({
      readTextFile: async (path) => ({
        content: "ok",
        name: "x",
        path,
        size: 2,
        truncated: false,
      }),
    }));
    const registry = new ToolRegistry([tool]);

    const batch = await executeToolBridgeCalls({
      calls: [{ arguments: { path: "x.txt" }, id: "call", name: "files_read", provider: "openai" }],
      context: makeContext({ permissionMode: "auto-review" }),
      registry,
    });

    expect(batch.toolCalls[0]?.status).toBe("complete");
  });
});
