import { WorkspaceSettingsStore } from "./settings.ts";
import { WorkspaceRoot } from "./workspace.ts";

export type WorkspaceHandoff = () => Promise<boolean>;

export interface WorkspaceOpenResult {
  opened: boolean;
  path: string | null;
}

export class WorkspaceController {
  active: WorkspaceRoot | null = null;

  constructor(
    private readonly settings: WorkspaceSettingsStore,
    private readonly handoff: WorkspaceHandoff,
  ) {}

  async open(
    path: string,
    options: { requireHandoff?: boolean } = {},
  ): Promise<WorkspaceOpenResult> {
    const next = await WorkspaceRoot.open(path);
    if (next.path === this.active?.path) {
      await this.settings.remember(next.path);
      return { opened: true, path: next.path };
    }

    if (this.active !== null && options.requireHandoff !== false) {
      const accepted = await this.handoff();
      if (!accepted) return { opened: false, path: this.active.path };
    }

    this.active = next;
    await this.settings.remember(next.path);
    return { opened: true, path: next.path };
  }
}
