export async function prepareBundleForFirstLaunch(
  bundlePath: string,
  runtimeName: string,
): Promise<void> {
  const sentinel = `${bundlePath}/Contents/MacOS/${runtimeName}.update-ok`;
  await Deno.writeTextFile(sentinel, "ok");
}

export async function sealMacosBundle(
  bundlePath: string,
  runtimeName: string,
): Promise<void> {
  await prepareBundleForFirstLaunch(bundlePath, runtimeName);

  const result = await new Deno.Command("codesign", {
    args: ["--force", "--deep", "--sign", "-", bundlePath],
    stdout: "inherit",
    stderr: "inherit",
  }).output();

  if (!result.success) {
    throw new Error(`codesign failed with exit code ${result.code}`);
  }
}

if (import.meta.main) {
  const [bundlePath, runtimeName] = Deno.args;
  if (!bundlePath || !runtimeName) {
    throw new Error("Usage: seal_macos_bundle.ts <bundle-path> <runtime-name>");
  }
  await sealMacosBundle(bundlePath, runtimeName);
}
