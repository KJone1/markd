import type {
  ActiveFile,
  DocumentSaveRequest,
  DocumentSaveResult,
  HtmlPreviewDocument,
  WorkspaceNavigation,
  WorkspaceState,
} from "../src/shared/desktop.ts";
import { dirname, extname, posix } from "node:path";
import { WorkspaceFiles } from "./files.ts";
import { WorkspaceDocuments } from "./documents.ts";
import {
  startWorkspacePreviewServer,
  type WorkspacePreviewServer,
} from "./preview.ts";
import { WorkspaceSettingsStore } from "./settings.ts";
import { WorkspaceRoot } from "./workspace.ts";
import { WorkspaceController } from "./workspace_controller.ts";
import {
  type ApplicationMenuItem,
  buildApplicationMenu,
} from "./workspace_menu.ts";

export interface WorkspaceWindow {
  setApplicationMenu(menu: ApplicationMenuItem[]): void;
  addEventListener(
    type: "menuclick",
    listener: (event: Event & { detail?: { id?: string } }) => void,
  ): void;
  executeJs(source: string): Promise<unknown>;
}

export type FolderPicker = () => Promise<string | null>;
export type ErrorPresenter = (message: string) => void;
export type ExternalUrlOpener = (url: string) => Promise<void>;

export class WorkspaceApplication {
  private readonly controller: WorkspaceController;
  private recentWorkspaces: string[] = [];
  private files: WorkspaceFiles | null = null;
  private documents: WorkspaceDocuments | null = null;
  private activeFile: ActiveFile | null = null;
  private stopWatching: (() => void) | null = null;
  private previewServer: WorkspacePreviewServer | null = null;

  constructor(
    private readonly settings: WorkspaceSettingsStore,
    private readonly window: WorkspaceWindow,
    private readonly pickFolder: FolderPicker,
    private readonly showError: ErrorPresenter,
    private readonly openExternal: ExternalUrlOpener = () =>
      Promise.reject(new Error("External URLs are unavailable.")),
  ) {
    this.controller = new WorkspaceController(settings, async () => {
      const accepted = await this.window.executeJs(
        "globalThis.markdBeforeWorkspaceSwitch ? globalThis.markdBeforeWorkspaceSwitch() : true",
      );
      return accepted !== false;
    });

    this.window.addEventListener("menuclick", (event) => {
      void this.handleMenuClick(event.detail?.id);
    });
  }

  async initialize(): Promise<void> {
    const persisted = await this.settings.load();
    const available = await this.settings.prune(isAvailableWorkspace);
    await this.refreshMenu(available.recentWorkspaces);

    if (persisted.lastWorkspace === null) return;
    if (available.lastWorkspace === persisted.lastWorkspace) {
      await this.controller.open(persisted.lastWorkspace, {
        requireHandoff: false,
      });
      await this.activateWorkspace();
      await this.refreshMenu(available.recentWorkspaces);
      return;
    }

    this.showError(
      "The last workspace is no longer available. Choose another folder.",
    );
    await this.openFolder();
  }

  async getState(): Promise<WorkspaceState> {
    const settings = await this.settings.load();
    return {
      activePath: this.controller.active?.path ?? null,
      recentWorkspaces: settings.recentWorkspaces,
    };
  }

  async getNavigation(): Promise<WorkspaceNavigation> {
    if (this.files === null) {
      return { rootPath: null, entries: [], activeFile: null };
    }
    this.startWatching();
    return {
      rootPath: this.files.root.path,
      entries: await this.files.index(),
      activeFile: this.activeFile,
    };
  }

  async openFile(path: string): Promise<ActiveFile> {
    if (this.files === null) throw new Error("No workspace is open.");
    this.activeFile = await this.files.open(path);
    await this.settings.rememberActiveFile(this.files.root.path, path);
    await this.refreshMenu(this.recentWorkspaces);
    return this.activeFile;
  }

  async saveDocument(
    request: DocumentSaveRequest,
  ): Promise<DocumentSaveResult> {
    if (this.documents === null) throw new Error("No workspace is open.");
    return await this.documents.save(request);
  }

  async getHtmlPreviewUrl(
    path: string,
    search?: string,
  ): Promise<HtmlPreviewDocument> {
    if (this.files === null) throw new Error("No workspace is open.");
    const target = await this.files.open(path);
    if (target.kind !== "html") {
      throw new Error("Only HTML files can be previewed.");
    }
    this.previewServer ??= startWorkspacePreviewServer(this.files.root);
    return this.previewServer.documentFor(path, search);
  }

  async getMarkdownImageUrl(
    documentPath: string,
    imagePath: string,
  ): Promise<string> {
    if (this.files === null) throw new Error("No workspace is open.");
    const document = await this.files.open(documentPath);
    if (document.kind !== "markdown") {
      throw new Error("Only Markdown documents can resolve images.");
    }
    if (
      imagePath === "" || imagePath.startsWith("/") ||
      imagePath.includes("\\")
    ) {
      throw new Error("Markdown image paths must be relative files.");
    }
    try {
      new URL(imagePath);
      throw new Error("Markdown image paths must be workspace relative.");
    } catch (error) {
      if (
        error instanceof Error && error.message.includes("workspace relative")
      ) {
        throw error;
      }
    }
    const resolvedReference = posix.normalize(
      posix.join(dirname(documentPath), imagePath),
    );
    if (
      resolvedReference === ".." || resolvedReference.startsWith("../") ||
      !MARKDOWN_IMAGE_EXTENSIONS.has(extname(resolvedReference).toLowerCase())
    ) {
      throw new Error("Markdown images must be contained image files.");
    }
    const resolvedPath = await this.files.root.resolveExistingPath(
      resolvedReference,
    );
    if (!(await Deno.stat(resolvedPath)).isFile) {
      throw new Error("Markdown images must identify files.");
    }
    this.previewServer ??= startWorkspacePreviewServer(this.files.root);
    return this.previewServer.resourceFor(resolvedReference);
  }

  async openExternalUrl(url: string): Promise<void> {
    let target: URL;
    try {
      target = new URL(url);
    } catch (error) {
      throw new Error("The external URL is invalid.", { cause: error });
    }
    if (target.protocol !== "http:" && target.protocol !== "https:") {
      throw new Error("Only web links can open outside the preview.");
    }
    await this.openExternal(target.href);
  }

  async dispose(): Promise<void> {
    this.stopWatching?.();
    this.stopWatching = null;
    const server = this.previewServer;
    this.previewServer = null;
    await server?.close();
  }

  async openFolder(): Promise<WorkspaceState & { opened: boolean }> {
    const path = await this.pickFolder();
    if (path === null) return { ...(await this.getState()), opened: false };

    try {
      const result = await this.controller.open(path);
      if (result.opened) await this.activateWorkspace();
      await this.refreshMenu();
      if (result.opened) await this.notifyRenderer();
      return { ...(await this.getState()), opened: result.opened };
    } catch {
      this.showError("The selected workspace folder cannot be opened.");
      await this.settings.remove(path);
      await this.refreshMenu();
      return { ...(await this.getState()), opened: false };
    }
  }

  private async openRecent(index: number): Promise<void> {
    const path = this.recentWorkspaces[index];
    if (path === undefined) return;

    try {
      const result = await this.controller.open(path);
      if (result.opened) await this.activateWorkspace();
      await this.refreshMenu();
      if (result.opened) await this.notifyRenderer();
    } catch {
      await this.settings.remove(path);
      await this.refreshMenu();
      this.showError("That recent workspace is no longer available.");
    }
  }

  private async handleMenuClick(id: string | undefined): Promise<void> {
    if (id === "open-folder") {
      await this.openFolder();
      return;
    }
    if (id === "save") {
      await this.window.executeJs("globalThis.markdSave?.()");
      return;
    }
    if (id?.startsWith("open-recent:")) {
      const index = Number(id.slice("open-recent:".length));
      if (Number.isInteger(index)) await this.openRecent(index);
    }
  }

  private async refreshMenu(recentWorkspaces?: string[]): Promise<void> {
    this.recentWorkspaces = recentWorkspaces ??
      (await this.settings.prune(isAvailableWorkspace)).recentWorkspaces;
    this.window.setApplicationMenu(
      buildApplicationMenu(
        this.recentWorkspaces,
        this.activeFile?.kind === "code" ||
          this.activeFile?.kind === "markdown",
      ),
    );
  }

  private async activateWorkspace(): Promise<void> {
    await this.dispose();
    const root = this.controller.active;
    if (root === null) {
      this.files = null;
      this.documents = null;
      this.activeFile = null;
      return;
    }

    this.files = new WorkspaceFiles(root);
    this.documents = new WorkspaceDocuments(root);
    this.activeFile = null;
    const rememberedPath = (await this.settings.load()).activeFiles[root.path];
    if (rememberedPath === undefined) return;

    try {
      this.activeFile = await this.files.open(rememberedPath);
    } catch {
      this.activeFile = null;
    }
  }

  private startWatching(): void {
    if (this.files === null || this.stopWatching !== null) return;
    const watchedFiles = this.files;
    this.stopWatching = watchedFiles.watch((entries) => {
      void this.handleFilesChanged(watchedFiles, entries);
    });
  }

  private async handleFilesChanged(
    watchedFiles: WorkspaceFiles,
    entries: WorkspaceNavigation["entries"],
  ): Promise<void> {
    if (this.files !== watchedFiles) return;
    if (this.activeFile !== null) {
      try {
        this.activeFile = await watchedFiles.open(this.activeFile.path);
      } catch {
        this.activeFile = null;
      }
    }
    await this.refreshMenu(this.recentWorkspaces);
    await this.notifyNavigation({
      rootPath: watchedFiles.root.path,
      entries,
      activeFile: this.activeFile,
    });
  }

  private async notifyRenderer(): Promise<void> {
    const state = await this.getState();
    try {
      await this.window.executeJs(
        `globalThis.dispatchEvent(new CustomEvent("markd-workspace-change", { detail: ${
          JSON.stringify(state)
        } }))`,
      );
    } catch {
      // The renderer may still be loading during startup restoration.
    }
  }

  private async notifyNavigation(state: WorkspaceNavigation): Promise<void> {
    try {
      await this.window.executeJs(
        `globalThis.dispatchEvent(new CustomEvent("markd-files-change", { detail: ${
          JSON.stringify(state)
        } }))`,
      );
    } catch {
      // The renderer may still be loading during startup restoration.
    }
  }
}

const MARKDOWN_IMAGE_EXTENSIONS = new Set([
  ".avif",
  ".bmp",
  ".gif",
  ".ico",
  ".jpeg",
  ".jpg",
  ".png",
  ".svg",
  ".webp",
]);

async function isAvailableWorkspace(path: string): Promise<boolean> {
  try {
    await WorkspaceRoot.open(path);
    return true;
  } catch {
    return false;
  }
}
