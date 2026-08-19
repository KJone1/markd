import type {
  ActiveFile,
  AppInfo,
  DocumentSaveRequest,
  DocumentSaveResult,
  HtmlPreviewDocument,
  WorkspaceNavigation,
  WorkspaceState,
} from "../src/shared/desktop.ts";

export interface RuntimeInfo {
  platform: string;
  arch: string;
  version: string;
}

export interface BindingRegistrar {
  bind(
    name: "getAppInfo",
    handler: () => Promise<AppInfo>,
  ): void;
  bind(
    name: "getWorkspaceState",
    handler: () => Promise<WorkspaceState>,
  ): void;
  bind(
    name: "getWorkspaceNavigation",
    handler: () => Promise<WorkspaceNavigation>,
  ): void;
  bind(
    name: "openWorkspaceFile",
    handler: (path: string) => Promise<ActiveFile>,
  ): void;
  bind(
    name: "saveWorkspaceDocument",
    handler: (request: DocumentSaveRequest) => Promise<DocumentSaveResult>,
  ): void;
  bind(
    name: "getHtmlPreviewUrl",
    handler: (path: string, search?: string) => Promise<HtmlPreviewDocument>,
  ): void;
  bind(
    name: "getMarkdownImageUrl",
    handler: (documentPath: string, imagePath: string) => Promise<string>,
  ): void;
  bind(
    name: "openExternalUrl",
    handler: (url: string) => Promise<void>,
  ): void;
  bind(
    name: "openInZed",
    handler: (path: string) => Promise<void>,
  ): void;
  bind(
    name: "openFolder",
    handler: () => Promise<WorkspaceState & { opened: boolean }>,
  ): void;
}

export interface WorkspaceBindings {
  getState(): Promise<WorkspaceState>;
  getNavigation(): Promise<WorkspaceNavigation>;
  openFile(path: string): Promise<ActiveFile>;
  saveDocument(request: DocumentSaveRequest): Promise<DocumentSaveResult>;
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

export function registerDesktopBindings(
  registrar: BindingRegistrar,
  runtime: RuntimeInfo,
  workspace: WorkspaceBindings,
): void {
  registrar.bind("getAppInfo", () =>
    Promise.resolve({
      name: "Markd",
      platform: runtime.platform,
      arch: runtime.arch,
      runtime: `Deno ${runtime.version}`,
    }));
  registrar.bind("getWorkspaceState", () => workspace.getState());
  registrar.bind("getWorkspaceNavigation", () => workspace.getNavigation());
  registrar.bind("openWorkspaceFile", (path) => workspace.openFile(path));
  registrar.bind(
    "saveWorkspaceDocument",
    (request) => workspace.saveDocument(request),
  );
  registrar.bind(
    "getHtmlPreviewUrl",
    (path, search) => workspace.getHtmlPreviewUrl(path, search),
  );
  registrar.bind(
    "getMarkdownImageUrl",
    (documentPath, imagePath) =>
      workspace.getMarkdownImageUrl(documentPath, imagePath),
  );
  registrar.bind("openExternalUrl", (url) => workspace.openExternalUrl(url));
  registrar.bind("openInZed", (path) => workspace.openInZed(path));
  registrar.bind("openFolder", () => workspace.openFolder());
}
