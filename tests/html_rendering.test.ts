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

describe("html rendering", () => {
  it("renders a centered image wrapper without leaking internal markers", async () => {
    const source = [
      '<p align="center">',
      '  <img src="assets/icons/markd-icon-1024.png" alt="markd" width="128" />',
      "</p>",
      "",
      '<h1 align="center">markd</h1>',
      "",
      "Body text",
      "",
    ].join("\n");
    const view = render(MarkdownEditor, {
      props: {
        path: "README.md",
        content: source,
        resolveImage: (path: string) => Promise.resolve(`asset://${path}`),
      },
    });
    const editor = await screen.findByRole("textbox", {
      name: "Editing README.md",
    });

    await waitFor(() => {
      expect(editor.querySelector(".html-section")).toBeTruthy();
    });
    expect(editor.textContent).not.toContain("markd-internal:");
    expect(editor.querySelector(".prompt-section")).toBeNull();
    expect(editor.querySelectorAll(".html-block-source:not([hidden])"))
      .toHaveLength(0);

    const wrapper = editor.querySelector<HTMLElement>(".html-section")!;
    expect(wrapper.localName).toBe("div");
    expect(wrapper.dataset.htmlName).toBe("p");
    expect(wrapper.getAttribute("align")).toBe("center");
    const image = editor.querySelector("img[alt='markd']") as HTMLImageElement;
    expect(image.getAttribute("width")).toBe("128");
    await waitFor(() => {
      expect(image.getAttribute("src")).toBe(
        "asset://assets/icons/markd-icon-1024.png",
      );
    });

    const heading = editor.querySelector(".html-block h1")!;
    expect(heading.textContent).toBe("markd");
    expect(heading.getAttribute("align")).toBe("center");

    const paragraph = [...editor.querySelectorAll("p")].find((item) =>
      item.textContent === "Body text"
    )!;
    paragraph.textContent = "Edited body";
    await fireEvent.input(editor);
    await waitFor(() => {
      const saved = view.emitted<string[]>("change").at(-1)?.[0] ?? "";
      expect(saved).not.toContain("markd-internal:");
      expect(saved).toContain('<p align="center">');
      expect(saved).toContain('<img src="assets/icons/markd-icon-1024.png"');
      expect(saved).toContain("</p>");
      expect(saved).toContain('<h1 align="center">markd</h1>');
      expect(saved).toContain("Edited body");
    });
  });

  it("keeps markdown inside a wrapper editable and restores the wrapper on save", async () => {
    const source = [
      '<div align="center">',
      "",
      "A **minimalist** editor.",
      "",
      "</div>",
      "",
    ].join("\n");
    const view = render(MarkdownEditor, {
      props: { path: "docs/wrapper.md", content: source },
    });
    const editor = await screen.findByRole("textbox", {
      name: "Editing docs/wrapper.md",
    });
    await waitFor(() => {
      expect(editor.querySelector(".html-section")).toBeTruthy();
    });
    const wrapper = editor.querySelector(".html-section")!;
    expect(wrapper.localName).toBe("div");
    expect(wrapper.querySelector("strong")?.textContent).toBe("minimalist");

    wrapper.querySelector("p")!.textContent = "Edited copy";
    await fireEvent.input(editor);
    await waitFor(() => {
      const saved = view.emitted<string[]>("change").at(-1)?.[0] ?? "";
      expect(saved).toContain('<div align="center">');
      expect(saved).toContain("Edited copy");
      expect(saved).toContain("</div>");
      expect(saved).not.toContain("markd-internal:");
    });
  });

  it("renders a native collapsible details section with a direct editable summary", async () => {
    const source = [
      "<details>",
      '<summary title="Reveal section">Section title</summary>',
      "",
      "Hidden **detail**",
      "",
      "</details>",
      "",
    ].join("\n");
    const view = render(MarkdownEditor, {
      props: { path: "docs/details.md", content: source },
    });
    const editor = await screen.findByRole("textbox", {
      name: "Editing docs/details.md",
    });
    const details = await waitFor(() => {
      const element = editor.querySelector<HTMLDetailsElement>("details");
      expect(element).toBeTruthy();
      return element!;
    });
    const summary = details.querySelector<HTMLElement>(
      ":scope > summary.details-summary",
    )!;

    expect(summary.parentElement).toBe(details);
    expect(summary.textContent).toBe("Section title");
    expect(summary.getAttribute("title")).toBe("Reveal section");
    expect(details.open).toBe(false);
    expect(details.querySelector("strong")?.textContent).toBe("detail");

    await fireEvent.click(summary);
    expect(details.open).toBe(true);

    summary.textContent = "Renamed section";
    await fireEvent.input(editor);
    await waitFor(() => {
      const saved = view.emitted<string[]>("change").at(-1)?.[0] ?? "";
      expect(saved).toContain(
        '<summary title="Reveal section">Renamed section</summary>',
      );
      expect(saved).toContain("Hidden **detail**");
      expect(saved).toContain("<details>");
      expect(saved).not.toContain("<details open>");
    });
  });

  it("uses the source open attribute only as the initial details state", async () => {
    const source = [
      "<details open>",
      "<summary>Initially open</summary>",
      "",
      "Body",
      "",
      "</details>",
      "",
    ].join("\n");
    const view = render(MarkdownEditor, {
      props: { path: "docs/open-details.md", content: source },
    });
    const editor = await screen.findByRole("textbox", {
      name: "Editing docs/open-details.md",
    });
    const details = await waitFor(() => {
      const element = editor.querySelector<HTMLDetailsElement>("details");
      expect(element).toBeTruthy();
      return element!;
    });
    expect(details.open).toBe(true);

    await fireEvent.click(details.querySelector("summary")!);
    expect(details.open).toBe(false);

    details.querySelector("p")!.textContent = "Edited body";
    await fireEvent.input(editor);
    await waitFor(() => {
      const saved = view.emitted<string[]>("change").at(-1)?.[0] ?? "";
      expect(saved).toContain("<details open>");
      expect(saved).toContain("Edited body");
    });
  });

  it("shows unsafe html as inert source instead of rendering it", async () => {
    const source = [
      '<img src="javascript:alert(1)" alt="x">',
      "",
      '<div onclick="globalThis.compromised = true">text</div>',
      "",
      '<iframe src="https://example.com"></iframe>',
      "",
    ].join("\n");
    render(MarkdownEditor, {
      props: { path: "docs/unsafe.md", content: source },
    });
    const editor = await screen.findByRole("textbox", {
      name: "Editing docs/unsafe.md",
    });
    await waitFor(() => {
      expect(editor.querySelectorAll(".html-block-source:not([hidden])"))
        .toHaveLength(3);
    });
    expect(editor.querySelector("iframe")).toBeNull();
    expect(editor.querySelector("[onclick]")).toBeNull();
    expect(editor.querySelector("img")).toBeNull();
    expect(editor.textContent).toContain('<img src="javascript:alert(1)"');
  });

  it("edits html source in place and saves the edited markup", async () => {
    const view = render(MarkdownEditor, {
      props: {
        path: "docs/source-edit.md",
        content: ["<hr />", "", "After", ""].join("\n"),
      },
    });
    const editor = await screen.findByRole("textbox", {
      name: "Editing docs/source-edit.md",
    });
    await waitFor(() => {
      expect(editor.querySelector(".html-block hr")).toBeTruthy();
    });

    const block = editor.querySelector(".html-block")!;
    await fireEvent.dblClick(block.querySelector(".html-block-rendered")!);
    const source = block.querySelector<HTMLElement>(".html-block-source")!;
    expect(source.hidden).toBe(false);
    expect(source.textContent).toBe("<hr />");

    source.textContent = '<img src="logo.png" alt="logo" />';
    await fireEvent.blur(source);
    await waitFor(() => {
      expect(editor.querySelector(".html-block img")).toBeTruthy();
      const saved = view.emitted<string[]>("change").at(-1)?.[0] ?? "";
      expect(saved).toContain('<img src="logo.png" alt="logo" />');
      expect(saved).not.toContain("<hr />");
    });
  });

  it("renders html without accessibility violations", async () => {
    const view = render(MarkdownEditor, {
      props: {
        path: "docs/a11y.md",
        content: [
          '<p align="center">',
          '  <img src="logo.png" width="64" />',
          "</p>",
          "",
          "<details>",
          "",
          "Hidden detail",
          "",
          "</details>",
          "",
        ].join("\n"),
      },
    });
    const editor = await screen.findByRole("textbox", {
      name: "Editing docs/a11y.md",
    });
    await waitFor(() => {
      expect(editor.querySelectorAll(".html-section")).toHaveLength(2);
    });
    expect(editor.querySelector("img")?.getAttribute("alt")).toBe("");

    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    const results = await axe.run(view.container);
    expect(results.violations).toEqual([]);
  });
});
