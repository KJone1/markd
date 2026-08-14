import { WorkspaceController } from "../desktop/workspace_controller.ts";
import { WorkspaceSettingsStore } from "../desktop/settings.ts";

Deno.test("workspace replacement waits for an accepted document handoff", async () => {
  const sandbox = await Deno.makeTempDir();
  try {
    const first = `${sandbox}/first`;
    const second = `${sandbox}/second`;
    await Deno.mkdir(first);
    await Deno.mkdir(second);

    let releaseHandoff: ((accepted: boolean) => void) | undefined;
    let signalHandoffStarted: (() => void) | undefined;
    const handoffStarted = new Promise<void>((resolve) => {
      signalHandoffStarted = resolve;
    });
    const controller = new WorkspaceController(
      new WorkspaceSettingsStore(`${sandbox}/settings.json`),
      () => {
        signalHandoffStarted?.();
        return new Promise((resolve) => releaseHandoff = resolve);
      },
    );

    await controller.open(first, { requireHandoff: false });
    const replacement = controller.open(second);
    await handoffStarted;
    assertEquals(controller.active?.path.endsWith("/first"), true);

    releaseHandoff?.(true);
    assertEquals((await replacement).opened, true);
    assertEquals(controller.active?.path.endsWith("/second"), true);
  } finally {
    await Deno.remove(sandbox, { recursive: true });
  }
});

Deno.test("a rejected document handoff keeps the current workspace", async () => {
  const sandbox = await Deno.makeTempDir();
  try {
    const first = `${sandbox}/first`;
    const second = `${sandbox}/second`;
    await Deno.mkdir(first);
    await Deno.mkdir(second);
    const store = new WorkspaceSettingsStore(`${sandbox}/settings.json`);
    const controller = new WorkspaceController(
      store,
      () => Promise.resolve(false),
    );

    await controller.open(first, { requireHandoff: false });
    const result = await controller.open(second);

    assertEquals(result.opened, false);
    assertEquals(controller.active?.path.endsWith("/first"), true);
    assertEquals((await store.load()).lastWorkspace?.endsWith("/first"), true);
  } finally {
    await Deno.remove(sandbox, { recursive: true });
  }
});

Deno.test("alternative workspace spellings create one recent entry", async () => {
  const sandbox = await Deno.makeTempDir();
  try {
    const root = `${sandbox}/workspace`;
    await Deno.mkdir(root);
    await Deno.symlink(root, `${sandbox}/alias`);
    const store = new WorkspaceSettingsStore(`${sandbox}/settings.json`);
    const controller = new WorkspaceController(
      store,
      () => Promise.resolve(true),
    );

    await controller.open(`${root}/.`, { requireHandoff: false });
    await controller.open(`${sandbox}/alias`);

    const settings = await store.load();
    assertEquals(settings.recentWorkspaces.length, 1);
    assertEquals(settings.recentWorkspaces[0], await Deno.realPath(root));
  } finally {
    await Deno.remove(sandbox, { recursive: true });
  }
});

function assertEquals(actual: unknown, expected: unknown): void {
  if (actual !== expected) {
    throw new Error(
      `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}
