import { cleanup, fireEvent, render, waitFor } from "@testing-library/vue";
import { afterEach, describe, expect, it, vi } from "vitest";
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
      CodeMirror: "code-mirror",
      Cursor: "cursor",
      ImageBlock: "image-block",
      Latex: "latex",
      LinkTooltip: "link-tooltip",
      ListItem: "list-item",
      Placeholder: "placeholder",
      Table: "table",
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
      "top-bar": false,
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

  it("renders the custom top bar and preserves non-top-bar configuration", async () => {
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
    expect(instance.config.features["top-bar"]).toBe(false);
    expect(instance.config.featureConfigs?.["top-bar"]).toBeUndefined();
    for (
      const [feature, fields] of Object.entries({
        "code-mirror": [
          "expandIcon",
          "searchIcon",
          "clearSearchIcon",
          "copyIcon",
        ],
        "image-block": [
          "inlineImageIcon",
          "inlineConfirmButton",
          "blockImageIcon",
          "blockCaptionIcon",
        ],
        latex: ["inlineEditConfirm"],
        "link-tooltip": [
          "linkIcon",
          "editButton",
          "removeButton",
          "confirmButton",
        ],
        "list-item": [
          "bulletIcon",
          "checkBoxCheckedIcon",
          "checkBoxUncheckedIcon",
        ],
        table: [
          "addRowIcon",
          "addColIcon",
          "deleteRowIcon",
          "deleteColIcon",
          "alignLeftIcon",
          "alignCenterIcon",
          "alignRightIcon",
          "colDragHandleIcon",
          "rowDragHandleIcon",
        ],
      })
    ) {
      for (const field of fields) {
        expect(instance.config.featureConfigs?.[feature]?.[field]).toContain(
          'class="lucide-icon"',
        );
      }
    }
    const previewToggleIcon = instance.config.featureConfigs?.["code-mirror"]
      ?.previewToggleIcon as (previewOnlyMode: boolean) => string;
    expect(previewToggleIcon(true)).toContain('class="lucide-icon"');
    expect(previewToggleIcon(false)).toContain('class="lucide-icon"');
    const toolbar = view.getByRole("toolbar", {
      name: "Markdown formatting",
    });
    expect(view.getByRole("button", { name: "Paragraph" })).toBeTruthy();
    expect(toolbar.querySelectorAll(".editor-top-bar-item")).toHaveLength(19);

    await fireEvent.click(view.getByRole("button", { name: "Browse files" }));
    expect(view.emitted("browseFiles")).toEqual([[]]);
    await fireEvent.click(
      view.getByRole("button", { name: "Copy file path" }),
    );
    expect(view.emitted("copyPath")).toEqual([[]]);
    await fireEvent.click(view.getByRole("button", { name: "Open in Zed" }));
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
