import type {
  DocumentSaveRequest,
  DocumentSaveResult,
} from "./shared/desktop.ts";

export interface DocumentSessionOptions {
  path: string;
  content: string;
  save(request: DocumentSaveRequest): Promise<DocumentSaveResult>;
  onSaveFailure?(error: unknown): void;
  onDiskReload?(content: string): void;
  onConflict?(diskContent: string): void;
  debounceMs?: number;
}

export class DocumentSession {
  readonly path: string;
  buffer: string;
  private diskContent: string;
  private readonly saveDocument: DocumentSessionOptions["save"];
  private readonly debounceMs: number;
  private readonly onSaveFailure: (error: unknown) => void;
  private readonly onDiskReload: (content: string) => void;
  private readonly onConflict: (diskContent: string) => void;
  private autosaveTimer: ReturnType<typeof setTimeout> | null = null;
  private autosavePaused = false;
  private conflictContent: string | null = null;
  private inFlight: Promise<boolean> | null = null;
  private savingContent: string | null = null;

  constructor(options: DocumentSessionOptions) {
    this.path = options.path;
    this.buffer = options.content;
    this.diskContent = options.content;
    this.saveDocument = options.save;
    this.debounceMs = options.debounceMs ?? 300;
    this.onSaveFailure = options.onSaveFailure ?? (() => undefined);
    this.onDiskReload = options.onDiskReload ?? (() => undefined);
    this.onConflict = options.onConflict ?? (() => undefined);
  }

  edit(content: string): void {
    this.buffer = content;
    this.clearAutosave();
    if (this.autosavePaused) return;
    this.scheduleAutosave();
  }

  private scheduleAutosave(): void {
    if (this.buffer === this.diskContent || this.autosaveTimer !== null) return;
    this.autosaveTimer = setTimeout(() => {
      this.autosaveTimer = null;
      void this.saveLatest(false, false, false);
    }, this.debounceMs);
  }

  retry(): Promise<boolean> {
    this.clearAutosave();
    return this.saveLatest(false, true, true);
  }

  saveNow(): Promise<boolean> {
    return this.retry();
  }

  handoff(): Promise<boolean> {
    this.clearAutosave();
    return this.saveLatest(false, false, true);
  }

  diskChanged(content: string): void {
    if (content === this.diskContent) return;
    if (content === this.savingContent) {
      this.diskContent = content;
      return;
    }
    if (this.buffer === this.diskContent && this.autosaveTimer === null) {
      this.diskContent = content;
      this.buffer = content;
      this.onDiskReload(content);
      return;
    }

    this.clearAutosave();
    this.autosavePaused = true;
    this.conflictContent = content;
    this.onConflict(content);
  }

  reloadFromDisk(): void {
    if (this.conflictContent === null) return;
    const content = this.conflictContent;
    this.conflictContent = null;
    this.autosavePaused = false;
    this.diskContent = content;
    this.buffer = content;
    this.onDiskReload(content);
  }

  overwrite(): Promise<boolean> {
    this.clearAutosave();
    return this.saveLatest(true, true, true);
  }

  private clearAutosave(): void {
    if (this.autosaveTimer === null) return;
    clearTimeout(this.autosaveTimer);
    this.autosaveTimer = null;
  }

  private async saveLatest(
    overwrite: boolean,
    allowPaused: boolean,
    untilClean: boolean,
  ): Promise<boolean> {
    while (true) {
      if (this.inFlight !== null) {
        const activeSave = this.inFlight;
        const saved = await activeSave;
        if (!saved && !allowPaused) return false;
        continue;
      }
      if (this.buffer === this.diskContent) return true;
      if (this.autosavePaused && !allowPaused) return false;

      const operation = this.saveSnapshot(overwrite);
      this.inFlight = operation;
      const saved = await operation;
      if (this.inFlight === operation) this.inFlight = null;
      if (!saved) return false;
      if (this.buffer === this.diskContent) return true;
      if (!untilClean) {
        this.scheduleAutosave();
        return true;
      }
      overwrite = false;
    }
  }

  private async saveSnapshot(overwrite: boolean): Promise<boolean> {
    const content = this.buffer;
    const conflictAtStart = this.conflictContent;
    this.savingContent = content;
    try {
      const result = await this.saveDocument({
        path: this.path,
        content,
        expectedContent: overwrite && conflictAtStart !== null
          ? conflictAtStart
          : this.diskContent,
        overwrite,
      });
      if (result.kind === "conflict") {
        this.autosavePaused = true;
        this.conflictContent = result.diskContent;
        this.onConflict(result.diskContent);
        return false;
      }
      if (this.conflictContent !== conflictAtStart) return false;
      this.diskContent = content;
      this.autosavePaused = false;
      this.conflictContent = null;
      return true;
    } catch (error) {
      this.autosavePaused = true;
      this.onSaveFailure(error);
      return false;
    } finally {
      if (this.savingContent === content) this.savingContent = null;
    }
  }
}
