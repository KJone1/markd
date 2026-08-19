import { dirname } from "node:path";

export async function consumeOpenRequest(
  requestPath: string,
): Promise<string | null> {
  let content: string;
  try {
    content = await Deno.readTextFile(requestPath);
    await Deno.remove(requestPath);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return null;
    throw error;
  }

  const requestedPath = content.trim();
  return requestedPath.startsWith("/") ? requestedPath : null;
}

export async function writeOpenRequest(
  requestPath: string,
  requestedPath: string,
): Promise<void> {
  const temporaryPath = `${requestPath}.tmp`;
  await Deno.writeTextFile(temporaryPath, `${requestedPath}\n`);
  await Deno.rename(temporaryPath, requestPath);
}

export function bundlePathFor(executablePath: string): string {
  const marker = ".app/Contents/MacOS/";
  const index = executablePath.indexOf(marker);
  return index === -1 ? "" : executablePath.slice(0, index + ".app".length);
}

export async function writeRunningApp(
  markerPath: string,
  bundlePath: string,
): Promise<void> {
  const temporaryPath = `${markerPath}.tmp`;
  await Deno.writeTextFile(temporaryPath, `${bundlePath}\n`);
  await Deno.rename(temporaryPath, markerPath);
}

export async function readRunningApp(
  markerPath: string,
): Promise<string | null> {
  try {
    return (await Deno.readTextFile(markerPath)).trim();
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return null;
    throw error;
  }
}

export async function removeRunningApp(markerPath: string): Promise<void> {
  try {
    await Deno.remove(markerPath);
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
}

export function watchOpenRequests(
  requestPath: string,
  listener: (requestedPath: string) => void,
): () => void {
  const watcher = Deno.watchFs(dirname(requestPath));
  let closed = false;

  void (async () => {
    try {
      for await (const _event of watcher) {
        if (closed) return;
        const requestedPath = await consumeOpenRequest(requestPath);
        if (requestedPath !== null) listener(requestedPath);
      }
    } catch (error) {
      if (!closed) throw error;
    }
  })();

  return () => {
    if (closed) return;
    closed = true;
    watcher.close();
  };
}
