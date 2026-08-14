import {
  createWorkspacePreviewHandler,
  startWorkspacePreviewServer,
} from "../desktop/preview.ts";
import { WorkspaceRoot } from "../desktop/workspace.ts";

Deno.test("workspace preview serves browser-ready files with browser MIME types", async () => {
  const sandbox = await Deno.makeTempDir();
  try {
    const rootPath = `${sandbox}/workspace`;
    await Deno.mkdir(`${rootPath}/assets`, { recursive: true });
    await Deno.writeTextFile(`${rootPath}/index.html`, "<h1>Preview</h1>");
    await Deno.writeTextFile(`${rootPath}/assets/site.css`, "h1 {}");
    await Deno.writeTextFile(`${rootPath}/assets/app.mjs`, "export {};");
    await Deno.writeTextFile(`${rootPath}/assets/data.json`, "{}");
    await Deno.writeFile(`${rootPath}/assets/font.woff2`, new Uint8Array([1]));
    const handler = createWorkspacePreviewHandler(
      await WorkspaceRoot.open(rootPath),
    );

    const expectedTypes = new Map([
      ["/index.html", "text/html; charset=utf-8"],
      ["/assets/site.css", "text/css; charset=utf-8"],
      ["/assets/app.mjs", "text/javascript; charset=utf-8"],
      ["/assets/data.json", "application/json; charset=utf-8"],
      ["/assets/font.woff2", "font/woff2"],
    ]);
    for (const [path, contentType] of expectedTypes) {
      const response = await handler(new Request(`http://127.0.0.1${path}`));
      assertEquals(response.status, 200);
      assertEquals(response.headers.get("content-type"), contentType);
      assertEquals(response.headers.get("x-content-type-options"), "nosniff");
    }
  } finally {
    await Deno.remove(sandbox, { recursive: true });
  }
});

Deno.test("workspace preview rejects paths outside static workspace files", async () => {
  const sandbox = await Deno.makeTempDir();
  try {
    const rootPath = `${sandbox}/workspace`;
    const outsidePath = `${sandbox}/outside`;
    await Deno.mkdir(`${rootPath}/folder`, { recursive: true });
    await Deno.mkdir(outsidePath);
    await Deno.writeTextFile(`${rootPath}/index.html`, "inside");
    await Deno.writeTextFile(`${outsidePath}/secret.html`, "outside");
    await Deno.symlink(
      `${outsidePath}/secret.html`,
      `${rootPath}/external.html`,
    );
    await Deno.symlink(`${rootPath}/missing.html`, `${rootPath}/broken.html`);
    const handler = createWorkspacePreviewHandler(
      await WorkspaceRoot.open(rootPath),
    );

    for (
      const path of [
        "/%2e%2e%2foutside/secret.html",
        "/%2Fetc/passwd",
        "/external.html",
        "/broken.html",
        "/folder",
        "/folder/",
        "/assets%5csecret.js",
        "/assets%00secret.js",
        "/assets%ZZsecret.js",
      ]
    ) {
      const response = await handler(new Request(`http://127.0.0.1${path}`));
      if (response.status >= 200 && response.status < 300) {
        throw new Error(`Unsafe preview path was served: ${path}`);
      }
    }

    const write = await handler(
      new Request("http://127.0.0.1/index.html", { method: "POST" }),
    );
    assertEquals(write.status, 405);
    const fileUrl = await handler(new Request("file:///index.html"));
    assertEquals(fileUrl.status, 400);
  } finally {
    await Deno.remove(sandbox, { recursive: true });
  }
});

Deno.test("workspace preview does not allow persistent service workers", async () => {
  const sandbox = await Deno.makeTempDir();
  try {
    const rootPath = `${sandbox}/workspace`;
    await Deno.mkdir(rootPath);
    await Deno.writeTextFile(`${rootPath}/worker.js`, "self.skipWaiting();");
    const handler = createWorkspacePreviewHandler(
      await WorkspaceRoot.open(rootPath),
    );

    const response = await handler(
      new Request("http://127.0.0.1/worker.js", {
        headers: { "service-worker": "script" },
      }),
    );
    assertEquals(response.status, 403);
  } finally {
    await Deno.remove(sandbox, { recursive: true });
  }
});

Deno.test("workspace preview rejects a path replaced during file access", async () => {
  const sandbox = await Deno.makeTempDir();
  try {
    const rootPath = `${sandbox}/workspace`;
    const outsidePath = `${sandbox}/outside.html`;
    const pagePath = `${rootPath}/page.html`;
    await Deno.mkdir(rootPath);
    await Deno.writeTextFile(pagePath, "inside");
    await Deno.writeTextFile(outsidePath, "outside secret");
    const root = await WorkspaceRoot.open(rootPath);
    let resolutionCount = 0;
    const changingRoot = {
      path: root.path,
      async resolveExistingPath(path: string): Promise<string> {
        resolutionCount += 1;
        if (resolutionCount === 2) {
          await Deno.rename(pagePath, `${rootPath}/original.html`);
          await Deno.symlink(outsidePath, pagePath);
        }
        return await root.resolveExistingPath(path);
      },
    } as WorkspaceRoot;
    const handler = createWorkspacePreviewHandler(changingRoot);

    const response = await handler(
      new Request("http://127.0.0.1/page.html"),
    );
    if (response.status < 400 || (await response.text()).includes("outside")) {
      throw new Error("A replaced preview path exposed outside content");
    }
  } finally {
    await Deno.remove(sandbox, { recursive: true });
  }
});

Deno.test("workspace preview server binds to loopback and creates encoded file URLs", async () => {
  const sandbox = await Deno.makeTempDir();
  try {
    const rootPath = `${sandbox}/workspace`;
    await Deno.mkdir(`${rootPath}/nested`, { recursive: true });
    await Deno.writeTextFile(
      `${rootPath}/nested/page name.html`,
      "<!doctype html><title>Safe preview</title>",
    );
    const server = startWorkspacePreviewServer(
      await WorkspaceRoot.open(rootPath),
    );
    try {
      const document = server.documentFor(
        "nested/page name.html",
        "?mode=reader&item=1",
      );
      assertEquals(new URL(document.url).hostname, "127.0.0.1");
      assertEquals(new URL(document.url).search, "");
      if (new URL(document.url).pathname.includes("page%20name.html")) {
        throw new Error("The authentication URL exposed the workspace path");
      }
      const response = await fetch(document.url);
      assertEquals(response.status, 200);
      const initial = await response.text();
      if (!initial.includes("Safe preview")) {
        throw new Error("Preview server returned the wrong workspace file");
      }
      if (
        !initial.includes(JSON.stringify(document.runtimeToken)) ||
        !initial.includes("document.currentScript") ||
        !initial.includes("apply(removeElement") ||
        !initial.includes("History.prototype.replaceState") ||
        !initial.includes(
          JSON.stringify("/nested/page%20name.html?mode=reader&item=1"),
        )
      ) {
        throw new Error("Authenticated runtime did not install its clean URL");
      }
      const replay = await fetch(document.url);
      assertEquals(replay.status, 404);
    } finally {
      await server.close();
    }
  } finally {
    await Deno.remove(sandbox, { recursive: true });
  }
});

Deno.test("workspace preview server bounds unused authenticated documents", async () => {
  const sandbox = await Deno.makeTempDir();
  try {
    const rootPath = `${sandbox}/workspace`;
    await Deno.mkdir(rootPath);
    await Deno.writeTextFile(`${rootPath}/index.html`, "<p>Preview</p>");
    const server = startWorkspacePreviewServer(
      await WorkspaceRoot.open(rootPath),
    );
    try {
      const documents = Array.from(
        { length: 128 },
        () => server.documentFor("index.html"),
      );
      const oldest = await fetch(documents[0].url);
      if (
        oldest.status === 200 &&
        (await oldest.text()).includes(documents[0].runtimeToken)
      ) {
        throw new Error("Unused preview documents grew without a bound");
      }
      const latest = await fetch(documents.at(-1)!.url);
      if (
        latest.status !== 200 ||
        !(await latest.text()).includes(documents.at(-1)!.runtimeToken)
      ) {
        throw new Error("The newest preview document was evicted");
      }
    } finally {
      await server.close();
    }
  } finally {
    await Deno.remove(sandbox, { recursive: true });
  }
});

Deno.test("unauthenticated HTML navigation uses a safe host relay", async () => {
  const sandbox = await Deno.makeTempDir();
  try {
    const rootPath = `${sandbox}/workspace`;
    await Deno.mkdir(`${rootPath}/docs`, { recursive: true });
    await Deno.writeTextFile(
      `${rootPath}/docs/scripted.html`,
      "<script>globalThis.workspaceCodeRan = true</script>",
    );
    const handler = createWorkspacePreviewHandler(
      await WorkspaceRoot.open(rootPath),
    );
    const response = await handler(
      new Request(
        "http://127.0.0.1/docs/scripted.html?from=script",
        {
          headers: {
            "sec-fetch-dest": "iframe",
            "sec-fetch-mode": "navigate",
          },
        },
      ),
    );
    const served = await response.text();
    if (
      !served.includes("workspace-navigation") ||
      !served.includes("location.href") || served.includes("workspaceCodeRan")
    ) {
      throw new Error("Script navigation was not replaced by a safe relay");
    }
  } finally {
    await Deno.remove(sandbox, { recursive: true });
  }
});

Deno.test("HTML fetched as a static resource is served byte-for-byte", async () => {
  const sandbox = await Deno.makeTempDir();
  try {
    const rootPath = `${sandbox}/workspace`;
    const fragment = "<template><p>Fragment</p></template>";
    await Deno.mkdir(rootPath);
    await Deno.writeTextFile(`${rootPath}/fragment.html`, fragment);
    const handler = createWorkspacePreviewHandler(
      await WorkspaceRoot.open(rootPath),
    );

    for (
      const headers of [
        { "sec-fetch-dest": "empty", "sec-fetch-mode": "cors" },
        { "sec-fetch-dest": "empty", "sec-fetch-mode": "same-origin" },
      ]
    ) {
      const response = await handler(
        new Request("http://127.0.0.1/fragment.html", { headers }),
      );
      assertEquals(await response.text(), fragment);
    }
  } finally {
    await Deno.remove(sandbox, { recursive: true });
  }
});

Deno.test("HTML responses install an isolated runtime bridge without changing workspace files", async () => {
  const sandbox = await Deno.makeTempDir();
  try {
    const rootPath = `${sandbox}/workspace`;
    const source = "<!doctype html><html><head></head><body>Page</body></html>";
    await Deno.mkdir(rootPath);
    await Deno.writeTextFile(`${rootPath}/index.html`, source);
    const handler = authenticatedPreviewHandler(
      await WorkspaceRoot.open(rootPath),
    );

    const response = await handler(
      new Request("http://127.0.0.1/index.html"),
    );
    const served = await response.text();
    if (
      !served.includes("data-markd-preview-runtime") ||
      !served.includes("MessagePort.prototype.postMessage") ||
      !served.includes("Window.prototype.postMessage") ||
      !served.includes("apply(removeElement, document.currentScript") ||
      !served.includes("target.search !== location.search") ||
      !served.includes("event.isTrusted") || !served.includes("Page")
    ) {
      throw new Error("HTML preview runtime bridge was not installed");
    }
    assertEquals(await Deno.readTextFile(`${rootPath}/index.html`), source);
  } finally {
    await Deno.remove(sandbox, { recursive: true });
  }
});

Deno.test("HTML runtime injection preserves a leading doctype when head is omitted", async () => {
  const sandbox = await Deno.makeTempDir();
  try {
    const rootPath = `${sandbox}/workspace`;
    const source =
      "<!-- generated page --><!doctype html><title>Standards mode</title><main>Page</main>";
    await Deno.mkdir(rootPath);
    await Deno.writeTextFile(`${rootPath}/index.html`, source);
    const handler = authenticatedPreviewHandler(
      await WorkspaceRoot.open(rootPath),
    );

    const response = await handler(
      new Request("http://127.0.0.1/index.html"),
    );
    const served = await response.text();
    if (!served.startsWith("<!-- generated page --><!doctype html>")) {
      throw new Error("Preview runtime displaced the document doctype");
    }
    if (
      served.indexOf("data-markd-preview-runtime") <
        "<!-- generated page --><!doctype html>".length
    ) {
      throw new Error("Preview runtime was inserted before the doctype");
    }
  } finally {
    await Deno.remove(sandbox, { recursive: true });
  }
});

Deno.test("HTML runtime precedes misleading head comments and pre-head workspace scripts", async () => {
  const sandbox = await Deno.makeTempDir();
  try {
    const rootPath = `${sandbox}/workspace`;
    const misleadingComment = "<!-- misleading <head> text -->";
    const workspaceScript =
      '<script data-workspace-listener>Object.defineProperty(MessageEvent.prototype, "ports", { get: function () { globalThis.portsRead = true; return []; } }); addEventListener("message", function (event) { globalThis.stolenPort = event.ports[0]; }, true);</script>';
    const source =
      `<!doctype html>${misleadingComment}${workspaceScript}<head><title>Safe</title></head>`;
    await Deno.mkdir(rootPath);
    await Deno.writeTextFile(`${rootPath}/index.html`, source);
    const handler = authenticatedPreviewHandler(
      await WorkspaceRoot.open(rootPath),
    );

    const response = await handler(
      new Request("http://127.0.0.1/index.html"),
    );
    const served = await response.text();
    const runtimeIndex = served.indexOf("<script data-markd-preview-runtime>");
    const commentIndex = served.indexOf(misleadingComment);
    const workspaceScriptIndex = served.indexOf(workspaceScript);
    if (
      runtimeIndex < "<!doctype html>".length || runtimeIndex >= commentIndex ||
      runtimeIndex >= workspaceScriptIndex
    ) {
      throw new Error("Workspace code can execute before the preview runtime");
    }
    if (!served.includes(misleadingComment)) {
      throw new Error("Runtime injection changed a valid HTML comment");
    }
    if (!served.includes("apply(postToWindow, parent")) {
      throw new Error("Runtime did not capture the native window messenger");
    }
  } finally {
    await Deno.remove(sandbox, { recursive: true });
  }
});

Deno.test("HTML runtime is first when a pre-head script has no doctype", async () => {
  const sandbox = await Deno.makeTempDir();
  try {
    const rootPath = `${sandbox}/workspace`;
    const source =
      '<script data-workspace-listener>addEventListener("message", function () {});</script><head><title>Page</title></head>';
    await Deno.mkdir(rootPath);
    await Deno.writeTextFile(`${rootPath}/index.html`, source);
    const handler = authenticatedPreviewHandler(
      await WorkspaceRoot.open(rootPath),
    );

    const served = await (await handler(
      new Request("http://127.0.0.1/index.html"),
    )).text();
    if (!served.startsWith("<script data-markd-preview-runtime>")) {
      throw new Error("A workspace script precedes the preview runtime");
    }
  } finally {
    await Deno.remove(sandbox, { recursive: true });
  }
});

Deno.test("HTML runtime preserves explicit html and head parsing after misleading comments", async () => {
  const sandbox = await Deno.makeTempDir();
  try {
    const rootPath = `${sandbox}/workspace`;
    const prefix =
      '<!doctype html><!-- fake <head> --><html lang="en"><head data-theme="site">';
    const source =
      `${prefix}<title>Page</title></head><body>Content</body></html>`;
    await Deno.mkdir(rootPath);
    await Deno.writeTextFile(`${rootPath}/index.html`, source);
    const handler = authenticatedPreviewHandler(
      await WorkspaceRoot.open(rootPath),
    );

    const served = await (await handler(
      new Request("http://127.0.0.1/index.html"),
    )).text();
    if (!served.startsWith(`${prefix}<script data-markd-preview-runtime>`)) {
      throw new Error("Runtime injection changed leading document semantics");
    }
  } finally {
    await Deno.remove(sandbox, { recursive: true });
  }
});

function assertEquals(actual: unknown, expected: unknown): void {
  if (actual !== expected) {
    throw new Error(`Expected ${String(expected)}, got ${String(actual)}`);
  }
}

function authenticatedPreviewHandler(root: WorkspaceRoot) {
  return createWorkspacePreviewHandler(root, () => ({
    path: "index.html",
    search: "",
    runtimeToken: "test-runtime-token",
  }));
}
