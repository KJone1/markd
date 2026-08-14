import { isAbsolute, relative, resolve } from "node:path";

export class WorkspacePathError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "WorkspacePathError";
  }
}

export class WorkspaceRoot {
  private constructor(readonly path: string) {}

  static async open(path: string): Promise<WorkspaceRoot> {
    let resolvedPath: string;
    try {
      resolvedPath = await Deno.realPath(path);
      const info = await Deno.stat(resolvedPath);
      if (!info.isDirectory) {
        throw new WorkspacePathError("A workspace must be a folder.");
      }
      for await (const _entry of Deno.readDir(resolvedPath)) {
        break;
      }
    } catch (error) {
      if (error instanceof WorkspacePathError) throw error;
      throw new WorkspacePathError("The workspace folder is unavailable.", {
        cause: error,
      });
    }

    return new WorkspaceRoot(resolvedPath);
  }

  async resolveExistingPath(path: string): Promise<string> {
    if (isAbsolute(path)) {
      throw new WorkspacePathError("Workspace paths must be relative.");
    }

    const candidate = resolve(this.path, path);
    if (!isContainedBy(this.path, candidate)) {
      throw new WorkspacePathError("The path is outside the workspace.");
    }

    let resolvedPath: string;
    try {
      resolvedPath = await Deno.realPath(candidate);
    } catch (error) {
      throw new WorkspacePathError("The workspace path is unavailable.", {
        cause: error,
      });
    }

    if (!isContainedBy(this.path, resolvedPath)) {
      throw new WorkspacePathError("The path resolves outside the workspace.");
    }

    return resolvedPath;
  }
}

function isContainedBy(root: string, candidate: string): boolean {
  const pathFromRoot = relative(root, candidate);
  return pathFromRoot === "" ||
    (!pathFromRoot.startsWith("..") && !isAbsolute(pathFromRoot));
}
