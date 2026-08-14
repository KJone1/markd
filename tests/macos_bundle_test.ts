import { prepareBundleForFirstLaunch } from "../scripts/seal_macos_bundle.ts";

Deno.test("macOS bundle includes the runtime launch sentinel before signing", async () => {
  const root = await Deno.makeTempDir({ prefix: "markd-bundle-" });
  const bundle = `${root}/Markd.app`;
  const executableDirectory = `${bundle}/Contents/MacOS`;

  try {
    await Deno.mkdir(executableDirectory, { recursive: true });
    await prepareBundleForFirstLaunch(bundle, "Markd.dylib");

    const sentinel = await Deno.readTextFile(
      `${executableDirectory}/Markd.dylib.update-ok`,
    );
    if (sentinel !== "ok") {
      throw new Error(
        `Unexpected launch sentinel: ${JSON.stringify(sentinel)}`,
      );
    }
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("macOS build seals the first-launch sentinel into the app", async () => {
  const config = JSON.parse(await Deno.readTextFile("deno.json"));
  const build = config.tasks?.build;
  const sealCommand = "scripts/seal_macos_bundle.ts dist/Markd.app Markd.dylib";

  if (typeof build !== "string" || !build.includes(sealCommand)) {
    throw new Error("The macOS build does not seal its first-launch sentinel");
  }
});
