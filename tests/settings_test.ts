import { WorkspaceSettingsStore } from "../desktop/settings.ts";

Deno.test("workspace history is persisted, deduplicated, and capped at ten", async () => {
  const sandbox = await Deno.makeTempDir();
  try {
    const settingsPath = `${sandbox}/Markd/workspaces.json`;
    const store = new WorkspaceSettingsStore(settingsPath);

    for (let index = 0; index < 12; index += 1) {
      await store.remember(`/workspace/${index}`);
    }
    await store.remember("/workspace/5");

    const reloaded = await new WorkspaceSettingsStore(settingsPath).load();
    assertEquals(reloaded.lastWorkspace, "/workspace/5");
    assertEquals(reloaded.recentWorkspaces.length, 10);
    assertEquals(reloaded.recentWorkspaces[0], "/workspace/5");
    assertEquals(
      reloaded.recentWorkspaces.filter((path) => path === "/workspace/5")
        .length,
      1,
    );
  } finally {
    await Deno.remove(sandbox, { recursive: true });
  }
});

Deno.test("unavailable folders are removed instead of retained", async () => {
  const sandbox = await Deno.makeTempDir();
  try {
    const store = new WorkspaceSettingsStore(`${sandbox}/workspaces.json`);
    await store.remember("/missing/older");
    await store.remember("/available/current");

    const settings = await store.prune((path) =>
      Promise.resolve(path === "/available/current")
    );
    assertEquals(settings.recentWorkspaces, ["/available/current"]);

    const empty = await store.prune(() => Promise.resolve(false));
    assertEquals(empty.lastWorkspace, null);
    assertEquals(empty.recentWorkspaces, []);
  } finally {
    await Deno.remove(sandbox, { recursive: true });
  }
});

Deno.test("the last active file is remembered independently for each workspace", async () => {
  const sandbox = await Deno.makeTempDir();
  try {
    const store = new WorkspaceSettingsStore(`${sandbox}/workspaces.json`);
    await store.remember("/workspace/one");
    await store.rememberActiveFile("/workspace/one", "notes/one.md");
    await store.remember("/workspace/two");
    await store.rememberActiveFile("/workspace/two", "two.html");

    const settings = await new WorkspaceSettingsStore(store.path).load();
    assertEquals(settings.activeFiles, {
      "/workspace/one": "notes/one.md",
      "/workspace/two": "two.html",
    });
  } finally {
    await Deno.remove(sandbox, { recursive: true });
  }
});

Deno.test("concurrent windows writing settings keep every update", async () => {
  const sandbox = await Deno.makeTempDir();
  try {
    const store = new WorkspaceSettingsStore(`${sandbox}/workspaces.json`);
    await store.remember("/workspace/one");
    await store.remember("/workspace/two");

    await Promise.all([
      store.rememberActiveFile("/workspace/one", "one.md"),
      store.rememberActiveFile("/workspace/two", "two.md"),
      store.remember("/workspace/three"),
    ]);

    const settings = await new WorkspaceSettingsStore(store.path).load();
    assertEquals(settings.activeFiles, {
      "/workspace/one": "one.md",
      "/workspace/two": "two.md",
    });
    assertEquals(settings.recentWorkspaces.includes("/workspace/three"), true);
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
