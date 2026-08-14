import { extname } from "node:path";
import { WorkspacePathError, WorkspaceRoot } from "./workspace.ts";
import type { HtmlPreviewDocument } from "../src/shared/desktop.ts";

const CONTENT_TYPES: Record<string, string> = {
  ".avif": "image/avif",
  ".bmp": "image/bmp",
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".htm": "text/html; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".otf": "font/otf",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ttf": "font/ttf",
  ".wasm": "application/wasm",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

const PREVIEW_BOOTSTRAP_PREFIX = "/__markd_preview__/";
const MAX_PENDING_DOCUMENTS = 32;

interface AuthorizedPreviewRequest {
  path: string;
  search: string;
  runtimeToken: string;
}

function previewRuntime(
  runtimeToken: string | null,
  cleanUrl: string | null = null,
): string {
  return `<script data-markd-preview-runtime>(function () {
  "use strict";
  var apply = Reflect.apply;
  var assign = Object.assign;
  var descriptor = Object.getOwnPropertyDescriptor;
  var messageData = descriptor(MessageEvent.prototype, "data").get;
  var addEvent = EventTarget.prototype.addEventListener;
  var removeElement = Element.prototype.remove;
  var replaceState = History.prototype.replaceState;
  var postToWindow = Window.prototype.postMessage;
  var postThroughPort = MessagePort.prototype.postMessage;
  var startPort = MessagePort.prototype.start;
  var runtimeToken = ${JSON.stringify(runtimeToken)};
  apply(removeElement, document.currentScript, []);
  var cleanUrl = ${JSON.stringify(cleanUrl)};
  if (cleanUrl !== null) {
    apply(replaceState, history, [null, "", cleanUrl + location.hash]);
  }
  var channel = null;
  var pendingErrors = [];
  var send = function (type, detail) {
    if (!channel) return;
    apply(postThroughPort, channel, [assign({ type: type }, detail || {})]);
  };
  var reportError = function (message) {
    if (!channel) {
      pendingErrors.push(message);
      return;
    }
    send("error", { message: message });
  };
  apply(addEvent, globalThis, ["error", function (event) {
    var target = event.target;
    var resource = target && target !== window && (target.currentSrc || target.src || target.href);
    reportError(event.message || (resource ? "Failed to load " + resource : "Preview resource failed to load"));
  }, true]);
  apply(addEvent, globalThis, ["unhandledrejection", function (event) {
    var reason = event.reason;
    reportError(reason && reason.message ? reason.message : String(reason || "Unhandled promise rejection"));
  }]);
  apply(addEvent, globalThis, ["load", function () {
    send("document-loaded");
  }]);
  if (runtimeToken !== null) {
    var runtimeChannel = new MessageChannel();
    channel = runtimeChannel.port1;
    apply(addEvent, channel, ["message", function (channelEvent) {
      var channelData = apply(messageData, channelEvent, []);
      if (!channelData || channelData.markdHost !== true) return;
      if (channelData.type === "capture-scroll") {
        send("scroll", { x: scrollX, y: scrollY });
      }
      if (channelData.type === "restore-scroll") {
        scrollTo(Number(channelData.x) || 0, Number(channelData.y) || 0);
      }
    }]);
    apply(startPort, channel, []);
    apply(postToWindow, parent, [{ markdPreview: true, type: "connect", token: runtimeToken }, "*", [runtimeChannel.port2]]);
    send("runtime-ready");
    pendingErrors.splice(0).forEach(reportError);
  }
  apply(addEvent, globalThis, ["click", function (event) {
    if (!event.isTrusted) return;
    var element = event.target;
    var anchor = element && element.closest ? element.closest("a[href]") : null;
    if (!anchor) return;
    var target;
    try {
      target = new URL(anchor.getAttribute("href"), location.href);
    } catch (_) {
      event.preventDefault();
      return;
    }
    if (target.protocol !== "http:" && target.protocol !== "https:") {
      event.preventDefault();
      return;
    }
    if (target.origin !== location.origin) {
      event.preventDefault();
      send("external-link", { url: target.href });
      return;
    }
    if (target.pathname !== location.pathname || target.search !== location.search) {
      event.preventDefault();
      send("workspace-link", { url: target.href });
      return;
    }
    if (anchor.target && anchor.target.toLowerCase() !== "_self") {
      event.preventDefault();
      location.assign(target.href);
    }
  }, true]);
})();</script>`;
}

export interface WorkspacePreviewServer {
  readonly origin: string;
  documentFor(path: string, search?: string): HtmlPreviewDocument;
  resourceFor(path: string): string;
  close(): Promise<void>;
}

export function startWorkspacePreviewServer(
  root: WorkspaceRoot,
): WorkspacePreviewServer {
  const tickets = new Map<string, AuthorizedPreviewRequest>();
  const server = Deno.serve(
    {
      hostname: "127.0.0.1",
      port: 0,
      onListen: () => undefined,
    },
    createWorkspacePreviewHandler(root, (request) => {
      const pathname = new URL(request.url).pathname;
      if (!pathname.startsWith(PREVIEW_BOOTSTRAP_PREFIX)) return null;
      const ticket = pathname.slice(PREVIEW_BOOTSTRAP_PREFIX.length);
      if (ticket === "" || ticket.includes("/")) return null;
      const issued = tickets.get(ticket);
      tickets.delete(ticket);
      return issued ?? null;
    }),
  );
  const address = server.addr as Deno.NetAddr;
  const origin = `http://127.0.0.1:${address.port}`;

  return {
    origin,
    documentFor(path: string, search = ""): HtmlPreviewDocument {
      if (safeRelativeSegments(path) === null) {
        throw new WorkspacePathError("Preview paths must be relative files.");
      }
      if (search !== "" && (!search.startsWith("?") || search.includes("#"))) {
        throw new WorkspacePathError("Preview search parameters are invalid.");
      }
      const ticket = crypto.randomUUID();
      const runtimeToken = crypto.randomUUID();
      while (tickets.size >= MAX_PENDING_DOCUMENTS) {
        const oldest = tickets.keys().next();
        if (oldest.done) break;
        tickets.delete(oldest.value);
      }
      tickets.set(ticket, { path, search, runtimeToken });
      return {
        url: `${origin}${PREVIEW_BOOTSTRAP_PREFIX}${ticket}`,
        runtimeToken,
      };
    },
    resourceFor(path: string): string {
      const segments = safeRelativeSegments(path);
      if (segments === null) {
        throw new WorkspacePathError("Resource paths must be relative files.");
      }
      return `${origin}/${segments.map(encodeURIComponent).join("/")}`;
    },
    async close(): Promise<void> {
      await server.shutdown();
    },
  };
}

export function createWorkspacePreviewHandler(
  root: WorkspaceRoot,
  authorizeRuntime: (
    request: Request,
  ) => AuthorizedPreviewRequest | null = () => null,
) {
  return async (request: Request): Promise<Response> => {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed", {
        status: 405,
        headers: { allow: "GET, HEAD" },
      });
    }
    if (
      request.headers.get("service-worker") === "script" ||
      request.headers.get("sec-fetch-dest") === "serviceworker"
    ) {
      return response("Service workers are not available in previews", 403);
    }

    const authorized = authorizeRuntime(request);
    const path = authorized?.path ?? requestPath(request);
    if (path === null) return response("Bad request", 400);

    try {
      const bytes = await readStableWorkspaceFile(root, path);
      const payload = isHtml(path)
        ? authorized !== null
          ? installRuntime(
            bytes,
            authorized.runtimeToken,
            cleanPreviewUrl(path, authorized.search),
          )
          : isDocumentNavigation(request)
          ? navigationRelay()
          : bytes
        : bytes;
      const body = request.method === "HEAD"
        ? null
        : Uint8Array.from(payload).buffer;
      return new Response(body, {
        headers: {
          "cache-control": "no-store",
          "content-type": contentType(path),
          "x-content-type-options": "nosniff",
        },
      });
    } catch (error) {
      if (
        error instanceof WorkspacePathError ||
        error instanceof Deno.errors.NotFound ||
        error instanceof Deno.errors.PermissionDenied
      ) {
        return response("Not found", 404);
      }
      throw error;
    }
  };
}

function requestPath(request: Request): string | null {
  let decoded: string;
  try {
    const url = new URL(request.url);
    if (url.protocol !== "http:" || url.hostname !== "127.0.0.1") return null;
    decoded = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }

  if (
    !decoded.startsWith("/") || decoded.startsWith("//") ||
    decoded.includes("\\") || decoded.includes("\0")
  ) {
    return null;
  }

  const path = decoded.slice(1);
  return safeRelativeSegments(path) === null ? null : path;
}

function safeRelativeSegments(path: string): string[] | null {
  if (path === "" || path.startsWith("/") || path.includes("\\")) return null;
  const segments = path.split("/");
  return segments.some((segment) =>
      segment === "" || segment === "." || segment === ".." ||
      segment.includes("\0")
    )
    ? null
    : segments;
}

async function readStableWorkspaceFile(
  root: WorkspaceRoot,
  path: string,
): Promise<Uint8Array> {
  const resolvedPath = await root.resolveExistingPath(path);
  const initialInfo = await Deno.stat(resolvedPath);
  if (!initialInfo.isFile) {
    throw new WorkspacePathError("Preview requests must identify a file.");
  }

  const file = await Deno.open(resolvedPath, { read: true });
  try {
    assertSameFile(initialInfo, await file.stat());
    const bytes = new Uint8Array(initialInfo.size);
    let offset = 0;
    while (offset < bytes.length) {
      const count = await file.read(bytes.subarray(offset));
      if (count === null) break;
      offset += count;
    }
    const currentPath = await root.resolveExistingPath(path);
    if (currentPath !== resolvedPath) {
      throw new WorkspacePathError(
        "The preview path changed while being read.",
      );
    }
    assertSameFile(initialInfo, await Deno.stat(currentPath));
    return bytes.subarray(0, offset);
  } finally {
    file.close();
  }
}

function assertSameFile(expected: Deno.FileInfo, actual: Deno.FileInfo): void {
  if (
    expected.dev !== null && expected.ino !== null &&
    (expected.dev !== actual.dev || expected.ino !== actual.ino)
  ) {
    throw new WorkspacePathError("The preview file changed during access.");
  }
}

function contentType(path: string): string {
  return CONTENT_TYPES[extname(path).toLowerCase()] ??
    "application/octet-stream";
}

function isHtml(path: string): boolean {
  const extension = extname(path).toLowerCase();
  return extension === ".html" || extension === ".htm";
}

function isDocumentNavigation(request: Request): boolean {
  const destination = request.headers.get("sec-fetch-dest");
  return request.headers.get("sec-fetch-mode") === "navigate" &&
    (destination === "document" || destination === "iframe");
}

function cleanPreviewUrl(path: string, search: string): string {
  const segments = safeRelativeSegments(path);
  if (segments === null) {
    throw new WorkspacePathError("Preview paths must be relative files.");
  }
  return `/${segments.map(encodeURIComponent).join("/")}${search}`;
}

function navigationRelay(): Uint8Array {
  return new TextEncoder().encode(
    `<script>(function () {
  "use strict";
  Reflect.apply(Window.prototype.postMessage, parent, [{ markdPreview: true, type: "workspace-navigation", url: location.href }, "*"]);
})();</script>`,
  );
}

function installRuntime(
  bytes: Uint8Array,
  runtimeToken: string | null,
  cleanUrl: string | null = null,
): Uint8Array {
  const source = new TextDecoder().decode(bytes);
  const insertion = runtimeInsertion(source);
  return new TextEncoder().encode(
    `${source.slice(0, insertion)}${previewRuntime(runtimeToken, cleanUrl)}${
      source.slice(insertion)
    }`,
  );
}

function runtimeInsertion(source: string): number {
  const safeFallback = insertionAfterLeadingDoctype(source);
  let cursor = safeFallback;

  while (cursor < source.length) {
    cursor = skipHtmlSpace(source, cursor);
    if (source.startsWith("<!--", cursor)) {
      const commentEnd = source.indexOf("-->", cursor + 4);
      if (commentEnd === -1) return safeFallback;
      cursor = commentEnd + 3;
      continue;
    }

    const tag = leadingStartTag(source, cursor);
    if (tag === null) return safeFallback;
    if (tag.name === "head") return tag.end;
    if (tag.name !== "html") return safeFallback;
    cursor = tag.end;
  }
  return safeFallback;
}

function insertionAfterLeadingDoctype(source: string): number {
  let cursor = source.charCodeAt(0) === 0xfeff ? 1 : 0;

  while (true) {
    cursor = skipHtmlSpace(source, cursor);
    if (!source.startsWith("<!--", cursor)) break;
    const commentEnd = source.indexOf("-->", cursor + 4);
    if (commentEnd === -1) return 0;
    cursor = commentEnd + 3;
  }

  const declaration = source.slice(cursor, cursor + 9).toLowerCase();
  if (declaration !== "<!doctype") return 0;
  const boundary = source[cursor + 9];
  if (boundary !== ">" && !isHtmlSpace(boundary)) return 0;

  let quote: '"' | "'" | null = null;
  for (let index = cursor + 9; index < source.length; index += 1) {
    const character = source[index];
    if (quote !== null) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === ">") return index + 1;
  }
  return 0;
}

function skipHtmlSpace(source: string, offset: number): number {
  while (isHtmlSpace(source[offset])) offset += 1;
  return offset;
}

function leadingStartTag(
  source: string,
  offset: number,
): { name: string; end: number } | null {
  if (source[offset] !== "<" || !isAsciiLetter(source[offset + 1])) {
    return null;
  }

  let nameEnd = offset + 2;
  while (isTagNameCharacter(source[nameEnd])) nameEnd += 1;
  const boundary = source[nameEnd];
  if (boundary !== ">" && boundary !== "/" && !isHtmlSpace(boundary)) {
    return null;
  }

  const end = tagEnd(source, nameEnd);
  return end === null
    ? null
    : { name: source.slice(offset + 1, nameEnd).toLowerCase(), end };
}

function tagEnd(source: string, offset: number): number | null {
  let quote: '"' | "'" | null = null;
  for (let index = offset; index < source.length; index += 1) {
    const character = source[index];
    if (quote !== null) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === ">") return index + 1;
  }
  return null;
}

function isAsciiLetter(character: string | undefined): boolean {
  if (character === undefined) return false;
  const code = character.charCodeAt(0);
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function isTagNameCharacter(character: string | undefined): boolean {
  if (character === undefined) return false;
  const code = character.charCodeAt(0);
  return isAsciiLetter(character) || (code >= 48 && code <= 57) ||
    character === "-";
}

function isHtmlSpace(character: string | undefined): boolean {
  return character === "\t" || character === "\n" || character === "\f" ||
    character === "\r" || character === " ";
}

function response(body: string, status: number): Response {
  return new Response(body, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
