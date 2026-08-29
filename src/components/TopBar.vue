<script setup lang="ts">
import { Menu } from "@ark-ui/vue/menu";
import { Tooltip } from "@ark-ui/vue/tooltip";
import { computed } from "vue";
import {
  copyPathIcon,
  detailsIcon,
  fileTreeIcon,
  indentIcon,
  outdentIcon,
  topBarIcons,
  zedIcon,
} from "../editor/icons.ts";
import type {
  ApplicationTopBarActionId,
  EditorTopBarActionId,
  TopBarActionId,
  TopBarState,
} from "../editor/top-bar.ts";

type ActiveStateKey =
  | "bold"
  | "italic"
  | "strikethrough"
  | "inlineCode"
  | "link"
  | "bulletList"
  | "orderedList"
  | "taskList"
  | "codeBlock"
  | "quote";

interface TopBarButton {
  id: TopBarActionId;
  label: string;
  icon: string;
  activeState?: ActiveStateKey;
}

interface TopBarGroup {
  id: string;
  label: string;
  buttons: readonly TopBarButton[];
}

const props = defineProps<{
  state: TopBarState;
}>();

const emit = defineEmits<{
  run: [action: TopBarActionId];
}>();

const applicationActions = new Set<ApplicationTopBarActionId>([
  "browse-files",
  "copy-path",
  "open-in-zed",
]);

const headingOptions = [
  { id: "heading-paragraph", label: "Paragraph" },
  { id: "heading-1", label: "Heading 1" },
  { id: "heading-2", label: "Heading 2" },
  { id: "heading-3", label: "Heading 3" },
  { id: "heading-4", label: "Heading 4" },
  { id: "heading-5", label: "Heading 5" },
  { id: "heading-6", label: "Heading 6" },
] as const satisfies ReadonlyArray<{
  id: EditorTopBarActionId;
  label: string;
}>;

const groups: readonly TopBarGroup[] = [
  {
    id: "formatting",
    label: "Formatting",
    buttons: [
      {
        id: "bold",
        label: "Bold",
        icon: topBarIcons.boldIcon,
        activeState: "bold",
      },
      {
        id: "italic",
        label: "Italic",
        icon: topBarIcons.italicIcon,
        activeState: "italic",
      },
      {
        id: "strikethrough",
        label: "Strikethrough",
        icon: topBarIcons.strikethroughIcon,
        activeState: "strikethrough",
      },
      {
        id: "inline-code",
        label: "Inline code",
        icon: topBarIcons.codeIcon,
        activeState: "inlineCode",
      },
    ],
  },
  {
    id: "list",
    label: "List",
    buttons: [
      {
        id: "bullet-list",
        label: "Bullet list",
        icon: topBarIcons.bulletListIcon,
        activeState: "bulletList",
      },
      {
        id: "ordered-list",
        label: "Ordered list",
        icon: topBarIcons.orderedListIcon,
        activeState: "orderedList",
      },
      {
        id: "task-list",
        label: "Task list",
        icon: topBarIcons.taskListIcon,
        activeState: "taskList",
      },
      { id: "indent", label: "Indent list item", icon: indentIcon },
      { id: "outdent", label: "Outdent list item", icon: outdentIcon },
    ],
  },
  {
    id: "insert",
    label: "Insert",
    buttons: [
      {
        id: "link",
        label: "Insert link",
        icon: topBarIcons.linkIcon,
        activeState: "link",
      },
      { id: "image", label: "Insert image", icon: topBarIcons.imageIcon },
      { id: "table", label: "Insert table", icon: topBarIcons.tableIcon },
    ],
  },
  {
    id: "block",
    label: "Block",
    buttons: [
      {
        id: "code-block",
        label: "Code block",
        icon: topBarIcons.codeBlockIcon,
        activeState: "codeBlock",
      },
      {
        id: "details",
        label: "Insert collapsible section",
        icon: detailsIcon,
      },
    ],
  },
  {
    id: "more",
    label: "More",
    buttons: [
      {
        id: "quote",
        label: "Quote",
        icon: topBarIcons.quoteIcon,
        activeState: "quote",
      },
      { id: "divider", label: "Divider", icon: topBarIcons.hrIcon },
    ],
  },
  {
    id: "document",
    label: "Document",
    buttons: [
      { id: "browse-files", label: "Browse files", icon: fileTreeIcon },
      { id: "copy-path", label: "Copy file path", icon: copyPathIcon },
      { id: "open-in-zed", label: "Open in Zed", icon: zedIcon },
    ],
  },
];

const headingAction = computed<EditorTopBarActionId>(() =>
  props.state.headingLevel === null
    ? "heading-paragraph"
    : `heading-${props.state.headingLevel}` as EditorTopBarActionId
);

const headingLabel = computed(() =>
  headingOptions.find((option) => option.id === headingAction.value)?.label ??
    "Paragraph"
);

const editorControlsDisabled = computed(() =>
  !props.state.ready || !props.state.editable
);

function tooltipLabel(triggerValue: string | null): string {
  for (const group of groups) {
    const button = group.buttons.find(
      (entry) => entry.id === triggerValue,
    );
    if (button !== undefined) return button.label;
  }
  return "";
}

function isApplicationAction(
  action: TopBarActionId,
): action is ApplicationTopBarActionId {
  return applicationActions.has(action as ApplicationTopBarActionId);
}

function isDisabled(action: TopBarActionId): boolean {
  return !isApplicationAction(action) && editorControlsDisabled.value;
}

function pressedState(button: TopBarButton): boolean | undefined {
  return button.activeState === undefined
    ? undefined
    : props.state[button.activeState];
}

function run(action: TopBarActionId): void {
  if (!isDisabled(action)) emit("run", action);
}

function selectHeading(action: string): void {
  const option = headingOptions.find((entry) => entry.id === action);
  if (option !== undefined && !editorControlsDisabled.value) {
    emit("run", option.id);
  }
}
</script>

<template>
  <Tooltip.Root
    id="editor-top-bar-tooltip"
    :open-delay="400"
    :close-delay="0"
    :close-on-click="true"
    :close-on-escape="true"
    :close-on-pointer-down="true"
    :close-on-scroll="true"
    lazy-mount
    unmount-on-exit
    :positioning="{
      placement: 'top',
      strategy: 'fixed',
      gutter: 8,
      flip: true,
      slide: true,
      overflowPadding: 8,
      hideWhenDetached: true,
    }"
  >
    <div
      class="editor-top-bar"
      role="toolbar"
      aria-label="Markdown formatting"
    >
      <div class="editor-top-bar-group" role="group" aria-label="Heading">
        <Menu.Root
          :positioning="{
            placement: 'bottom-start',
            strategy: 'fixed',
            gutter: 6,
            flip: true,
            slide: true,
            overflowPadding: 8,
            hideWhenDetached: true,
          }"
        >
          <Menu.Trigger as-child>
            <button
              type="button"
              class="editor-top-bar-heading"
              :disabled="editorControlsDisabled"
            >
              <span>{{ headingLabel }}</span>
              <span
                class="editor-top-bar-chevron"
                aria-hidden="true"
                v-html="topBarIcons.chevronDownIcon"
              />
            </button>
          </Menu.Trigger>
          <Teleport to="body">
            <Menu.Positioner class="editor-heading-menu-positioner">
              <Menu.Content class="editor-heading-menu-content">
                <Menu.RadioItemGroup
                  id="editor-heading-level"
                  :model-value="headingAction"
                  @update:model-value="selectHeading"
                >
                  <Menu.RadioItem
                    v-for="option in headingOptions"
                  :key="option.id"
                  :value="option.id"
                  class="editor-heading-menu-item"
                >
                    <Menu.ItemIndicator class="editor-heading-menu-indicator">
                      ✓
                    </Menu.ItemIndicator>
                    <Menu.ItemText>{{ option.label }}</Menu.ItemText>
                  </Menu.RadioItem>
                </Menu.RadioItemGroup>
              </Menu.Content>
            </Menu.Positioner>
          </Teleport>
        </Menu.Root>
      </div>

      <template v-for="group in groups" :key="group.id">
        <div class="editor-top-bar-separator" aria-hidden="true" />
        <div
          class="editor-top-bar-group"
          role="group"
          :aria-label="group.label"
          :data-group="group.id"
        >
          <Tooltip.Trigger
            v-for="button in group.buttons"
            :key="button.id"
            :value="button.id"
            as-child
          >
            <button
              type="button"
              class="editor-top-bar-item"
              :aria-label="button.label"
              :aria-pressed="pressedState(button)"
              :disabled="isDisabled(button.id)"
              :data-action="button.id"
              @mousedown.prevent
              @click="run(button.id)"
            >
              <span
                class="editor-top-bar-icon"
                aria-hidden="true"
                v-html="button.icon"
              />
            </button>
          </Tooltip.Trigger>
        </div>
      </template>
    </div>

    <Teleport to="body">
      <Tooltip.Positioner class="editor-tooltip-positioner">
        <Tooltip.Content class="editor-tooltip-content">
          <Tooltip.Context v-slot="tooltip">
            {{ tooltipLabel(tooltip.triggerValue) }}
          </Tooltip.Context>
          <Tooltip.Arrow>
            <Tooltip.ArrowTip />
          </Tooltip.Arrow>
        </Tooltip.Content>
      </Tooltip.Positioner>
    </Teleport>
  </Tooltip.Root>
</template>

<style scoped>
.editor-top-bar {
  position: relative;
  z-index: 10;
  display: flex;
  width: 100%;
  min-height: 44px;
  flex: none;
  align-items: center;
  padding: 0 var(--space-md);
  overflow-x: auto;
  overflow-y: hidden;
  color: var(--color-body);
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-hairline);
  overscroll-behavior-x: contain;
  scrollbar-width: thin;
}

.editor-top-bar-group {
  display: flex;
  flex: none;
  align-items: center;
}

.editor-top-bar-separator {
  width: 1px;
  height: 24px;
  flex: none;
  margin: 10px;
  background: var(--color-hairline);
}

.editor-top-bar-heading,
.editor-top-bar-item {
  border: 0;
  color: var(--color-ink);
  background: transparent;
  border-radius: 4px;
  cursor: pointer;
}

.editor-top-bar-heading:hover:not(:disabled),
.editor-top-bar-item:hover:not(:disabled) {
  background: var(--color-hairline-soft);
}

.editor-top-bar-heading:focus-visible,
.editor-top-bar-item:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 1px;
}

.editor-top-bar-heading:disabled,
.editor-top-bar-item:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.editor-top-bar-heading {
  display: flex;
  min-width: 118px;
  height: 32px;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
  margin: 6px;
  padding: 4px 4px 4px 10px;
  color: var(--color-ink);
  font-size: 14px;
  font-weight: 600;
  line-height: 20px;
  text-align: left;
  white-space: nowrap;
}

.editor-top-bar-chevron {
  display: flex;
  width: 24px;
  height: 24px;
  flex: none;
  align-items: center;
  justify-content: center;
  color: var(--color-ink);
}

.editor-top-bar-chevron :deep(svg) {
  width: 16px;
  height: 16px;
  fill: none;
  stroke: currentColor;
}

.editor-top-bar-item {
  display: flex;
  width: 32px;
  height: 32px;
  flex: none;
  align-items: center;
  justify-content: center;
  margin: 6px;
  padding: 4px;
}

.editor-top-bar-item:active:not(:disabled) {
  background: var(--color-hairline-soft);
}

.editor-top-bar-item[aria-pressed="true"] {
  color: var(--color-primary-active);
  background: var(--color-hairline-soft);
}

.editor-top-bar-icon {
  display: flex;
  width: 24px;
  height: 24px;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}

.editor-top-bar-icon :deep(svg) {
  width: 24px;
  height: 24px;
  color: currentColor;
  fill: currentColor;
}

.editor-top-bar-icon :deep(svg.lucide-icon) {
  fill: none;
  stroke: currentColor;
}

.editor-heading-menu-positioner {
  z-index: 1400;
}

.editor-heading-menu-content {
  min-width: 160px;
  padding: 4px;
  color: var(--color-body);
  background: var(--color-surface);
  border: 1px solid var(--color-hairline);
  border-radius: var(--radius-md);
  box-shadow: 0 10px 15px -3px rgb(15 23 42 / 12%);
  outline: none;
}

.editor-heading-menu-item {
  display: flex;
  min-height: 36px;
  align-items: center;
  gap: var(--space-xs);
  padding: 8px 12px;
  color: var(--color-body);
  border-radius: 4px;
  font-size: 14px;
  line-height: 20px;
  white-space: nowrap;
  cursor: pointer;
  outline: none;
}

.editor-heading-menu-item[data-highlighted] {
  color: var(--color-ink);
  background: var(--color-hairline-soft);
}

.editor-heading-menu-item[data-state="checked"] {
  color: var(--color-primary-active);
  font-weight: 600;
}

.editor-heading-menu-indicator {
  width: 14px;
  flex: none;
  color: var(--color-primary-active);
  text-align: center;
}

/* Teleport preserves this component's scoped style attribute. */
.editor-tooltip-positioner {
  z-index: 1500;
  pointer-events: none;
}

.editor-tooltip-content {
  --arrow-background: var(--color-ink);
  --arrow-size: 8px;

  padding: 4px var(--space-xs);
  color: var(--color-surface);
  background: var(--color-ink);
  border-radius: 6px;
  box-shadow: 0 4px 12px rgb(15 23 42 / 8%);
  font-size: 12px;
  font-weight: 500;
  line-height: 16px;
  white-space: nowrap;
  pointer-events: none;
  transform: scale(0.95);
  transform-origin: var(--transform-origin);
  opacity: 0;
  transition: opacity 150ms ease-out, transform 150ms ease-out;
}

.editor-tooltip-content[data-state="open"] {
  transform: scale(1);
  opacity: 1;
}

.editor-tooltip-content[data-state="closed"] {
  transform: scale(0.95);
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .editor-tooltip-content {
    transition: none;
  }
}

@media (max-width: 640px) {
  .editor-top-bar {
    padding: 0 var(--space-xs);
  }
}
</style>
