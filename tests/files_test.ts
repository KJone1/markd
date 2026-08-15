import { WorkspaceFiles } from "../desktop/files.ts";
import { WorkspaceRoot } from "../desktop/workspace.ts";

Deno.test("workspace index is hierarchical and skips generated or unsafe paths", async () => {
  const sandbox = await Deno.makeTempDir();
  try {
    const rootPath = `${sandbox}/workspace`;
    const outsidePath = `${sandbox}/outside`;
    await Deno.mkdir(`${rootPath}/notes`, { recursive: true });
    await Deno.mkdir(`${rootPath}/node_modules`);
    await Deno.mkdir(`${rootPath}/dist`);
    await Deno.mkdir(`${rootPath}/.vscode`);
    await Deno.mkdir(outsidePath);
    await Deno.writeTextFile(`${rootPath}/.env`, "visible");
    await Deno.writeTextFile(`${rootPath}/.gitignore`, "visible");
    await Deno.writeTextFile(`${rootPath}/.DS_Store`, "hidden");
    await Deno.writeTextFile(`${rootPath}/package-lock.json`, "hidden");
    await Deno.writeTextFile(`${rootPath}/deno.lock`, "hidden");
    await Deno.writeTextFile(`${rootPath}/.vscode/settings.json`, "hidden");
    await Deno.writeTextFile(`${rootPath}/notes/.DS_Store`, "hidden");
    await Deno.writeTextFile(`${rootPath}/notes/today.md`, "# Today");
    await Deno.writeTextFile(`${rootPath}/node_modules/package.js`, "hidden");
    await Deno.writeTextFile(`${rootPath}/dist/output.js`, "hidden");
    await Deno.writeTextFile(`${outsidePath}/secret.md`, "outside");
    await Deno.symlink(outsidePath, `${rootPath}/external`);
    await Deno.symlink(`${rootPath}/missing`, `${rootPath}/broken`);
    await Deno.symlink(rootPath, `${rootPath}/notes/cycle`);

    const files = new WorkspaceFiles(await WorkspaceRoot.open(rootPath));
    const index = await files.index();

    assertEquals(index, [
      { kind: "file", name: ".env", path: ".env" },
      { kind: "file", name: ".gitignore", path: ".gitignore" },
      {
        kind: "directory",
        name: "notes",
        path: "notes",
        children: [
          { kind: "file", name: "today.md", path: "notes/today.md" },
        ],
      },
    ]);
  } finally {
    await Deno.remove(sandbox, { recursive: true });
  }
});

Deno.test("safe file opening returns stable routes without exposing ineligible content", async () => {
  const sandbox = await Deno.makeTempDir();
  const unreadablePath = `${sandbox}/workspace/private.txt`;
  try {
    const rootPath = `${sandbox}/workspace`;
    await Deno.mkdir(rootPath);
    await Deno.writeTextFile(`${rootPath}/note.md`, "# Note");
    await Deno.writeTextFile(`${rootPath}/page.htm`, "<h1>Page</h1>");
    await Deno.writeTextFile(`${rootPath}/script.ts`, "export {};");
    await Deno.writeFile(`${rootPath}/binary.txt`, new Uint8Array([0, 1, 2]));
    await Deno.writeTextFile(`${rootPath}/picture.png`, "not an image payload");
    const largeText = new Uint8Array(10 * 1024 * 1024 + 1);
    largeText.fill(65);
    await Deno.writeFile(`${rootPath}/large.txt`, largeText);
    await Deno.writeTextFile(unreadablePath, "do not expose");
    await Deno.chmod(unreadablePath, 0o000);

    const files = new WorkspaceFiles(await WorkspaceRoot.open(rootPath));

    assertEquals(await files.open("note.md"), {
      kind: "markdown",
      path: "note.md",
      content: "# Note",
    });
    assertEquals(await files.open("page.htm"), {
      kind: "html",
      path: "page.htm",
      content: "<h1>Page</h1>",
    });
    assertEquals(await files.open("script.ts"), {
      kind: "code",
      path: "script.ts",
      content: "export {};",
    });
    assertEquals(await files.open("binary.txt"), {
      kind: "information",
      path: "binary.txt",
      reason: "binary",
    });
    assertEquals(await files.open("picture.png"), {
      kind: "information",
      path: "picture.png",
      reason: "unsupported",
    });
    assertEquals(await files.open("large.txt"), {
      kind: "information",
      path: "large.txt",
      reason: "too-large",
    });
    assertEquals(await files.open("private.txt"), {
      kind: "information",
      path: "private.txt",
      reason: "unreadable",
    });
  } finally {
    await Deno.chmod(unreadablePath, 0o600).catch(() => undefined);
    await Deno.remove(sandbox, { recursive: true });
  }
});

Deno.test("binary detection takes precedence over the text size limit", async () => {
  const sandbox = await Deno.makeTempDir();
  try {
    const rootPath = `${sandbox}/workspace`;
    await Deno.mkdir(rootPath);
    const bytes = new Uint8Array(10 * 1024 * 1024 + 1);
    bytes.fill(65);
    bytes[0] = 0;
    await Deno.writeFile(`${rootPath}/large-binary.txt`, bytes);
    const files = new WorkspaceFiles(await WorkspaceRoot.open(rootPath));

    assertEquals(await files.open("large-binary.txt"), {
      kind: "information",
      path: "large-binary.txt",
      reason: "binary",
    });
  } finally {
    await Deno.remove(sandbox, { recursive: true });
  }
});

Deno.test("file opening rejects a path replaced after its initial validation", async () => {
  const sandbox = await Deno.makeTempDir();
  try {
    const rootPath = `${sandbox}/workspace`;
    const targetPath = `${rootPath}/note.md`;
    await Deno.mkdir(rootPath);
    await Deno.writeTextFile(targetPath, "inside");
    const root = await WorkspaceRoot.open(rootPath);
    let resolutionCount = 0;
    const changingRoot = {
      path: root.path,
      async resolveExistingPath(path: string): Promise<string> {
        const resolved = await root.resolveExistingPath(path);
        resolutionCount += 1;
        if (resolutionCount === 2) {
          await Deno.rename(targetPath, `${rootPath}/original.md`);
          await Deno.writeTextFile(targetPath, "replacement");
        }
        return resolved;
      },
    } as WorkspaceRoot;

    await assertRejects(() => new WorkspaceFiles(changingRoot).open("note.md"));
  } finally {
    await Deno.remove(sandbox, { recursive: true });
  }
});

Deno.test("workspace watcher refreshes the index after create, rename, and remove", async () => {
  const sandbox = await Deno.makeTempDir();
  try {
    const rootPath = `${sandbox}/workspace`;
    await Deno.mkdir(rootPath);
    const files = new WorkspaceFiles(await WorkspaceRoot.open(rootPath));
    const snapshots: string[][] = [];
    const stop = files.watch((entries) => snapshots.push(filePaths(entries)));

    await Deno.writeTextFile(`${rootPath}/draft.md`, "draft");
    await waitFor(() => snapshots.some((paths) => paths.includes("draft.md")));

    await Deno.rename(`${rootPath}/draft.md`, `${rootPath}/final.md`);
    await waitFor(() =>
      snapshots.some((paths) =>
        paths.includes("final.md") && !paths.includes("draft.md")
      )
    );

    await Deno.remove(`${rootPath}/final.md`);
    await waitFor(() =>
      snapshots.length > 0 &&
      !snapshots.at(-1)!.includes("final.md")
    );
    stop();
  } finally {
    await Deno.remove(sandbox, { recursive: true });
  }
});

function assertEquals(actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

async function assertRejects(action: () => Promise<unknown>): Promise<void> {
  try {
    await action();
  } catch {
    return;
  }
  throw new Error("Expected promise to reject");
}

function filePaths(
  entries: Awaited<ReturnType<WorkspaceFiles["index"]>>,
): string[] {
  return entries.flatMap((entry) =>
    entry.kind === "directory"
      ? [entry.path, ...filePaths(entry.children)]
      : [entry.path]
  );
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error("Timed out waiting for file update");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
