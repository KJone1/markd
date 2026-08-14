import { basename, dirname, join } from "node:path";
import type {
  DocumentSaveRequest,
  DocumentSaveResult,
} from "../src/shared/desktop.ts";
import { WorkspaceFiles } from "./files.ts";
import { WorkspacePathError, WorkspaceRoot } from "./workspace.ts";

const MAX_TEXT_FILE_BYTES = 10 * 1024 * 1024;
const TEMP_FILE_PREFIX = ".markd-save-";

export interface DocumentWriter {
  write(data: Uint8Array): Promise<number>;
  sync(): Promise<void>;
  close(): void;
}

export interface WorkspaceDocumentsOptions {
  openTemporary(
    path: string,
    options: Deno.OpenOptions,
  ): Promise<DocumentWriter>;
}

const DEFAULT_OPTIONS: WorkspaceDocumentsOptions = {
  openTemporary: (path, options) => Deno.open(path, options),
};

export class WorkspaceDocuments {
  private readonly files: WorkspaceFiles;

  constructor(
    private readonly root: WorkspaceRoot,
    private readonly options: WorkspaceDocumentsOptions = DEFAULT_OPTIONS,
  ) {
    this.files = new WorkspaceFiles(root);
  }

  async save(request: DocumentSaveRequest): Promise<DocumentSaveResult> {
    if (
      new TextEncoder().encode(request.content).byteLength > MAX_TEXT_FILE_BYTES
    ) {
      throw new WorkspacePathError("The document exceeds the text file limit.");
    }

    const current = await this.readEditable(request.path);
    if (!request.overwrite && current.content !== request.expectedContent) {
      return { kind: "conflict", diskContent: current.content };
    }

    const resolvedPath = await this.root.resolveExistingPath(request.path);
    const info = await Deno.stat(resolvedPath);
    if (!info.isFile) throw new WorkspacePathError("Only files can be saved.");

    const temporaryPath = join(
      dirname(resolvedPath),
      `${TEMP_FILE_PREFIX}${basename(resolvedPath)}-${crypto.randomUUID()}`,
    );
    let temporaryCreated = false;
    try {
      const temporary = await this.options.openTemporary(temporaryPath, {
        createNew: true,
        write: true,
        mode: info.mode === null ? 0o600 : info.mode & 0o777,
      });
      temporaryCreated = true;
      try {
        await writeAll(temporary, new TextEncoder().encode(request.content));
        await temporary.sync();
      } finally {
        temporary.close();
      }

      const latest = await this.readEditable(request.path);
      if (!request.overwrite && latest.content !== request.expectedContent) {
        return { kind: "conflict", diskContent: latest.content };
      }
      const latestPath = await this.root.resolveExistingPath(request.path);
      if (latestPath !== resolvedPath) {
        throw new WorkspacePathError("The document path changed while saving.");
      }

      await Deno.rename(temporaryPath, resolvedPath);
      temporaryCreated = false;
      return { kind: "saved" };
    } finally {
      if (temporaryCreated) {
        await Deno.remove(temporaryPath).catch(() => undefined);
      }
    }
  }

  private async readEditable(path: string): Promise<{
    content: string;
  }> {
    const file = await this.files.open(path);
    if (file.kind !== "code" && file.kind !== "markdown") {
      throw new WorkspacePathError("This document is not editable.");
    }
    return file;
  }
}

async function writeAll(
  writer: DocumentWriter,
  content: Uint8Array,
): Promise<void> {
  let offset = 0;
  while (offset < content.length) {
    const written = await writer.write(content.subarray(offset));
    if (written <= 0) throw new Error("Document write made no progress.");
    offset += written;
  }
}
