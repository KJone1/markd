import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/vue";
import axe from "axe-core";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import MarkdownEditor from "../src/components/MarkdownEditor.vue";

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
