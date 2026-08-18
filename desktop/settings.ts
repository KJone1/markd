import { dirname } from "node:path";

const MAX_RECENT_WORKSPACES = 10;

export interface WorkspaceSettings {
  lastWorkspace: string | null;
  recentWorkspaces: string[];
  activeFiles: Record<string, string>;
}

const EMPTY_SETTINGS: WorkspaceSettings = {
  lastWorkspace: null,
  recentWorkspaces: [],
  activeFiles: {},
};

export class WorkspaceSettingsStore {
  private pending: Promise<unknown> = Promise.resolve();

  constructor(readonly path: string) {}

  async load(): Promise<WorkspaceSettings> {
    try {
      const value: unknown = JSON.parse(await Deno.readTextFile(this.path));
      if (!isWorkspaceSettings(value)) return copyEmptySettings();

      const recentWorkspaces = [...new Set(value.recentWorkspaces)].slice(
        0,
        MAX_RECENT_WORKSPACES,
      );
      return {
        lastWorkspace: typeof value.lastWorkspace === "string"
          ? value.lastWorkspace
          : null,
        recentWorkspaces,
        activeFiles: isActiveFiles(value.activeFiles) ? value.activeFiles : {},
      };
    } catch (error) {
      if (
        error instanceof Deno.errors.NotFound || error instanceof SyntaxError
      ) {
        return copyEmptySettings();
      }
      throw error;
    }
  }

  remember(resolvedPath: string): Promise<WorkspaceSettings> {
    return this.transact((current) => ({
      lastWorkspace: resolvedPath,
      recentWorkspaces: [
        resolvedPath,
        ...current.recentWorkspaces.filter((path) => path !== resolvedPath),
      ].slice(0, MAX_RECENT_WORKSPACES),
      activeFiles: current.activeFiles,
    }));
  }

  rememberActiveFile(
    workspacePath: string,
    relativePath: string,
  ): Promise<WorkspaceSettings> {
    return this.transact((current) => ({
      ...current,
      activeFiles: {
        ...current.activeFiles,
        [workspacePath]: relativePath,
      },
    }));
  }

  remove(resolvedPath: string): Promise<WorkspaceSettings> {
    return this.transact((current) => ({
      lastWorkspace: current.lastWorkspace === resolvedPath
        ? null
        : current.lastWorkspace,
      recentWorkspaces: current.recentWorkspaces.filter((path) =>
        path !== resolvedPath
      ),
      activeFiles: Object.fromEntries(
        Object.entries(current.activeFiles).filter(([path]) =>
          path !== resolvedPath
        ),
      ),
    }));
  }

  prune(
    isAvailable: (path: string) => Promise<boolean>,
  ): Promise<WorkspaceSettings> {
    return this.transact(async (current) => {
      const recentWorkspaces: string[] = [];
      for (const path of current.recentWorkspaces) {
        try {
          if (await isAvailable(path)) recentWorkspaces.push(path);
        } catch {
          // Unavailable entries are intentionally omitted.
        }
      }

      return {
        lastWorkspace: current.lastWorkspace !== null &&
            recentWorkspaces.includes(current.lastWorkspace)
          ? current.lastWorkspace
          : null,
        recentWorkspaces,
        activeFiles: Object.fromEntries(
          Object.entries(current.activeFiles).filter(([path]) =>
            recentWorkspaces.includes(path)
          ),
        ),
      };
    });
  }

  private transact(
    update: (
      current: WorkspaceSettings,
    ) => WorkspaceSettings | Promise<WorkspaceSettings>,
  ): Promise<WorkspaceSettings> {
    const settled = this.pending.then(async () => {
      const next = await update(await this.load());
      await this.save(next);
      return next;
    });
    this.pending = settled.catch(() => undefined);
    return settled;
  }

  private async save(settings: WorkspaceSettings): Promise<void> {
    await Deno.mkdir(dirname(this.path), { recursive: true });
    await Deno.writeTextFile(
      this.path,
      `${JSON.stringify(settings, null, 2)}\n`,
    );
  }
}

function copyEmptySettings(): WorkspaceSettings {
  return {
    lastWorkspace: EMPTY_SETTINGS.lastWorkspace,
    recentWorkspaces: [],
    activeFiles: {},
  };
}

function isWorkspaceSettings(value: unknown): value is WorkspaceSettings {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (candidate.lastWorkspace === null ||
    typeof candidate.lastWorkspace === "string") &&
    Array.isArray(candidate.recentWorkspaces) &&
    candidate.recentWorkspaces.every((path) => typeof path === "string") &&
    (candidate.activeFiles === undefined ||
      isActiveFiles(candidate.activeFiles));
}

function isActiveFiles(value: unknown): value is Record<string, string> {
  return typeof value === "object" && value !== null &&
    Object.values(value).every((path) => typeof path === "string");
}
