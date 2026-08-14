import { registerDesktopBindings } from "./bindings.ts";
import type { BindingRegistrar } from "./bindings.ts";
import { pickNativeFolder } from "./folder_picker.ts";
import { createStaticHandler } from "./server.ts";
import { WorkspaceSettingsStore } from "./settings.ts";
import {
  WorkspaceApplication,
  type WorkspaceWindow,
} from "./workspace_application.ts";

interface DesktopBrowserWindow extends BindingRegistrar, WorkspaceWindow {}

const desktopRuntime = Deno as typeof Deno & {
  BrowserWindow?: new (options: {
    title: string;
    width: number;
    height: number;
  }) => DesktopBrowserWindow;
};

if (desktopRuntime.BrowserWindow) {
  const window = new desktopRuntime.BrowserWindow({
    title: "Markd",
    width: 1120,
    height: 760,
  }) as unknown as DesktopBrowserWindow;

  window.addEventListener("close", () => Deno.exit(0));

  const home = Deno.env.get("HOME");
  if (home === undefined) throw new Error("HOME is unavailable");
  const workspace = new WorkspaceApplication(
    new WorkspaceSettingsStore(
      `${home}/Library/Application Support/Markd/workspaces.json`,
    ),
    window,
    pickNativeFolder,
    (message) => alert(message),
    openExternalUrl,
  );

  registerDesktopBindings(window, {
    platform: Deno.build.os,
    arch: Deno.build.arch,
    version: Deno.version.deno,
  }, workspace);
  await workspace.initialize();
}

const webRoot = new URL("../dist/web/", import.meta.url);
const handler = createStaticHandler((path) =>
  Deno.readFile(new URL(path, webRoot))
);

Deno.serve(handler);

async function openExternalUrl(url: string): Promise<void> {
  const command = new Deno.Command("/usr/bin/open", {
    args: [url],
    stdout: "null",
    stderr: "piped",
  });
  const result = await command.output();
  if (!result.success) {
    throw new Error(new TextDecoder().decode(result.stderr).trim());
  }
}
