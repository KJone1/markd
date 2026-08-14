import { cleanup, render, waitFor } from "@testing-library/vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import CodeEditor from "../src/components/CodeEditor.vue";

const { create, setModelLanguage } = vi.hoisted(() => ({
  create: vi.fn(),
  setModelLanguage: vi.fn(),
}));

vi.mock("monaco-editor", () => ({
  editor: { create, setModelLanguage },
}));

afterEach(() => {
  cleanup();
  create.mockReset();
  setModelLanguage.mockReset();
});

describe("CodeEditor", () => {
  it("mounts Monaco with the file language and emits complete changes", async () => {
    let changeListener: (() => void) | undefined;
    let buffer = "const value = 1;";
    const model = {};
    const dispose = vi.fn();
    create.mockReturnValue({
      getModel: () => model,
      getValue: () => buffer,
      setValue: vi.fn((value: string) => {
        buffer = value;
      }),
      onDidChangeModelContent: (listener: () => void) => {
        changeListener = listener;
        return { dispose: vi.fn() };
      },
      dispose,
    });

    const view = render(CodeEditor, {
      props: { path: "src/app.ts", content: buffer },
    });
    await waitFor(() => expect(create).toHaveBeenCalledOnce());
    expect(create).toHaveBeenCalledWith(
      expect.any(HTMLElement),
      expect.objectContaining({
        value: "const value = 1;",
        language: "typescript",
        automaticLayout: true,
      }),
    );

    buffer = "const value = 2;";
    changeListener?.();
    expect(view.emitted("change")).toEqual([["const value = 2;"]]);
    view.unmount();
    expect(dispose).toHaveBeenCalledOnce();
  });
});
