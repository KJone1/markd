import { resolve } from "node:path";
import { readRunningApp, writeOpenRequest } from "../desktop/open_requests.ts";

const USAGE = [
  "usage: markd [path]",
  "       markd            open Markd",
  "       markd <file>     open the file, using its folder as the workspace",
  "       markd <folder>   open the folder as the workspace",
].join("\n");

function fail(message: string, code: number): never {
  console.error(message);
  Deno.exit(code);
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await Deno.stat(path)).isDirectory;
  } catch {
    return false;
  }
}

if (Deno.args.length > 1) fail("usage: markd [path]", 64);
if (Deno.args[0] === "-h" || Deno.args[0] === "--help") {
  console.log(USAGE);
  Deno.exit(0);
}

const home = Deno.env.get("HOME");
if (home === undefined) fail("markd: HOME is unavailable", 78);
const supportDirectory = `${home}/Library/Application Support/Markd`;

let target: string | null = null;
if (Deno.args.length === 1) {
  target = resolve(Deno.cwd(), Deno.args[0]);
  try {
    await Deno.lstat(target);
  } catch {
    fail(`markd: ${Deno.args[0]}: no such file or directory`, 66);
  }
}

const writeRequest = async (): Promise<void> => {
  if (target === null) return;
  await Deno.mkdir(supportDirectory, { recursive: true });
  await writeOpenRequest(`${supportDirectory}/open-request`, target);
};

const runningApp = await readRunningApp(`${supportDirectory}/running-app`);
if (runningApp === "") {
  await writeRequest();
  console.error(
    "markd: the running instance was not launched from an app bundle; " +
      "the window opens without being focused",
  );
  Deno.exit(0);
}

const app = runningApp !== null && await isDirectory(runningApp)
  ? runningApp
  : Deno.env.get("MARKD_APP") ?? "/Applications/Markd.app";
if (!await isDirectory(app)) {
  fail(`markd: ${app} is not installed (run: just install)`, 69);
}

await writeRequest();

const opened = await new Deno.Command("/usr/bin/open", {
  args: ["-a", app],
  stdout: "null",
  stderr: "piped",
}).output();
if (!opened.success) {
  fail(new TextDecoder().decode(opened.stderr).trim(), 70);
}
