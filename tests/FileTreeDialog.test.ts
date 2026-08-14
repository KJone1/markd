/// <reference lib="dom" />

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/vue";
import axe from "axe-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import FileTreeDialog from "../src/components/FileTreeDialog.vue";

const entries = [
  {
    kind: "directory" as const,
    name: "notes",
    path: "notes",
    children: [
      { kind: "file" as const, name: "one.md", path: "notes/one.md" },
      { kind: "file" as const, name: "two.md", path: "notes/two.md" },
    ],
  },
  { kind: "file" as const, name: "readme.md", path: "readme.md" },
];

afterEach(cleanup);

describe("FileTreeDialog", () => {
  it("traverses, expands, collapses, opens, and closes from the keyboard", async () => {
    const { emitted } = render(FileTreeDialog, {
      props: { open: true, entries, currentPath: null },
    });
    const dialog = screen.getByRole("dialog", { name: "Open a file" });
    const tree = screen.getByRole("tree", { name: "Workspace files" });

    expect(within(dialog).getAllByRole("treeitem")).toHaveLength(2);
    await fireEvent.keyDown(tree, { key: "ArrowRight" });
    expect(within(dialog).getAllByRole("treeitem")).toHaveLength(4);
    await fireEvent.keyDown(tree, { key: "ArrowDown" });
    expect(
      screen.getByRole("treeitem", { name: "one.md" }).getAttribute(
        "aria-selected",
      ),
    ).toBe("true");
    await fireEvent.keyDown(tree, { key: "Enter" });

    expect(emitted().openFile).toEqual([["notes/one.md"]]);
    expect(emitted().close).toHaveLength(1);
  });

  it("uses left for collapse and parent traversal and pointer activation opens files", async () => {
    const { emitted } = render(FileTreeDialog, {
      props: { open: true, entries, currentPath: "notes/two.md" },
    });
    const dialog = screen.getByRole("dialog", { name: "Open a file" });
    const tree = screen.getByRole("tree", { name: "Workspace files" });
    const current = screen.getByRole("treeitem", { name: "two.md" });
    expect(current.getAttribute("aria-selected")).toBe("true");

    await fireEvent.keyDown(tree, { key: "ArrowLeft" });
    expect(
      screen.getByRole("treeitem", { name: "notes" }).getAttribute(
        "aria-selected",
      ),
    ).toBe("true");
    await fireEvent.keyDown(tree, { key: "ArrowLeft" });
    expect(within(dialog).getAllByRole("treeitem")).toHaveLength(2);

    await fireEvent.click(screen.getByRole("treeitem", { name: "readme.md" }));
    expect(emitted().openFile).toEqual([["readme.md"]]);
    expect(emitted().close).toHaveLength(1);
  });

  it("uses pointer movement for selection and pointer activation for folder toggling", async () => {
    render(FileTreeDialog, {
      props: { open: true, entries, currentPath: null },
    });
    const dialog = screen.getByRole("dialog", { name: "Open a file" });
    const folder = screen.getByRole("treeitem", { name: "notes" });
    const readme = screen.getByRole("treeitem", { name: "readme.md" });

    await fireEvent.mouseEnter(readme);
    expect(readme.getAttribute("aria-selected")).toBe("true");
    await fireEvent.click(folder);
    expect(within(dialog).getAllByRole("treeitem")).toHaveLength(4);
    expect(folder.getAttribute("aria-expanded")).toBe("true");
    await fireEvent.click(folder);
    expect(within(dialog).getAllByRole("treeitem")).toHaveLength(2);
    expect(folder.getAttribute("aria-expanded")).toBe("false");
  });

  it("restores focus on Escape and retains expansion across closure", async () => {
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();
    const view = render(FileTreeDialog, {
      props: { open: true, entries, currentPath: null },
    });
    const dialog = screen.getByRole("dialog", { name: "Open a file" });
    const tree = screen.getByRole("tree", { name: "Workspace files" });
    await fireEvent.keyDown(tree, { key: "ArrowRight" });
    expect(within(dialog).getAllByRole("treeitem")).toHaveLength(4);

    await fireEvent.keyDown(tree, { key: "Escape" });
    await view.rerender({ open: false, entries, currentPath: null });
    expect(document.activeElement).toBe(opener);
    await view.rerender({ open: true, entries, currentPath: null });
    expect(within(screen.getByRole("dialog")).getAllByRole("treeitem"))
      .toHaveLength(4);
    opener.remove();
  });

  it("has no detectable accessibility violations", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    const { container } = render(FileTreeDialog, {
      props: { open: true, entries, currentPath: "notes/two.md" },
    });
    const results = await axe.run(container);
    expect(results.violations).toEqual([]);
  });

  it("focuses the tree and links selection to a whitespace-safe active descendant", async () => {
    render(FileTreeDialog, {
      props: {
        open: true,
        entries: [
          {
            kind: "file",
            name: "release notes.md",
            path: "drafts/release notes.md",
          },
          { kind: "file", name: "summary.md", path: "summary.md" },
        ],
        currentPath: "drafts/release notes.md",
      },
    });
    const tree = screen.getByRole("tree", { name: "Workspace files" });
    const item = screen.getByRole("treeitem", { name: "release notes.md" });
    const activeDescendant = tree.getAttribute("aria-activedescendant");

    await waitFor(() => expect(document.activeElement).toBe(tree));
    expect(activeDescendant).toBe(item.id);
    expect(activeDescendant).not.toMatch(/\s/);

    await fireEvent.keyDown(tree, { key: "ArrowDown" });
    const nextItem = screen.getByRole("treeitem", { name: "summary.md" });
    expect(tree.getAttribute("aria-activedescendant")).toBe(nextItem.id);
  });
});
