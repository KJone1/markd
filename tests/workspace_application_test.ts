import { WorkspaceApplication } from "../desktop/workspace_application.ts";
import { WorkspaceSettingsStore } from "../desktop/settings.ts";
import type { ApplicationMenuItem } from "../desktop/workspace_menu.ts";
import { WorkspaceRoot } from "../desktop/workspace.ts";

Deno.test("startup removes an unavailable last workspace before showing the picker", async () => {
  const sandbox = await Deno.makeTempDir();
  try {
    const available = `${sandbox}/available`;
    await Deno.mkdir(available);
    const store = new WorkspaceSettingsStore(`${sandbox}/settings.json`);
    await store.remember(`${sandbox}/missing`);
    const events: string[] = [];
    const window = new FakeWindow();
    const app = new WorkspaceApplication(
      store,
      window,
      () => {
        events.push("picker");
        return Promise.resolve(available);
      },
      () => events.push("error"),
    );

    await app.initialize();

    assertEquals(events, ["error", "picker"]);
    assertEquals(
      (await app.getState()).activePath?.endsWith("/available"),
      true,
    );
    const settings = await store.load();
    assertEquals(
      settings.recentWorkspaces.some((path) => path.endsWith("/missing")),
      false,
    );
  } finally {
    await Deno.remove(sandbox, { recursive: true });
  }
});

Deno.test("opening a folder refreshes one active workspace and recent menu", async () => {
  const sandbox = await Deno.makeTempDir();
  try {
    const root = `${sandbox}/workspace`;
    await Deno.mkdir(root);
    const window = new FakeWindow();
    const app = new WorkspaceApplication(
      new WorkspaceSettingsStore(`${sandbox}/settings.json`),
      window,
      () => Promise.resolve(`${root}/.`),
      () => undefined,
    );

    await app.initialize();
    const result = await app.openFolder();

    assertEquals(result.opened, true);
    assertEquals(result.activePath, await Deno.realPath(root));
    assertEquals(
      JSON.stringify(window.menu).includes('"label":"workspace"'),
      true,
    );
  } finally {
    await Deno.remove(sandbox, { recursive: true });
  }
});

Deno.test("an unreadable folder cannot open and is pruned from recent history", async () => {
  const sandbox = await Deno.makeTempDir();
  const unreadable = `${sandbox}/unreadable`;
  try {
    const available = `${sandbox}/available`;
    await Deno.mkdir(unreadable);
    await Deno.mkdir(available);
    const store = new WorkspaceSettingsStore(`${sandbox}/settings.json`);
    await store.remember(await Deno.realPath(unreadable));
    await store.remember(await Deno.realPath(available));
    await Deno.chmod(unreadable, 0o000);

    await assertRejects(async () => {
      for await (const _entry of Deno.readDir(unreadable)) {
        // Enumeration is only used to prove the permission precondition.
      }
    });
    await assertRejects(() => WorkspaceRoot.open(unreadable));

    const app = new WorkspaceApplication(
      store,
      new FakeWindow(),
      () => Promise.resolve(null),
      () => undefined,
    );
    await app.initialize();

    assertEquals((await store.load()).recentWorkspaces, [
      await Deno.realPath(available),
    ]);
  } finally {
    await Deno.chmod(unreadable, 0o700).catch(() => undefined);
    await Deno.remove(sandbox, { recursive: true });
  }
});

Deno.test("startup restores the last eligible active file for the workspace", async () => {
  const sandbox = await Deno.makeTempDir();
  try {
    const rootPath = `${sandbox}/workspace`;
    await Deno.mkdir(rootPath);
    await Deno.writeTextFile(`${rootPath}/note.md`, "# Restored");
    const resolvedRoot = await Deno.realPath(rootPath);
    const store = new WorkspaceSettingsStore(`${sandbox}/settings.json`);
    await store.remember(resolvedRoot);
    await store.rememberActiveFile(resolvedRoot, "note.md");
    const app = new WorkspaceApplication(
      store,
      new FakeWindow(),
      () => Promise.resolve(null),
      () => undefined,
    );

    await app.initialize();
    const navigation = await app.getNavigation();

    assertEquals(navigation.activeFile, {
      kind: "markdown",
      path: "note.md",
      content: "# Restored",
    });
    app.dispose();
  } finally {
    await Deno.remove(sandbox, { recursive: true });
  }
});

Deno.test("startup restores an unsupported file into its safe information route", async () => {
  const sandbox = await Deno.makeTempDir();
  try {
    const rootPath = `${sandbox}/workspace`;
    await Deno.mkdir(rootPath);
    await Deno.writeTextFile(`${rootPath}/image.png`, "opaque");
    const resolvedRoot = await Deno.realPath(rootPath);
    const store = new WorkspaceSettingsStore(`${sandbox}/settings.json`);
    await store.remember(resolvedRoot);
    await store.rememberActiveFile(resolvedRoot, "image.png");
    const app = new WorkspaceApplication(
      store,
      new FakeWindow(),
      () => Promise.resolve(null),
      () => undefined,
    );

    await app.initialize();
    assertEquals((await app.getNavigation()).activeFile, {
      kind: "information",
      path: "image.png",
      reason: "unsupported",
    });
    app.dispose();
  } finally {
    await Deno.remove(sandbox, { recursive: true });
  }
});

Deno.test("active HTML receives an isolated preview URL and only web links open externally", async () => {
  const sandbox = await Deno.makeTempDir();
  try {
    const rootPath = `${sandbox}/workspace`;
    await Deno.mkdir(rootPath);
    await Deno.writeTextFile(`${rootPath}/page.html`, "<title>Preview</title>");
    await Deno.writeTextFile(`${rootPath}/other.html`, "<title>Other</title>");
    const openedUrls: string[] = [];
    const app = new WorkspaceApplication(
      new WorkspaceSettingsStore(`${sandbox}/settings.json`),
      new FakeWindow(),
      () => Promise.resolve(rootPath),
      () => undefined,
      (url) => {
        openedUrls.push(url);
        return Promise.resolve();
      },
    );

    await app.initialize();
    await app.openFolder();
    await app.openFile("page.html");
    const preview = await app.getHtmlPreviewUrl("page.html");
    assertEquals(new URL(preview.url).hostname, "127.0.0.1");
    assertEquals((await fetch(preview.url)).status, 200);
    const other = await app.getHtmlPreviewUrl("other.html", "?mode=reader");
    const otherSource = await (await fetch(other.url)).text();
    if (!otherSource.includes(JSON.stringify("/other.html?mode=reader"))) {
      throw new Error("Preview navigation did not preserve its user query");
    }

    await app.openExternalUrl("https://example.com/docs");
    await assertRejects(() => app.openExternalUrl("file:///etc/passwd"));
    await assertRejects(() => app.openExternalUrl("javascript:alert(1)"));
    assertEquals(openedUrls, ["https://example.com/docs"]);
    await app.dispose();
  } finally {
    await Deno.remove(sandbox, { recursive: true });
  }
});

Deno.test("Markdown images receive contained workspace resource URLs", async () => {
  const sandbox = await Deno.makeTempDir();
  try {
    const rootPath = `${sandbox}/workspace`;
    await Deno.mkdir(`${rootPath}/notes/images`, { recursive: true });
    await Deno.writeTextFile(
      `${rootPath}/notes/readme.md`,
      "![Pixel](images/pixel.png)",
    );
    const pixel = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    await Deno.writeFile(`${rootPath}/notes/images/pixel.png`, pixel);
    await Deno.writeTextFile(`${rootPath}/notes/images/not-image.txt`, "no");
    await Deno.writeFile(`${sandbox}/outside.png`, pixel);
    const app = new WorkspaceApplication(
      new WorkspaceSettingsStore(`${sandbox}/settings.json`),
      new FakeWindow(),
      () => Promise.resolve(rootPath),
      () => undefined,
    );

    await app.initialize();
    await app.openFolder();
    const imageUrl = await app.getMarkdownImageUrl(
      "notes/readme.md",
      "images/pixel.png",
    );
    const response = await fetch(imageUrl);
    assertEquals(response.status, 200);
    assertEquals(response.headers.get("content-type"), "image/png");
    assertEquals([...new Uint8Array(await response.arrayBuffer())], [...pixel]);

    await assertRejects(() =>
      app.getMarkdownImageUrl(
        "notes/readme.md",
        "https://example.com/pixel.png",
      )
    );
    await assertRejects(() =>
      app.getMarkdownImageUrl("notes/readme.md", "../../../outside.png")
    );
    await assertRejects(() =>
      app.getMarkdownImageUrl("notes/readme.md", "images/missing.png")
    );
    await assertRejects(() =>
      app.getMarkdownImageUrl("notes/readme.md", "images/not-image.txt")
    );
    await app.dispose();
  } finally {
    await Deno.remove(sandbox, { recursive: true });
  }
});

Deno.test("active Markdown enables native Save and dispatches the save bridge", async () => {
  const sandbox = await Deno.makeTempDir();
  try {
    const rootPath = `${sandbox}/workspace`;
    await Deno.mkdir(rootPath);
    await Deno.writeTextFile(`${rootPath}/note.md`, "# Editable");
    await Deno.writeTextFile(`${rootPath}/page.html`, "<p>Preview</p>");
    const window = new FakeWindow();
    const app = new WorkspaceApplication(
      new WorkspaceSettingsStore(`${sandbox}/settings.json`),
      window,
      () => Promise.resolve(rootPath),
      () => undefined,
    );

    await app.initialize();
    await app.openFolder();
    await app.openFile("note.md");
    assertEquals(nativeSaveEnabled(window.menu), true);

    window.dispatchMenuClick("save");
    await waitFor(() =>
      window.executedSources.includes("globalThis.markdSave?.()")
    );

    await app.openFile("page.html");
    assertEquals(nativeSaveEnabled(window.menu), false);
    await app.dispose();
  } finally {
    await Deno.remove(sandbox, { recursive: true });
  }
});

Deno.test("a requested file opens its folder as the workspace", async () => {
  const sandbox = await Deno.makeTempDir();
  try {
    const rootPath = `${sandbox}/workspace`;
    await Deno.mkdir(rootPath);
    await Deno.writeTextFile(`${rootPath}/note.md`, "# Requested");
    const window = new FakeWindow();
    const app = new WorkspaceApplication(
      new WorkspaceSettingsStore(`${sandbox}/settings.json`),
      window,
      () => Promise.reject(new Error("The picker must stay closed")),
      () => undefined,
    );

    await app.initialize(`${rootPath}/note.md`);

    const navigation = await app.getNavigation();
    assertEquals(navigation.rootPath, await Deno.realPath(rootPath));
    assertEquals(navigation.activeFile?.path, "note.md");
    assertEquals(
      (await app.getState()).activePath,
      await Deno.realPath(rootPath),
    );
    await app.dispose();
  } finally {
    await Deno.remove(sandbox, { recursive: true });
  }
});

Deno.test("a requested file inside the workspace keeps the current root", async () => {
  const sandbox = await Deno.makeTempDir();
  try {
    const rootPath = `${sandbox}/workspace`;
    await Deno.mkdir(`${rootPath}/notes`, { recursive: true });
    await Deno.writeTextFile(`${rootPath}/notes/nested.md`, "# Nested");
    const window = new FakeWindow();
    const app = new WorkspaceApplication(
      new WorkspaceSettingsStore(`${sandbox}/settings.json`),
      window,
      () => Promise.resolve(rootPath),
      () => undefined,
    );

    await app.initialize();
    await app.openFolder();
    assertEquals(await app.openPath(`${rootPath}/notes/nested.md`), true);

    const navigation = await app.getNavigation();
    assertEquals(navigation.rootPath, await Deno.realPath(rootPath));
    assertEquals(navigation.activeFile?.path, "notes/nested.md");
    assertEquals(
      window.executedSources.some((source) =>
        source.includes("markd-files-change")
      ),
      true,
    );
    await app.dispose();
  } finally {
    await Deno.remove(sandbox, { recursive: true });
  }
});

Deno.test("a missing requested path falls back to the last workspace", async () => {
  const sandbox = await Deno.makeTempDir();
  try {
    const rootPath = `${sandbox}/workspace`;
    await Deno.mkdir(rootPath);
    const store = new WorkspaceSettingsStore(`${sandbox}/settings.json`);
    await store.remember(await Deno.realPath(rootPath));
    const errors: string[] = [];
    const app = new WorkspaceApplication(
      store,
      new FakeWindow(),
      () => Promise.reject(new Error("The picker must stay closed")),
      (message) => errors.push(message),
    );

    await app.initialize(`${sandbox}/missing/note.md`);

    assertEquals(errors, ["Markd could not open that path."]);
    assertEquals(
      (await app.getState()).activePath,
      await Deno.realPath(rootPath),
    );
    await app.dispose();
  } finally {
    await Deno.remove(sandbox, { recursive: true });
  }
});

Deno.test("a new window opens empty instead of restoring the last workspace", async () => {
  const sandbox = await Deno.makeTempDir();
  try {
    const rootPath = `${sandbox}/workspace`;
    await Deno.mkdir(rootPath);
    const store = new WorkspaceSettingsStore(`${sandbox}/settings.json`);
    await store.remember(await Deno.realPath(rootPath));
    const app = new WorkspaceApplication(
      store,
      new FakeWindow(),
      () => Promise.reject(new Error("The picker must stay closed")),
      () => undefined,
    );

    await app.initialize(null, { restoreLastWorkspace: false });

    assertEquals((await app.getState()).activePath, null);
    assertEquals(
      (await store.load()).lastWorkspace,
      await Deno.realPath(rootPath),
    );
    await app.dispose();
  } finally {
    await Deno.remove(sandbox, { recursive: true });
  }
});

Deno.test("only the focused window writes the shared application menu", async () => {
  const sandbox = await Deno.makeTempDir();
  try {
    const rootPath = `${sandbox}/workspace`;
    await Deno.mkdir(rootPath);
    await Deno.writeTextFile(`${rootPath}/note.md`, "# note\n");
    const window = new FakeWindow();
    let focused = false;
    const app = new WorkspaceApplication(
      new WorkspaceSettingsStore(`${sandbox}/settings.json`),
      window,
      () => Promise.resolve(rootPath),
      () => undefined,
      undefined,
      undefined,
      () => focused,
    );

    await app.initialize(null, { restoreLastWorkspace: false });
    await app.openFolder();
    await app.openFile("note.md");
    assertEquals(window.menu, []);

    focused = true;
    app.claimApplicationMenu();
    assertEquals(nativeSaveEnabled(window.menu), true);
    await app.dispose();
  } finally {
    await Deno.remove(sandbox, { recursive: true });
  }
});

class FakeWindow {
  menu: ApplicationMenuItem[] = [];
  executedSources: string[] = [];
  private menuClickListener:
    | ((event: Event & { detail?: { id?: string } }) => void)
    | null = null;

  setApplicationMenu(menu: ApplicationMenuItem[]): void {
    this.menu = menu;
  }

  addEventListener(
    _type: "menuclick",
    listener: (event: Event & { detail?: { id?: string } }) => void,
  ): void {
    this.menuClickListener = listener;
  }

  dispatchMenuClick(id: string): void {
    this.menuClickListener?.(
      { detail: { id } } as Event & {
        detail: { id: string };
      },
    );
  }

  executeJs(source: string): Promise<unknown> {
    this.executedSources.push(source);
    if (source.includes("markdBeforeWorkspaceSwitch")) {
      return Promise.resolve(true);
    }
    return Promise.resolve(undefined);
  }
}

function nativeSaveEnabled(menu: ApplicationMenuItem[]): boolean | undefined {
  for (const entry of menu) {
    if (entry === "separator" || "role" in entry) continue;
    if ("item" in entry && entry.item.id === "save") return entry.item.enabled;
    if ("submenu" in entry) {
      const enabled = nativeSaveEnabled(entry.submenu.items);
      if (enabled !== undefined) return enabled;
    }
  }
  return undefined;
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return;
    await Promise.resolve();
  }
  throw new Error("Expected asynchronous menu action");
}

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
