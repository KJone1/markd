import { afterEach, describe, expect, it, vi } from "vitest";
import { createTooltipHost } from "../src/editor/tooltips.ts";

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe("tooltip host", () => {
  it("removes a tooltip on leave before opening the next tooltip", () => {
    vi.useFakeTimers();
    const bold = document.createElement("button");
    bold.setAttribute("aria-label", "Bold");
    const copyPath = document.createElement("button");
    copyPath.setAttribute("aria-label", "Copy file path");
    document.body.append(bold, copyPath);

    const tooltips = createTooltipHost();
    tooltips.attach(bold);
    tooltips.attach(copyPath);

    bold.dispatchEvent(new PointerEvent("pointerenter"));
    vi.advanceTimersByTime(400);
    expect(document.querySelector("[role=tooltip]")?.textContent).toContain(
      "Bold",
    );

    bold.dispatchEvent(new PointerEvent("pointerleave"));
    copyPath.dispatchEvent(new PointerEvent("pointerenter"));
    expect(document.querySelector("[role=tooltip]")).toBeNull();

    vi.advanceTimersByTime(400);
    expect(document.querySelector("[role=tooltip]")?.textContent).toContain(
      "Copy file path",
    );
    tooltips.destroy();
  });
});
