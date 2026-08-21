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
