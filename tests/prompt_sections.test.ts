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
import { promptSectionsFeature } from "../src/editor/prompt-sections.ts";

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

describe("prompt sections", () => {
  it("renders arbitrary, attributed, sibling, and nested paired sections", async () => {
    const markdown = [
      "<System-Prompt role=\"system\" data-kind='base'>",
      "# Instructions",
      "",
      "<Nested_1>",
      "Nested text",
      "</Nested_1>",
      "</System-Prompt>",
      "",
      "<Context.v2>",
      "Sibling text",
      "</Context.v2>",
    ].join("\n");
    render(MarkdownEditor, {
      props: { path: "prompts/structured.md", content: markdown },
    });

    const editor = await screen.findByRole("textbox", {
      name: "Editing prompts/structured.md",
    });
    await waitFor(() => {
      expect(editor.querySelectorAll(".prompt-section")).toHaveLength(3);
    });
    expect(editor.querySelector(".prompt-section h1")?.textContent).toBe(
      "Instructions",
    );
    expect(
      editor.querySelectorAll(
        ".prompt-section > .prompt-section-content .prompt-section",
      ),
    )
      .toHaveLength(1);
    expect(editor.querySelectorAll("[data-prompt-boundary='open']"))
      .toHaveLength(3);
    expect(editor.querySelectorAll("[data-prompt-boundary='close']"))
      .toHaveLength(3);
  });

  it("preserves exact boundaries, synchronizes rename, and unwraps content", async () => {
    const opening = "  <Task_Name role=\"user\" data-note='Keep Me'>  ";
    const closing = "  </Task_Name>  ";
    const markdown = [opening, "# Keep this", closing].join("\n");
    const view = render(MarkdownEditor, {
      props: { path: "prompts/edit.md", content: markdown },
    });
    const editor = await screen.findByRole("textbox", {
      name: "Editing prompts/edit.md",
    });
    await waitFor(() => {
      expect(editor.querySelector(".prompt-section")).toBeTruthy();
    });

    const heading = editor.querySelector("h1")!;
    heading.textContent = "Still here";
    await fireEvent.input(editor);
    await waitFor(() => {
      const saved = view.emitted<string[]>("change").at(-1)?.[0] ?? "";
      expect(saved).toContain(opening);
      expect(saved).toContain(closing);
    });

    const openingName = await screen.findByRole("textbox", {
      name: "Rename opening Task_Name prompt section",
    });
    await fireEvent.update(openingName, "Renamed.v2");
    await waitFor(() => {
      const saved = view.emitted<string[]>("change").at(-1)?.[0] ?? "";
      expect(saved).toContain(
        "  <Renamed.v2 role=\"user\" data-note='Keep Me'>  ",
      );
      expect(saved).toContain("  </Renamed.v2>  ");
      expect(saved).toContain("# Still here");
    });
    const closingName = screen.getByRole("textbox", {
      name: "Rename closing Renamed.v2 prompt section",
    }) as HTMLInputElement;
    expect(closingName.value).toBe("Renamed.v2");
    await fireEvent.update(closingName, "Final_Name");
    await waitFor(() => {
      const saved = view.emitted<string[]>("change").at(-1)?.[0] ?? "";
      expect(saved).toContain(
        "  <Final_Name role=\"user\" data-note='Keep Me'>  ",
      );
      expect(saved).toContain("  </Final_Name>  ");
    });

    await fireEvent.click(screen.getByRole("button", {
      name: "Remove Final_Name prompt section boundaries",
    }));
    await waitFor(() => {
      expect(editor.querySelector(".prompt-section")).toBeNull();
      const saved = view.emitted<string[]>("change").at(-1)?.[0] ?? "";
      expect(saved).toContain("# Still here");
      expect(saved).not.toContain("Final_Name");
    });
  });

  it("retains structure and exact boundaries across a load-save-load cycle", async () => {
    const opening = '<CaseSensitive data-json="{&quot;keep&quot;:true}">';
    const closing = "</CaseSensitive>";
    const first = render(MarkdownEditor, {
      props: {
        path: "prompts/roundtrip.md",
        content: [opening, "Original text", closing].join("\n"),
      },
    });
    const firstEditor = await screen.findByRole("textbox", {
      name: "Editing prompts/roundtrip.md",
    });
    await waitFor(() => {
      expect(firstEditor.querySelector(".prompt-section")).toBeTruthy();
    });
    firstEditor.querySelector(".prompt-section-content p")!.textContent =
      "Updated text";
    await fireEvent.input(firstEditor);
    const saved = await waitFor(() => {
      const markdown = first.emitted<string[]>("change").at(-1)?.[0];
      expect(markdown).toContain(opening);
      expect(markdown).toContain(closing);
      return markdown!;
    });
    first.unmount();

    render(MarkdownEditor, {
      props: { path: "prompts/roundtrip.md", content: saved },
    });
    const secondEditor = await screen.findByRole("textbox", {
      name: "Editing prompts/roundtrip.md",
    });
    await waitFor(() => {
      expect(secondEditor.querySelectorAll(".prompt-section")).toHaveLength(1);
    });
    expect(secondEditor.textContent).toContain("Updated text");
  });

  it("preserves adversarial marker-like comments exactly across load-save-load", async () => {
    const opening = "<!--markd-prompt-open:%3CFake%3E-->";
    const closing = "<!--markd-prompt-close:%3C%2FFake%3E-->";
    const internalLooking =
      "<!--markd-internal:00000000-0000-4000-8000-000000000000-0-->";
    const source = `${
      [opening, "", internalLooking, "", "Editable text", "", closing].join(
        "\n",
      )
    }\n`;
    const first = render(MarkdownEditor, {
      props: { path: "prompts/marker-comment.md", content: source },
    });
    const firstEditor = await screen.findByRole("textbox", {
      name: "Editing prompts/marker-comment.md",
    });
    await waitFor(() => {
      expect(firstEditor.querySelector(".prompt-section")).toBeNull();
      expect(firstEditor.textContent).toContain(opening);
      expect(firstEditor.textContent).toContain(internalLooking);
      expect(firstEditor.textContent).toContain(closing);
    });
    const editable = [...firstEditor.querySelectorAll("p")].find((paragraph) =>
      paragraph.textContent === "Editable text"
    )!;
    editable.textContent = "Edited text";
    await fireEvent.input(firstEditor);
    const expected = `${
      [opening, "", internalLooking, "", "Edited text", "", closing].join(
        "\n",
      )
    }\n`;
    const saved = await waitFor(() => {
      const markdown = first.emitted<string[]>("change").at(-1)?.[0];
      expect(markdown).toBe(expected);
      return markdown!;
    });
    first.unmount();

    render(MarkdownEditor, {
      props: { path: "prompts/marker-comment.md", content: saved },
    });
    const secondEditor = await screen.findByRole("textbox", {
      name: "Editing prompts/marker-comment.md",
    });
    await waitFor(() => {
      expect(secondEditor.querySelector(".prompt-section")).toBeNull();
      expect(secondEditor.textContent).toContain(opening);
      expect(secondEditor.textContent).toContain(internalLooking);
      expect(secondEditor.textContent).toContain(closing);
    });
  });

  it.each([
    [
      "indented",
      [
        "    <Indented>",
        "    const prompt = true;",
        "    </Indented>",
      ].join("\n"),
    ],
    [
      "fenced",
      [
        "```xml",
        "<Fenced>",
        "const prompt = true;",
        "</Fenced>",
        "```",
      ].join("\n"),
    ],
    [
      "tilde-fenced",
      [
        "~~~~prompt",
        "<TildeFenced>",
        "const prompt = true;",
        "</TildeFenced>",
        "~~~~",
      ].join("\n"),
    ],
    [
      "backtick-fenced with an invalid closing candidate",
      [
        "```prompt",
        "const prompt = true;",
        "``` still-code",
        "<StillBacktickCode>",
        "literal content",
        "</StillBacktickCode>",
        "```",
      ].join("\n"),
    ],
    [
      "tilde-fenced with an invalid closing candidate",
      [
        "~~~prompt",
        "const prompt = true;",
        "~~~ still-code",
        "<StillTildeCode>",
        "literal content",
        "</StillTildeCode>",
        "~~~",
      ].join("\n"),
    ],
    [
      "long backtick-fenced with a shorter closing candidate",
      [
        "````prompt",
        "const prompt = true;",
        "```",
        "<StillLongFenceCode>",
        "literal content",
        "</StillLongFenceCode>",
        "````",
      ].join("\n"),
    ],
    [
      "tilde-fenced with a wrong-character closing candidate",
      [
        "~~~~prompt",
        "const prompt = true;",
        "````",
        "<StillWrongFenceCode>",
        "literal content",
        "</StillWrongFenceCode>",
        "~~~~",
      ].join("\n"),
    ],
  ])(
    "preserves %s code literally across load-save-load",
    async (_name, code) => {
      const source = `${code}\n\nAfter\n`;
      const first = render(MarkdownEditor, {
        props: { path: "prompts/code.md", content: source },
      });
      const firstEditor = await screen.findByRole("textbox", {
        name: "Editing prompts/code.md",
      });
      await waitFor(() => {
        expect(firstEditor.querySelector(".prompt-section")).toBeNull();
        expect(firstEditor.querySelector("pre")?.textContent).toContain(
          "const prompt = true;",
        );
      });
      const after = [...firstEditor.querySelectorAll("p")].find((paragraph) =>
        paragraph.textContent === "After"
      )!;
      after.textContent = "After edit";
      await fireEvent.input(firstEditor);
      const expected = `${code}\n\nAfter edit\n`;
      const saved = await waitFor(() => {
        const markdown = first.emitted<string[]>("change").at(-1)?.[0];
        expect(markdown).toBe(expected);
        return markdown!;
      });
      first.unmount();

      render(MarkdownEditor, {
        props: { path: "prompts/code.md", content: saved },
      });
      const secondEditor = await screen.findByRole("textbox", {
        name: "Editing prompts/code.md",
      });
      await waitFor(() => {
        expect(secondEditor.querySelector(".prompt-section")).toBeNull();
        expect(secondEditor.querySelector("pre")?.textContent).toContain(
          "const prompt = true;",
        );
      });
    },
  );

  it("keeps indented tag-like paragraph continuations literal across load-save-load", async () => {
    const source = [
      "Paragraph before",
      "    <ParagraphContinuation>",
      "    literal content",
      "    </ParagraphContinuation>",
      "",
      "After",
      "",
    ].join("\n");

    const first = render(MarkdownEditor, {
      props: { path: "prompts/paragraph-continuation.md", content: source },
    });
    const firstEditor = await screen.findByRole("textbox", {
      name: "Editing prompts/paragraph-continuation.md",
    });
    await waitFor(() => {
      expect(firstEditor.querySelector(".prompt-section")).toBeNull();
      expect(firstEditor.textContent).toContain("<ParagraphContinuation>");
      expect(firstEditor.textContent).not.toContain("markd-internal:");
    });
    const after = [...firstEditor.querySelectorAll("p")].find((paragraph) =>
      paragraph.textContent === "After"
    )!;
    after.textContent = "After edit";
    await fireEvent.input(firstEditor);
    const expected = source.replace("After\n", "After edit\n");
    const saved = await waitFor(() => {
      const markdown = first.emitted<string[]>("change").at(-1)?.[0];
      expect(markdown).toBe(expected);
      expect(markdown).not.toContain("markd-internal:");
      return markdown!;
    });
    first.unmount();

    render(MarkdownEditor, {
      props: {
        path: "prompts/paragraph-continuation.md",
        content: saved,
      },
    });
    const secondEditor = await screen.findByRole("textbox", {
      name: "Editing prompts/paragraph-continuation.md",
    });
    await waitFor(() => {
      expect(secondEditor.querySelector(".prompt-section")).toBeNull();
      expect(secondEditor.textContent).toContain("<ParagraphContinuation>");
      expect(secondEditor.textContent).not.toContain("markd-internal:");
    });
  });

  it("directly parses and serializes an indented paragraph continuation without marker leakage", async () => {
    const source = [
      "Paragraph before",
      "    <DirectGuard>",
      "    literal content",
      "    </DirectGuard>",
      "",
    ].join("\n");
    const host = document.createElement("div");
    document.body.append(host);
    const crepe = new Crepe({ root: host, defaultValue: source });
    crepe.addFeature(promptSectionsFeature);
    await crepe.create();

    expect(crepe.getMarkdown()).toBe(source);
    expect(host.querySelector(".prompt-section")).toBeNull();
    expect(host.textContent).toContain("<DirectGuard>");
    expect(host.textContent).not.toContain("markd-internal:");

    await crepe.destroy();
  });

  it.each([
    [
      "blockquote lazy continuation",
      [
        "> Quote",
        "lazy continuation",
        "    <Quoted>",
        "    literal content",
        "    </Quoted>",
      ].join("\n"),
      "blockquote",
    ],
    [
      "list-item continuation",
      [
        "- Item",
        "    continuation",
        "        <Listed>",
        "        literal content",
        "        </Listed>",
      ].join("\n"),
      "li",
    ],
  ])(
    "preserves %s structure exactly across load-save-load",
    async (_name, nestedSource, containerSelector) => {
      const source = `${nestedSource}\n\nAfter\n`;
      const first = render(MarkdownEditor, {
        props: { path: "prompts/nested-continuation.md", content: source },
      });
      const firstEditor = await screen.findByRole("textbox", {
        name: "Editing prompts/nested-continuation.md",
      });
      await waitFor(() => {
        expect(firstEditor.querySelector(containerSelector)).toBeTruthy();
        expect(firstEditor.querySelector(".prompt-section")).toBeNull();
        expect(firstEditor.textContent).not.toContain("markd-internal:");
      });
      const after = [...firstEditor.querySelectorAll("p")].find((paragraph) =>
        paragraph.textContent === "After"
      )!;
      after.textContent = "After edit";
      await fireEvent.input(firstEditor);
      const expected = `${nestedSource}\n\nAfter edit\n`;
      const saved = await waitFor(() => {
        const markdown = first.emitted<string[]>("change").at(-1)?.[0];
        expect(markdown).toBe(expected);
        expect(markdown).not.toContain("markd-internal:");
        return markdown!;
      });
      first.unmount();

      render(MarkdownEditor, {
        props: {
          path: "prompts/nested-continuation.md",
          content: saved,
        },
      });
      const secondEditor = await screen.findByRole("textbox", {
        name: "Editing prompts/nested-continuation.md",
      });
      await waitFor(() => {
        expect(secondEditor.querySelector(containerSelector)).toBeTruthy();
        expect(secondEditor.querySelector(".prompt-section")).toBeNull();
        expect(secondEditor.textContent).not.toContain("markd-internal:");
      });
    },
  );

  it("converts a complete pasted pair and keeps pasted Markdown editable", async () => {
    const view = render(MarkdownEditor, {
      props: { path: "prompts/paste.md", content: "Before" },
    });
    const editor = await screen.findByRole("textbox", {
      name: "Editing prompts/paste.md",
    });
    const pasted = [
      '<Pasted role="user">',
      "## Pasted heading",
      "",
      "Pasted **content**",
      "</Pasted>",
    ].join("\n");
    await fireEvent.paste(editor, {
      clipboardData: {
        getData: (type: string) => type === "text/plain" ? pasted : "",
      },
    });
    await waitFor(() => {
      expect(editor.querySelector(".prompt-section h2")?.textContent).toBe(
        "Pasted heading",
      );
    });
    expect(editor.querySelector(".prompt-section strong")?.textContent).toBe(
      "content",
    );
    await waitFor(() => {
      const saved = view.emitted<string[]>("change").at(-1)?.[0] ?? "";
      expect(saved).toContain('<Pasted role="user">');
      expect(saved).toContain("</Pasted>");
    });
  });

  it("converts a complete pair entered as editor blocks", async () => {
    const view = render(MarkdownEditor, {
      props: { path: "prompts/typed.md", content: "Start typing" },
    });
    const editor = await screen.findByRole("textbox", {
      name: "Editing prompts/typed.md",
    });
    editor.replaceChildren();
    for (const text of ["<Typed>", "Typed body", "</Typed>"]) {
      const paragraph = document.createElement("p");
      paragraph.textContent = text;
      editor.append(paragraph);
    }
    await fireEvent.input(editor, {
      inputType: "insertText",
      data: ">",
    });
    await waitFor(() => {
      expect(editor.querySelector(".prompt-section")).toBeTruthy();
      expect(editor.querySelector(".prompt-section-content")?.textContent)
        .toContain("Typed body");
    });
    await waitFor(() => {
      const saved = view.emitted<string[]>("change").at(-1)?.[0] ?? "";
      expect(saved).toContain("<Typed>");
      expect(saved).toContain("</Typed>");
    });
  });

  it("falls back to exact visible literal boundaries when a rename becomes invalid", async () => {
    const view = render(MarkdownEditor, {
      props: {
        path: "prompts/invalidate.md",
        content: "<Valid>\nKeep me\n</Valid>",
      },
    });
    const editor = await screen.findByRole("textbox", {
      name: "Editing prompts/invalidate.md",
    });
    const openingName = await screen.findByRole("textbox", {
      name: "Rename opening Valid prompt section",
    });
    await fireEvent.update(openingName, "not valid");
    await waitFor(() => {
      expect(editor.querySelector(".prompt-section")).toBeNull();
      expect(editor.textContent).toContain("<not valid>");
      expect(editor.textContent).toContain("</not valid>");
      expect(editor.textContent).toContain("Keep me");
    });
    await waitFor(() => {
      const saved = view.emitted<string[]>("change").at(-1)?.[0] ?? "";
      expect(saved).toContain("<not valid>");
      expect(saved).toContain("</not valid>");
    });
  });

  it("reconciles external valid and invalid content without duplicating editor lifecycle", async () => {
    const view = render(MarkdownEditor, {
      props: {
        path: "prompts/external.md",
        content: "<Initial>\nFirst\n</Initial>",
      },
    });
    const editor = await screen.findByRole("textbox", {
      name: "Editing prompts/external.md",
    });
    await waitFor(() => {
      expect(editor.querySelectorAll(".prompt-section")).toHaveLength(1);
    });

    await view.rerender({
      path: "prompts/external.md",
      content: "<Broken>\nSecond\n</Different>",
    });
    await waitFor(() => {
      expect(editor.querySelector(".prompt-section")).toBeNull();
      expect(editor.textContent).toContain("<Broken>");
      expect(editor.textContent).toContain("</Different>");
    });

    await view.rerender({
      path: "prompts/external.md",
      content: "<Replacement>\nThird\n</Replacement>",
    });
    await waitFor(() => {
      expect(editor.querySelectorAll(".prompt-section")).toHaveLength(1);
      expect(editor.textContent).toContain("Third");
    });
    expect(view.emitted("change")).toBeUndefined();
  });

  it.each([
    ["inline", "Before <Inline>text</Inline> after"],
    ["self-closing", "<SelfClosing />"],
    ["unclosed", "<Unclosed>\ntext"],
    ["mismatched", "<First>\ntext\n</Second>"],
    ["overlapping", "<First>\n<Second>\n</First>\n</Second>"],
    ["malformed attribute", "<Bad unquoted=value>\ntext\n</Bad>"],
  ])("keeps %s syntax visible and literal", async (_name, markdown) => {
    render(MarkdownEditor, {
      props: { path: "prompts/invalid.md", content: markdown },
    });
    const editor = await screen.findByRole("textbox", {
      name: "Editing prompts/invalid.md",
    });
    await waitFor(() =>
      expect(editor.textContent).toContain(markdown.split("\n")[0])
    );
    expect(editor.querySelector(".prompt-section")).toBeNull();
  });

  it("never creates active elements or handlers and remains accessible", async () => {
    const view = render(MarkdownEditor, {
      props: {
        path: "prompts/safe.md",
        content: [
          '<script onload="globalThis.compromised=true">',
          "Safe **Markdown**",
          "</script>",
        ].join("\n"),
      },
    });
    const editor = await screen.findByRole("textbox", {
      name: "Editing prompts/safe.md",
    });
    await waitFor(() => {
      expect(editor.querySelector(".prompt-section")).toBeTruthy();
    });
    expect(editor.querySelector("script")).toBeNull();
    expect(editor.querySelector("[onload]")).toBeNull();
    expect(editor.querySelector("strong")?.textContent).toBe("Markdown");

    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    const results = await axe.run(view.container);
    expect(results.violations).toEqual([]);
  });
});
