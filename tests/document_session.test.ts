import { afterEach, describe, expect, it, vi } from "vitest";
import { DocumentSession } from "../src/document_session.ts";
import type {
  DocumentSaveRequest,
  DocumentSaveResult,
} from "../src/shared/desktop.ts";

afterEach(() => vi.useRealTimers());

describe("DocumentSession", () => {
  it("debounces edits and saves the latest complete buffer", async () => {
    vi.useFakeTimers();
    const requests: DocumentSaveRequest[] = [];
    const session = new DocumentSession({
      path: "app.ts",
      content: "initial",
      save: (request) => {
        requests.push(request);
        return Promise.resolve<DocumentSaveResult>({ kind: "saved" });
      },
    });

    session.edit("first");
    await vi.advanceTimersByTimeAsync(200);
    session.edit("latest");
    await vi.advanceTimersByTimeAsync(299);
    expect(requests).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);

    expect(requests).toEqual([{
      path: "app.ts",
      content: "latest",
      expectedContent: "initial",
      overwrite: false,
    }]);
    expect(session.buffer).toBe("latest");
  });

  it("pauses after autosave failure until Retry saves the latest buffer", async () => {
    vi.useFakeTimers();
    const save = vi.fn()
      .mockRejectedValueOnce(new Error("disk full"))
      .mockResolvedValue({ kind: "saved" });
    const onSaveFailure = vi.fn();
    const session = new DocumentSession({
      path: "app.ts",
      content: "initial",
      save,
      onSaveFailure,
    });

    session.edit("failed version");
    await vi.advanceTimersByTimeAsync(300);
    expect(save).toHaveBeenCalledTimes(1);
    expect(onSaveFailure).toHaveBeenCalledOnce();

    session.edit("latest after failure");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(save).toHaveBeenCalledTimes(1);

    await expect(session.retry()).resolves.toBe(true);
    expect(save).toHaveBeenLastCalledWith({
      path: "app.ts",
      content: "latest after failure",
      expectedContent: "initial",
      overwrite: false,
    });

    session.edit("autosave resumed");
    await vi.advanceTimersByTimeAsync(300);
    expect(save).toHaveBeenCalledTimes(3);
  });

  it("flushes a queued save before handoff and blocks handoff after failure", async () => {
    vi.useFakeTimers();
    let completeSave: ((result: DocumentSaveResult) => void) | undefined;
    const save = vi.fn().mockImplementation(() =>
      new Promise<DocumentSaveResult>((resolve) => {
        completeSave = resolve;
      })
    );
    const session = new DocumentSession({
      path: "app.ts",
      content: "initial",
      save,
    });

    session.edit("queued");
    const handoff = session.handoff();
    expect(save).toHaveBeenCalledOnce();
    expect(save).toHaveBeenCalledWith({
      path: "app.ts",
      content: "queued",
      expectedContent: "initial",
      overwrite: false,
    });
    completeSave?.({ kind: "saved" });
    await expect(handoff).resolves.toBe(true);
    await vi.advanceTimersByTimeAsync(300);
    expect(save).toHaveBeenCalledOnce();

    const failing = new DocumentSession({
      path: "other.ts",
      content: "initial",
      save: vi.fn().mockRejectedValue(new Error("read only")),
    });
    failing.edit("unsaved");
    await vi.advanceTimersByTimeAsync(300);
    await expect(failing.handoff()).resolves.toBe(false);
    expect(failing.buffer).toBe("unsaved");
  });

  it("reloads clean external changes and requires reload or overwrite for conflicts", async () => {
    vi.useFakeTimers();
    const save = vi.fn().mockResolvedValue({ kind: "saved" });
    const onDiskReload = vi.fn();
    const onConflict = vi.fn();
    const session = new DocumentSession({
      path: "app.ts",
      content: "initial",
      save,
      onDiskReload,
      onConflict,
    });

    session.diskChanged("clean external");
    expect(session.buffer).toBe("clean external");
    expect(onDiskReload).toHaveBeenCalledWith("clean external");

    session.edit("local work");
    session.diskChanged("conflicting external");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(save).not.toHaveBeenCalled();
    expect(onConflict).toHaveBeenCalledWith("conflicting external");
    expect(session.buffer).toBe("local work");

    session.reloadFromDisk();
    expect(session.buffer).toBe("conflicting external");
    expect(onDiskReload).toHaveBeenLastCalledWith("conflicting external");

    session.edit("local overwrite");
    session.diskChanged("new external");
    await expect(session.overwrite()).resolves.toBe(true);
    expect(save).toHaveBeenCalledWith({
      path: "app.ts",
      content: "local overwrite",
      expectedContent: "new external",
      overwrite: true,
    });
  });

  it("keeps the disk conflict reloadable when overwrite fails", async () => {
    const onDiskReload = vi.fn();
    const session = new DocumentSession({
      path: "app.ts",
      content: "initial",
      save: vi.fn().mockRejectedValue(new Error("disk full")),
      onDiskReload,
    });

    session.edit("local");
    session.diskChanged("external");
    await expect(session.overwrite()).resolves.toBe(false);
    expect(session.buffer).toBe("local");

    session.reloadFromDisk();
    expect(session.buffer).toBe("external");
    expect(onDiskReload).toHaveBeenCalledWith("external");
  });

  it("turns a backend save conflict into an explicit disk decision", async () => {
    vi.useFakeTimers();
    const onConflict = vi.fn();
    const save = vi.fn().mockResolvedValue({
      kind: "conflict",
      diskContent: "external",
    });
    const session = new DocumentSession({
      path: "app.ts",
      content: "initial",
      save,
      onConflict,
    });

    session.edit("local");
    await vi.advanceTimersByTimeAsync(300);
    expect(onConflict).toHaveBeenCalledWith("external");
    expect(session.buffer).toBe("local");
    session.edit("later local");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(save).toHaveBeenCalledOnce();
  });

  it("serializes an active autosave and saves the latest buffer before handoff", async () => {
    vi.useFakeTimers();
    const completions: Array<(result: DocumentSaveResult) => void> = [];
    const save = vi.fn().mockImplementation(() =>
      new Promise<DocumentSaveResult>((resolve) => completions.push(resolve))
    );
    const session = new DocumentSession({
      path: "app.ts",
      content: "initial",
      save,
    });

    session.edit("first save");
    await vi.advanceTimersByTimeAsync(300);
    session.edit("latest buffer");
    const handoff = session.handoff();
    expect(save).toHaveBeenCalledTimes(1);

    completions[0]?.({ kind: "saved" });
    await Promise.resolve();
    await Promise.resolve();
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith({
      path: "app.ts",
      content: "latest buffer",
      expectedContent: "first save",
      overwrite: false,
    });
    completions[1]?.({ kind: "saved" });
    await expect(handoff).resolves.toBe(true);
  });
});
