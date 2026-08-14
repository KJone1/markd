export type AssetReader = (path: string) => Promise<Uint8Array>;

const CONTENT_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

function toAssetPath(request: Request): string | null {
  const pathname = new URL(request.url).pathname;

  try {
    const decoded = decodeURIComponent(pathname);
    if (decoded.includes("\\") || decoded.includes("\0")) return null;

    const segments = decoded.split("/").filter(Boolean);
    if (segments.some((segment) => segment === "." || segment === "..")) {
      return null;
    }

    return segments.join("/") || "index.html";
  } catch {
    return null;
  }
}

function contentType(path: string): string {
  const extensionIndex = path.lastIndexOf(".");
  const extension = extensionIndex === -1 ? "" : path.slice(extensionIndex);
  return CONTENT_TYPES[extension] ?? "application/octet-stream";
}

export function createStaticHandler(reader: AssetReader) {
  return async (request: Request): Promise<Response> => {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed", {
        status: 405,
        headers: { allow: "GET, HEAD" },
      });
    }

    const path = toAssetPath(request);
    if (path === null) return new Response("Bad request", { status: 400 });

    try {
      const body = await reader(path);
      const responseBody = request.method === "HEAD"
        ? null
        : Uint8Array.from(body).buffer;
      return new Response(responseBody, {
        headers: {
          "content-type": contentType(path),
          "x-content-type-options": "nosniff",
        },
      });
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        return new Response("Not found", { status: 404 });
      }
      throw error;
    }
  };
}
