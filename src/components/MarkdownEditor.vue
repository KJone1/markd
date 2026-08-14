<script setup lang="ts">
import { Crepe } from "@milkdown/crepe";
import "@milkdown/crepe/theme/common/style.css";
import "@milkdown/crepe/theme/frame.css";
import { replaceAll } from "@milkdown/kit/utils";
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  frontmatterFeature,
  prepareFrontmatterMarkdown,
} from "../editor/frontmatter.ts";
import {
  preparePromptSectionMarkdown,
  promptSectionsFeature,
} from "../editor/prompt-sections.ts";

function prepareMarkdown(markdown: string): string {
  return preparePromptSectionMarkdown(prepareFrontmatterMarkdown(markdown));
}

const props = defineProps<{
  path: string;
  content: string;
  resolveImage?: (path: string) => Promise<string>;
}>();
const emit = defineEmits<{
  change: [content: string];
}>();

const host = ref<HTMLElement>();
let crepe: Crepe | null = null;
let createFinished = false;
let destroyRequested = false;
let destroyed = false;
let applyingExternalChange = false;
let controlObserver: MutationObserver | null = null;

function isEphemeralImageUrl(url: string): boolean {
  return url.trim().toLowerCase().startsWith("blob:");
}

function preventEphemeralImageConfirmation(event: Event): void {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const imageEdit = target.closest(".image-edit, .empty-image-inline");
  if (imageEdit === null) return;
  const isConfirmation = target.closest(".confirm") !== null ||
    (event instanceof KeyboardEvent && event.key === "Enter" &&
      target.matches(".link-input-area"));
  if (!isConfirmation) return;
  const input = imageEdit.querySelector<HTMLInputElement>(".link-input-area");
  if (input === null || !isEphemeralImageUrl(input.value)) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  input.setAttribute("aria-invalid", "true");
}

function enhanceKeyboardButton(
  control: HTMLElement,
  label: string,
  activationEvent = "pointerdown",
): void {
  control.setAttribute("aria-label", label);
  if (control.tagName === "BUTTON") return;
  control.setAttribute("role", "button");
  control.setAttribute("tabindex", "0");
  if (control.dataset.keyboardActivation === "true") return;
  control.dataset.keyboardActivation = "true";
  control.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    if (activationEvent === "click") {
      control.click();
      return;
    }
    control.dispatchEvent(new MouseEvent(activationEvent, {
      bubbles: true,
      cancelable: true,
    }));
  });
}

function enhanceImageResizeHandle(control: HTMLElement): void {
  const image = control.parentElement?.querySelector<HTMLImageElement>(
    'img[data-type="image-block"]',
  );
  const originHeight = Number(image?.dataset.origin) || 100;
  const currentHeight = Number(image?.dataset.height) ||
    image?.getBoundingClientRect().height || originHeight;
  const currentRatio = currentHeight / originHeight;
  control.setAttribute("role", "slider");
  control.setAttribute("tabindex", "0");
  control.setAttribute("aria-label", "Resize image");
  control.setAttribute("aria-orientation", "vertical");
  control.setAttribute("aria-valuemin", "10");
  control.setAttribute("aria-valuemax", "1000");
  control.setAttribute("aria-valuenow", `${Math.round(currentRatio * 100)}`);
  control.setAttribute(
    "aria-valuetext",
    `${Math.round(currentRatio * 100)} percent`,
  );
  if (control.dataset.keyboardAdjustment === "true") return;
  control.dataset.keyboardAdjustment = "true";
  control.addEventListener("keydown", (event) => {
    const direction = event.key === "ArrowUp" || event.key === "ArrowRight"
      ? 0.1
      : event.key === "ArrowDown" || event.key === "ArrowLeft"
      ? -0.1
      : 0;
    if (direction === 0 || image == null) return;
    event.preventDefault();
    const origin = Number(image.dataset.origin) || 100;
    const height = Number(image.dataset.height) ||
      image.getBoundingClientRect().height || origin;
    const ratio = Math.min(10, Math.max(0.1, height / origin + direction));
    const targetHeight = origin * ratio;
    image.dataset.origin = `${origin}`;
    image.dataset.height = `${height}`;
    control.dispatchEvent(new MouseEvent("pointerdown", {
      bubbles: true,
      cancelable: true,
    }));
    window.dispatchEvent(new MouseEvent("pointermove", {
      bubbles: true,
      cancelable: true,
      clientY: image.getBoundingClientRect().top + targetHeight,
    }));
    window.dispatchEvent(new MouseEvent("pointerup", {
      bubbles: true,
      cancelable: true,
    }));
    control.setAttribute("aria-valuenow", `${Math.round(ratio * 100)}`);
    control.setAttribute(
      "aria-valuetext",
      `${Math.round(ratio * 100)} percent`,
    );
  });
}

function labelEditorControls(): void {
  const editable = host.value?.querySelector<HTMLElement>(
    '[contenteditable="true"]',
  );
  editable?.setAttribute("role", "textbox");
  editable?.setAttribute("aria-label", `Editing ${props.path}`);
  editable?.setAttribute("aria-multiline", "true");

  const controlLabels = [
    [".link-icon", "Copy link", "pointerdown"],
    [".link-edit-button", "Edit link", "pointerdown"],
    [".link-remove-button", "Remove link", "pointerdown"],
    [".link-edit .confirm", "Confirm link", "pointerdown"],
    [".milkdown-latex-inline-edit button", "Confirm formula", "pointerdown"],
    [".preview-toggle-button", "Toggle code preview", "pointerdown"],
    [".image-wrapper .operation-item", "Toggle image caption", "pointerdown"],
    [".image-edit .confirm, .empty-image-inline .confirm", "Confirm image", "click"],
    [".image-edit .placeholder .text, .empty-image-inline .placeholder .text", "Enter image URL", "click"],
    ["[data-role='col-drag-handle'] button:nth-of-type(1)", "Align column left", "pointerdown"],
    ["[data-role='col-drag-handle'] button:nth-of-type(2)", "Align column center", "pointerdown"],
    ["[data-role='col-drag-handle'] button:nth-of-type(3)", "Align column right", "pointerdown"],
    ["[data-role='col-drag-handle'] button:nth-of-type(4)", "Delete column", "pointerdown"],
    ["[data-role='row-drag-handle'] button", "Delete row", "pointerdown"],
    ["[data-role='x-line-drag-handle'] button", "Add row", "pointerdown"],
    ["[data-role='y-line-drag-handle'] button", "Add column", "pointerdown"],
    [".milkdown-top-bar .top-bar-item:nth-of-type(1)", "Bold", "pointerdown"],
    [".milkdown-top-bar .top-bar-item:nth-of-type(2)", "Italic", "pointerdown"],
    [".milkdown-top-bar .top-bar-item:nth-of-type(3)", "Strikethrough", "pointerdown"],
    [".milkdown-top-bar .top-bar-item:nth-of-type(4)", "Inline code", "pointerdown"],
    [".milkdown-top-bar .top-bar-item:nth-of-type(5)", "Bullet list", "pointerdown"],
    [".milkdown-top-bar .top-bar-item:nth-of-type(6)", "Ordered list", "pointerdown"],
    [".milkdown-top-bar .top-bar-item:nth-of-type(7)", "Task list", "pointerdown"],
    [".milkdown-top-bar .top-bar-item:nth-of-type(8)", "Insert link", "pointerdown"],
    [".milkdown-top-bar .top-bar-item:nth-of-type(9)", "Insert image", "pointerdown"],
    [".milkdown-top-bar .top-bar-item:nth-of-type(10)", "Insert table", "pointerdown"],
    [".milkdown-top-bar .top-bar-item:nth-of-type(11)", "Code block", "pointerdown"],
    [".milkdown-top-bar .top-bar-item:nth-of-type(12)", "Quote", "pointerdown"],
    [".milkdown-top-bar .top-bar-item:nth-of-type(13)", "Divider", "pointerdown"],
  ] as const;
  for (const [selector, label, activationEvent] of controlLabels) {
    host.value?.querySelectorAll<HTMLElement>(selector).forEach((control) => {
      enhanceKeyboardButton(control, label, activationEvent);
    });
  }
  host.value?.querySelectorAll<HTMLElement>(".image-resize-handle").forEach(
    enhanceImageResizeHandle,
  );
  host.value?.querySelectorAll<HTMLInputElement>(".caption-input").forEach(
    (input) => input.setAttribute("aria-label", "Image caption"),
  );
  host.value?.querySelectorAll<HTMLInputElement>(".link-input-area")
    .forEach((input) => {
      input.setAttribute("aria-label", "Image URL");
      if (!isEphemeralImageUrl(input.value)) input.removeAttribute("aria-invalid");
    });
  host.value?.querySelectorAll<HTMLElement>(".uploader").forEach(
    (upload) => {
      const fileInput = upload.parentElement?.querySelector<HTMLInputElement>(
        'input[type="file"]',
      );
      fileInput?.remove();
      upload.remove();
    },
  );
  host.value?.querySelectorAll<HTMLImageElement>('img[data-type="image-block"]')
    .forEach((image) => {
      if (!image.hasAttribute("alt")) image.setAttribute("alt", "");
    });
  host.value?.querySelectorAll<HTMLAnchorElement>(".link-display").forEach(
    (link) => {
      link.setAttribute("aria-label", "Open link");
    },
  );
}

function destroyEditor(): void {
  if (crepe === null || destroyed) return;
  if (!createFinished) {
    destroyRequested = true;
    return;
  }
  destroyed = true;
  controlObserver?.disconnect();
  controlObserver = null;
  host.value?.removeEventListener(
    "keydown",
    preventEphemeralImageConfirmation,
    true,
  );
  host.value?.removeEventListener(
    "click",
    preventEphemeralImageConfirmation,
    true,
  );
  void crepe.destroy();
  crepe = null;
}

onMounted(async () => {
  if (host.value === undefined) return;
  const instance = new Crepe({
    root: host.value,
    defaultValue: props.content,
    features: {
      [Crepe.Feature.AI]: false,
      [Crepe.Feature.BlockEdit]: false,
      [Crepe.Feature.ImageBlock]: true,
      [Crepe.Feature.LinkTooltip]: true,
      [Crepe.Feature.Toolbar]: false,
      [Crepe.Feature.TopBar]: true,
    },
    featureConfigs: {
      [Crepe.Feature.ImageBlock]: {
        proxyDomURL: (url: string) => props.resolveImage?.(url) ?? url,
        inlineOnUpload: () =>
          Promise.reject(new Error("File upload is unavailable")),
        blockOnUpload: () =>
          Promise.reject(new Error("File upload is unavailable")),
      },
      [Crepe.Feature.TopBar]: {
        buildTopBar: (builder) => {
          const block = builder.getGroup("block");
          block.group.items = block.group.items.filter(
            (item) => item.key !== "math",
          );
        },
      },
    },
  });
  instance.addFeature(frontmatterFeature);
  instance.addFeature(promptSectionsFeature);
  crepe = instance;
  instance.on((listener) => {
    listener.markdownUpdated((_context, markdown, previousMarkdown) => {
      if (
        applyingExternalChange || markdown === previousMarkdown ||
        markdown === props.content || markdown.includes("](blob:")
      ) return;
      emit("change", markdown);
    });
  });

  await instance.create();
  createFinished = true;
  if (destroyRequested) {
    destroyEditor();
    return;
  }
  labelEditorControls();
  controlObserver = new MutationObserver(labelEditorControls);
  controlObserver.observe(host.value, { childList: true, subtree: true });
  host.value.addEventListener(
    "keydown",
    preventEphemeralImageConfirmation,
    true,
  );
  host.value.addEventListener(
    "click",
    preventEphemeralImageConfirmation,
    true,
  );
  if (instance.getMarkdown() !== props.content) {
    applyingExternalChange = true;
    instance.editor.action(replaceAll(prepareMarkdown(props.content)));
    applyingExternalChange = false;
  }
});

watch(() => props.content, (content) => {
  if (!createFinished || crepe === null || crepe.getMarkdown() === content) {
    return;
  }
  applyingExternalChange = true;
  crepe.editor.action(replaceAll(prepareMarkdown(content)));
  applyingExternalChange = false;
});

watch(() => props.path, labelEditorControls);

onBeforeUnmount(destroyEditor);
</script>

<template>
  <section
    ref="host"
    class="markdown-editor"
    :aria-label="`Markdown editor for ${path}`"
  />
</template>
