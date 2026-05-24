import { afterEach, describe, expect, it, vi } from "vitest";
import type { LocalWorkspaceSettings } from "../types/localWorkspace";

vi.mock("./files", () => ({
  getComputerGitStatus: vi.fn(),
  listComputerDirectory: vi.fn(),
  readComputerTextFile: vi.fn(),
}));

import { getComputerGitStatus, listComputerDirectory, readComputerTextFile } from "./files";
import { clearWorkspaceContextCache, getWorkspaceContextSnapshot, refreshWorkspaceContext } from "./workspaceContext";

const mockedListComputerDirectory = vi.mocked(listComputerDirectory);
const mockedReadComputerTextFile = vi.mocked(readComputerTextFile);
const mockedGetComputerGitStatus = vi.mocked(getComputerGitStatus);

function workspace(root: string): LocalWorkspaceSettings {
  return {
    enabled: true,
    permissionMode: "default",
    roots: [root],
    scope: "selected-folder",
  };
}

function emptyWorkspace(): LocalWorkspaceSettings {
  return {
    enabled: true,
    permissionMode: "default",
    roots: [],
    scope: "selected-folder",
  };
}

function directoryListing(root: string) {
  return {
    entries: [
      {
        kind: "file" as const,
        name: "package.json",
        path: `${root}\\package.json`,
      },
    ],
    inaccessibleEntries: 0,
    limited: false,
    path: root,
  };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });

  return { promise, resolve };
}

describe("workspace context cache", () => {
  afterEach(() => {
    clearWorkspaceContextCache();
    vi.clearAllMocks();
  });

  it("does not reuse an in-flight refresh for a different workspace signature", async () => {
    const rootA = "C:\\Projects\\Alpha";
    const rootB = "C:\\Projects\\Beta";
    const alphaListing = createDeferred<ReturnType<typeof directoryListing>>();

    mockedListComputerDirectory.mockImplementation((root) =>
      root === rootA
        ? alphaListing.promise
        : Promise.resolve(directoryListing(root)),
    );
    mockedReadComputerTextFile.mockResolvedValue({
      content: JSON.stringify({ name: "beta-app", scripts: { build: "vite build" } }),
      name: "package.json",
      path: `${rootB}\\package.json`,
      size: 64,
      truncated: false,
    });
    mockedGetComputerGitStatus.mockResolvedValue({
      additions: 0,
      ahead: 0,
      available: true,
      behind: 0,
      branch: "main",
      changedFiles: 0,
      clean: true,
      deletions: 0,
    });

    const alphaRefresh = refreshWorkspaceContext(workspace(rootA));
    const betaRefresh = refreshWorkspaceContext(workspace(rootB));

    await betaRefresh;
    expect(getWorkspaceContextSnapshot()?.roots).toEqual([rootB]);

    alphaListing.resolve(directoryListing(rootA));
    await alphaRefresh;
    expect(getWorkspaceContextSnapshot()?.roots).toEqual([rootB]);
  });

  it("prevents an older in-flight refresh from overwriting an immediate empty-root snapshot", async () => {
    const root = "C:\\Projects\\Alpha";
    const alphaListing = createDeferred<ReturnType<typeof directoryListing>>();

    mockedListComputerDirectory.mockImplementation(() => alphaListing.promise);
    mockedReadComputerTextFile.mockResolvedValue({
      content: JSON.stringify({ name: "alpha-app" }),
      name: "package.json",
      path: `${root}\\package.json`,
      size: 64,
      truncated: false,
    });
    mockedGetComputerGitStatus.mockResolvedValue({
      additions: 0,
      ahead: 0,
      available: true,
      behind: 0,
      branch: "main",
      changedFiles: 0,
      clean: true,
      deletions: 0,
    });

    const alphaRefresh = refreshWorkspaceContext(workspace(root));
    await refreshWorkspaceContext(emptyWorkspace());

    expect(getWorkspaceContextSnapshot()?.roots).toEqual([]);

    alphaListing.resolve(directoryListing(root));
    await alphaRefresh;
    expect(getWorkspaceContextSnapshot()?.roots).toEqual([]);
  });
});
