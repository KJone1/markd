import { WorkspaceDocuments } from "../desktop/documents.ts";
import { WorkspaceRoot } from "../desktop/workspace.ts";

Deno.test("document save atomically replaces an eligible workspace text file", async () => {
  const sandbox = await Deno.makeTempDir();
  try {
    const rootPath = `${sandbox}/workspace`;
    await Deno.mkdir(rootPath);
    await Deno.writeTextFile(`${rootPath}/app.ts`, "const value = 1;\n");
    const documents = new WorkspaceDocuments(
      await WorkspaceRoot.open(rootPath),
    );

    const result = await documents.save({
      path: "app.ts",
      content: "const value = 2;\n",
      expectedContent: "const value = 1;\n",
      overwrite: false,
    });

    assertEquals(result, { kind: "saved" });
    assertEquals(
      await Deno.readTextFile(`${rootPath}/app.ts`),
      "const value = 2;\n",
    );
    assertEquals(
      [...Deno.readDirSync(rootPath)].map((entry) => entry.name),
      ["app.ts"],
    );
  } finally {
    await Deno.remove(sandbox, { recursive: true });
  }
});

Deno.test("document save completes short writes before atomic replacement", async () => {
  const sandbox = await Deno.makeTempDir();
  try {
    const rootPath = `${sandbox}/workspace`;
    await Deno.mkdir(rootPath);
    await Deno.writeTextFile(`${rootPath}/app.ts`, "initial");
    let writeCalls = 0;
    const documents = new WorkspaceDocuments(
      await WorkspaceRoot.open(rootPath),
      {
        async openTemporary(path, options) {
          const file = await Deno.open(path, options);
          return {
            write(data) {
              writeCalls += 1;
              return file.write(data.subarray(0, Math.min(3, data.length)));
            },
            sync: () => file.sync(),
            close: () => file.close(),
          };
        },
      },
    );

    const content = "complete replacement content";
    assertEquals(
      await documents.save({
        path: "app.ts",
        content,
        expectedContent: "initial",
        overwrite: false,
      }),
      { kind: "saved" },
    );

    assertEquals(await Deno.readTextFile(`${rootPath}/app.ts`), content);
    assertEquals(writeCalls > 1, true);
  } finally {
    await Deno.remove(sandbox, { recursive: true });
  }
});

Deno.test("document save reports external conflicts without overwriting disk", async () => {
  const sandbox = await Deno.makeTempDir();
  try {
    const rootPath = `${sandbox}/workspace`;
    await Deno.mkdir(rootPath);
    await Deno.writeTextFile(`${rootPath}/app.ts`, "initial\n");
    const documents = new WorkspaceDocuments(
      await WorkspaceRoot.open(rootPath),
    );
    await Deno.writeTextFile(`${rootPath}/app.ts`, "external\n");

    const result = await documents.save({
      path: "app.ts",
      content: "local\n",
      expectedContent: "initial\n",
      overwrite: false,
    });

    assertEquals(result, { kind: "conflict", diskContent: "external\n" });
    assertEquals(await Deno.readTextFile(`${rootPath}/app.ts`), "external\n");
  } finally {
    await Deno.remove(sandbox, { recursive: true });
  }
});

Deno.test("document save rejects ineligible routes and oversized replacement buffers", async () => {
  const sandbox = await Deno.makeTempDir();
  try {
    const rootPath = `${sandbox}/workspace`;
    await Deno.mkdir(rootPath);
    await Deno.writeTextFile(`${rootPath}/page.html`, "<p>Page</p>");
    await Deno.writeTextFile(`${rootPath}/image.png`, "opaque");
    await Deno.writeTextFile(`${rootPath}/app.ts`, "initial");
    const documents = new WorkspaceDocuments(
      await WorkspaceRoot.open(rootPath),
    );

    await assertRejects(() =>
      documents.save({
        path: "page.html",
        content: "<p>Changed</p>",
        expectedContent: "<p>Page</p>",
        overwrite: false,
      })
    );
    await assertRejects(() =>
      documents.save({
        path: "image.png",
        content: "changed",
        expectedContent: "opaque",
        overwrite: false,
      })
    );
    await assertRejects(() =>
      documents.save({
        path: "app.ts",
        content: "a".repeat(10 * 1024 * 1024 + 1),
        expectedContent: "initial",
        overwrite: false,
      })
    );

    assertEquals(
      await Deno.readTextFile(`${rootPath}/page.html`),
      "<p>Page</p>",
    );
    assertEquals(await Deno.readTextFile(`${rootPath}/image.png`), "opaque");
    assertEquals(await Deno.readTextFile(`${rootPath}/app.ts`), "initial");
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
