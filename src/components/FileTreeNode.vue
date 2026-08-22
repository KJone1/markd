<script setup lang="ts">
import { TreeView } from "@ark-ui/vue/tree-view";
import type { WorkspaceEntry } from "../shared/desktop.ts";

defineProps<{
  node: WorkspaceEntry;
  indexPath: number[];
  onFileOpen: (path: string) => void;
}>();
</script>

<template>
  <TreeView.NodeProvider :node="node" :index-path="indexPath">
    <TreeView.NodeContext v-slot="nodeState">
      <TreeView.Branch
        v-if="node.kind === 'directory'"
        class="file-tree-branch"
      >
        <TreeView.BranchControl class="file-tree-branch-control">
          <TreeView.BranchIndicator class="file-tree-branch-indicator">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="m9 18 6-6-6-6" />
            </svg>
          </TreeView.BranchIndicator>
          <TreeView.BranchText class="file-tree-branch-text">
            <svg
              v-if="nodeState.expanded"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path
                d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"
              />
            </svg>
            <svg
              v-else
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path
                d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"
              />
            </svg>
            {{ node.name }}
          </TreeView.BranchText>
        </TreeView.BranchControl>
        <TreeView.BranchContent class="file-tree-branch-content">
          <TreeView.BranchIndentGuide class="file-tree-indent-guide" />
          <FileTreeNode
            v-for="(child, index) in node.children"
            :key="child.path"
            :node="child"
            :index-path="[...indexPath, index]"
            :on-file-open="onFileOpen"
          />
        </TreeView.BranchContent>
      </TreeView.Branch>
      <TreeView.Item
        v-else
        class="file-tree-item"
        @click="onFileOpen(node.path)"
        @keydown.enter="onFileOpen(node.path)"
      >
        <TreeView.ItemText class="file-tree-item-text">
          <svg
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
          {{ node.name }}
        </TreeView.ItemText>
      </TreeView.Item>
    </TreeView.NodeContext>
  </TreeView.NodeProvider>
</template>

<style scoped>
/* Stays above the indicator rule: they tie on specificity and the
   0.875rem chevron size must win by source order. */
.file-tree-list svg {
  width: var(--tree-icon-size);
  height: var(--tree-icon-size);
  flex-shrink: 0;
}

.file-tree-branch {
  position: relative;
}

.file-tree-branch-control {
  --tree-depth: calc(var(--depth) - 1);
  --tree-indentation-offset: calc(var(--tree-indentation) * var(--tree-depth));
  --tree-icon-offset: calc(var(--tree-icon-size) * var(--tree-depth) * 0.5);
  --tree-offset: calc(
    var(--tree-padding-inline) + var(--tree-indentation-offset) +
      var(--tree-icon-offset)
  );
  position: relative;
  display: flex;
  align-items: center;
  gap: var(--tree-item-gap);
  width: 100%;
  padding-inline-start: var(--tree-offset);
  padding-inline-end: var(--tree-padding-inline);
  padding-block: var(--tree-padding-block);
  color: var(--color-ink);
  background: transparent;
  border: none;
  border-radius: 0.375rem;
  font: inherit;
  text-align: start;
  user-select: none;
  cursor: pointer;
}

.file-tree-branch-control:hover,
.file-tree-branch-control[data-focus] {
  background: var(--color-hairline-soft);
}

.file-tree-branch-control:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: -2px;
}

.file-tree-branch-control[data-selected] {
  color: var(--color-primary-active);
}

.file-tree-branch-content {
  position: relative;
}

.file-tree-branch-content[data-state="open"] {
  animation:
    expand-height 150ms ease-out,
    fade-in 150ms ease-out;
}

.file-tree-branch-content[data-state="closed"] {
  animation:
    collapse-height 150ms ease-out,
    fade-out 150ms ease-out;
}

.file-tree-indent-guide {
  --tree-depth: calc(var(--depth) - 1);
  --tree-indentation-offset: calc(var(--tree-indentation) * var(--tree-depth));
  --tree-offset: calc(
    var(--tree-padding-inline) + var(--tree-indentation-offset)
  );
  --tree-icon-offset: calc(var(--tree-icon-size) * 0.5 * var(--depth));
  position: absolute;
  z-index: 1;
  inset-inline-start: calc(var(--tree-offset) + var(--tree-icon-offset));
  height: 100%;
  width: 1px;
  background: var(--color-hairline);
}

.file-tree-branch-indicator {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--color-muted);
  transform-origin: center;
  transition: transform 150ms ease;
}

.file-tree-branch-indicator[data-state="open"] {
  transform: rotate(90deg);
}

.file-tree-branch-indicator svg {
  width: var(--tree-chevron-size);
  height: var(--tree-chevron-size);
}

.file-tree-branch-text {
  flex: 1;
  display: inline-flex;
  align-items: center;
  gap: var(--tree-item-gap);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-tree-item {
  --tree-depth: calc(var(--depth) - 1);
  --tree-indentation-offset: calc(var(--tree-indentation) * var(--tree-depth));
  --tree-icon-offset: calc(var(--tree-icon-size) * var(--tree-depth) * 0.5);
  --tree-offset: calc(
    var(--tree-padding-inline) + var(--tree-indentation-offset) +
      var(--tree-icon-offset)
  );
  position: relative;
  display: flex;
  align-items: center;
  gap: var(--tree-item-gap);
  width: 100%;
  padding-inline-start: calc(
    var(--tree-offset) + var(--tree-chevron-size) + var(--tree-item-gap)
  );
  padding-inline-end: var(--tree-padding-inline);
  padding-block: var(--tree-padding-block);
  color: var(--color-ink);
  background: transparent;
  border: none;
  border-radius: 0.375rem;
  font: inherit;
  text-align: start;
  text-decoration: none;
  user-select: none;
  cursor: pointer;
}

.file-tree-item:hover,
.file-tree-item[data-focus] {
  background: var(--color-hairline-soft);
}

.file-tree-item:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: -2px;
}

.file-tree-item[data-selected] {
  color: var(--color-primary-active);
}

.file-tree-item-text {
  flex: 1;
  display: inline-flex;
  align-items: center;
  gap: var(--tree-item-gap);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@keyframes expand-height {
  from {
    height: 0;
  }

  to {
    height: var(--height);
  }
}

@keyframes collapse-height {
  from {
    height: var(--height);
  }

  to {
    height: 0;
  }
}

@keyframes fade-in {
  from {
    opacity: 0;
  }

  to {
    opacity: 1;
  }
}

@keyframes fade-out {
  from {
    opacity: 1;
  }

  to {
    opacity: 0;
  }
}
</style>
