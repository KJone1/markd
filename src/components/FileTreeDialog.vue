<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import fuzzysort from "fuzzysort";
import { createTreeCollection, TreeView } from "@ark-ui/vue/tree-view";
import FileTreeNode from "./FileTreeNode.vue";
import type { WorkspaceEntry } from "../shared/desktop.ts";

interface SearchSegment {
  text: string;
  hl: boolean;
}

interface SearchRow {
  entry: WorkspaceEntry;
  dirname: string;
  nameSegments: SearchSegment[];
  dirSegments: SearchSegment[];
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

const treePane = ref<HTMLElement>();
const expandedValue = ref<string[]>([]);
const selectedPath = ref<string | null>(null);
const searchMode = ref(false);
const query = ref("");
const searchSelected = ref(0);
const searchInput = ref<HTMLInputElement>();
let returnFocus: HTMLElement | null = null;

const selectedValue = computed(() =>
  props.currentPath !== null && hasPath(props.entries, props.currentPath)
    ? [props.currentPath]
    : []
);

const collection = computed(() =>
  createTreeCollection<WorkspaceEntry>({
    nodeToValue: (node) => node.path,
    nodeToString: (node) => node.name,
    rootNode: {
      kind: "directory",
      name: "",
      path: "",
      children: props.entries,
    },
  })
);

const allFiles = computed(() => collectFiles(props.entries));
const searchRows = computed<SearchRow[]>(() => {
  if (query.value === "") {
    return allFiles.value.map((entry) => searchRowFor(entry, null));
  }
  return fuzzysort
    .go(query.value, allFiles.value, { key: "path", limit: 200 })
    .map((result) => searchRowFor(result.obj, new Set(result.indexes)));
});
const searchIndex = computed(() =>
  Math.min(searchSelected.value, Math.max(0, searchRows.value.length - 1))
);
const searchActiveId = computed(() => {
  const row = searchRows.value[searchIndex.value];
  return row === undefined ? undefined : searchItemId(row.entry.path);
});

watch(
  () => props.open,
  (open, wasOpen) => {
    if (open) {
      if (!wasOpen) {
        returnFocus = document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      }
      searchMode.value = false;
      query.value = "";
      selectCurrentOrRoot();
      void revealSelected();
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
    if (!props.open || searchMode.value) return;
    selectCurrentOrRoot();
    void revealSelected();
  },
);

watch(
  () => props.entries,
  () => {
    if (!props.open || searchMode.value) return;
    selectCurrentOrRoot();
    void revealSelected();
  },
);

watch(query, () => {
  searchSelected.value = 0;
});

function selectCurrentOrRoot(): void {
  if (props.currentPath !== null && hasPath(props.entries, props.currentPath)) {
    const merged = new Set([
      ...expandedValue.value,
      ...ancestorsOf(props.currentPath),
    ]);
    expandedValue.value = [...merged];
    selectedPath.value = props.currentPath;
    return;
  }
  if (
    selectedPath.value === null || !hasPath(props.entries, selectedPath.value)
  ) {
    selectedPath.value = props.entries[0]?.path ?? null;
  }
}

async function revealSelected(): Promise<void> {
  await nextTick();
  const pane = treePane.value;
  if (pane === undefined) return;
  const path = selectedPath.value;
  const target = path === null ? null : pane.querySelector<HTMLElement>(
    `[data-part="branch-control"][data-value="${CSS.escape(path)}"], ` +
      `[data-part="item"][data-value="${CSS.escape(path)}"]`,
  );
  if (target === null) {
    pane.focus();
    return;
  }
  target.focus({ preventScroll: true });
  target.scrollIntoView({ block: "nearest" });
}

function activateFile(path: string): void {
  emit("openFile", path);
  emit("close");
}

function collectFiles(entries: WorkspaceEntry[]): WorkspaceEntry[] {
  return entries.flatMap((entry) =>
    entry.kind === "directory" ? collectFiles(entry.children) : [entry]
  );
}

function searchRowFor(
  entry: WorkspaceEntry,
  indexes: Set<number> | null,
): SearchRow {
  const slash = entry.path.lastIndexOf("/");
  const dirname = slash === -1 ? "" : entry.path.slice(0, slash);
  return {
    entry,
    dirname,
    nameSegments: toSegments(entry.name, slash + 1, indexes),
    dirSegments: toSegments(dirname, 0, indexes),
  };
}

function toSegments(
  text: string,
  start: number,
  indexes: Set<number> | null,
): SearchSegment[] {
  if (indexes === null) return text === "" ? [] : [{ text, hl: false }];
  const segments: SearchSegment[] = [];
  for (let i = 0; i < text.length; i++) {
    const hl = indexes.has(start + i);
    const last = segments[segments.length - 1];
    if (last !== undefined && last.hl === hl) last.text += text[i];
    else segments.push({ text: text[i], hl });
  }
  return segments;
}

async function enterSearch(): Promise<void> {
  searchMode.value = true;
  query.value = "";
  searchSelected.value = 0;
  await nextTick();
  searchInput.value?.focus();
}

async function exitSearch(): Promise<void> {
  searchMode.value = false;
  await revealSelected();
}

async function revealSearchSelected(): Promise<void> {
  await nextTick();
  const row = searchRows.value[searchIndex.value];
  if (row === undefined) return;
  document.getElementById(searchItemId(row.entry.path))?.scrollIntoView({
    block: "nearest",
  });
}

function handleSearchKeydown(event: KeyboardEvent): void {
  if (event.key === "Tab") {
    event.preventDefault();
    return;
  }
  if (event.key === "Escape") {
    event.preventDefault();
    void exitSearch();
    return;
  }
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    const direction = event.key === "ArrowDown" ? 1 : -1;
    searchSelected.value = Math.min(
      Math.max(0, searchRows.value.length - 1),
      Math.max(0, searchIndex.value + direction),
    );
    void revealSearchSelected();
    return;
  }
  if (event.key === "Home" || event.key === "End") {
    event.preventDefault();
    searchSelected.value = event.key === "Home"
      ? 0
      : Math.max(0, searchRows.value.length - 1);
    void revealSearchSelected();
    return;
  }
  if (event.key === "Enter") {
    event.preventDefault();
    const row = searchRows.value[searchIndex.value];
    if (row !== undefined) activateFile(row.entry.path);
  }
}

function handleTreeKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    event.preventDefault();
    emit("close");
    return;
  }
  if (
    event.key === "/" && !event.metaKey && !event.ctrlKey && !event.altKey
  ) {
    event.preventDefault();
    void enterSearch();
    return;
  }
  if (event.key === "Tab") event.preventDefault();
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

function searchItemId(path: string): string {
  return `markd-search-item-${encodeURIComponent(path)}`;
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
        <div class="tree-dialog-keys" aria-hidden="true">
          <span v-if="!searchMode" class="tree-dialog-key">/</span>
          <span class="tree-dialog-key">Esc</span>
        </div>
      </header>
      <div
        v-if="!searchMode"
        ref="treePane"
        class="file-tree"
        tabindex="-1"
        @keydown.capture="handleTreeKeydown"
      >
        <TreeView.Root
          v-if="entries.length > 0"
          v-model:expanded-value="expandedValue"
          :selected-value="selectedValue"
          :collection="collection"
          class="file-tree-root"
        >
          <TreeView.Label class="visually-hidden">Workspace files</TreeView.Label>
          <TreeView.Tree class="file-tree-list">
            <FileTreeNode
              v-for="(node, index) in entries"
              :key="node.path"
              :node="node"
              :index-path="[index]"
              :on-file-open="activateFile"
            />
          </TreeView.Tree>
        </TreeView.Root>
        <p v-else class="file-tree-empty">
          No eligible files in this workspace.
        </p>
      </div>
      <div v-else class="file-search">
        <input
          ref="searchInput"
          v-model="query"
          class="file-search-input"
          type="text"
          role="combobox"
          aria-label="Search files"
          aria-autocomplete="list"
          aria-expanded="true"
          aria-controls="markd-search-list"
          :aria-activedescendant="searchActiveId"
          placeholder="Search files"
          @keydown="handleSearchKeydown"
        />
        <div
          id="markd-search-list"
          class="file-search-list"
          role="listbox"
          aria-label="Matching files"
        >
          <button
            v-for="(row, index) in searchRows"
            :id="searchItemId(row.entry.path)"
            :key="row.entry.path"
            class="file-search-item"
            :class="{ 'file-search-item-selected': index === searchIndex }"
            type="button"
            tabindex="-1"
            role="option"
            :aria-selected="index === searchIndex"
            @mousedown.prevent
            @mouseenter="searchSelected = index"
            @click="activateFile(row.entry.path)"
          >
            <svg
              class="file-tree-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
              <path d="M14 2v4a2 2 0 0 0 2 2h4" />
            </svg>
            <span class="file-tree-name">
              <template v-for="(segment, i) in row.nameSegments" :key="i">
                <span v-if="segment.hl" class="file-search-hl">{{ segment.text }}</span>
                <template v-else>{{ segment.text }}</template>
              </template>
            </span>
            <span v-if="row.dirname !== ''" class="file-search-dir">
              <template v-for="(segment, i) in row.dirSegments" :key="i">
                <span v-if="segment.hl" class="file-search-hl">{{ segment.text }}</span>
                <template v-else>{{ segment.text }}</template>
              </template>
            </span>
          </button>
          <p v-if="searchRows.length === 0" class="file-tree-empty">
            No files match "{{ query }}".
          </p>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.tree-dialog-backdrop {
  position: fixed;
  z-index: 30;
  inset: 0;
  display: grid;
  place-items: center;
  padding: var(--space-md);
  background: rgb(15 23 42 / 32%);
}

.tree-dialog {
  width: min(100%, 640px);
  max-height: min(720px, calc(100vh - 32px));
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  background: var(--color-surface);
  border: 1px solid var(--color-hairline);
  border-radius: var(--radius-lg);
  box-shadow: 0 16px 32px rgb(15 23 42 / 16%);
}

.tree-dialog:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: -2px;
}

.tree-dialog-header {
  min-height: 72px;
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-md);
  padding: var(--space-md) var(--space-lg);
  border-bottom: 1px solid var(--color-hairline);
}

.tree-dialog-header h2 {
  margin: 0;
  color: var(--color-ink);
  font-size: 18px;
  line-height: 1.4;
}

.tree-dialog-eyebrow {
  margin: 0 0 4px;
  color: var(--color-muted);
  font-size: 13px;
  font-weight: 500;
}

.tree-dialog-keys {
  display: flex;
  gap: 6px;
}

.tree-dialog-key {
  min-width: 40px;
  padding: 4px 8px;
  color: var(--color-muted);
  background: var(--color-hairline-soft);
  border-radius: 6px;
  font-size: 13px;
  text-align: center;
}

.file-tree {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 8px;
  outline: none;
}

.file-tree-root {
  --tree-item-gap: 0.5rem;
  --tree-indentation: 1rem;
  --tree-padding-inline: 0.75rem;
  --tree-padding-block: 0.375rem;
  --tree-icon-size: 1rem;
  --tree-chevron-size: 0.875rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  width: 100%;
  color: var(--color-ink);
}

.file-tree-list {
  display: flex;
  flex-direction: column;
  font-size: 0.875rem;
  line-height: 1.25rem;
}

.file-tree-icon {
  width: 16px;
  height: 16px;
  flex: 0 0 16px;
  color: var(--color-muted);
}

.file-tree-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-tree-empty {
  margin: 0;
  padding: var(--space-lg);
  color: var(--color-muted);
  font-size: 14px;
  text-align: center;
}

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  border: 0;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}

.file-search {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.file-search-input {
  margin: 8px 8px 0;
  padding: 8px 12px;
  color: var(--color-ink);
  background: transparent;
  border: 1px solid var(--color-hairline);
  border-radius: 6px;
  font: inherit;
  font-size: 14px;
}

.file-search-input:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: -2px;
}

.file-search-list {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 8px;
}

.file-search-item {
  width: 100%;
  min-height: 40px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  color: var(--color-ink);
  background: transparent;
  border: 0;
  border-radius: 6px;
  font-size: 14px;
  line-height: 1.5;
  text-align: left;
  cursor: pointer;
}

.file-search-item-selected {
  background: var(--color-hairline-soft);
}

.file-search-item .file-tree-name {
  flex: 0 0 auto;
}

.file-search-dir {
  margin-left: auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--color-muted);
  font-size: 13px;
}

.file-search-hl {
  color: var(--color-primary);
  font-weight: 600;
}
</style>
