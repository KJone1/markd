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
