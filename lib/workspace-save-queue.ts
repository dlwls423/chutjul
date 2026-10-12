import type {
  ComplaintWorkspace,
  WorkspaceSnapshot,
} from "./complaint-workspace";
export type SaveResult = { status: string; workspace?: ComplaintWorkspace };
export class WorkspaceSaveQueue {
  entries = new Map<
    string,
    {
      revision: number;
      snapshot: WorkspaceSnapshot;
      dirty: boolean;
      blocked: boolean;
      flight: Promise<void> | null;
    }
  >();
  private send: (body: unknown) => Promise<SaveResult>;
  private status: (id: string, state: string) => void;
  constructor(
    send: (body: unknown) => Promise<SaveResult>,
    status: (id: string, state: string) => void,
  ) {
    this.send = send;
    this.status = status;
  }
  seed(row: ComplaintWorkspace) {
    this.entries.set(row.id, {
      revision: row.revision,
      snapshot: row.snapshot,
      dirty: false,
      blocked: false,
      flight: null,
    });
  }
  update(id: string, snapshot: WorkspaceSnapshot) {
    const e = this.entries.get(id);
    if (!e) return;
    if (JSON.stringify(e.snapshot) === JSON.stringify(snapshot)) return;
    e.snapshot = snapshot;
    e.dirty = true;
    this.status(id, e.blocked ? "conflict" : "pending");
  }
  async flush(id: string) {
    const e = this.entries.get(id);
    if (!e || e.blocked) return;
    if (e.flight) return e.flight;
    e.flight = (async () => {
      while (e.dirty && !e.blocked) {
        const snapshot = e.snapshot;
        e.dirty = false;
        this.status(id, "saving");
        try {
          const result = await this.send({
            action: "save",
            id,
            revision: e.revision,
            snapshot,
          });
          if (result.status !== "saved" || !result.workspace) {
            e.dirty = true;
            e.blocked =
              result.status === "conflict" || result.status === "limit";
            this.status(
              id,
              result.status === "limit"
                ? "limit"
                : e.blocked
                  ? "conflict"
                  : "error",
            );
            break;
          }
          e.revision = result.workspace.revision;
          this.status(id, e.dirty ? "pending" : "saved");
        } catch {
          e.dirty = true;
          this.status(id, "error");
          break;
        }
      }
    })().finally(() => {
      e.flight = null;
    });
    return e.flight;
  }
  flushAll() {
    return Promise.all([...this.entries.keys()].map((id) => this.flush(id)));
  }
  hasUnsaved() {
    return [...this.entries.values()].some((e) => e.dirty || e.flight);
  }
  async remove(id: string) {
    await this.flush(id);
    const e = this.entries.get(id);
    if (!e || e.dirty || e.blocked) throw new Error("UNSAVED");
    const result = await this.send({
      action: "delete",
      id,
      revision: e.revision,
    });
    if (result.status !== "deleted") {
      e.blocked = true;
      this.status(id, "conflict");
      throw new Error("CONFLICT");
    }
    this.entries.delete(id);
  }
}
