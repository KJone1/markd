import { registerDesktopBindings } from "./bindings.ts";
import type { BindingRegistrar } from "./bindings.ts";
import { pickNativeFolder } from "./folder_picker.ts";
import {
  bundlePathFor,
  consumeOpenRequest,
  removeRunningApp,
  watchOpenRequests,
  writeRunningApp,
} from "./open_requests.ts";
import { createStaticHandler } from "./server.ts";
import { WorkspaceSettingsStore } from "./settings.ts";
import {
  WorkspaceApplication,
  type WorkspaceWindow,
} from "./workspace_application.ts";

interface DesktopBrowserWindow extends BindingRegistrar, WorkspaceWindow {
  navigate(url: string): void;
  hide(): void;
}

const desktopRuntime = Deno as typeof Deno & {
  BrowserWindow?: new (options: {
    title: string;
    width: number;
    height: number;
  }) => DesktopBrowserWindow;
};

const webRoot = new URL("../dist/web/", import.meta.url);
const server = Deno.serve(
  createStaticHandler((path) => Deno.readFile(new URL(path, webRoot))),
);
const appOrigin = `http://127.0.0.1:${(server.addr as Deno.NetAddr).port}/`;

if (desktopRuntime.BrowserWindow) {
  const BrowserWindow = desktopRuntime.BrowserWindow;

  const home = Deno.env.get("HOME");
  if (home === undefined) throw new Error("HOME is unavailable");
  const supportDirectory = `${home}/Library/Application Support/Markd`;
  const openRequestPath = `${supportDirectory}/open-request`;
  const runningAppPath = `${supportDirectory}/running-app`;
  await Deno.mkdir(supportDirectory, { recursive: true });
  await writeRunningApp(runningAppPath, bundlePathFor(Deno.execPath()));

  const settings = new WorkspaceSettingsStore(
    `${supportDirectory}/workspaces.json`,
  );
  const sessions = new Set<WorkspaceApplication>();
  let menuOwner: WorkspaceApplication | null = null;

  const openSession = async (
    requestedPath: string | null,
    restoreLastWorkspace: boolean,
  ): Promise<void> => {
    const window = new BrowserWindow({
      title: "Markd",
      width: 1120,
      height: 760,
    }) as unknown as DesktopBrowserWindow;

    const workspace: WorkspaceApplication = new WorkspaceApplication(
      settings,
      window,
      pickNativeFolder,
      (message) => alert(message),
      openExternalUrl,
      openInZed,
      () => menuOwner === workspace,
    );
    sessions.add(workspace);
    menuOwner = workspace;

    window.addEventListener("focus", () => {
      menuOwner = workspace;
      workspace.claimApplicationMenu();
    });
    // The webview backend marks the window closed without destroying it.
    window.addEventListener("close", () => {
      window.hide();
      sessions.delete(workspace);
      if (menuOwner === workspace) menuOwner = null;
      workspace.dispose().catch(() => undefined);
      if (sessions.size > 0) return;
      stopWatchingRequests();
      void removeRunningApp(runningAppPath).finally(() => Deno.exit(0));
    });

    registerDesktopBindings(window, workspace);
    window.navigate(appOrigin);
    await workspace.initialize(requestedPath, { restoreLastWorkspace });
  };

  const stopWatchingRequests = watchOpenRequests(
    openRequestPath,
    (requestedPath) => void openSession(requestedPath, false),
  );

  await openSession(await consumeOpenRequest(openRequestPath), true);
}

function openExternalUrl(url: string): Promise<void> {
  return runOpen([url]);
}

function openInZed(path: string): Promise<void> {
  return runOpen(["-a", "Zed", path]);
}

async function runOpen(args: string[]): Promise<void> {
  const command = new Deno.Command("/usr/bin/open", {
    args,
    stdout: "null",
    stderr: "piped",
  });
  const result = await command.output();
  if (!result.success) {
    throw new Error(new TextDecoder().decode(result.stderr).trim());
  }
}
