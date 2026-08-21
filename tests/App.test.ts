import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/vue";
import axe from "axe-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../src/App.vue";
import { FakeMessageChannel } from "./fake_message_channel.ts";

const markdownLifecycle = vi.hoisted(() => ({
  mounted: 0,
  unmounted: 0,
}));
const editorWiring = vi.hoisted(() => ({ codeResolvers: [] as unknown[] }));

vi.mock("../src/components/CodeEditor.vue", async () => {
  const { defineComponent, h } = await import("vue");
  return {
    __esModule: true,
    default: defineComponent({
      props: { path: String, content: String, resolveImage: Function },
      emits: ["change"],
      setup(props, { emit }) {
        editorWiring.codeResolvers.push(props.resolveImage);
        return () =>
          h("textarea", {
            "aria-label": `Editing ${props.path}`,
            value: props.content,
            onInput: (event: Event) =>
              emit("change", (event.target as HTMLTextAreaElement).value),
          });
      },
    }),
  };
});

vi.mock("../src/components/MarkdownEditor.vue", async () => {
  const { defineComponent, h, onBeforeUnmount, onMounted } = await import(
    "vue"
  );
  return {
    __esModule: true,
    default: defineComponent({
      props: { path: String, content: String, resolveImage: Function },
      emits: ["change"],
      setup(props, { emit }) {
        onMounted(() => {
          markdownLifecycle.mounted += 1;
          if (props.content?.includes("images/pixel.png")) {
            void props.resolveImage?.("images/pixel.png");
          }
        });
        onBeforeUnmount(() => markdownLifecycle.unmounted += 1);
        return () =>
          h("div", { "data-testid": "milkdown-crepe" }, [
            h("textarea", {
              "aria-label": `Editing ${props.path}`,
              value: props.content,
              onInput: (event: Event) =>
                emit("change", (event.target as HTMLTextAreaElement).value),
            }),
          ]);
      },
    }),
  };
});

beforeEach(() => {
  vi.stubGlobal("MessageChannel", FakeMessageChannel);
  markdownLifecycle.mounted = 0;
  markdownLifecycle.unmounted = 0;
  editorWiring.codeResolvers.length = 0;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("Markd shell", () => {
  it("wires workspace image resolution only to the active Markdown editor", async () => {
    const getMarkdownImageUrl = vi.fn().mockResolvedValue(
      "http://127.0.0.1:49152/notes/images/pixel.png",
    );
    const baseBindings = {
      getAppInfo: vi.fn().mockResolvedValue({
        name: "Markd",
        platform: "darwin",
        arch: "aarch64",
        runtime: "Deno 2.9.0",
      }),
      getWorkspaceState: vi.fn().mockResolvedValue({
        activePath: "/Users/example/Notes",
        recentWorkspaces: ["/Users/example/Notes"],
      }),
      openWorkspaceFile: vi.fn(),
      saveWorkspaceDocument: vi.fn(),
      getMarkdownImageUrl,
      openFolder: vi.fn(),
    };
    vi.stubGlobal("bindings", {
      ...baseBindings,
      getWorkspaceNavigation: vi.fn().mockResolvedValue({
        rootPath: "/Users/example/Notes",
        entries: [],
        activeFile: {
          kind: "markdown",
          path: "notes/readme.md",
          content: "![pixel](images/pixel.png)",
        },
      }),
    });

    render(App);
    await waitFor(() => {
      expect(getMarkdownImageUrl).toHaveBeenCalledWith(
        "notes/readme.md",
        "images/pixel.png",
      );
    });
    expect(editorWiring.codeResolvers).toEqual([]);

    cleanup();
    vi.stubGlobal("bindings", {
      ...baseBindings,
      getWorkspaceNavigation: vi.fn().mockResolvedValue({
        rootPath: "/Users/example/Notes",
        entries: [],
        activeFile: {
          kind: "code",
          path: "src/main.ts",
          content: "export {};",
        },
      }),
    });
    render(App);
    await screen.findByRole("textbox", { name: "Editing src/main.ts" });
    expect(editorWiring.codeResolvers).toEqual([undefined]);
  });

  it("routes only eligible Markdown documents to the Crepe editor", async () => {
    vi.stubGlobal("bindings", {
      getAppInfo: vi.fn().mockResolvedValue({
        name: "Markd",
        platform: "darwin",
        arch: "aarch64",
        runtime: "Deno 2.9.0",
      }),
      getWorkspaceState: vi.fn().mockResolvedValue({
        activePath: "/Users/example/Notes",
        recentWorkspaces: ["/Users/example/Notes"],
      }),
      getWorkspaceNavigation: vi.fn().mockResolvedValue({
        rootPath: "/Users/example/Notes",
        entries: [{
          kind: "file",
          name: "guide.markdown",
          path: "guide.markdown",
        }],
        activeFile: {
          kind: "markdown",
          path: "guide.markdown",
          content: "# Guide",
        },
      }),
      openWorkspaceFile: vi.fn(),
      saveWorkspaceDocument: vi.fn(),
      openFolder: vi.fn(),
    });

    render(App);

    expect(await screen.findByTestId("milkdown-crepe")).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Editing guide.markdown" }))
      .toBeTruthy();
    expect(screen.queryByText(/route is ready for its editor/i)).toBeNull();
    expect(screen.queryByTitle(/Previewing/)).toBeNull();
    expect(screen.queryByRole("heading", { name: "guide.markdown" })).toBeNull();
    expect(screen.queryByText("guide.markdown", { selector: ".document-path" }))
      .toBeNull();
  });

  it("renders no header, footer, or document chrome around an active document", async () => {
    vi.stubGlobal("bindings", {
      getAppInfo: vi.fn().mockResolvedValue({
        name: "Markd",
        platform: "darwin",
        arch: "aarch64",
        runtime: "Deno 2.9.0",
      }),
      getWorkspaceState: vi.fn().mockResolvedValue({
        activePath: "/Users/example/Notes",
        recentWorkspaces: ["/Users/example/Notes"],
      }),
      getWorkspaceNavigation: vi.fn().mockResolvedValue({
        rootPath: "/Users/example/Notes",
        entries: [{ kind: "file", name: "guide.markdown", path: "guide.markdown" }],
        activeFile: {
          kind: "markdown",
          path: "guide.markdown",
          content: "# Guide",
        },
      }),
      openWorkspaceFile: vi.fn(),
      saveWorkspaceDocument: vi.fn(),
      openFolder: vi.fn(),
    });

    render(App);

    expect(await screen.findByTestId("milkdown-crepe")).toBeTruthy();
    expect(screen.queryByRole("banner")).toBeNull();
    expect(screen.queryByRole("contentinfo")).toBeNull();
    expect(document.querySelector(".document-surface")).toBeNull();
  });

  it("keeps the document card with filename, path, and reason for a binary file", async () => {
    vi.stubGlobal("bindings", {
      getAppInfo: vi.fn().mockResolvedValue({
        name: "Markd",
        platform: "darwin",
        arch: "aarch64",
        runtime: "Deno 2.9.0",
      }),
      getWorkspaceState: vi.fn().mockResolvedValue({
        activePath: "/Users/example/Notes",
        recentWorkspaces: ["/Users/example/Notes"],
      }),
      getWorkspaceNavigation: vi.fn().mockResolvedValue({
        rootPath: "/Users/example/Notes",
        entries: [{ kind: "file", name: "photo.png", path: "assets/photo.png" }],
        activeFile: {
          kind: "information",
          path: "assets/photo.png",
          reason: "binary",
        },
      }),
      openWorkspaceFile: vi.fn(),
      openFolder: vi.fn(),
    });

    render(App);

    expect(await screen.findByRole("heading", { name: "photo.png" }))
      .toBeTruthy();
    expect(screen.getByText("assets/photo.png")).toBeTruthy();
    expect(screen.getByText("Binary file")).toBeTruthy();
    expect(screen.queryByRole("banner")).toBeNull();
    expect(screen.queryByRole("contentinfo")).toBeNull();
  });

  it("saves Markdown changes through the shared debounced session and Cmd+S", async () => {
    vi.useFakeTimers();
    const saveWorkspaceDocument = vi.fn().mockResolvedValue({ kind: "saved" });
    vi.stubGlobal("bindings", {
      getAppInfo: vi.fn().mockResolvedValue({
        name: "Markd",
        platform: "darwin",
        arch: "aarch64",
        runtime: "Deno 2.9.0",
      }),
      getWorkspaceState: vi.fn().mockResolvedValue({
        activePath: "/Users/example/Notes",
        recentWorkspaces: ["/Users/example/Notes"],
      }),
      getWorkspaceNavigation: vi.fn().mockResolvedValue({
        rootPath: "/Users/example/Notes",
        entries: [{ kind: "file", name: "note.md", path: "note.md" }],
        activeFile: { kind: "markdown", path: "note.md", content: "# Initial" },
      }),
      openWorkspaceFile: vi.fn(),
      saveWorkspaceDocument,
      openFolder: vi.fn(),
    });

    render(App);
    const editor = await screen.findByRole("textbox", {
      name: "Editing note.md",
    });
    await fireEvent.update(editor, "# Autosaved");
    await vi.advanceTimersByTimeAsync(299);
    expect(saveWorkspaceDocument).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(saveWorkspaceDocument).toHaveBeenCalledWith({
      path: "note.md",
      content: "# Autosaved",
      expectedContent: "# Initial",
      overwrite: false,
    });

    await fireEvent.update(editor, "# Saved now");
    await fireEvent.keyDown(window, { key: "s", metaKey: true });
    expect(saveWorkspaceDocument).toHaveBeenLastCalledWith({
      path: "note.md",
      content: "# Saved now",
      expectedContent: "# Autosaved",
      overwrite: false,
    });
  });

  it("uses the shared external-change conflict lifecycle for Markdown", async () => {
    vi.stubGlobal("bindings", {
      getAppInfo: vi.fn().mockResolvedValue({
        name: "Markd",
        platform: "darwin",
        arch: "aarch64",
        runtime: "Deno 2.9.0",
      }),
      getWorkspaceState: vi.fn().mockResolvedValue({
        activePath: "/Users/example/Notes",
        recentWorkspaces: ["/Users/example/Notes"],
      }),
      getWorkspaceNavigation: vi.fn().mockResolvedValue({
        rootPath: "/Users/example/Notes",
        entries: [{ kind: "file", name: "note.md", path: "note.md" }],
        activeFile: { kind: "markdown", path: "note.md", content: "# Initial" },
      }),
      openWorkspaceFile: vi.fn(),
      saveWorkspaceDocument: vi.fn(),
      openFolder: vi.fn(),
    });

    render(App);
    const editor = await screen.findByRole("textbox", {
      name: "Editing note.md",
    });
    await fireEvent.update(editor, "# Local");
    globalThis.dispatchEvent(
      new CustomEvent("markd-files-change", {
        detail: {
          rootPath: "/Users/example/Notes",
          entries: [{ kind: "file", name: "note.md", path: "note.md" }],
          activeFile: { kind: "markdown", path: "note.md", content: "# Disk" },
        },
      }),
    );

    expect(
      await screen.findByRole("alertdialog", {
        name: "This file changed on disk",
      }),
    ).toBeTruthy();
    expect((editor as HTMLTextAreaElement).value).toBe("# Local");
    await fireEvent.click(
      screen.getByRole("button", { name: "Reload from disk" }),
    );
    expect((editor as HTMLTextAreaElement).value).toBe("# Disk");
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("keeps one Markdown editor mounted while active files change", async () => {
    vi.stubGlobal("bindings", {
      getAppInfo: vi.fn().mockResolvedValue({
        name: "Markd",
        platform: "darwin",
        arch: "aarch64",
        runtime: "Deno 2.9.0",
      }),
      getWorkspaceState: vi.fn().mockResolvedValue({
        activePath: "/Users/example/Notes",
        recentWorkspaces: ["/Users/example/Notes"],
      }),
      getWorkspaceNavigation: vi.fn().mockResolvedValue({
        rootPath: "/Users/example/Notes",
        entries: [],
        activeFile: { kind: "markdown", path: "first.md", content: "# First" },
      }),
      openWorkspaceFile: vi.fn(),
      saveWorkspaceDocument: vi.fn(),
      openFolder: vi.fn(),
    });

    render(App);
    expect(await screen.findByRole("textbox", { name: "Editing first.md" }))
      .toBeTruthy();
    expect(markdownLifecycle).toEqual({ mounted: 1, unmounted: 0 });

    globalThis.dispatchEvent(
      new CustomEvent("markd-files-change", {
        detail: {
          rootPath: "/Users/example/Notes",
          entries: [],
          activeFile: {
            kind: "markdown",
            path: "second.md",
            content: "# Second",
          },
        },
      }),
    );
    expect(await screen.findByRole("textbox", { name: "Editing second.md" }))
      .toBeTruthy();
    expect(markdownLifecycle).toEqual({ mounted: 2, unmounted: 1 });

    globalThis.dispatchEvent(
      new CustomEvent("markd-files-change", {
        detail: {
          rootPath: "/Users/example/Notes",
          entries: [],
          activeFile: {
            kind: "code",
            path: "app.ts",
            content: "const value = 1;",
          },
        },
      }),
    );
    expect(await screen.findByRole("textbox", { name: "Editing app.ts" }))
      .toBeTruthy();
    expect(markdownLifecycle).toEqual({ mounted: 2, unmounted: 2 });
    expect(screen.queryByTestId("milkdown-crepe")).toBeNull();

    globalThis.dispatchEvent(
      new CustomEvent("markd-files-change", {
        detail: {
          rootPath: "/Users/example/Notes",
          entries: [],
          activeFile: { kind: "markdown", path: "third.md", content: "# Third" },
        },
      }),
    );
    expect(await screen.findByRole("textbox", { name: "Editing third.md" }))
      .toBeTruthy();
    expect(markdownLifecycle).toEqual({ mounted: 3, unmounted: 2 });
    expect(screen.queryByRole("textbox", { name: "Editing app.ts" })).toBeNull();
  });

  it("replaces the Markdown editor when another workspace has the same relative path", async () => {
    const getWorkspaceNavigation = vi.fn()
      .mockResolvedValueOnce({
        rootPath: "/Users/example/First",
        entries: [{ kind: "file", name: "README.md", path: "README.md" }],
        activeFile: {
          kind: "markdown",
          path: "README.md",
          content: "# First workspace",
        },
      })
      .mockResolvedValueOnce({
        rootPath: "/Users/example/Second",
        entries: [{ kind: "file", name: "README.md", path: "README.md" }],
        activeFile: {
          kind: "markdown",
          path: "README.md",
          content: "# Second workspace",
        },
      });
    vi.stubGlobal("bindings", {
      getAppInfo: vi.fn().mockResolvedValue({
        name: "Markd",
        platform: "darwin",
        arch: "aarch64",
        runtime: "Deno 2.9.0",
      }),
      getWorkspaceState: vi.fn().mockResolvedValue({
        activePath: "/Users/example/First",
        recentWorkspaces: ["/Users/example/First"],
      }),
      getWorkspaceNavigation,
      openWorkspaceFile: vi.fn(),
      saveWorkspaceDocument: vi.fn(),
      openFolder: vi.fn(),
    });

    render(App);
    const firstEditor = await screen.findByRole("textbox", {
      name: "Editing README.md",
    });
    expect((firstEditor as HTMLTextAreaElement).value).toBe(
      "# First workspace",
    );
    expect(markdownLifecycle).toEqual({ mounted: 1, unmounted: 0 });

    globalThis.dispatchEvent(
      new CustomEvent("markd-workspace-change", {
        detail: {
          activePath: "/Users/example/Second",
          recentWorkspaces: ["/Users/example/First", "/Users/example/Second"],
        },
      }),
    );

    await waitFor(() => {
      const editor = screen.getByRole("textbox", { name: "Editing README.md" });
      expect((editor as HTMLTextAreaElement).value).toBe("# Second workspace");
    });
    expect(markdownLifecycle).toEqual({ mounted: 2, unmounted: 1 });
    expect(screen.getAllByTestId("milkdown-crepe")).toHaveLength(1);
  });

  it("pauses failed Markdown autosave until Retry saves the latest serialization", async () => {
    vi.useFakeTimers();
    const saveWorkspaceDocument = vi.fn()
      .mockRejectedValueOnce(new Error("disk full"))
      .mockResolvedValue({ kind: "saved" });
    vi.stubGlobal("bindings", {
      getAppInfo: vi.fn().mockResolvedValue({
        name: "Markd",
        platform: "darwin",
        arch: "aarch64",
        runtime: "Deno 2.9.0",
      }),
      getWorkspaceState: vi.fn().mockResolvedValue({
        activePath: "/Users/example/Notes",
        recentWorkspaces: ["/Users/example/Notes"],
      }),
      getWorkspaceNavigation: vi.fn().mockResolvedValue({
        rootPath: "/Users/example/Notes",
        entries: [],
        activeFile: { kind: "markdown", path: "note.md", content: "# Initial" },
      }),
      openWorkspaceFile: vi.fn(),
      saveWorkspaceDocument,
      openFolder: vi.fn(),
    });

    render(App);
    const editor = await screen.findByRole("textbox", {
      name: "Editing note.md",
    });
    await fireEvent.update(editor, "# Failed");
    await vi.advanceTimersByTimeAsync(300);
    expect(screen.getByRole("alert")).toBeTruthy();
    await fireEvent.update(editor, "# Latest");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(saveWorkspaceDocument).toHaveBeenCalledOnce();

    await fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(saveWorkspaceDocument).toHaveBeenLastCalledWith({
      path: "note.md",
      content: "# Latest",
      expectedContent: "# Initial",
      overwrite: false,
    });
  });

  it("shows eligible HTML as the only full active view", async () => {
    vi.stubGlobal("bindings", {
      getAppInfo: vi.fn().mockResolvedValue({
        name: "Markd",
        platform: "darwin",
        arch: "aarch64",
        runtime: "Deno 2.9.0",
      }),
      getWorkspaceState: vi.fn().mockResolvedValue({
        activePath: "/Users/example/Site",
        recentWorkspaces: ["/Users/example/Site"],
      }),
      getWorkspaceNavigation: vi.fn().mockResolvedValue({
        rootPath: "/Users/example/Site",
        entries: [{ kind: "file", name: "index.html", path: "index.html" }],
        activeFile: {
          kind: "html",
          path: "index.html",
          content: "<!doctype html>",
        },
      }),
      getHtmlPreviewUrl: vi.fn().mockResolvedValue(
        {
          url: "http://127.0.0.1:49152/index.html",
          runtimeToken: "runtime-token",
        },
      ),
      openExternalUrl: vi.fn(),
      openWorkspaceFile: vi.fn(),
      openFolder: vi.fn(),
    });

    render(App);

    expect(await screen.findByTitle("Previewing index.html")).toBeTruthy();
    expect(screen.queryByRole("banner")).toBeNull();
    expect(screen.queryByRole("contentinfo")).toBeNull();
    expect(screen.queryByText("HTML preview")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("fully reloads active HTML after an external workspace change", async () => {
    const activeFile = {
      kind: "html" as const,
      path: "index.html",
      content: "<!doctype html><title>Initial</title>",
    };
    vi.stubGlobal("bindings", {
      getAppInfo: vi.fn().mockResolvedValue({
        name: "Markd",
        platform: "darwin",
        arch: "aarch64",
        runtime: "Deno 2.9.0",
      }),
      getWorkspaceState: vi.fn().mockResolvedValue({
        activePath: "/Users/example/Site",
        recentWorkspaces: ["/Users/example/Site"],
      }),
      getWorkspaceNavigation: vi.fn().mockResolvedValue({
        rootPath: "/Users/example/Site",
        entries: [{ kind: "file", name: "index.html", path: "index.html" }],
        activeFile,
      }),
      getHtmlPreviewUrl: vi.fn().mockResolvedValue(
        {
          url: "http://127.0.0.1:49152/index.html",
          runtimeToken: "runtime-token",
        },
      ),
      openExternalUrl: vi.fn(),
      openWorkspaceFile: vi.fn(),
      openFolder: vi.fn(),
    });

    render(App);
    const firstFrame = await screen.findByTitle("Previewing index.html");
    globalThis.dispatchEvent(
      new CustomEvent("markd-files-change", {
        detail: {
          rootPath: "/Users/example/Site",
          entries: [{ kind: "file", name: "index.html", path: "index.html" }],
          activeFile: {
            ...activeFile,
            content: "<!doctype html><title>Changed</title>",
          },
        },
      }),
    );

    await waitFor(() => {
      expect(screen.getByTitle("Previewing index.html")).not.toBe(firstFrame);
    });
    expect(
      screen.getByTitle("Previewing index.html").getAttribute("src"),
    ).toBe("http://127.0.0.1:49152/index.html");
  });

  it("renders no page header or footer around the welcome region and moves initial focus to the primary action", async () => {
    const openFolder = vi.fn().mockResolvedValue({
      activePath: "/Users/example/Notes",
      recentWorkspaces: ["/Users/example/Notes"],
      opened: true,
    });
    vi.stubGlobal("bindings", {
      getAppInfo: vi.fn().mockResolvedValue({
        name: "Markd",
        platform: "darwin",
        arch: "aarch64",
        runtime: "Deno 2.9.0",
      }),
      getWorkspaceState: vi.fn().mockResolvedValue({
        activePath: null,
        recentWorkspaces: [],
      }),
      getWorkspaceNavigation: vi.fn().mockResolvedValue({
        rootPath: "/Users/example/Notes",
        entries: [],
        activeFile: null,
      }),
      openWorkspaceFile: vi.fn(),
      openFolder,
    });

    render(App);

    expect(screen.queryByRole("banner")).toBeNull();
    expect(screen.queryByRole("contentinfo")).toBeNull();
    expect(screen.getByRole("main", { name: "Welcome to Markd" })).toBeTruthy();
    expect(screen.getByRole("status")).toBeTruthy();

    const action = screen.getByRole("button", { name: "Open a workspace" });
    await waitFor(() => expect(document.activeElement).toBe(action));
    await fireEvent.click(action);
    await waitFor(() => expect(screen.getByText("Notes")).toBeTruthy());
    expect(openFolder).toHaveBeenCalledOnce();
  });

  it("has no detectable accessibility violations", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    vi.stubGlobal("bindings", {
      getAppInfo: vi.fn().mockResolvedValue({
        name: "Markd",
        platform: "darwin",
        arch: "aarch64",
        runtime: "Deno 2.9.0",
      }),
      getWorkspaceState: vi.fn().mockResolvedValue({
        activePath: null,
        recentWorkspaces: [],
      }),
      getWorkspaceNavigation: vi.fn(),
      openWorkspaceFile: vi.fn(),
      openFolder: vi.fn(),
    });

    const { container } = render(App);
    const results = await axe.run(container);
    expect(results.violations).toEqual([]);
  });

  it("shows the save failure toast and Retry saves the latest editor buffer", async () => {
    vi.useFakeTimers();
    const saveWorkspaceDocument = vi.fn()
      .mockRejectedValueOnce(new Error("disk full"))
      .mockResolvedValue({ kind: "saved" });
    vi.stubGlobal("bindings", {
      getAppInfo: vi.fn().mockResolvedValue({
        name: "Markd",
        platform: "darwin",
        arch: "aarch64",
        runtime: "Deno 2.9.0",
      }),
      getWorkspaceState: vi.fn().mockResolvedValue({
        activePath: "/Users/example/Notes",
        recentWorkspaces: ["/Users/example/Notes"],
      }),
      getWorkspaceNavigation: vi.fn().mockResolvedValue({
        rootPath: "/Users/example/Notes",
        entries: [{ kind: "file", name: "app.ts", path: "app.ts" }],
        activeFile: { kind: "code", path: "app.ts", content: "initial" },
      }),
      openWorkspaceFile: vi.fn(),
      saveWorkspaceDocument,
      openFolder: vi.fn(),
    });

    render(App);
    const editor = await screen.findByRole("textbox", {
      name: "Editing app.ts",
    });
    await fireEvent.update(editor, "failed");
    await vi.advanceTimersByTimeAsync(300);
    expect(screen.getByRole("alert")).toBeTruthy();

    await fireEvent.update(editor, "latest");
    await vi.advanceTimersByTimeAsync(9_000);
    expect(saveWorkspaceDocument).toHaveBeenCalledOnce();
    await fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(saveWorkspaceDocument).toHaveBeenCalledTimes(2));
    expect(saveWorkspaceDocument).toHaveBeenLastCalledWith({
      path: "app.ts",
      content: "latest",
      expectedContent: "initial",
      overwrite: false,
    });
  });

  it("preserves a dirty editor when external route invalidation cannot hand off", async () => {
    const saveWorkspaceDocument = vi.fn().mockRejectedValue(
      new Error("file unavailable"),
    );
    vi.stubGlobal("bindings", {
      getAppInfo: vi.fn().mockResolvedValue({
        name: "Markd",
        platform: "darwin",
        arch: "aarch64",
        runtime: "Deno 2.9.0",
      }),
      getWorkspaceState: vi.fn().mockResolvedValue({
        activePath: "/Users/example/Notes",
        recentWorkspaces: ["/Users/example/Notes"],
      }),
      getWorkspaceNavigation: vi.fn().mockResolvedValue({
        rootPath: "/Users/example/Notes",
        entries: [{ kind: "file", name: "app.ts", path: "app.ts" }],
        activeFile: { kind: "code", path: "app.ts", content: "initial" },
      }),
      openWorkspaceFile: vi.fn(),
      saveWorkspaceDocument,
      openFolder: vi.fn(),
    });

    render(App);
    const editor = await screen.findByRole("textbox", {
      name: "Editing app.ts",
    });
    await fireEvent.update(editor, "unsaved local buffer");
    globalThis.dispatchEvent(
      new CustomEvent("markd-files-change", {
        detail: {
          rootPath: "/Users/example/Notes",
          entries: [],
          activeFile: null,
        },
      }),
    );

    await waitFor(() => expect(saveWorkspaceDocument).toHaveBeenCalledOnce());
    expect(
      (screen.getByRole("textbox", {
        name: "Editing app.ts",
      }) as HTMLTextAreaElement).value,
    ).toBe("unsaved local buffer");
    expect(screen.queryByRole("main", { name: "Welcome to Markd" })).toBeNull();
  });

  it("keeps a conflicting external change behind an explicit reload decision", async () => {
    vi.stubGlobal("bindings", {
      getAppInfo: vi.fn().mockResolvedValue({
        name: "Markd",
        platform: "darwin",
        arch: "aarch64",
        runtime: "Deno 2.9.0",
      }),
      getWorkspaceState: vi.fn().mockResolvedValue({
        activePath: "/Users/example/Notes",
        recentWorkspaces: ["/Users/example/Notes"],
      }),
      getWorkspaceNavigation: vi.fn().mockResolvedValue({
        rootPath: "/Users/example/Notes",
        entries: [{ kind: "file", name: "app.ts", path: "app.ts" }],
        activeFile: { kind: "code", path: "app.ts", content: "initial" },
      }),
      openWorkspaceFile: vi.fn(),
      saveWorkspaceDocument: vi.fn(),
      openFolder: vi.fn(),
    });

    render(App);
    const editor = await screen.findByRole("textbox", {
      name: "Editing app.ts",
    });
    await fireEvent.update(editor, "local buffer");
    globalThis.dispatchEvent(
      new CustomEvent("markd-files-change", {
        detail: {
          rootPath: "/Users/example/Notes",
          entries: [{ kind: "file", name: "app.ts", path: "app.ts" }],
          activeFile: {
            kind: "code",
            path: "app.ts",
            content: "external buffer",
          },
        },
      }),
    );

    expect(
      await screen.findByRole("alertdialog", {
        name: "This file changed on disk",
      }),
    ).toBeTruthy();
    expect(
      (screen.getByRole("textbox", {
        name: "Editing app.ts",
      }) as HTMLTextAreaElement).value,
    ).toBe("local buffer");

    await fireEvent.click(screen.getByRole("button", {
      name: "Reload from disk",
    }));
    expect(
      (screen.getByRole("textbox", {
        name: "Editing app.ts",
      }) as HTMLTextAreaElement).value,
    ).toBe("external buffer");
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("saves the latest complete buffer immediately with Cmd+S", async () => {
    vi.useFakeTimers();
    const saveWorkspaceDocument = vi.fn().mockResolvedValue({ kind: "saved" });
    vi.stubGlobal("bindings", {
      getAppInfo: vi.fn().mockResolvedValue({
        name: "Markd",
        platform: "darwin",
        arch: "aarch64",
        runtime: "Deno 2.9.0",
      }),
      getWorkspaceState: vi.fn().mockResolvedValue({
        activePath: "/Users/example/Notes",
        recentWorkspaces: ["/Users/example/Notes"],
      }),
      getWorkspaceNavigation: vi.fn().mockResolvedValue({
        rootPath: "/Users/example/Notes",
        entries: [{ kind: "file", name: "app.ts", path: "app.ts" }],
        activeFile: { kind: "code", path: "app.ts", content: "initial" },
      }),
      openWorkspaceFile: vi.fn(),
      saveWorkspaceDocument,
      openFolder: vi.fn(),
    });

    render(App);
    const editor = await screen.findByRole("textbox", {
      name: "Editing app.ts",
    });
    await fireEvent.update(editor, "first change");
    await fireEvent.update(editor, "latest complete buffer");
    await fireEvent.keyDown(window, { key: "s", metaKey: true });

    expect(saveWorkspaceDocument).toHaveBeenCalledOnce();
    expect(saveWorkspaceDocument).toHaveBeenCalledWith({
      path: "app.ts",
      content: "latest complete buffer",
      expectedContent: "initial",
      overwrite: false,
    });
    await vi.advanceTimersByTimeAsync(300);
    expect(saveWorkspaceDocument).toHaveBeenCalledOnce();
  });
});
