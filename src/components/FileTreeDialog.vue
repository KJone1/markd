<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import type { WorkspaceEntry } from "../shared/desktop.ts";

interface VisibleEntry {
  entry: WorkspaceEntry;
  level: number;
  parentPath: string | null;
}

const props = defineProps<{
  open: boolean;
  entries: WorkspaceEntry[];
  currentPath: string | null;
}>();
const emit = defineEmits<{
  close: [];
  openFile: [path: string];
}>();

const tree = ref<HTMLElement>();
const expanded = ref(new Set<string>());
const selectedPath = ref<string | null>(null);
let returnFocus: HTMLElement | null = null;

const visibleEntries = computed(() => flatten(props.entries));
const selectedIndex = computed(() =>
  Math.max(
    0,
    visibleEntries.value.findIndex(({ entry }) => entry.path === selectedPath.value),
  )
);
const selectedId = computed(() =>
  selectedPath.value === null
    ? undefined
    : itemId(selectedPath.value)
);

watch(
  () => props.open,
  async (open, wasOpen) => {
    if (open) {
      if (!wasOpen) {
        returnFocus = document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      }
      selectCurrentOrRoot();
      await nextTick();
      tree.value?.focus();
      return;
    }
    if (wasOpen) {
      returnFocus?.focus();
      returnFocus = null;
    }
  },
  { immediate: true },
);

watch(
  () => props.currentPath,
  () => {
    if (props.open) selectCurrentOrRoot();
  },
);

watch(
  () => props.entries,
  () => {
    if (props.open) selectCurrentOrRoot();
  },
);

function flatten(
  entries: WorkspaceEntry[],
  level = 1,
  parentPath: string | null = null,
): VisibleEntry[] {
  return entries.flatMap((entry) => {
    const visible = [{ entry, level, parentPath }];
    if (entry.kind === "directory" && expanded.value.has(entry.path)) {
      visible.push(...flatten(entry.children, level + 1, entry.path));
    }
    return visible;
  });
}

function selectCurrentOrRoot(): void {
  if (props.currentPath !== null && hasPath(props.entries, props.currentPath)) {
    for (const ancestor of ancestorsOf(props.currentPath)) expanded.value.add(ancestor);
    selectedPath.value = props.currentPath;
    return;
  }
  if (!visibleEntries.value.some(({ entry }) => entry.path === selectedPath.value)) {
    selectedPath.value = visibleEntries.value[0]?.entry.path ?? null;
  }
}

function handleKeydown(event: KeyboardEvent): void {
  const current = visibleEntries.value[selectedIndex.value];
  if (event.key === "Tab") {
    event.preventDefault();
    tree.value?.focus();
    return;
  }
  if (event.key === "Escape") {
    event.preventDefault();
    emit("close");
    return;
  }
  if (current === undefined) return;

  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    const direction = event.key === "ArrowDown" ? 1 : -1;
    const nextIndex = Math.min(
      visibleEntries.value.length - 1,
      Math.max(0, selectedIndex.value + direction),
    );
    selectedPath.value = visibleEntries.value[nextIndex]?.entry.path ?? null;
    return;
  }
  if (event.key === "ArrowRight") {
    event.preventDefault();
    if (current.entry.kind === "directory") expanded.value.add(current.entry.path);
    return;
  }
  if (event.key === "ArrowLeft") {
    event.preventDefault();
    if (current.entry.kind === "directory" && expanded.value.has(current.entry.path)) {
      expanded.value.delete(current.entry.path);
    } else if (current.parentPath !== null) {
      selectedPath.value = current.parentPath;
    }
    return;
  }
  if (event.key === "Enter") {
    event.preventDefault();
    activate(current.entry);
  }
}

function activate(entry: WorkspaceEntry): void {
  selectedPath.value = entry.path;
  if (entry.kind === "directory") {
    if (expanded.value.has(entry.path)) expanded.value.delete(entry.path);
    else expanded.value.add(entry.path);
    return;
  }
  emit("openFile", entry.path);
  emit("close");
}

function hasPath(entries: WorkspaceEntry[], path: string): boolean {
  return entries.some((entry) =>
    entry.path === path ||
    (entry.kind === "directory" && hasPath(entry.children, path))
  );
}

function ancestorsOf(path: string): string[] {
  const segments = path.split("/");
  return segments.slice(0, -1).map((_, index) =>
    segments.slice(0, index + 1).join("/")
  );
}

function itemId(path: string): string {
  return `markd-tree-item-${encodeURIComponent(path)}`;
}
</script>

<template>
  <div v-show="open" class="tree-dialog-backdrop" @mousedown.self="emit('close')">
    <section
      class="tree-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="tree-dialog-title"
    >
      <header class="tree-dialog-header">
        <div>
          <p class="tree-dialog-eyebrow">Workspace</p>
          <h2 id="tree-dialog-title">Open a file</h2>
        </div>
        <span class="tree-dialog-key" aria-hidden="true">Esc</span>
      </header>
      <div
        ref="tree"
        class="file-tree"
        role="tree"
        aria-label="Workspace files"
        tabindex="0"
        :aria-activedescendant="selectedId"
        @keydown="handleKeydown"
      >
        <button
          v-for="item in visibleEntries"
          :id="itemId(item.entry.path)"
          :key="item.entry.path"
          class="file-tree-item"
          :class="{ 'file-tree-item-selected': item.entry.path === selectedPath }"
          type="button"
          tabindex="-1"
          role="treeitem"
          :aria-level="item.level"
          :aria-selected="item.entry.path === selectedPath"
          :aria-expanded="item.entry.kind === 'directory' ? expanded.has(item.entry.path) : undefined"
          :style="{ '--tree-level': item.level }"
          @mousedown.prevent
          @mouseenter="selectedPath = item.entry.path"
          @click="activate(item.entry)"
        >
          <span class="file-tree-icon" aria-hidden="true">
            {{ item.entry.kind === "directory" ? (expanded.has(item.entry.path) ? "▾" : "▸") : "·" }}
          </span>
          <span class="file-tree-name">{{ item.entry.name }}</span>
        </button>
        <p v-if="visibleEntries.length === 0" class="file-tree-empty">
          No eligible files in this workspace.
        </p>
      </div>
    </section>
  </div>
</template>
