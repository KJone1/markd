<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import fuzzysort from "fuzzysort";
import type { WorkspaceEntry } from "../shared/desktop.ts";

interface EntryIcon {
  body: string;
  detail: string;
  color: string;
}

interface VisibleEntry {
  entry: WorkspaceEntry;
  level: number;
  parentPath: string | null;
  icon: EntryIcon;
}

interface SearchSegment {
  text: string;
  hl: boolean;
}

interface SearchRow {
  entry: WorkspaceEntry;
  dirname: string;
  icon: EntryIcon;
  nameSegments: SearchSegment[];
  dirSegments: SearchSegment[];
}

const FOLDER =
  "M4 4h5l2 2h9a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z";
const FOLDER_OPEN =
  "M4 4h5l2 2h9a1 1 0 0 1 1 1v2H7.5L4.5 20H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Zm4.3 6H22l-2.6 9.3a1 1 0 0 1-1 .7H5.7L8.3 10Z";
const PAGE = "M6 2h7l5 5v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1Z";
const FOLD = "M13 2l5 5h-5Z";
const TEXT = "M8 11h8v1.6H8ZM8 14.2h8v1.6H8ZM8 17.4h5v1.6H8Z";
const CODE =
  "M10.6 11.9 7.5 15l3.1 3.1 1.15-1.15L9.8 15l1.95-1.95ZM13.4 11.9l-1.15 1.15L14.2 15l-1.95 1.95L13.4 18.1 16.5 15Z";
const IMAGE =
  "M7.5 19.5 10.5 15.5l2 2.4 1.6-2 2.4 3.6ZM9.3 10.6a1.3 1.3 0 1 1 0 2.6 1.3 1.3 0 0 1 0-2.6Z";
const TERMINAL =
  "M8 12.4 9.1 11.3 12.4 14.6 9.1 17.9 8 16.8 10.2 14.6ZM12.8 17h4.2v1.6h-4.2Z";

const FILE_TYPES: Record<string, { detail: string; color: string }> = {
  md: { detail: TEXT, color: "#519aba" },
  markdown: { detail: TEXT, color: "#519aba" },
  mdx: { detail: TEXT, color: "#519aba" },
  txt: { detail: TEXT, color: "#8a95a5" },
  json: { detail: CODE, color: "#cbcb41" },
  yaml: { detail: CODE, color: "#a074c4" },
  yml: { detail: CODE, color: "#a074c4" },
  toml: { detail: CODE, color: "#a074c4" },
  ts: { detail: CODE, color: "#3178c6" },
  tsx: { detail: CODE, color: "#3178c6" },
  js: { detail: CODE, color: "#cbcb41" },
  jsx: { detail: CODE, color: "#cbcb41" },
  py: { detail: CODE, color: "#3572a5" },
  rs: { detail: CODE, color: "#dea584" },
  go: { detail: CODE, color: "#519aba" },
  vue: { detail: CODE, color: "#41b883" },
  html: { detail: CODE, color: "#e37933" },
  css: { detail: CODE, color: "#519aba" },
  scss: { detail: CODE, color: "#c76395" },
  sh: { detail: TERMINAL, color: "#8dc149" },
  bash: { detail: TERMINAL, color: "#8dc149" },
  zsh: { detail: TERMINAL, color: "#8dc149" },
  svg: { detail: IMAGE, color: "#a074c4" },
  png: { detail: IMAGE, color: "#a074c4" },
  jpg: { detail: IMAGE, color: "#a074c4" },
  jpeg: { detail: IMAGE, color: "#a074c4" },
  gif: { detail: IMAGE, color: "#a074c4" },
  webp: { detail: IMAGE, color: "#a074c4" },
};

function iconFor(entry: WorkspaceEntry, expanded: boolean): EntryIcon {
  if (entry.kind === "directory") {
    return {
      body: expanded ? FOLDER_OPEN : FOLDER,
      detail: "",
      color: "var(--color-muted)",
    };
  }
  const extension = entry.name.split(".").pop()?.toLowerCase() ?? "";
  const type = FILE_TYPES[extension] ??
    { detail: TEXT, color: "var(--color-muted-soft)" };
  return { body: PAGE, detail: `${FOLD}${type.detail}`, color: type.color };
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
const searchMode = ref(false);
const query = ref("");
const searchSelected = ref(0);
const searchInput = ref<HTMLInputElement>();
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
  async (open, wasOpen) => {
    if (open) {
      if (!wasOpen) {
        returnFocus = document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      }
      searchMode.value = false;
      query.value = "";
      selectCurrentOrRoot();
      await nextTick();
      tree.value?.focus();
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

function flatten(
  entries: WorkspaceEntry[],
  level = 1,
  parentPath: string | null = null,
): VisibleEntry[] {
  return entries.flatMap((entry) => {
    const open = entry.kind === "directory" && expanded.value.has(entry.path);
    const visible = [{ entry, level, parentPath, icon: iconFor(entry, open) }];
    if (open && entry.kind === "directory") {
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

async function revealSelected(): Promise<void> {
  await nextTick();
  if (selectedPath.value === null) return;
  document.getElementById(itemId(selectedPath.value))?.scrollIntoView({
    block: "nearest",
  });
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
    icon: iconFor(entry, false),
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
  await nextTick();
  tree.value?.focus();
  void revealSelected();
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
    if (row !== undefined) activate(row.entry);
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
  if (
    event.key === "/" && !event.metaKey && !event.ctrlKey && !event.altKey
  ) {
    event.preventDefault();
    void enterSearch();
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
    void revealSelected();
    return;
  }
  if (event.key === "Home" || event.key === "End") {
    event.preventDefault();
    const index = event.key === "Home" ? 0 : visibleEntries.value.length - 1;
    selectedPath.value = visibleEntries.value[index]?.entry.path ?? null;
    void revealSelected();
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
      void revealSelected();
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
          <span class="file-tree-twisty" aria-hidden="true">
            {{ item.entry.kind === "directory" ? (expanded.has(item.entry.path) ? "▾" : "▸") : "" }}
          </span>
          <svg
            class="file-tree-icon"
            viewBox="0 0 24 24"
            :style="{ color: item.icon.color }"
            aria-hidden="true"
          >
            <path :d="item.icon.body" fill="currentColor" />
            <path v-if="item.icon.detail" :d="item.icon.detail" fill="var(--color-surface)" />
          </svg>
          <span class="file-tree-name">{{ item.entry.name }}</span>
        </button>
        <p v-if="visibleEntries.length === 0" class="file-tree-empty">
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
            class="file-tree-item file-search-item"
            :class="{ 'file-tree-item-selected': index === searchIndex }"
            type="button"
            tabindex="-1"
            role="option"
            :aria-selected="index === searchIndex"
            :style="{ '--tree-level': 1 }"
            @mousedown.prevent
            @mouseenter="searchSelected = index"
            @click="activate(row.entry)"
          >
            <svg
              class="file-tree-icon"
              viewBox="0 0 24 24"
              :style="{ color: row.icon.color }"
              aria-hidden="true"
            >
              <path :d="row.icon.body" fill="currentColor" />
              <path v-if="row.icon.detail" :d="row.icon.detail" fill="var(--color-surface)" />
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
