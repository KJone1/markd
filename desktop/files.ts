import { extname, join, relative } from "node:path";
import type { ActiveFile, WorkspaceEntry } from "../src/shared/desktop.ts";
import { WorkspacePathError, WorkspaceRoot } from "./workspace.ts";

const EXCLUDED_DIRECTORIES = new Set([
  ".git",
  "node_modules",
  ".deno",
  ".venv",
  ".idea",
  ".vscode",
  ".cache",
  ".next",
  "coverage",
  "dist",
  "build",
]);

const EXCLUDED_FILES = new Set([
  ".DS_Store",
  "Thumbs.db",
  "desktop.ini",
  "Cargo.lock",
  "Gemfile.lock",
  "bun.lockb",
  "composer.lock",
  "deno.lock",
  "go.sum",
  "package-lock.json",
  "pnpm-lock.yaml",
  "poetry.lock",
  "uv.lock",
  "yarn.lock",
]);

const MAX_TEXT_FILE_BYTES = 10 * 1024 * 1024;
const BINARY_SAMPLE_BYTES = 8 * 1024;
const CODE_EXTENSIONS = new Set([
  ".bash",
  ".c",
  ".cfg",
  ".conf",
  ".cpp",
  ".cs",
  ".css",
  ".csv",
  ".env",
  ".fish",
  ".go",
  ".gql",
  ".graphql",
  ".h",
  ".hpp",
  ".ini",
  ".java",
  ".js",
  ".json",
  ".jsx",
  ".kt",
  ".kts",
  ".less",
  ".log",
  ".mjs",
  ".py",
  ".rb",
  ".rs",
  ".scss",
  ".sh",
  ".sql",
  ".svg",
  ".swift",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".xml",
  ".yaml",
  ".yml",
  ".zsh",
]);

export class WorkspaceFiles {
  constructor(readonly root: WorkspaceRoot) {}

  async index(): Promise<WorkspaceEntry[]> {
    return await this.readDirectory("", new Set([this.root.path]));
  }

  watch(listener: (entries: WorkspaceEntry[]) => void): () => void {
    const watcher = Deno.watchFs(this.root.path, { recursive: true });
    let closed = false;

    void (async () => {
      try {
        for await (const _event of watcher) {
          if (closed) return;
          try {
            listener(await this.index());
          } catch (error) {
            if (
              !(error instanceof Deno.errors.NotFound) &&
              !(error instanceof Deno.errors.PermissionDenied)
            ) {
              throw error;
            }
          }
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

  async open(path: string): Promise<ActiveFile> {
    let resolvedPath: string;
    let initialInfo: Deno.FileInfo;
    try {
      resolvedPath = await this.root.resolveExistingPath(path);
      initialInfo = await Deno.stat(resolvedPath);
    } catch (error) {
      if (error instanceof Deno.errors.PermissionDenied) {
        return information(path, "unreadable");
      }
      throw error;
    }

    if (!initialInfo.isFile) {
      throw new WorkspacePathError("Only workspace files can be opened.");
    }

    const route = routeFor(path);
    if (route === null) return information(path, "unsupported");

    let file: Deno.FsFile;
    try {
      file = await Deno.open(resolvedPath, { read: true });
    } catch (error) {
      if (
        error instanceof Deno.errors.PermissionDenied ||
        error instanceof Deno.errors.NotFound
      ) {
        return information(path, "unreadable");
      }
      throw error;
    }

    try {
      assertSameFile(initialInfo, await file.stat());
      await this.assertPathUnchanged(path, resolvedPath, initialInfo);

      const sample = new Uint8Array(
        Math.min(initialInfo.size, BINARY_SAMPLE_BYTES),
      );
      const sampleSize = await readBytes(file, sample);
      await this.assertPathUnchanged(path, resolvedPath, initialInfo);
      if (looksBinary(sample.subarray(0, sampleSize))) {
        return information(path, "binary");
      }
      if (initialInfo.size > MAX_TEXT_FILE_BYTES) {
        return information(path, "too-large");
      }

      await file.seek(0, Deno.SeekMode.Start);

      const bytes = new Uint8Array(initialInfo.size);
      const offset = await readBytes(file, bytes);
      await this.assertPathUnchanged(path, resolvedPath, initialInfo);

      const payload = bytes.subarray(0, offset);
      if (looksBinary(payload)) return information(path, "binary");

      try {
        return {
          kind: route,
          path,
          content: new TextDecoder("utf-8", { fatal: true }).decode(payload),
        };
      } catch {
        return information(path, "binary");
      }
    } finally {
      file.close();
    }
  }

  private async assertPathUnchanged(
    path: string,
    expectedResolvedPath: string,
    expectedInfo: Deno.FileInfo,
  ): Promise<void> {
    const currentResolvedPath = await this.root.resolveExistingPath(path);
    if (currentResolvedPath !== expectedResolvedPath) {
      throw new WorkspacePathError("The workspace path changed while opening.");
    }
    assertSameFile(expectedInfo, await Deno.stat(currentResolvedPath));
  }

  private async readDirectory(
    directory: string,
    visitedDirectories: Set<string>,
  ): Promise<WorkspaceEntry[]> {
    const directoryPath = directory === ""
      ? this.root.path
      : join(this.root.path, directory);
    const entries: WorkspaceEntry[] = [];
    const directoryEntries: Deno.DirEntry[] = [];

    try {
      for await (const entry of Deno.readDir(directoryPath)) {
        directoryEntries.push(entry);
      }
    } catch (error) {
      if (
        error instanceof Deno.errors.NotFound ||
        error instanceof Deno.errors.PermissionDenied
      ) {
        return [];
      }
      throw error;
    }

    for (const entry of directoryEntries) {
      if (entry.name === "." || entry.name === "..") continue;
      if (entry.name.startsWith(".markd-save-")) continue;
      if (EXCLUDED_FILES.has(entry.name)) continue;
      const relativePath = directory === ""
        ? entry.name
        : `${directory}/${entry.name}`;

      let resolvedPath: string;
      let info: Deno.FileInfo;
      try {
        resolvedPath = await this.root.resolveExistingPath(relativePath);
        info = await Deno.stat(resolvedPath);
      } catch (error) {
        if (
          error instanceof WorkspacePathError ||
          error instanceof Deno.errors.NotFound ||
          error instanceof Deno.errors.PermissionDenied
        ) {
          continue;
        }
        throw error;
      }

      if (info.isDirectory) {
        if (
          EXCLUDED_DIRECTORIES.has(entry.name) ||
          visitedDirectories.has(resolvedPath)
        ) {
          continue;
        }
        const nextVisited = new Set(visitedDirectories);
        nextVisited.add(resolvedPath);
        entries.push({
          kind: "directory",
          name: entry.name,
          path: relativePath,
          children: await this.readDirectory(relativePath, nextVisited),
        });
        continue;
      }

      if (info.isFile && relative(this.root.path, resolvedPath) !== "") {
        entries.push({ kind: "file", name: entry.name, path: relativePath });
      }
    }

    return entries.sort((left, right) => left.name.localeCompare(right.name));
  }
}

function routeFor(path: string): "markdown" | "html" | "code" | null {
  const extension = extname(path).toLowerCase();
  if (extension === ".md" || extension === ".markdown") return "markdown";
  if (extension === ".html" || extension === ".htm") return "html";
  if (extension === "" || CODE_EXTENSIONS.has(extension)) return "code";
  return null;
}

function information(
  path: string,
  reason: "binary" | "unreadable" | "unsupported" | "too-large",
): ActiveFile {
  return { kind: "information", path, reason };
}

function looksBinary(bytes: Uint8Array): boolean {
  const sample = bytes.subarray(0, Math.min(bytes.length, BINARY_SAMPLE_BYTES));
  return sample.some((byte) =>
    byte === 0 || (byte < 32 && byte !== 9 && byte !== 10 && byte !== 13)
  );
}

async function readBytes(
  file: Deno.FsFile,
  bytes: Uint8Array,
): Promise<number> {
  let offset = 0;
  while (offset < bytes.length) {
    const count = await file.read(bytes.subarray(offset));
    if (count === null) break;
    offset += count;
  }
  return offset;
}

function assertSameFile(expected: Deno.FileInfo, actual: Deno.FileInfo): void {
  if (
    expected.dev !== null && expected.ino !== null &&
    (expected.dev !== actual.dev || expected.ino !== actual.ino)
  ) {
    throw new WorkspacePathError("The workspace path changed while opening.");
  }
}
