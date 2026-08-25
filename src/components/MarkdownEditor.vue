<script setup lang="ts">
import { Crepe } from "@milkdown/crepe";
import "@milkdown/crepe/theme/common/style.css";
import "@milkdown/crepe/theme/frame.css";
import { commandsCtx } from "@milkdown/kit/core";
import {
  liftListItemCommand,
  sinkListItemCommand,
} from "@milkdown/kit/preset/commonmark";
import { replaceAll } from "@milkdown/kit/utils";
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  frontmatterFeature,
  prepareFrontmatterMarkdown,
  restoreFrontmatterSources,
} from "../editor/frontmatter.ts";
import {
  preparePromptSectionMarkdown,
  promptSectionsFeature,
  restoreMarkerSources,
} from "../editor/prompt-sections.ts";
import { createHtmlFeature } from "../editor/html.ts";
import { inlineCodeFeature } from "../editor/inline-code.ts";
import { footnotesFeature } from "../editor/footnotes.ts";
import { listIndentFeature } from "../editor/list-indent.ts";
import {
  copyPathIcon,
  fileTreeIcon,
  indentIcon,
  outdentIcon,
  zedIcon,
} from "../editor/icons.ts";
import { createTooltipHost, type TooltipHost } from "../editor/tooltips.ts";

function prepareMarkdown(markdown: string): string {
  return preparePromptSectionMarkdown(prepareFrontmatterMarkdown(markdown));
}

function savedMarkdown(markdown: string): string {
  return restoreFrontmatterSources(restoreMarkerSources(markdown))
    .replace(/\n{2,}$/, "\n");
}

const props = defineProps<{
  path: string;
  content: string;
  resolveImage?: (path: string) => Promise<string>;
}>();
const emit = defineEmits<{
  change: [content: string];
  browseFiles: [];
  copyPath: [];
  openInZed: [];
}>();

const host = ref<HTMLElement>();
let crepe: Crepe | null = null;
let createFinished = false;
let destroyRequested = false;
let destroyed = false;
let applyingExternalChange = false;
let controlObserver: MutationObserver | null = null;
let tooltips: TooltipHost | null = null;

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
    [".milkdown-top-bar .top-bar-item:nth-of-type(8)", "Indent list item", "pointerdown"],
    [".milkdown-top-bar .top-bar-item:nth-of-type(9)", "Outdent list item", "pointerdown"],
    [".milkdown-top-bar .top-bar-item:nth-of-type(10)", "Insert link", "pointerdown"],
    [".milkdown-top-bar .top-bar-item:nth-of-type(11)", "Insert image", "pointerdown"],
    [".milkdown-top-bar .top-bar-item:nth-of-type(12)", "Insert table", "pointerdown"],
    [".milkdown-top-bar .top-bar-item:nth-of-type(13)", "Code block", "pointerdown"],
    [".milkdown-top-bar .top-bar-item:nth-of-type(14)", "Quote", "pointerdown"],
    [".milkdown-top-bar .top-bar-item:nth-of-type(15)", "Divider", "pointerdown"],
    [".milkdown-top-bar .top-bar-item:nth-of-type(16)", "Browse files", "pointerdown"],
    [".milkdown-top-bar .top-bar-item:nth-of-type(17)", "Copy file path", "pointerdown"],
    [".milkdown-top-bar .top-bar-item:nth-of-type(18)", "Open in Zed", "pointerdown"],
  ] as const;
  for (const [selector, label, activationEvent] of controlLabels) {
    host.value?.querySelectorAll<HTMLElement>(selector).forEach((control) => {
      enhanceKeyboardButton(control, label, activationEvent);
    });
  }
  host.value?.querySelectorAll<HTMLElement>(
    ".milkdown-top-bar .top-bar-item",
  ).forEach((item) => {
    if (item.hasAttribute("aria-label")) tooltips?.attach(item);
  });
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
  tooltips?.destroy();
  tooltips = null;
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
          const list = builder.getGroup("list");
          list.addItem("indent", {
            icon: indentIcon,
            active: () => false,
            onRun: (ctx) => ctx.get(commandsCtx).call(sinkListItemCommand.key),
          });
          list.addItem("outdent", {
            icon: outdentIcon,
            active: () => false,
            onRun: (ctx) => ctx.get(commandsCtx).call(liftListItemCommand.key),
          });
          const block = builder.getGroup("block");
          block.group.items = block.group.items.filter(
            (item) => item.key !== "math",
          );
          const documentGroup = builder.addGroup("document", "Document");
          documentGroup.addItem("browse-files", {
            icon: fileTreeIcon,
            active: () => false,
            onRun: () => emit("browseFiles"),
          });
          documentGroup.addItem("copy-path", {
            icon: copyPathIcon,
            active: () => false,
            onRun: () => emit("copyPath"),
          });
          documentGroup.addItem("open-in-zed", {
            icon: zedIcon,
            active: () => false,
            onRun: () => emit("openInZed"),
          });
        },
      },
    },
  });
  instance.addFeature(frontmatterFeature);
  instance.addFeature(promptSectionsFeature);
  instance.addFeature(inlineCodeFeature);
  instance.addFeature(footnotesFeature);
  instance.addFeature(listIndentFeature);
  instance.addFeature(createHtmlFeature({
    resolveImage: (path) => props.resolveImage?.(path),
  }));
  crepe = instance;
  instance.on((listener) => {
    listener.markdownUpdated((_context, rawMarkdown, previousMarkdown) => {
      const markdown = savedMarkdown(rawMarkdown);
      if (
        applyingExternalChange || rawMarkdown === previousMarkdown ||
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
  tooltips = createTooltipHost();
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
  if (savedMarkdown(instance.getMarkdown()) !== props.content) {
    applyingExternalChange = true;
    instance.editor.action(replaceAll(prepareMarkdown(props.content)));
    applyingExternalChange = false;
  }
});

watch(() => props.content, (content) => {
  if (
    !createFinished || crepe === null ||
    savedMarkdown(crepe.getMarkdown()) === content
  ) {
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

<style scoped>
.markdown-editor {
  width: 100%;
  height: 100%;
  overflow: hidden auto;
  color: var(--color-body);
  background: var(--color-canvas);
  overscroll-behavior: contain;
}

/* Everything below is rendered by Milkdown plugins and src/editor/*.ts, never in this template. */
.markdown-editor :deep(.milkdown) {
  display: flex;
  flex-direction: column;
  min-height: 100%;
  --crepe-base-font-size: 16px;
  --crepe-color-background: var(--color-surface);
  --crepe-color-on-background: var(--color-body);
  --crepe-color-surface: var(--color-hairline-soft);
  --crepe-color-surface-low: var(--color-hairline);
  --crepe-color-on-surface: var(--color-ink);
  --crepe-color-on-surface-variant: var(--color-muted);
  --crepe-color-outline: var(--color-muted);
  --crepe-color-primary: var(--color-primary);
  --crepe-color-secondary: var(--color-hairline);
  --crepe-color-on-secondary: var(--color-ink);
  --crepe-color-inverse: var(--color-ink);
  --crepe-color-on-inverse: var(--color-surface);
  --crepe-color-inline-code: #b91c1c;
  --crepe-color-error: var(--color-error);
  --crepe-color-hover: var(--color-hairline-soft);
  --crepe-color-selected: #bfdbfe;
  --crepe-color-inline-area: var(--color-hairline);
  --crepe-font-title: "Cal Sans", Inter, -apple-system, BlinkMacSystemFont, sans-serif;
  --crepe-font-default: Inter, -apple-system, BlinkMacSystemFont, sans-serif;
  --crepe-font-code: "JetBrains Mono", ui-monospace, monospace;
  --crepe-shadow-1: 0 4px 12px rgb(15 23 42 / 8%);
  --crepe-shadow-2: 0 10px 15px -3px rgb(15 23 42 / 12%);
}

.markdown-editor :deep(.milkdown .milkdown-top-bar) {
  flex: none;
  padding: 0 var(--space-md);
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-hairline);
}

.markdown-editor :deep(.milkdown .milkdown-top-bar .top-bar-divider) {
  background: var(--color-hairline);
}

/* Crepe fills every top-bar svg, which turns stroke icons into blobs. */
.markdown-editor :deep(.milkdown .milkdown-top-bar .top-bar-item svg.outline-icon) {
  fill: none;
  stroke: currentColor;
}

.markdown-editor :deep(.milkdown .ProseMirror) {
  width: 100%;
  flex: 1 0 auto;
  padding: var(--space-xxl);
  color: var(--color-body);
  caret-color: var(--color-primary-active);
  overflow-wrap: anywhere;
}

.markdown-editor :deep(.milkdown .ProseMirror > *) {
  max-width: 100%;
  min-width: 0;
}

.markdown-editor :deep(.milkdown .ProseMirror:focus-visible) {
  outline: none;
}

.markdown-editor :deep(.milkdown .ProseMirror h1),
.markdown-editor :deep(.milkdown .ProseMirror h2),
.markdown-editor :deep(.milkdown .ProseMirror h3),
.markdown-editor :deep(.milkdown .ProseMirror h4),
.markdown-editor :deep(.milkdown .ProseMirror h5),
.markdown-editor :deep(.milkdown .ProseMirror h6) {
  color: var(--color-ink);
  font-weight: 600;
}

.markdown-editor :deep(.milkdown .ProseMirror h1) {
  font-size: 36px;
  line-height: 1.15;
  letter-spacing: -0.02em;
}

.markdown-editor :deep(.milkdown .ProseMirror h2) {
  font-size: 28px;
  line-height: 1.2;
  letter-spacing: -0.015em;
}

.markdown-editor :deep(.milkdown .ProseMirror h3) {
  font-size: 22px;
  line-height: 1.3;
  letter-spacing: -0.01em;
}

.markdown-editor :deep(.milkdown .ProseMirror h4),
.markdown-editor :deep(.milkdown .ProseMirror h5),
.markdown-editor :deep(.milkdown .ProseMirror h6) {
  font-size: 18px;
  line-height: 1.4;
  letter-spacing: 0;
}

.markdown-editor :deep(.milkdown .ProseMirror p),
.markdown-editor :deep(.milkdown .ProseMirror li),
.markdown-editor :deep(.milkdown .ProseMirror blockquote) {
  line-height: 1.5;
}

.markdown-editor :deep(.milkdown .ProseMirror :lang(he)) {
  line-height: 1.65;
}

.markdown-editor :deep(.milkdown .ProseMirror table) {
  font-variant-numeric: tabular-nums;
}

.markdown-editor :deep(.milkdown .milkdown-code-block) {
  margin: var(--space-md) 0;
  overflow: hidden;
  border-radius: var(--radius-md);
  --crepe-color-surface: #282c34;
  --crepe-color-surface-low: #21252b;
  --crepe-color-on-surface: #e6e6e6;
  --crepe-color-on-surface-variant: #abb2bf;
  --crepe-color-secondary: #3a4149;
  --crepe-color-hover: #3a4149;
  --crepe-color-outline: #6b7280;
}

.markdown-editor :deep(.milkdown .milkdown-code-block .milkdown-code-block-placeholder) {
  color: var(--crepe-color-on-surface-variant);
}

.markdown-editor :deep(.milkdown .milkdown-code-block .codemirror-host),
.markdown-editor :deep(.milkdown .milkdown-code-block .cm-editor) {
  max-width: 100%;
  min-width: 0;
}

.markdown-editor :deep(.milkdown .milkdown-code-block .cm-scroller) {
  overflow-x: auto;
}

.markdown-editor :deep(.milkdown .milkdown-code-block .cm-scroller::-webkit-scrollbar) {
  height: 6px;
}

.markdown-editor :deep(.milkdown .milkdown-code-block .cm-scroller::-webkit-scrollbar-track) {
  background: transparent;
}

.markdown-editor :deep(.milkdown .milkdown-code-block .cm-scroller::-webkit-scrollbar-thumb) {
  background: rgb(255 255 255 / 20%);
  border-radius: 9999px;
}

.markdown-editor :deep(.milkdown .milkdown-code-block .cm-scroller::-webkit-scrollbar-thumb:hover) {
  background: rgb(255 255 255 / 35%);
}

.markdown-editor :deep(.milkdown .milkdown-code-block .cm-line) {
  white-space: pre;
}

.markdown-editor :deep(.milkdown button),
.markdown-editor :deep(.milkdown input) {
  border-radius: var(--radius-md);
}

.markdown-editor :deep(.milkdown button:focus-visible),
.markdown-editor :deep(.milkdown input:focus-visible),
.markdown-editor :deep(.milkdown [role="button"]:focus-visible),
.markdown-editor :deep(.milkdown [role="slider"]:focus-visible) {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}

.markdown-editor :deep(.prompt-section) {
  margin: var(--space-lg) 0;
  overflow: hidden;
  background: var(--color-surface);
  border: 1px solid var(--color-hairline);
  border-radius: var(--radius-lg);
  box-shadow: 0 4px 12px rgb(15 23 42 / 5%);
}

.markdown-editor :deep(.prompt-section .prompt-section) {
  margin: var(--space-md) 0;
  background: var(--color-canvas);
}

.markdown-editor :deep(.prompt-section-opening) {
  min-height: 40px;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: var(--space-xs) var(--space-md);
  color: var(--color-muted);
  background: var(--color-hairline-soft);
  border-bottom: 1px solid var(--color-hairline);
  font-family: "JetBrains Mono", ui-monospace, monospace;
  font-size: 13px;
  line-height: 1.5;
}

.markdown-editor :deep(.prompt-section-closing) {
  display: none;
}

.markdown-editor :deep(.prompt-section-name) {
  min-width: 7ch;
  width: calc(var(--prompt-name-length, 12) * 1ch);
  max-width: 40ch;
  padding: 2px 0;
  color: var(--color-ink);
  background: transparent;
  border: 0;
  border-bottom: 1px solid transparent;
  font-family: inherit;
  font-size: inherit;
  font-weight: 600;
}

.markdown-editor :deep(.prompt-section-name:hover) {
  border-bottom-color: var(--color-hairline);
}

.markdown-editor :deep(.prompt-section-content) {
  padding: var(--space-md) var(--space-lg);
}

.markdown-editor :deep(.prompt-section-collapse) {
  min-height: 28px;
  margin-left: auto;
  padding: 4px var(--space-xs);
  color: var(--color-muted);
  background: transparent;
  border: 1px solid var(--color-hairline);
  font-size: 12px;
  cursor: pointer;
}

.markdown-editor :deep(.prompt-section-collapse:hover) {
  color: var(--color-ink);
  background: var(--color-surface);
}

.markdown-editor :deep(.prompt-section[data-prompt-collapsed="true"] > .prompt-section-content),
.markdown-editor :deep(.prompt-section[data-prompt-collapsed="true"] > .prompt-section-closing) {
  display: none;
}

.markdown-editor :deep(.html-block) {
  margin: var(--space-md) 0;
}

.markdown-editor :deep(.html-block img) {
  max-width: 100%;
  height: auto;
}

.markdown-editor :deep(.html-block-source) {
  margin: 0;
  padding: var(--space-xs) var(--space-md);
  color: var(--color-muted);
  background: var(--color-hairline-soft);
  border: 1px solid var(--color-hairline);
  border-radius: var(--radius-md);
  font-family: "JetBrains Mono", ui-monospace, monospace;
  font-size: 13px;
  white-space: pre-wrap;
  word-break: break-word;
}

.markdown-editor :deep(.html-section) {
  margin: var(--space-md) 0;
}

.markdown-editor :deep(.html-section[align="center"]),
.markdown-editor :deep(.html-block-rendered [align="center"]) {
  text-align: center;
}

.markdown-editor :deep(.html-section[align="right"]),
.markdown-editor :deep(.html-block-rendered [align="right"]) {
  text-align: right;
}

.markdown-editor :deep(.frontmatter-label) {
  font-weight: 600;
  cursor: default;
}

.markdown-editor :deep(.frontmatter-entries) {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: var(--space-xs) var(--space-md);
  margin: 0;
}

.markdown-editor :deep(.frontmatter-key) {
  color: var(--color-muted);
  font-weight: 600;
  white-space: nowrap;
}

.markdown-editor :deep(.frontmatter-value) {
  margin: 0;
  color: var(--color-ink);
  white-space: pre-wrap;
  word-break: break-word;
}

.markdown-editor :deep(.frontmatter-empty) {
  margin: 0;
  color: var(--color-muted);
}

.markdown-editor :deep(.footnote-reference),
.markdown-editor :deep(.footnote-definition) {
  transition: background 300ms ease, box-shadow 300ms ease;
}

.markdown-editor :deep(.footnote-definition) {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 0 var(--space-xs);
  margin: var(--space-xs) 0;
  font-size: 14px;
}

.markdown-editor :deep(.footnote-definition > dt) {
  font-variant-numeric: tabular-nums;
}

.markdown-editor :deep(.footnote-definition > dd) {
  min-width: 0;
  margin: 0;
}

.markdown-editor :deep(.footnote-jump) {
  padding: 0;
  color: var(--color-primary-active);
  background: transparent;
  border: 0;
  font: inherit;
  text-decoration: underline;
  text-underline-offset: 2px;
  cursor: pointer;
}

.markdown-editor :deep(.footnote-jump:hover) {
  color: var(--color-primary-pressed);
}

.markdown-editor :deep([data-footnote-flash="true"]) {
  border-radius: var(--radius-md);
  background: rgb(59 130 246 / 14%);
  box-shadow: 0 0 0 4px rgb(59 130 246 / 14%);
}

@media (max-width: 760px) {
  .markdown-editor :deep(.milkdown .ProseMirror) {
    padding: var(--space-xxl) var(--space-md);
  }
}
</style>
