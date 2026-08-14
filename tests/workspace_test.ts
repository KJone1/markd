import { WorkspaceRoot } from "../desktop/workspace.ts";

Deno.test("workspace resolution cannot escape through traversal or symlinks", async () => {
  const sandbox = await Deno.makeTempDir();
  try {
    const root = `${sandbox}/workspace`;
    const outside = `${sandbox}/outside`;
    await Deno.mkdir(root);
    await Deno.mkdir(outside);
    await Deno.writeTextFile(`${root}/inside.md`, "inside");
    await Deno.writeTextFile(`${outside}/secret.md`, "outside");
    await Deno.symlink(`${outside}/secret.md`, `${root}/external.md`);
    await Deno.symlink(`${root}/missing.md`, `${root}/broken.md`);

    const workspace = await WorkspaceRoot.open(root);

    await assertRejects(() =>
      workspace.resolveExistingPath("../outside/secret.md")
    );
    await assertRejects(() => workspace.resolveExistingPath("external.md"));
    await assertRejects(() => workspace.resolveExistingPath("broken.md"));
    assertEquals(
      await workspace.resolveExistingPath("inside.md"),
      `${workspace.path}/inside.md`,
    );
  } finally {
    await Deno.remove(sandbox, { recursive: true });
  }
});

Deno.test("workspace identity uses its resolved path", async () => {
  const sandbox = await Deno.makeTempDir();
  try {
    const root = `${sandbox}/workspace`;
    await Deno.mkdir(root);
    await Deno.symlink(root, `${sandbox}/workspace-alias`);

    const direct = await WorkspaceRoot.open(`${root}/.`);
    const alias = await WorkspaceRoot.open(`${sandbox}/workspace-alias`);

    assertEquals(alias.path, direct.path);
  } finally {
    await Deno.remove(sandbox, { recursive: true });
  }
});

async function assertRejects(action: () => Promise<unknown>): Promise<void> {
  try {
    await action();
  } catch {
    return;
  }
  throw new Error("Expected promise to reject");
}

function assertEquals(actual: unknown, expected: unknown): void {
  if (actual !== expected) {
    throw new Error(
      `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}
