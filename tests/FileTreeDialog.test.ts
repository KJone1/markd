import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/vue";
import { defineComponent, ref } from "vue";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import FileTreeDialog from "../src/components/FileTreeDialog.vue";
import type { WorkspaceEntry } from "../src/shared/desktop.ts";

const entries: WorkspaceEntry[] = [
  { kind: "file", name: "README.md", path: "README.md" },
  {
    kind: "directory",
    name: "notes",
    path: "notes",
    children: [
      { kind: "file", name: "guide.md", path: "notes/guide.md" },
    ],
  },
];

const scrollIntoView = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "scrollIntoView",
);

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
  vi.stubGlobal("CSS", {
    ...globalThis.CSS,
    escape: (value: string) => value.replaceAll('"', '\\"'),
  });
});

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(100);
});

afterEach(async () => {
  cleanup();
  await Promise.resolve();
  vi.restoreAllMocks();
});

afterAll(() => {
  vi.unstubAllGlobals();
  if (scrollIntoView === undefined) {
    delete (HTMLElement.prototype as { scrollIntoView?: unknown })
      .scrollIntoView;
  } else {
    Object.defineProperty(
      HTMLElement.prototype,
      "scrollIntoView",
      scrollIntoView,
    );
  }
});

function renderControlledDialog() {
  return render(defineComponent({
    components: { FileTreeDialog },
    setup() {
      const open = ref(false);
      return { entries, open };
    },
    template: `
      <button type="button" @click="open = true">Choose a file</button>
      <FileTreeDialog
        :open="open"
        :entries="entries"
        current-path="README.md"
        @close="open = false"
      />
    `,
  }));
}

describe("FileTreeDialog", () => {
  it("does not display its mounted content while closed", () => {
    renderControlledDialog();

    const dialog = document.querySelector<HTMLElement>(".tree-dialog");
    expect(dialog).not.toBeNull();
    expect(dialog?.hidden).toBe(true);
    expect(getComputedStyle(dialog!).display).toBe("none");
  });

  it("delegates modal semantics, focus, Escape, and background locking to Ark UI", async () => {
    renderControlledDialog();
    const trigger = screen.getByRole("button", { name: "Choose a file" });

    trigger.focus();
    await fireEvent.click(trigger);
    const dialog = await screen.findByRole("dialog", { name: "Open a file" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    await waitFor(() =>
      expect(document.body.hasAttribute("data-inert")).toBe(true)
    );
    const selected = screen.getByRole("treeitem", { name: /README\.md/ });
    await waitFor(() => expect(document.activeElement).toBe(selected));

    await fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    expect(document.body.hasAttribute("data-inert")).toBe(false);
  });

  it("uses Ark UI outside interaction dismissal", async () => {
    renderControlledDialog();
    const trigger = screen.getByRole("button", { name: "Choose a file" });
    trigger.focus();
    await fireEvent.click(trigger);
    await screen.findByRole("dialog", { name: "Open a file" });
    await waitFor(() =>
      expect(document.body.hasAttribute("data-inert")).toBe(true)
    );
    await new Promise((resolve) => setTimeout(resolve, 50));

    const backdrop = document.querySelector<HTMLElement>(
      ".tree-dialog-backdrop",
    );
    expect(backdrop).not.toBeNull();
    await fireEvent.pointerDown(backdrop!, {
      pointerType: "mouse",
      clientX: 0,
      clientY: 0,
    });

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it("keeps the search Escape workflow and opens the selected file", async () => {
    const view = render(FileTreeDialog, {
      props: { open: true, entries, currentPath: "README.md" },
    });
    await screen.findByRole("dialog", { name: "Open a file" });
    const selected = screen.getByRole("treeitem", { name: /README\.md/ });
    await fireEvent.keyDown(selected, { key: "/" });

    const search = await screen.findByRole("combobox", {
      name: "Search files",
    });
    await waitFor(() => expect(document.activeElement).toBe(search));
    await fireEvent.update(search, "guide");
    await fireEvent.keyDown(search, { key: "Escape" });

    expect(screen.getByRole("dialog", { name: "Open a file" })).toBeTruthy();
    expect(screen.queryByRole("combobox", { name: "Search files" })).toBeNull();

    await fireEvent.keyDown(selected, { key: "/" });
    await fireEvent.update(
      await screen.findByRole("combobox", { name: "Search files" }),
      "guide",
    );
    await fireEvent.click(screen.getByRole("option", { name: /guide\.md/ }));
    expect(view.emitted("openFile")).toEqual([["notes/guide.md"]]);
    expect(view.emitted("close")).toEqual([[]]);
  });
});
