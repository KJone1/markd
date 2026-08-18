import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/vue";
import { Crepe } from "@milkdown/crepe";
import axe from "axe-core";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import MarkdownEditor from "../src/components/MarkdownEditor.vue";
import { frontmatterFeature } from "../src/editor/frontmatter.ts";

const representativeMarkdown = [
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
  '![1.00](images/example.png "Alt text")',
].join("\n");

beforeAll(() => {
  class Observer {
    disconnect(): void {}
    observe(): void {}
    unobserve(): void {}
  }
  vi.stubGlobal("IntersectionObserver", Observer);
  vi.stubGlobal("ResizeObserver", Observer);
});

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
});

describe("Markdown round trips", () => {
  it("names the visual editing surface and has no detectable accessibility violations", async () => {
    const view = render(MarkdownEditor, {
      props: { path: "notes/accessible.md", content: "# Accessible" },
    });

    expect(
      await screen.findByRole("textbox", {
        name: "Editing notes/accessible.md",
      }),
    ).toBeTruthy();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    const results = await axe.run(view.container);
    expect(results.violations).toEqual([]);
  });

  it("makes rendered image controls named, focusable, and keyboard operable", async () => {
    const view = render(MarkdownEditor, {
      props: {
        path: "notes/image-controls.md",
        content: '![1.00](images/example.png "Image caption")',
      },
    });
    const editor = await screen.findByRole("textbox", {
      name: "Editing notes/image-controls.md",
    });
    const captionToggle = await screen.findByRole("button", {
      name: "Toggle image caption",
    });
    const resizeHandle = await screen.findByRole("slider", {
      name: "Resize image",
    });

    expect(captionToggle.getAttribute("tabindex")).toBe("0");
    expect(resizeHandle.getAttribute("tabindex")).toBe("0");
    expect(resizeHandle.getAttribute("aria-orientation")).toBe("vertical");

    await fireEvent.keyDown(captionToggle, { key: "Enter" });
    await waitFor(() => {
      expect(editor.querySelector(".caption-input")).toBeNull();
    });
    await fireEvent.keyDown(captionToggle, { key: " " });
    await waitFor(() => {
      expect(editor.querySelector(".caption-input")).toBeTruthy();
    });

    const image = editor.querySelector<HTMLImageElement>(
      'img[data-type="image-block"]',
    )!;
    image.dataset.origin = "100";
    image.dataset.height = "100";
    image.style.height = "100px";
    await fireEvent.keyDown(resizeHandle, { key: "ArrowUp" });
    await waitFor(() => {
      const markdown = view.emitted<string[]>("change").at(-1)![0]!;
      expect(markdown).toContain(
        '![1.10](images/example.png "Image caption")',
      );
    });

    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    const results = await axe.run(view.container);
    expect(results.violations).toEqual([]);
  });

  it("retains URL editing without exposing or saving ephemeral uploads", async () => {
    const view = render(MarkdownEditor, {
      props: {
        path: "notes/new-image.md",
        content: "![1.00]()",
      },
    });
    await screen.findByRole("textbox", {
      name: "Editing notes/new-image.md",
    });
    const imageUrl = await screen.findByRole("textbox", {
      name: "Image URL",
    });
    expect(screen.queryByRole("button", { name: "Upload image" })).toBeNull();
    expect(view.container.querySelector('.image-edit input[type="file"]'))
      .toBeNull();

    await fireEvent.update(imageUrl, "blob:http://127.0.0.1/ephemeral");
    const unsafeConfirm = await screen.findByRole("button", {
      name: "Confirm image",
    });
    await fireEvent.keyDown(imageUrl, { key: "Enter" });
    await fireEvent.click(unsafeConfirm);
    expect(view.emitted("change")).toBeUndefined();

    await fireEvent.update(imageUrl, "images/keyboard.png");
    const confirm = await screen.findByRole("button", {
      name: "Confirm image",
    });
    expect(confirm.getAttribute("tabindex")).toBe("0");
    await fireEvent.keyDown(confirm, { key: " " });
    await waitFor(() => {
      const markdown = view.emitted<string[]>("change").at(-1)![0]!;
      expect(markdown).toContain("images/keyboard.png");
    });

    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    const results = await axe.run(view.container);
    expect(results.violations).toEqual([]);
  });

  it("removes the unsupported uploader from inline images", async () => {
    const view = render(MarkdownEditor, {
      props: {
        path: "notes/inline-image.md",
        content: "Before ![pixel]() after",
      },
    });
    await screen.findByRole("textbox", {
      name: "Editing notes/inline-image.md",
    });
    await waitFor(() => {
      expect(view.container.querySelector(".uploader")).toBeNull();
      expect(view.container.querySelector('input[type="file"]')).toBeNull();
    });
  });

  it("joins an inline code span that wraps across source lines", async () => {
    const view = render(MarkdownEditor, {
      props: {
        path: "notes/wrapped-code.md",
        content: [
          "Cruft is a fixed list: `Add action items to close",
          "the loop on open questions or concerns.`, and a trailing note.",
          "",
        ].join("\n"),
      },
    });
    const editor = await screen.findByRole("textbox", {
      name: "Editing notes/wrapped-code.md",
    });
    const span = await waitFor(() => {
      const found = [...editor.querySelectorAll("code")].find((item) =>
        item.textContent?.startsWith("Add action items")
      );
      expect(found).toBeTruthy();
      return found!;
    });
    expect(span.textContent).toBe(
      "Add action items to close the loop on open questions or concerns.",
    );
    expect(editor.querySelectorAll("code")).toHaveLength(1);
    expect(span.closest("p")?.querySelector("br")).toBeNull();

    const paragraph = span.closest("p")!;
    paragraph.append(" edited");
    await fireEvent.input(editor);
    await waitFor(() => {
      const markdown = view.emitted<string[]>("change").at(-1)![0]!;
      expect(markdown).toContain(
        "`Add action items to close the loop on open questions or concerns.`",
      );
    });
  });

  it("serializes visual document, link, and image edits through Crepe", async () => {
    const resolveImage = vi.fn((path: string) =>
      Promise.resolve(`http://127.0.0.1:49152/workspace/${path}`)
    );
    const view = render(MarkdownEditor, {
      props: {
        path: "notes/visual.md",
        content: representativeMarkdown,
        resolveImage,
      },
    });
    const editor = await screen.findByRole("textbox", {
      name: "Editing notes/visual.md",
    });
    const heading = editor.querySelector("h1");
    const link = editor.querySelector<HTMLAnchorElement>("a");
    const image = editor.querySelector<HTMLImageElement>(
      'img[data-type="image-block"]',
    );
    expect(heading?.textContent).toBe("Heading");
    expect(link?.textContent).toBe("a link");
    expect(link?.getAttribute("href")).toBe("https://example.com");
    await waitFor(() => {
      expect(image?.getAttribute("src")).toBe(
        "http://127.0.0.1:49152/workspace/images/example.png",
      );
    });
    expect(resolveImage).toHaveBeenCalledWith("images/example.png");
    expect(editor.querySelector("strong")?.textContent).toBe("bold");
    expect(editor.querySelector("em")?.textContent).toBe("emphasis");
    expect(editor.querySelectorAll(".milkdown-list-item-block")).toHaveLength(
      2,
    );
    expect(editor.querySelector(".checked")).toBeTruthy();
    expect(editor.querySelector("blockquote")?.textContent).toContain(
      "quoted text",
    );
    expect(editor.querySelector("pre")?.textContent).toContain(
      "const answer = 42;",
    );
    expect(editor.querySelector(".milkdown-table-block")).toBeTruthy();

    heading!.textContent = "Revised heading";
    await fireEvent.input(editor);

    await waitFor(() => {
      const changes = view.emitted<string[]>("change");
      expect(changes.length).toBeGreaterThan(0);
      const markdown = changes.at(-1)![0]!;
      expect(markdown).toContain("# Revised heading");
      expect(markdown).toContain("[a link](https://example.com)");
      expect(markdown).toContain("images/example.png");
      expect(markdown).toContain("Alt text");
    });

    link!.textContent = "updated link";
    await fireEvent.input(editor);
    await waitFor(() => {
      const markdown = view.emitted<string[]>("change").at(-1)![0]!;
      expect(markdown).toContain(
        "[updated link](https://example.com)",
      );
      expect(markdown).toContain("images/example.png");
    });

    const caption = editor.querySelector<HTMLInputElement>(".caption-input");
    expect(caption?.value).toBe("Alt text");
    await fireEvent.update(caption!, "Updated image caption");
    await fireEvent.blur(caption!);
    await waitFor(() => {
      const markdown = view.emitted<string[]>("change").at(-1)![0]!;
      expect(markdown).toContain(
        '![1.00](images/example.png "Updated image caption")',
      );
      expect(markdown).toContain(
        "[updated link](https://example.com)",
      );
      expect(markdown).toContain("**bold**");
      expect(markdown).toContain("*emphasis*");
      expect(markdown).toMatch(/[*-] list item/);
      expect(markdown).toMatch(/[*-] \[x\] completed task/);
      expect(markdown).toContain("> quoted text");
      expect(markdown).toContain("```ts");
      expect(markdown).toContain("| Name");
    });
  });
});

describe("Top bar", () => {
  it("shows a persistent, fully-named formatting bar and hides the block hover handle", async () => {
    const view = render(MarkdownEditor, {
      props: { path: "notes/topbar.md", content: "Plain paragraph" },
    });
    await screen.findByRole("textbox", { name: "Editing notes/topbar.md" });

    expect(view.container.querySelector(".milkdown-top-bar")).toBeTruthy();
    expect(await screen.findByRole("button", { name: "Paragraph" }))
      .toBeTruthy();
    for (
      const name of [
        "Bold",
        "Italic",
        "Strikethrough",
        "Inline code",
        "Bullet list",
        "Ordered list",
        "Task list",
        "Insert link",
        "Insert image",
        "Insert table",
        "Code block",
        "Quote",
        "Divider",
        "Copy file path",
      ]
    ) {
      expect(await screen.findByRole("button", { name })).toBeTruthy();
    }
    expect(
      view.container.querySelectorAll(".milkdown-top-bar .top-bar-item"),
    ).toHaveLength(14);

    const paragraph = view.container.querySelector(".ProseMirror p")!;
    await fireEvent.mouseOver(paragraph);
    expect(view.container.querySelector(".milkdown-block-handle")).toBeNull();

    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    const results = await axe.run(view.container);
    expect(results.violations).toEqual([]);
  });

  it("applies a heading level from the top bar without requiring a text selection", async () => {
    const view = render(MarkdownEditor, {
      props: { path: "notes/heading.md", content: "Plain paragraph" },
    });
    await screen.findByRole("textbox", { name: "Editing notes/heading.md" });

    const headingButton = await screen.findByRole("button", {
      name: "Paragraph",
    });
    await fireEvent.pointerDown(headingButton);
    const headingOneOption = await screen.findByRole("button", {
      name: "Heading 1",
    });
    await fireEvent.pointerDown(headingOneOption);

    await waitFor(() => {
      const markdown = view.emitted<string[]>("change").at(-1)![0]!;
      expect(markdown).toContain("# Plain paragraph");
    });
    expect(await screen.findByRole("button", { name: "Heading 1" }))
      .toBeTruthy();
  });
});

describe("Frontmatter", () => {
  it("collapses a leading YAML frontmatter block into a metadata row and expands to read-only key/value rows", async () => {
    const content = [
      "---",
      "title: Example",
      "count: 3",
      "---",
      "",
      "# Body heading",
    ].join("\n");
    const view = render(MarkdownEditor, {
      props: { path: "notes/frontmatter.md", content },
    });
    const editor = await screen.findByRole("textbox", {
      name: "Editing notes/frontmatter.md",
    });
    await waitFor(() => {
      expect(editor.querySelector(".frontmatter-block")).toBeTruthy();
    });
    const block = editor.querySelector<HTMLElement>(".frontmatter-block")!;
    expect(block.textContent).toContain("metadata");
    expect(editor.querySelector("h1")?.textContent).toBe("Body heading");
    expect(editor.textContent).not.toContain("title: Example");

    const entries = block.querySelector<HTMLElement>(".frontmatter-content")!;
    const expandButton = screen.getByRole("button", {
      name: "Expand metadata",
    });
    expect(expandButton.getAttribute("aria-expanded")).toBe("false");
    expect(entries.style.display).toBe("none");

    await fireEvent.click(expandButton);
    expect(entries.style.display).toBe("");
    expect(
      screen.getByRole("button", { name: "Collapse metadata" }),
    ).toBeTruthy();
    const keys = [...block.querySelectorAll(".frontmatter-key")].map(
      (node) => node.textContent,
    );
    const values = [...block.querySelectorAll(".frontmatter-value")].map(
      (node) => node.textContent,
    );
    expect(keys).toEqual(["title", "count"]);
    expect(values).toEqual(["Example", "3"]);
    expect(view.emitted("change")).toBeUndefined();

    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    const results = await axe.run(view.container);
    expect(results.violations).toEqual([]);
  });

  it("preserves frontmatter comments, quoting, and key order verbatim on save", async () => {
    const opening = [
      "---",
      "# leading comment",
      'title: "Quoted Value"',
      "tags:",
      "  - alpha",
      "  - beta",
      "count: 3",
      "---",
    ].join("\n");
    const source = `${[opening, "", "Body text", ""].join("\n")}`;
    const view = render(MarkdownEditor, {
      props: { path: "notes/preserve.md", content: source },
    });
    const editor = await screen.findByRole("textbox", {
      name: "Editing notes/preserve.md",
    });
    const heading = await waitFor(() => {
      const paragraph = [...editor.querySelectorAll("p")].find(
        (candidate) => candidate.textContent === "Body text",
      );
      expect(paragraph).toBeTruthy();
      return paragraph!;
    });
    heading.textContent = "Edited body";
    await fireEvent.input(editor);
    await waitFor(() => {
      const markdown = view.emitted<string[]>("change").at(-1)![0]!;
      expect(markdown.startsWith(opening)).toBe(true);
      expect(markdown).toContain("Edited body");
    });
  });

  it("round-trips a frontmatter block byte-for-byte with no edits", async () => {
    const source = `${
      [
        "---",
        "# leading comment",
        'title: "Quoted Value"',
        "tags:",
        "  - alpha",
        "  - beta",
        "count: 3",
        "---",
        "",
        "Body text",
        "",
      ].join("\n")
    }`;
    const host = document.createElement("div");
    document.body.append(host);
    const crepe = new Crepe({ root: host, defaultValue: source });
    crepe.addFeature(frontmatterFeature);
    await crepe.create();

    expect(crepe.getMarkdown()).toBe(source);
    expect(host.querySelector(".frontmatter-block")).toBeTruthy();

    await crepe.destroy();
  });

  it("treats a --- line outside the document start as a thematic break, not frontmatter", async () => {
    const content = ["# Heading", "", "---", "", "More text"].join("\n");
    const view = render(MarkdownEditor, {
      props: { path: "notes/hr.md", content },
    });
    const editor = await screen.findByRole("textbox", {
      name: "Editing notes/hr.md",
    });
    await waitFor(() => {
      expect(editor.querySelector("hr")).toBeTruthy();
    });
    expect(editor.querySelector(".frontmatter-block")).toBeNull();

    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    const results = await axe.run(view.container);
    expect(results.violations).toEqual([]);
  });

  it("shows a fallback message for empty frontmatter without breaking the editor", async () => {
    const content = ["---", "---", "", "Body"].join("\n");
    render(MarkdownEditor, {
      props: { path: "notes/empty-frontmatter.md", content },
    });
    const editor = await screen.findByRole("textbox", {
      name: "Editing notes/empty-frontmatter.md",
    });
    await waitFor(() => {
      expect(editor.querySelector(".frontmatter-block")).toBeTruthy();
    });
    await fireEvent.click(
      screen.getByRole("button", { name: "Expand metadata" }),
    );
    expect(editor.querySelector(".frontmatter-empty")?.textContent).toBe(
      "No metadata",
    );
    expect(editor.textContent).toContain("Body");
  });

  it("does not treat frontmatter without a closing delimiter as metadata", async () => {
    const content = ["---", "title: Example", "", "Body"].join("\n");
    render(MarkdownEditor, {
      props: { path: "notes/unclosed-frontmatter.md", content },
    });
    const editor = await screen.findByRole("textbox", {
      name: "Editing notes/unclosed-frontmatter.md",
    });
    await waitFor(() => {
      expect(editor.textContent).toContain("Body");
    });
    expect(editor.querySelector(".frontmatter-block")).toBeNull();
  });

  it("renders and round-trips a file containing only frontmatter", async () => {
    const source = `${["---", "title: Example", "---", ""].join("\n")}`;
    const view = render(MarkdownEditor, {
      props: { path: "notes/only-frontmatter.md", content: source },
    });
    const editor = await screen.findByRole("textbox", {
      name: "Editing notes/only-frontmatter.md",
    });
    await waitFor(() => {
      expect(editor.querySelector(".frontmatter-block")).toBeTruthy();
    });

    const host = document.createElement("div");
    document.body.append(host);
    const crepe = new Crepe({ root: host, defaultValue: source });
    crepe.addFeature(frontmatterFeature);
    await crepe.create();
    expect(crepe.getMarkdown()).toBe(source);
    await crepe.destroy();

    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    const results = await axe.run(view.container);
    expect(results.violations).toEqual([]);
  });
});
