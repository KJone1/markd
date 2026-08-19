<script setup lang="ts">
import {
  computed,
  defineAsyncComponent,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
} from "vue";
import ErrorToast from "./components/ErrorToast.vue";
import FileTreeDialog from "./components/FileTreeDialog.vue";
import HtmlPreview from "./components/HtmlPreview.vue";
import { DocumentSession } from "./document_session.ts";
import type {
  ActiveFile,
  AppInfo,
  WorkspaceNavigation,
  WorkspaceState,
} from "./shared/desktop.ts";

const CodeEditor = defineAsyncComponent(
  () => import("./components/CodeEditor.vue"),
);
const MarkdownEditor = defineAsyncComponent(
  () => import("./components/MarkdownEditor.vue"),
);

const primaryAction = ref<HTMLButtonElement>();
const appInfo = ref<AppInfo>();
const workspace = ref<WorkspaceState>({
  activePath: null,
  recentWorkspaces: [],
});
const navigation = ref<WorkspaceNavigation>({
  rootPath: null,
  entries: [],
  activeFile: null,
});
const treeOpen = ref(false);
const editorContent = ref("");
const saveError = ref<string | null>(null);
const diskConflict = ref(false);
const htmlReloadKey = ref(0);
let documentSession: DocumentSession | null = null;
const workspaceName = computed(() => {
  const path = workspace.value.activePath;
  return path?.split("/").filter(Boolean).at(-1) ?? null;
});

function copyActivePath(): void {
  const path = navigation.value.activeFile?.path;
  if (path === undefined) return;
  const root = navigation.value.rootPath;
  void navigator.clipboard.writeText(root === null ? path : `${root}/${path}`);
}

async function openActiveFileInZed(): Promise<void> {
  const path = navigation.value.activeFile?.path;
  if (path === undefined) return;
  try {
    await bindings.openInZed(path);
  } catch {
    saveError.value = "Markd could not open this file in Zed.";
  }
}

type EditableActiveFile =Extract<ActiveFile, { content: string }> & {
  kind: "code" | "markdown";
};

function isEditableDocument(
  activeFile: ActiveFile | null,
): activeFile is EditableActiveFile {
  return activeFile?.kind === "code" || activeFile?.kind === "markdown";
}

async function openWorkspace(): Promise<void> {
  const result = await bindings.openFolder();
  workspace.value = result;
  if (result.opened) await loadNavigation();
}

function handleWorkspaceChange(event: Event): void {
  workspace.value = (event as CustomEvent<WorkspaceState>).detail;
  void loadNavigation();
}

async function handleFilesChange(event: Event): Promise<void> {
  const changed = (event as CustomEvent<WorkspaceNavigation>).detail;
  const current = navigation.value.activeFile;
  if (
    current?.kind === "html" && changed.activeFile?.kind === "html" &&
    current.path === changed.activeFile.path
  ) {
    navigation.value = changed;
    htmlReloadKey.value += 1;
  } else if (
    isEditableDocument(current) && isEditableDocument(changed.activeFile) &&
    current.kind === changed.activeFile.kind &&
    current.path === changed.activeFile.path && documentSession !== null
  ) {
    navigation.value = { ...changed, activeFile: current };
    documentSession.diskChanged(changed.activeFile.content);
  } else {
    const currentSession = documentSession;
    if (isEditableDocument(current) && currentSession !== null) {
      const accepted = await currentSession.handoff();
      if (documentSession !== currentSession) return;
      if (!accepted) {
        navigation.value = { ...changed, activeFile: current };
        return;
      }
    }
    navigation.value = changed;
    activateDocument(changed.activeFile);
  }
  if (navigation.value.activeFile === null) treeOpen.value = true;
}

function handleShortcut(event: KeyboardEvent): void {
  if (
    event.key.toLowerCase() === "s" && (event.metaKey || event.ctrlKey) &&
    documentSession !== null
  ) {
    event.preventDefault();
    void saveDocument();
    return;
  }
  if (
    workspace.value.activePath !== null &&
    event.key.toLowerCase() === "p" &&
    (event.metaKey || event.ctrlKey)
  ) {
    event.preventDefault();
    treeOpen.value = true;
  }
}

async function loadNavigation(): Promise<void> {
  if (workspace.value.activePath === null) {
    navigation.value = { rootPath: null, entries: [], activeFile: null };
    treeOpen.value = false;
    return;
  }
  navigation.value = await bindings.getWorkspaceNavigation();
  activateDocument(navigation.value.activeFile);
  treeOpen.value = navigation.value.activeFile === null;
}

async function openFile(path: string): Promise<void> {
  const accepted = await window.markdBeforeWorkspaceSwitch?.() ?? true;
  if (!accepted) return;
  try {
    const activeFile = await bindings.openWorkspaceFile(path);
    navigation.value = {
      ...navigation.value,
      activeFile,
    };
    if (activeFile.kind === "html") htmlReloadKey.value += 1;
    activateDocument(activeFile);
  } catch {
    saveError.value = "Markd could not open this file.";
  }
}

function activateDocument(activeFile: ActiveFile | null): void {
  documentSession = null;
  saveError.value = null;
  diskConflict.value = false;
  if (!isEditableDocument(activeFile)) return;
  editorContent.value = activeFile.content;
  documentSession = new DocumentSession({
    path: activeFile.path,
    content: activeFile.content,
    save: (request) => bindings.saveWorkspaceDocument(request),
    onSaveFailure: () => {
      saveError.value = "Markd could not save this file. Your changes remain in the editor.";
    },
    onDiskReload: (content) => {
      editorContent.value = content;
      diskConflict.value = false;
    },
    onConflict: () => {
      diskConflict.value = true;
    },
  });
}

function editDocument(content: string): void {
  editorContent.value = content;
  documentSession?.edit(content);
}

function resolveMarkdownImage(path: string): Promise<string> {
  const activeFile = navigation.value.activeFile;
  if (activeFile?.kind !== "markdown") {
    return Promise.reject(new Error("No Markdown document is active."));
  }
  return bindings.getMarkdownImageUrl(activeFile.path, path);
}

async function retrySave(): Promise<void> {
  if (await documentSession?.retry()) saveError.value = null;
}

async function saveDocument(): Promise<void> {
  if (await documentSession?.saveNow()) saveError.value = null;
}

function reloadConflict(): void {
  documentSession?.reloadFromDisk();
}

async function overwriteConflict(): Promise<void> {
  if (await documentSession?.overwrite()) {
    diskConflict.value = false;
    saveError.value = null;
  }
}

function routeLabel(activeFile: ActiveFile): string {
  if (activeFile.kind === "markdown") return "Markdown document";
  if (activeFile.kind === "html") return "HTML preview";
  if (activeFile.kind === "code") return "Code document";
  if (activeFile.reason === "binary") return "Binary file";
  if (activeFile.reason === "unreadable") return "Unreadable file";
  if (activeFile.reason === "unsupported") return "Unsupported file";
  return "File is too large";
}

onMounted(async () => {
  await nextTick();
  primaryAction.value?.focus();

  try {
    [appInfo.value, workspace.value] = await Promise.all([
      bindings.getAppInfo(),
      bindings.getWorkspaceState(),
    ]);
    if (workspace.value.activePath !== null) await loadNavigation();
  } catch {
    appInfo.value = {
      name: "Markd",
      platform: "browser",
      arch: "development",
      runtime: "Web preview",
    };
  }

  window.addEventListener("markd-workspace-change", handleWorkspaceChange);
  window.addEventListener("markd-files-change", handleFilesChange);
  window.addEventListener("keydown", handleShortcut);
  window.markdBeforeWorkspaceSwitch = () =>
    documentSession?.handoff() ?? Promise.resolve(true);
  window.markdSave = saveDocument;
});

onBeforeUnmount(() => {
  window.removeEventListener("markd-workspace-change", handleWorkspaceChange);
  window.removeEventListener("markd-files-change", handleFilesChange);
  window.removeEventListener("keydown", handleShortcut);
  window.markdBeforeWorkspaceSwitch = undefined;
  window.markdSave = undefined;
});
</script>

<template>
  <div class="shell">
    <main
      v-if="navigation.activeFile === null"
      class="main"
      aria-label="Welcome to Markd"
    >
      <section class="welcome-card" aria-labelledby="welcome-title">
        <p class="eyebrow">Local workspace</p>
        <h1 id="welcome-title">
          {{ workspaceName ? `${workspaceName} is ready.` : "Choose your writing space." }}
        </h1>
        <p class="intro">
          Markd keeps editing on your Mac. Open one local folder and replace it
          at any time from here or the File menu.
        </p>
        <button
          ref="primaryAction"
          class="primary-action"
          type="button"
          @click="openWorkspace"
        >
          Open a workspace
        </button>
        <p class="scope-note">
          {{ workspace.activePath ?? "No workspace is open." }}
        </p>
      </section>

      <aside class="status-card" aria-labelledby="status-title">
        <span class="status-icon" aria-hidden="true">✓</span>
        <div>
          <h2 id="status-title">{{ workspaceName ?? "Ready to open" }}</h2>
          <p role="status" aria-live="polite">
            {{ appInfo ? `${appInfo.runtime} · ${appInfo.arch}` : "Connecting to desktop…" }}
          </p>
        </div>
      </aside>
    </main>

    <main
      v-else-if="navigation.activeFile.kind === 'html'"
      class="html-preview-view"
      aria-label="Active HTML preview"
    >
      <HtmlPreview
        :path="navigation.activeFile.path"
        :reload-key="htmlReloadKey"
      />
    </main>

    <main
      v-else
      :class="['document-view', { 'document-view-editor': navigation.activeFile.kind === 'code' || navigation.activeFile.kind === 'markdown' }]"
      aria-label="Active document"
    >
      <CodeEditor
        v-if="navigation.activeFile.kind === 'code'"
        :path="navigation.activeFile.path"
        :content="editorContent"
        @change="editDocument"
      />
      <MarkdownEditor
        v-else-if="navigation.activeFile.kind === 'markdown'"
        :key="`${navigation.rootPath ?? ''}:${navigation.activeFile.path}`"
        :path="navigation.activeFile.path"
        :content="editorContent"
        :resolve-image="resolveMarkdownImage"
        @change="editDocument"
        @copy-path="copyActivePath"
        @open-in-zed="openActiveFileInZed"
      />
      <section
        v-if="navigation.activeFile.kind !== 'code' && navigation.activeFile.kind !== 'markdown'"
        class="document-surface"
        aria-labelledby="document-title"
      >
        <p class="eyebrow">{{ routeLabel(navigation.activeFile) }}</p>
        <h1 id="document-title" class="document-title">
          {{ navigation.activeFile.path.split("/").at(-1) }}
        </h1>
        <p class="document-path">{{ navigation.activeFile.path }}</p>
        <p v-if="navigation.activeFile.kind === 'information'" class="document-note">
          This file is available as information only and its contents were not loaded.
        </p>
        <p v-else class="document-note">
          The {{ routeLabel(navigation.activeFile).toLowerCase() }} route is ready for its editor.
        </p>
      </section>
    </main>

    <FileTreeDialog
      :open="treeOpen"
      :entries="navigation.entries"
      :current-path="navigation.activeFile?.path ?? null"
      @close="treeOpen = false"
      @open-file="openFile"
    />

    <section
      v-if="diskConflict"
      class="conflict-dialog"
      role="alertdialog"
      aria-labelledby="conflict-title"
      aria-describedby="conflict-description"
    >
      <h2 id="conflict-title">This file changed on disk</h2>
      <p id="conflict-description">
        Reload the disk version or overwrite it with the complete local buffer.
      </p>
      <div class="conflict-actions">
        <button type="button" class="secondary-action" @click="reloadConflict">
          Reload from disk
        </button>
        <button type="button" class="primary-action" @click="overwriteConflict">
          Overwrite with local
        </button>
      </div>
    </section>

    <ErrorToast
      v-if="saveError"
      :key="saveError"
      :message="saveError"
      @retry="retrySave"
      @dismiss="saveError = null"
    />
  </div>
</template>
