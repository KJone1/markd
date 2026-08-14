import { cleanup, render, screen, waitFor } from "@testing-library/vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import HtmlPreview from "../src/components/HtmlPreview.vue";
import { FakeMessageChannel } from "./fake_message_channel.ts";

const runtimePorts: MessagePort[] = [];

beforeEach(() => vi.stubGlobal("MessageChannel", FakeMessageChannel));

afterEach(() => {
  cleanup();
  for (const port of runtimePorts.splice(0)) port.close();
  vi.useRealTimers();
});

describe("HTML preview", () => {
  it("loads the active page in a script-capable isolated iframe", async () => {
    const getHtmlPreviewUrl = vi.fn().mockResolvedValue(
      previewDocument("http://127.0.0.1:49152/pages/index.html"),
    );
    vi.stubGlobal("bindings", {
      getHtmlPreviewUrl,
      openExternalUrl: vi.fn(),
    });

    render(HtmlPreview, { props: { path: "pages/index.html", reloadKey: 0 } });

    const frame = await screen.findByTitle("Previewing pages/index.html");
    await waitFor(() =>
      expect(frame.getAttribute("src")).toBe(
        "http://127.0.0.1:49152/pages/index.html",
      )
    );
    expect(frame.getAttribute("sandbox")).toContain("allow-scripts");
    expect(frame.getAttribute("sandbox")).toContain("allow-same-origin");
    expect(frame.getAttribute("sandbox")).not.toContain("allow-top-navigation");
    expect(getHtmlPreviewUrl).toHaveBeenCalledWith("pages/index.html");
  });

  it("rejects forged external-link messages without an authenticated runtime", async () => {
    const openExternalUrl = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("bindings", {
      getHtmlPreviewUrl: vi.fn().mockResolvedValue(
        previewDocument("http://127.0.0.1:49152/index.html"),
      ),
      openExternalUrl,
    });
    render(HtmlPreview, { props: { path: "index.html", reloadKey: 0 } });
    const frame = await screen.findByTitle(
      "Previewing index.html",
    ) as HTMLIFrameElement;
    await waitFor(() => expect(frame.getAttribute("src")).toBeTruthy());

    globalThis.dispatchEvent(
      new MessageEvent("message", {
        source: frame.contentWindow,
        origin: "http://127.0.0.1:49152",
        data: {
          markdPreview: true,
          type: "external-link",
          url: "https://example.com/docs",
        },
      }),
    );
    expect(openExternalUrl).not.toHaveBeenCalled();

    const forgedChannel = new FakeMessageChannel();
    runtimePorts.push(forgedChannel.port1, forgedChannel.port2);
    globalThis.dispatchEvent(
      new MessageEvent("message", {
        source: frame.contentWindow,
        origin: "http://127.0.0.1:49152",
        data: { markdPreview: true, type: "connect" },
        ports: [forgedChannel.port1],
      }),
    );
    forgedChannel.port2.postMessage({
      type: "external-link",
      url: "https://attacker.example/forged-port",
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(openExternalUrl).not.toHaveBeenCalled();

    const runtime = connectRuntime(frame, "runtime-token");
    runtime.port.postMessage({ type: "runtime-ready" });
    await waitFor(() =>
      expect(runtime.messages).toContainEqual({
        markdHost: true,
        type: "connect",
      })
    );
    globalThis.dispatchEvent(
      new MessageEvent("message", {
        source: frame.contentWindow,
        origin: "http://127.0.0.1:49152",
        data: {
          markdPreview: true,
          type: "external-link",
          url: "https://attacker.example/",
        },
      }),
    );
    expect(openExternalUrl).not.toHaveBeenCalled();

    runtime.port.postMessage({
      type: "external-link",
      url: "https://example.com/docs",
    });
    await waitFor(() =>
      expect(openExternalUrl).toHaveBeenCalledWith("https://example.com/docs")
    );

    runtime.port.postMessage({
      type: "error",
      message: "ReferenceError: missingValue is not defined",
    });
    expect((await screen.findByRole("alert")).textContent).toContain(
      "missingValue is not defined",
    );

    expect(openExternalUrl).toHaveBeenCalledTimes(1);
  });

  it("does not grant a capability to a same-origin non-runtime navigation", async () => {
    const openExternalUrl = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("bindings", {
      getHtmlPreviewUrl: vi.fn().mockResolvedValue(
        previewDocument(
          "http://127.0.0.1:49152/__markd_preview__/initial",
          "initial-runtime-token",
        ),
      ),
      openExternalUrl,
    });
    render(HtmlPreview, { props: { path: "index.html", reloadKey: 0 } });
    const frame = await screen.findByTitle(
      "Previewing index.html",
    ) as HTMLIFrameElement;
    await waitFor(() => expect(frame.getAttribute("src")).toContain("initial"));

    const runtime = connectRuntime(frame, "initial-runtime-token");
    runtime.port.postMessage({ type: "runtime-ready" });
    await new Promise((resolve) => setTimeout(resolve, 0));

    frame.dispatchEvent(new Event("load"));
    const blobDocumentChannel = new FakeMessageChannel();
    runtimePorts.push(blobDocumentChannel.port1, blobDocumentChannel.port2);
    globalThis.dispatchEvent(
      new MessageEvent("message", {
        source: frame.contentWindow,
        origin: "http://127.0.0.1:49152",
        data: {
          markdPreview: true,
          type: "connect",
          token: "initial-runtime-token",
        },
        ports: [blobDocumentChannel.port2],
      }),
    );
    blobDocumentChannel.port1.postMessage({
      type: "external-link",
      url: "https://attacker.example/from-blob",
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(openExternalUrl).not.toHaveBeenCalled();
  });

  it("issues a fresh authenticated document for workspace navigation", async () => {
    const getHtmlPreviewUrl = vi.fn()
      .mockResolvedValueOnce(
        previewDocument(
          "http://127.0.0.1:49152/__markd_preview__/initial",
          "initial-token",
        ),
      )
      .mockResolvedValueOnce(
        previewDocument(
          "http://127.0.0.1:49152/__markd_preview__/next",
          "next-token",
        ),
      );
    vi.stubGlobal("bindings", {
      getHtmlPreviewUrl,
      openExternalUrl: vi.fn(),
    });
    render(HtmlPreview, { props: { path: "index.html", reloadKey: 0 } });
    const firstFrame = await screen.findByTitle(
      "Previewing index.html",
    ) as HTMLIFrameElement;
    const runtime = connectRuntime(firstFrame, "initial-token");
    runtime.port.postMessage({ type: "runtime-ready" });
    runtime.port.postMessage({
      type: "workspace-link",
      url: "http://127.0.0.1:49152/docs/next.html?mode=reader#section",
    });

    await waitFor(() =>
      expect(getHtmlPreviewUrl).toHaveBeenLastCalledWith(
        "docs/next.html",
        "?mode=reader",
      )
    );
    await waitFor(() => {
      expect(screen.getByTitle("Previewing index.html").getAttribute("src"))
        .toBe(
          "http://127.0.0.1:49152/__markd_preview__/next#section",
        );
    });
  });

  it("reauthenticates same-page query navigation", async () => {
    const getHtmlPreviewUrl = vi.fn()
      .mockResolvedValueOnce(previewDocument(
        "http://127.0.0.1:49152/__markd_preview__/initial",
        "initial-token",
      ))
      .mockResolvedValueOnce(previewDocument(
        "http://127.0.0.1:49152/__markd_preview__/query",
        "query-token",
      ));
    vi.stubGlobal("bindings", {
      getHtmlPreviewUrl,
      openExternalUrl: vi.fn(),
    });
    render(HtmlPreview, { props: { path: "index.html", reloadKey: 0 } });
    const frame = await screen.findByTitle(
      "Previewing index.html",
    ) as HTMLIFrameElement;
    const runtime = connectRuntime(frame, "initial-token");
    runtime.port.postMessage({ type: "runtime-ready" });
    runtime.port.postMessage({
      type: "workspace-link",
      url: "http://127.0.0.1:49152/index.html?theme=dark",
    });

    await waitFor(() =>
      expect(getHtmlPreviewUrl).toHaveBeenLastCalledWith(
        "index.html",
        "?theme=dark",
      )
    );
  });

  it("reauthenticates script-driven workspace document navigation", async () => {
    const getHtmlPreviewUrl = vi.fn()
      .mockResolvedValueOnce(previewDocument(
        "http://127.0.0.1:49152/__markd_preview__/initial",
        "initial-token",
      ))
      .mockResolvedValueOnce(previewDocument(
        "http://127.0.0.1:49152/__markd_preview__/script",
        "script-token",
      ));
    vi.stubGlobal("bindings", {
      getHtmlPreviewUrl,
      openExternalUrl: vi.fn(),
    });
    render(HtmlPreview, { props: { path: "index.html", reloadKey: 0 } });
    const frame = await screen.findByTitle(
      "Previewing index.html",
    ) as HTMLIFrameElement;
    await waitFor(() => expect(frame.getAttribute("src")).toBeTruthy());

    globalThis.dispatchEvent(
      new MessageEvent("message", {
        source: frame.contentWindow,
        origin: "http://127.0.0.1:49152",
        data: {
          markdPreview: true,
          type: "workspace-navigation",
          url: "http://127.0.0.1:49152/docs/scripted.html?from=script#result",
        },
      }),
    );

    await waitFor(() =>
      expect(getHtmlPreviewUrl).toHaveBeenLastCalledWith(
        "docs/scripted.html",
        "?from=script",
      )
    );
    await waitFor(() =>
      expect(screen.getByTitle("Previewing index.html").getAttribute("src"))
        .toBe(
          "http://127.0.0.1:49152/__markd_preview__/script#result",
        )
    );
  });

  it("safely rejects malformed workspace URL encoding", async () => {
    const getHtmlPreviewUrl = vi.fn().mockResolvedValue(
      previewDocument(
        "http://127.0.0.1:49152/__markd_preview__/initial",
        "initial-token",
      ),
    );
    vi.stubGlobal("bindings", {
      getHtmlPreviewUrl,
      openExternalUrl: vi.fn(),
    });
    render(HtmlPreview, { props: { path: "index.html", reloadKey: 0 } });
    const frame = await screen.findByTitle(
      "Previewing index.html",
    ) as HTMLIFrameElement;
    const runtime = connectRuntime(frame, "initial-token");
    runtime.port.postMessage({
      type: "workspace-link",
      url: "http://127.0.0.1:49152/docs/%ZZ.html",
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(getHtmlPreviewUrl).toHaveBeenCalledTimes(1);
  });

  it("coalesces a burst of unprivileged workspace navigations", async () => {
    const firstNavigation = deferred<ReturnType<typeof previewDocument>>();
    const getHtmlPreviewUrl = vi.fn()
      .mockResolvedValueOnce(previewDocument(
        "http://127.0.0.1:49152/__markd_preview__/initial",
        "initial-token",
      ))
      .mockReturnValueOnce(firstNavigation.promise)
      .mockResolvedValueOnce(previewDocument(
        "http://127.0.0.1:49152/__markd_preview__/final",
        "final-token",
      ));
    vi.stubGlobal("bindings", {
      getHtmlPreviewUrl,
      openExternalUrl: vi.fn(),
    });
    render(HtmlPreview, { props: { path: "index.html", reloadKey: 0 } });
    const frame = await screen.findByTitle(
      "Previewing index.html",
    ) as HTMLIFrameElement;

    for (let index = 0; index < 100; index += 1) {
      globalThis.dispatchEvent(
        new MessageEvent("message", {
          source: frame.contentWindow,
          origin: "http://127.0.0.1:49152",
          data: {
            markdPreview: true,
            type: "workspace-navigation",
            url: `http://127.0.0.1:49152/pages/${index}.html?burst=${index}`,
          },
        }),
      );
    }
    expect(getHtmlPreviewUrl).toHaveBeenCalledTimes(2);

    firstNavigation.resolve(previewDocument(
      "http://127.0.0.1:49152/__markd_preview__/superseded",
      "superseded-token",
    ));
    await waitFor(() => expect(getHtmlPreviewUrl).toHaveBeenCalledTimes(3));
    expect(getHtmlPreviewUrl).toHaveBeenLastCalledWith(
      "pages/99.html",
      "?burst=99",
    );
    await waitFor(() =>
      expect(screen.getByTitle("Previewing index.html").getAttribute("src"))
        .toBe("http://127.0.0.1:49152/__markd_preview__/final")
    );
  });

  it("fully reloads on workspace changes and restores captured scroll", async () => {
    vi.stubGlobal("bindings", {
      getHtmlPreviewUrl: vi.fn().mockResolvedValue(
        previewDocument("http://127.0.0.1:49152/index.html"),
      ),
      openExternalUrl: vi.fn(),
    });
    const view = render(HtmlPreview, {
      props: { path: "index.html", reloadKey: 0 },
    });
    const firstFrame = await screen.findByTitle(
      "Previewing index.html",
    ) as HTMLIFrameElement;
    await waitFor(() => expect(firstFrame.getAttribute("src")).toBeTruthy());
    const firstRuntime = connectRuntime(firstFrame, "runtime-token");
    firstRuntime.port.postMessage({ type: "runtime-ready" });
    await new Promise((resolve) => setTimeout(resolve, 0));

    await view.rerender({ path: "index.html", reloadKey: 1 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(firstRuntime.messages).toContainEqual({
      markdHost: true,
      type: "capture-scroll",
    });
    firstRuntime.port.postMessage({ type: "scroll", x: 12, y: 34 });
    await new Promise((resolve) => setTimeout(resolve, 0));

    await waitFor(() => {
      expect(screen.getByTitle("Previewing index.html")).not.toBe(firstFrame);
    });
    const reloaded = screen.getByTitle(
      "Previewing index.html",
    ) as HTMLIFrameElement;
    const reloadedRuntime = connectRuntime(reloaded, "runtime-token");
    expect(reloadedRuntime.messages).not.toContainEqual(
      expect.objectContaining({
        type: "restore-scroll",
      }),
    );
    reloadedRuntime.port.postMessage({ type: "runtime-ready" });
    await waitFor(() =>
      expect(reloadedRuntime.messages).toContainEqual({
        markdHost: true,
        type: "restore-scroll",
        x: 12,
        y: 34,
      })
    );
  });

  it("does not restore saved scroll during ordinary iframe navigation", async () => {
    vi.stubGlobal("bindings", {
      getHtmlPreviewUrl: vi.fn().mockResolvedValue(
        previewDocument("http://127.0.0.1:49152/index.html"),
      ),
      openExternalUrl: vi.fn(),
    });
    render(HtmlPreview, { props: { path: "index.html", reloadKey: 0 } });
    const frame = await screen.findByTitle(
      "Previewing index.html",
    ) as HTMLIFrameElement;
    const runtime = connectRuntime(frame, "runtime-token");
    runtime.port.postMessage({ type: "runtime-ready" });
    await waitFor(() =>
      expect(runtime.messages).toContainEqual({
        markdHost: true,
        type: "connect",
      })
    );
    expect(runtime.messages).not.toContainEqual(expect.objectContaining({
      type: "restore-scroll",
    }));
  });

  it("accepts an authenticated runtime after the iframe load event", async () => {
    vi.useFakeTimers();
    const openExternalUrl = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("bindings", {
      getHtmlPreviewUrl: vi.fn().mockResolvedValue(
        previewDocument("http://127.0.0.1:49152/__markd_preview__/load-first"),
      ),
      openExternalUrl,
    });
    render(HtmlPreview, { props: { path: "index.html", reloadKey: 0 } });
    const frame = await screen.findByTitle(
      "Previewing index.html",
    ) as HTMLIFrameElement;

    frame.dispatchEvent(new Event("load"));
    const runtime = offerRuntime(frame, "runtime-token");
    runtime.port.postMessage({ type: "runtime-ready" });
    runtime.port.postMessage({ type: "document-loaded" });
    await vi.advanceTimersByTimeAsync(600);
    runtime.port.postMessage({
      type: "external-link",
      url: "https://example.com/load-first",
    });
    await vi.advanceTimersByTimeAsync(0);

    expect(screen.queryByRole("alert")).toBeNull();
    expect(openExternalUrl).toHaveBeenCalledWith(
      "https://example.com/load-first",
    );
  });

  it("keeps a ready authenticated runtime across a delayed iframe load", async () => {
    vi.useFakeTimers();
    const openExternalUrl = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("bindings", {
      getHtmlPreviewUrl: vi.fn().mockResolvedValue(
        previewDocument(
          "http://127.0.0.1:49152/__markd_preview__/runtime-first",
        ),
      ),
      openExternalUrl,
    });
    render(HtmlPreview, { props: { path: "index.html", reloadKey: 0 } });
    const frame = await screen.findByTitle(
      "Previewing index.html",
    ) as HTMLIFrameElement;

    const runtime = offerRuntime(frame, "runtime-token");
    runtime.port.postMessage({ type: "runtime-ready" });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(screen.queryByRole("alert")).toBeNull();

    runtime.port.postMessage({ type: "document-loaded" });
    await vi.advanceTimersByTimeAsync(0);
    frame.dispatchEvent(new Event("load"));
    await vi.advanceTimersByTimeAsync(600);
    runtime.port.postMessage({
      type: "external-link",
      url: "https://example.com/runtime-first",
    });
    await vi.advanceTimersByTimeAsync(0);

    expect(screen.queryByRole("alert")).toBeNull();
    expect(openExternalUrl).toHaveBeenCalledWith(
      "https://example.com/runtime-first",
    );
  });

  it("surfaces a main-document failure when no preview runtime loads", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("bindings", {
      getHtmlPreviewUrl: vi.fn().mockResolvedValue(
        previewDocument("http://127.0.0.1:49152/missing.html"),
      ),
      openExternalUrl: vi.fn(),
    });
    render(HtmlPreview, { props: { path: "missing.html", reloadKey: 0 } });
    const frame = await screen.findByTitle(
      "Previewing missing.html",
    ) as HTMLIFrameElement;

    frame.dispatchEvent(new Event("load"));
    await vi.advanceTimersByTimeAsync(600);
    expect(screen.getByRole("alert").textContent).toContain(
      "could not load missing.html",
    );
  });
});

function connectRuntime(frame: HTMLIFrameElement, token: string): {
  port: MessagePort;
  messages: unknown[];
} {
  frame.dispatchEvent(new Event("load"));
  return offerRuntime(frame, token);
}

function offerRuntime(frame: HTMLIFrameElement, token: string): {
  port: MessagePort;
  messages: unknown[];
} {
  const channel = new FakeMessageChannel();
  runtimePorts.push(channel.port1, channel.port2);
  globalThis.dispatchEvent(
    new MessageEvent("message", {
      source: frame.contentWindow,
      origin: "http://127.0.0.1:49152",
      data: { markdPreview: true, type: "connect", token },
      ports: [channel.port2],
    }),
  );
  const messages: unknown[] = [{ markdHost: true, type: "connect" }];
  channel.port1.onmessage = (event) => messages.push(event.data);
  channel.port1.start();
  return { port: channel.port1, messages };
}

function previewDocument(url: string, runtimeToken = "runtime-token") {
  return { url, runtimeToken };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}
