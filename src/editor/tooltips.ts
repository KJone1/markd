const OPEN_DELAY = 400;
const GUTTER = 8;
const ARROW_SIZE = 8;
const VIEWPORT_PADDING = 8;

export interface TooltipHost {
  attach(trigger: HTMLElement): void;
  destroy(): void;
}

let nextId = 0;

export function createTooltipHost(): TooltipHost {
  const id = `markd-tooltip-${(nextId += 1)}`;
  const surface = document.createElement("div");
  surface.className = "markd-tooltip";
  surface.id = id;
  surface.setAttribute("role", "tooltip");
  surface.dataset.part = "content";
  const label = document.createElement("span");
  label.dataset.part = "label";
  const arrow = document.createElement("span");
  arrow.className = "markd-tooltip-arrow";
  arrow.dataset.part = "arrow";
  surface.append(label, arrow);

  let openTrigger: HTMLElement | null = null;
  let openTimer: number | null = null;
  let destroyed = false;

  function clearOpenTimer(): void {
    if (openTimer === null) return;
    clearTimeout(openTimer);
    openTimer = null;
  }

  function position(trigger: HTMLElement): void {
    const anchor = trigger.getBoundingClientRect();
    const box = surface.getBoundingClientRect();
    const above = anchor.top - box.height - GUTTER - ARROW_SIZE / 2;
    const below = anchor.bottom + GUTTER + ARROW_SIZE / 2;
    const flipped = above < VIEWPORT_PADDING;
    const top = flipped ? below : above;
    const centered = anchor.left + anchor.width / 2 - box.width / 2;
    const left = Math.min(
      Math.max(centered, VIEWPORT_PADDING),
      Math.max(
        VIEWPORT_PADDING,
        document.documentElement.clientWidth - box.width - VIEWPORT_PADDING,
      ),
    );
    surface.dataset.placement = flipped ? "bottom" : "top";
    surface.style.top = `${Math.round(top)}px`;
    surface.style.left = `${Math.round(left)}px`;
    const arrowCenter = anchor.left + anchor.width / 2 - left;
    arrow.style.left = `${
      Math.round(
        Math.min(
          Math.max(arrowCenter, ARROW_SIZE),
          Math.max(ARROW_SIZE, box.width - ARROW_SIZE),
        ),
      )
    }px`;
  }

  function open(trigger: HTMLElement): void {
    const text = trigger.getAttribute("aria-label");
    if (destroyed || text === null || !trigger.isConnected) return;
    clearOpenTimer();
    openTrigger?.removeAttribute("aria-describedby");
    openTrigger = trigger;
    label.textContent = text;
    document.body.append(surface);
    trigger.setAttribute("aria-describedby", id);
    surface.dataset.state = "open";
    position(trigger);
  }

  function close(): void {
    clearOpenTimer();
    if (openTrigger === null) return;
    openTrigger.removeAttribute("aria-describedby");
    openTrigger = null;
    surface.dataset.state = "closed";
    surface.remove();
  }

  function requestOpen(trigger: HTMLElement): void {
    clearOpenTimer();
    openTimer = globalThis.setTimeout(() => open(trigger), OPEN_DELAY);
  }

  function requestClose(trigger: HTMLElement): void {
    clearOpenTimer();
    if (openTrigger !== trigger) return;
    close();
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") close();
  }

  globalThis.addEventListener("keydown", handleKeydown, true);
  globalThis.addEventListener("scroll", close, true);
  globalThis.addEventListener("resize", close);

  return {
    attach(trigger) {
      if (trigger.dataset.tooltip === id) return;
      trigger.dataset.tooltip = id;
      trigger.addEventListener("pointerenter", () => requestOpen(trigger));
      trigger.addEventListener("pointerleave", () => requestClose(trigger));
      trigger.addEventListener("focus", () => open(trigger));
      trigger.addEventListener("blur", () => requestClose(trigger));
      trigger.addEventListener("pointerdown", close);
      trigger.addEventListener("click", close);
    },
    destroy() {
      destroyed = true;
      close();
      globalThis.removeEventListener("keydown", handleKeydown, true);
      globalThis.removeEventListener("scroll", close, true);
      globalThis.removeEventListener("resize", close);
    },
  };
}
