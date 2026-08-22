import {
  type BindingRegistrar,
  registerDesktopBindings,
} from "../desktop/bindings.ts";

Deno.test("registerDesktopBindings exposes only typed workspace calls", async () => {
  const registered = new Map<string, (...args: never[]) => unknown>();
  const registrar: BindingRegistrar = {
    bind(name, handler) {
      registered.set(name, handler);
    },
  };

  registerDesktopBindings(registrar, {
    getState: () =>
      Promise.resolve({
        activePath: "/workspace",
        recentWorkspaces: ["/workspace"],
      }),
    openFolder: () =>
      Promise.resolve({
        activePath: "/workspace",
        recentWorkspaces: ["/workspace"],
        opened: true,
      }),
    getNavigation: () =>
      Promise.resolve({
        rootPath: "/workspace",
        entries: [{ kind: "file", name: "note.md", path: "note.md" }],
        activeFile: null,
      }),
    openFile: (path) =>
      Promise.resolve({ kind: "markdown", path, content: "# Note" }),
    saveDocument: () => Promise.resolve({ kind: "saved" }),
    getHtmlPreviewUrl: (path, search) =>
      Promise.resolve({
        url: `http://127.0.0.1:49152/${path}${search ?? ""}`,
        runtimeToken: "runtime-token",
      }),
    getMarkdownImageUrl: (documentPath, imagePath) =>
      Promise.resolve(
        `http://127.0.0.1:49152/${documentPath}/${imagePath}`,
      ),
    openExternalUrl: () => Promise.resolve(),
    openInZed: () => Promise.resolve(),
  });

  const names = [...registered.keys()];
  const expectedNames = [
    "getWorkspaceState",
    "getWorkspaceNavigation",
    "openWorkspaceFile",
    "saveWorkspaceDocument",
    "getHtmlPreviewUrl",
    "getMarkdownImageUrl",
    "openExternalUrl",
    "openInZed",
    "openFolder",
  ];
  if (JSON.stringify(names) !== JSON.stringify(expectedNames)) {
    throw new Error(`Unexpected privileged boundary: ${names.join(", ")}`);
  }

  const workspace = await registered.get("getWorkspaceState")?.();
  if (
    JSON.stringify(workspace) !== JSON.stringify({
      activePath: "/workspace",
      recentWorkspaces: ["/workspace"],
    })
  ) {
    throw new Error(`Unexpected workspace state: ${JSON.stringify(workspace)}`);
  }

  const navigation = await registered.get("getWorkspaceNavigation")?.();
  if (!JSON.stringify(navigation).includes('"path":"note.md"')) {
    throw new Error(`Unexpected navigation: ${JSON.stringify(navigation)}`);
  }

  const openWorkspaceFile = registered.get("openWorkspaceFile") as
    | ((path: string) => Promise<unknown>)
    | undefined;
  const activeFile = await openWorkspaceFile?.("note.md");
  if (!JSON.stringify(activeFile).includes('"kind":"markdown"')) {
    throw new Error(`Unexpected active file: ${JSON.stringify(activeFile)}`);
  }

  const saveWorkspaceDocument = registered.get("saveWorkspaceDocument") as
    | ((request: unknown) => Promise<unknown>)
    | undefined;
  const saved = await saveWorkspaceDocument?.({
    path: "app.ts",
    content: "latest",
    expectedContent: "initial",
    overwrite: false,
  });
  if (JSON.stringify(saved) !== '{"kind":"saved"}') {
    throw new Error(`Unexpected document save: ${JSON.stringify(saved)}`);
  }

  const getHtmlPreviewUrl = registered.get("getHtmlPreviewUrl") as
    | ((path: string, search?: string) => Promise<unknown>)
    | undefined;
  assertEquals(
    await getHtmlPreviewUrl?.("page.html", "?mode=reader"),
    {
      url: "http://127.0.0.1:49152/page.html?mode=reader",
      runtimeToken: "runtime-token",
    },
  );

  const getMarkdownImageUrl = registered.get("getMarkdownImageUrl") as
    | ((documentPath: string, imagePath: string) => Promise<unknown>)
    | undefined;
  assertEquals(
    await getMarkdownImageUrl?.("notes/readme.md", "images/pixel.png"),
    "http://127.0.0.1:49152/notes/readme.md/images/pixel.png",
  );

  const openExternalUrl = registered.get("openExternalUrl") as
    | ((url: string) => Promise<unknown>)
    | undefined;
  assertEquals(await openExternalUrl?.("https://example.com/"), undefined);

  const openInZed = registered.get("openInZed") as
    | ((path: string) => Promise<unknown>)
    | undefined;
  assertEquals(await openInZed?.("notes/readme.md"), undefined);
});

function assertEquals(actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}
