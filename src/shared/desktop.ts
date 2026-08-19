export interface AppInfo {
  readonly [key: string]: unknown;
  name: "Markd";
  platform: string;
  arch: string;
  runtime: string;
}

export interface WorkspaceState {
  readonly [key: string]: unknown;
  activePath: string | null;
  recentWorkspaces: string[];
}

export interface WorkspaceFileEntry {
  kind: "file";
  name: string;
  path: string;
}

export interface WorkspaceDirectoryEntry {
  kind: "directory";
  name: string;
  path: string;
  children: WorkspaceEntry[];
}

export type WorkspaceEntry = WorkspaceFileEntry | WorkspaceDirectoryEntry;

export type ActiveFile =
  | {
    readonly [key: string]: unknown;
    kind: "markdown" | "html" | "code";
    path: string;
    content: string;
  }
  | {
    readonly [key: string]: unknown;
    kind: "information";
    path: string;
    reason: "binary" | "unreadable" | "unsupported" | "too-large";
  };

export interface WorkspaceNavigation {
  readonly [key: string]: unknown;
  rootPath: string | null;
  entries: WorkspaceEntry[];
  activeFile: ActiveFile | null;
}

export interface DocumentSaveRequest {
  readonly [key: string]: unknown;
  path: string;
  content: string;
  expectedContent: string;
  overwrite: boolean;
}

export interface HtmlPreviewDocument {
  readonly [key: string]: unknown;
  url: string;
  runtimeToken: string;
}

export type DocumentSaveResult =
  | { readonly [key: string]: unknown; kind: "saved" }
  | {
    readonly [key: string]: unknown;
    kind: "conflict";
    diskContent: string;
  };

export interface DesktopBindings {
  getAppInfo(): Promise<AppInfo>;
  getWorkspaceState(): Promise<WorkspaceState>;
  getWorkspaceNavigation(): Promise<WorkspaceNavigation>;
  openWorkspaceFile(path: string): Promise<ActiveFile>;
  saveWorkspaceDocument(
    request: DocumentSaveRequest,
  ): Promise<DocumentSaveResult>;
  getHtmlPreviewUrl(
    path: string,
    search?: string,
  ): Promise<HtmlPreviewDocument>;
  getMarkdownImageUrl(
    documentPath: string,
    imagePath: string,
  ): Promise<string>;
  openExternalUrl(url: string): Promise<void>;
  openInZed(path: string): Promise<void>;
  openFolder(): Promise<WorkspaceState & { opened: boolean }>;
}

declare global {
  const bindings: DesktopBindings;

  interface Window {
    markdBeforeWorkspaceSwitch?: () => Promise<boolean>;
    markdSave?: () => Promise<void>;
  }
}
