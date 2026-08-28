import { cleanup, render, waitFor } from "@testing-library/vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import { commandsCtx } from "@milkdown/kit/core";
import {
  liftListItemCommand,
  sinkListItemCommand,
} from "@milkdown/kit/preset/commonmark";
import MarkdownEditor from "../src/components/MarkdownEditor.vue";

interface MockCrepeInstance {
  config: {
    defaultValue: string;
    featureConfigs?: Record<string, Record<string, unknown>>;
    features: Record<string, boolean>;
    root: HTMLElement;
  };
  create: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
  addFeature: ReturnType<typeof vi.fn>;
  editor: { action: ReturnType<typeof vi.fn> };
  getMarkdown: ReturnType<typeof vi.fn>;
  markdownUpdated?: (
    context: unknown,
    markdown: string,
    previous: string,
  ) => void;
}

const crepeState = vi.hoisted(() => ({
  instances: [] as MockCrepeInstance[],
  replacements: [] as string[],
}));

vi.mock("@milkdown/kit/utils", async (importOriginal) => ({
  ...await importOriginal<typeof import("@milkdown/kit/utils")>(),
  replaceAll: (markdown: string) => {
    crepeState.replacements.push(markdown);
    return { markdown };
  },
}));

vi.mock("@milkdown/crepe", () => {
  class Crepe {
    static Feature = {
      AI: "ai",
      BlockEdit: "block-edit",
      Cursor: "cursor",
      ImageBlock: "image-block",
      LinkTooltip: "link-tooltip",
      Placeholder: "placeholder",
      Toolbar: "toolbar",
      TopBar: "top-bar",
    };

    config: MockCrepeInstance["config"];
    create = vi.fn().mockResolvedValue(undefined);
    destroy = vi.fn().mockResolvedValue(undefined);
    addFeature = vi.fn();
    editor = { action: vi.fn() };
    getMarkdown = vi.fn(() => this.config.defaultValue);
    markdownUpdated?: MockCrepeInstance["markdownUpdated"];

    constructor(config: MockCrepeInstance["config"]) {
      this.config = config;
      crepeState.instances.push(this);
    }

    on(
      register: (listener: {
        markdownUpdated(
          callback: NonNullable<MockCrepeInstance["markdownUpdated"]>,
        ): void;
      }) => void,
    ): this {
      register({
        markdownUpdated: (callback) => {
          this.markdownUpdated = callback;
        },
      });
      return this;
    }
  }

  return { Crepe };
});

afterEach(() => {
  cleanup();
  crepeState.instances.length = 0;
  crepeState.replacements.length = 0;
});

describe("MarkdownEditor", () => {
  it("loads representative Markdown and emits Crepe's complete serialization", async () => {
    const markdown = [
      "# Heading",
      "",
      "Paragraph with **bold**, *emphasis*, and [a link](https://example.com).",
      "",
      "- list item",
      "- [x] completed task",
      "",
      "> quoted text",
      "",
      "```ts",
      "const answer = 42;",
      "```",
      "",
      "| Name | Value |",
      "| --- | ---: |",
      "| answer | 42 |",
      "",
      "![Alt text](images/example.png)",
    ].join("\n");
    const serialized = markdown.replace("answer = 42", "answer = 43");

    const view = render(MarkdownEditor, {
      props: {
        path: "notes/example.markdown",
        content: markdown,
        resolveImage: (path: string) =>
          Promise.resolve(`http://127.0.0.1:49152/${path}`),
      },
    });

    await waitFor(() => expect(crepeState.instances).toHaveLength(1));
    const instance = crepeState.instances[0]!;
    expect(instance.config.defaultValue).toBe(markdown);
    expect(instance.config.features).toMatchObject({
      ai: false,
      "block-edit": false,
      "image-block": true,
      "link-tooltip": true,
      placeholder: false,
      toolbar: false,
      "top-bar": true,
    });
    const imageConfig = instance.config.featureConfigs?.["image-block"];
    expect(instance.config.featureConfigs?.cursor).toMatchObject({
      virtual: false,
    });
    expect(
      await (imageConfig?.proxyDomURL as (path: string) => Promise<string>)(
        "images/example.png",
      ),
    ).toBe("http://127.0.0.1:49152/images/example.png");
    await expect(
      (imageConfig?.blockOnUpload as (file: File) => Promise<string>)(
        new File([], "ephemeral.png"),
      ),
    ).rejects.toThrow("File upload is unavailable");
    instance.markdownUpdated?.(
      {},
      "![1.00](blob:http://127.0.0.1/ephemeral)",
      markdown,
    );
    expect(view.emitted("change")).toBeUndefined();
    instance.markdownUpdated?.({}, serialized, markdown);
    expect(view.emitted("change")).toEqual([[serialized]]);
  });

  it("configures the extended top bar via buildTopBar", async () => {
    const view = render(MarkdownEditor, {
      props: { path: "notes/topbar.md", content: "# Heading" },
    });
    await waitFor(() => expect(crepeState.instances).toHaveLength(1));
    const instance = crepeState.instances[0]!;
    const editor = view.container.querySelector<HTMLElement>(
      ".markdown-editor",
    )!;
    expect(editor.style.getPropertyValue("--details-chevron-right")).toContain(
      encodeURIComponent('d="m9 18 6-6-6-6"'),
    );
    expect(editor.style.getPropertyValue("--details-chevron-down")).toContain(
      encodeURIComponent('d="m6 9 6 6 6-6"'),
    );
    type Item = {
      icon: string;
      active: () => boolean;
      onRun: (ctx: unknown) => void;
    };
    type GroupInstance = {
      group: { items: { key: string }[] };
      addItem: (key: string, item: Item) => GroupInstance;
    };
    const topBarConfig = instance.config.featureConfigs?.["top-bar"];
    expect(topBarConfig?.codeBlockIcon).toContain(
      'class="outline-icon lucide lucide-square-terminal-icon lucide-square-terminal"',
    );
    expect(topBarConfig?.codeBlockIcon).toContain('d="m7 11 2-2-2-2"');
    const buildTopBar = topBarConfig?.buildTopBar as (builder: {
      getGroup: (key: string) => GroupInstance;
      addGroup: (key: string, label: string) => GroupInstance;
    }) => void;
    expect(buildTopBar).toBeInstanceOf(Function);

    const addedGroups: { key: string; label: string }[] = [];
    const added: Record<string, { key: string; item: Item }[]> = {};
    const groupInstance = (
      name: string,
      items: { key: string }[],
    ): GroupInstance => {
      added[name] = [];
      const group = { items };
      const self: GroupInstance = {
        group,
        addItem: (key, item) => {
          added[name]!.push({ key, item });
          return self;
        },
      };
      return self;
    };
    const blockGroup = groupInstance("block", [
      { key: "code-block" },
      { key: "math" },
    ]);
    const listGroup = groupInstance("list", [
      { key: "bullet-list" },
      { key: "ordered-list" },
    ]);
    buildTopBar({
      getGroup: (key) => (key === "block" ? blockGroup : listGroup),
      addGroup: (key, label) => {
        addedGroups.push({ key, label });
        return groupInstance(key, []);
      },
    });

    expect(blockGroup.group.items.map((item) => item.key)).toEqual([
      "code-block",
    ]);
    expect(listGroup.group.items.map((item) => item.key)).toEqual([
      "bullet-list",
      "ordered-list",
    ]);
    expect(added["list"]!.map(({ key }) => key)).toEqual([
      "indent",
      "outdent",
    ]);
    expect(added["block"]!.map(({ key }) => key)).toEqual(["details"]);
    expect(added["block"]![0]!.item.icon).toContain(
      'class="outline-icon lucide lucide-list-collapse-icon lucide-list-collapse"',
    );
    expect(added["block"]![0]!.item.icon).toContain('d="M10 5h11"');
    expect(added["block"]![0]!.item.active()).toBe(false);
    const call = vi.fn();
    const ctx = {
      get: (key: unknown) => {
        expect(key).toBe(commandsCtx);
        return { call };
      },
    };
    const [indent, outdent] = added["list"]!;
    for (const { item } of [indent!, outdent!]) {
      expect(item.icon).toContain("<svg");
      expect(item.active()).toBe(false);
    }
    indent!.item.onRun(ctx);
    expect(call).toHaveBeenLastCalledWith(sinkListItemCommand.key);
    outdent!.item.onRun(ctx);
    expect(call).toHaveBeenLastCalledWith(liftListItemCommand.key);
    expect(addedGroups).toEqual([{ key: "document", label: "Document" }]);
    expect(added["document"]).toHaveLength(3);
    const [browseFiles, copyPath, openInZed] = added["document"]!;
    expect(browseFiles!.key).toBe("browse-files");
    expect(browseFiles!.item.icon).toContain("<svg");
    expect(browseFiles!.item.active()).toBe(false);
    browseFiles!.item.onRun(undefined);
    expect(view.emitted("browseFiles")).toEqual([[]]);
    expect(copyPath!.key).toBe("copy-path");
    expect(copyPath!.item.icon).toContain("<svg");
    expect(copyPath!.item.active()).toBe(false);
    copyPath!.item.onRun(undefined);
    expect(view.emitted("copyPath")).toEqual([[]]);
    expect(openInZed!.key).toBe("open-in-zed");
    expect(openInZed!.item.icon).toContain("<svg");
    expect(openInZed!.item.active()).toBe(false);
    openInZed!.item.onRun(undefined);
    expect(view.emitted("openInZed")).toEqual([[]]);
  });

  it("replaces external content without emitting an edit and destroys each instance once", async () => {
    const first = render(MarkdownEditor, {
      props: { path: "first.md", content: "# First" },
    });
    await waitFor(() => expect(crepeState.instances).toHaveLength(1));
    const firstInstance = crepeState.instances[0]!;

    await first.rerender({ path: "first.md", content: "# Changed on disk" });
    expect(crepeState.replacements).toEqual(["# Changed on disk"]);
    expect(firstInstance.editor.action).toHaveBeenCalledWith({
      markdown: "# Changed on disk",
    });
    expect(first.emitted("change")).toBeUndefined();

    first.unmount();
    expect(firstInstance.destroy).toHaveBeenCalledOnce();

    const second = render(MarkdownEditor, {
      props: { path: "second.md", content: "# Second" },
    });
    await waitFor(() => expect(crepeState.instances).toHaveLength(2));
    second.unmount();
    expect(crepeState.instances[1]!.destroy).toHaveBeenCalledOnce();
  });
});
