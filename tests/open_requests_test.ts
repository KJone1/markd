import {
  consumeOpenRequest,
  watchOpenRequests,
} from "../desktop/open_requests.ts";

Deno.test("a pending request is read once and removed", async () => {
  const sandbox = await Deno.makeTempDir();
  try {
    const requestPath = `${sandbox}/open-request`;
    await Deno.writeTextFile(requestPath, `${sandbox}/notes.md\n`);

    assertEquals(await consumeOpenRequest(requestPath), `${sandbox}/notes.md`);
    assertEquals(await consumeOpenRequest(requestPath), null);
  } finally {
    await Deno.remove(sandbox, { recursive: true });
  }
});

Deno.test("relative requests are rejected", async () => {
  const sandbox = await Deno.makeTempDir();
  try {
    const requestPath = `${sandbox}/open-request`;
    await Deno.writeTextFile(requestPath, "notes.md\n");

    assertEquals(await consumeOpenRequest(requestPath), null);
    assertEquals(await exists(requestPath), false);
  } finally {
    await Deno.remove(sandbox, { recursive: true });
  }
});

Deno.test("watching reports requests written while the app runs", async () => {
  const sandbox = await Deno.makeTempDir();
  const requestPath = `${sandbox}/open-request`;
  const requested: string[] = [];
  const stop = watchOpenRequests(requestPath, (path) => {
    requested.push(path);
  });

  try {
    await Deno.writeTextFile(requestPath, `${sandbox}/notes.md\n`);
    await waitFor(() => requested.length === 1);

    assertEquals(requested, [`${sandbox}/notes.md`]);
    assertEquals(await exists(requestPath), false);
  } finally {
    stop();
    await Deno.remove(sandbox, { recursive: true });
  }
});

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Expected an open request to be observed");
}

function assertEquals(actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}
