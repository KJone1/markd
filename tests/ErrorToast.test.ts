import { cleanup, fireEvent, render, screen } from "@testing-library/vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import ErrorToast from "../src/components/ErrorToast.vue";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("ErrorToast", () => {
  it("offers Retry and Dismiss and auto-dismisses after 10 seconds", async () => {
    vi.useFakeTimers();
    const view = render(ErrorToast, { props: { message: "Could not save." } });
    expect(screen.getByRole("alert")).toBeTruthy();
    await fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(view.emitted("retry")).toHaveLength(1);
    await fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(view.emitted("dismiss")).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(view.emitted("dismiss")).toHaveLength(2);
  });
});
