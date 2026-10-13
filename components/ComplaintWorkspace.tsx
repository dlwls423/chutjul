"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  emptySnapshot,
  validateWorkspaceSnapshot,
  type ComplaintWorkspace as Workspace,
  type WorkspaceSnapshot,
} from "../lib/complaint-workspace";
import {
  WorkspaceSaveQueue,
  type SaveResult,
} from "../lib/workspace-save-queue";
import { registerWorkspaceGuard } from "../lib/workspace-session";
import "./ComplaintWorkspace.css";

type Render = (
  initial: WorkspaceSnapshot,
  onChange: (s: WorkspaceSnapshot) => void,
  onBusy: (busy: boolean) => void,
) => ReactNode;
const labels: Record<string, string> = {
  pending: "수정사항 저장 대기",
  saving: "저장 중…",
  saved: "계정에 저장됨",
  error: "저장 실패 · 다시 시도해 주세요",
  conflict: "다른 접속에서 수정됨 · 덮어쓰기를 중단했습니다",
  limit: "계정에 이미 10개가 저장되어 있습니다",
};
function Pane({
  row,
  queue,
  render,
  schedule,
  onBusy,
}: {
  row: Workspace;
  queue: WorkspaceSaveQueue;
  render: Render;
  schedule: () => void;
  onBusy: (id: string, b: boolean) => void;
}) {
  const change = useCallback(
    (s: WorkspaceSnapshot) => {
      queue.update(row.id, s);
      schedule();
    },
    [queue, row.id, schedule],
  );
  const busy = useCallback((b: boolean) => onBusy(row.id, b), [row.id, onBusy]);
  return <>{render(row.snapshot, change, busy)}</>;
}
export default function ComplaintWorkspace({
  userId,
  render,
}: {
  userId: string;
  render: Render;
}) {
  const [rows, setRows] = useState<Workspace[]>([]),
    [active, setActive] = useState(""),
    [states, setStates] = useState<Record<string, string>>({}),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const busyRef = useRef(new Set<string>());
  const [generation, setGeneration] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null),
    alive = useRef(true);
  const queueRef = useRef<WorkspaceSaveQueue | null>(null);
  if (!queueRef.current)
    queueRef.current = new WorkspaceSaveQueue(
      async (body) => {
        if (userId === "public-test") {
          const b = body as {
            action: string;
            id: string;
            revision: number;
            snapshot: WorkspaceSnapshot;
          };
          return b.action === "delete"
            ? { status: "deleted" }
            : {
                status: "saved",
                workspace: {
                  id: b.id,
                  revision: b.revision + 1,
                  snapshot: b.snapshot,
                  updated_at: new Date().toISOString(),
                },
              };
        }
        const encoded = JSON.stringify(body);
        const response = await fetch("/api/workspaces", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: encoded,
          signal: AbortSignal.timeout(15000),
          keepalive: new TextEncoder().encode(encoded).byteLength < 50000,
        });
        const result = (await response.json()) as SaveResult;
        if (!response.ok && response.status !== 409)
          throw new Error("SAVE_FAILED");
        return result;
      },
      (id, state) => {
        if (alive.current) setStates((v) => ({ ...v, [id]: state }));
      },
    );
  const queue = queueRef.current;
  const schedule = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => void queue.flushAll(), 900);
  }, [queue]);
  const onBusy = useCallback((id: string, b: boolean) => {
    if (b) busyRef.current.add(id);
    else busyRef.current.delete(id);
    setBusyIds(new Set(busyRef.current));
  }, []);
  useEffect(
    () =>
      registerWorkspaceGuard(async () => {
        if (busyRef.current.size) return false;
        await queue.flushAll();
        return !queue.hasUnsaved();
      }),
    [queue, busyIds],
  );
  async function load() {
    setLoading(true);
    setError("");
    try {
      const data =
        userId === "public-test"
          ? { workspaces: [] as Workspace[] }
          : await (async () => {
              const response = await fetch("/api/workspaces", {
                cache: "no-store",
                signal: AbortSignal.timeout(15000),
              });
              if (!response.ok) throw new Error("LOAD_FAILED");
              return (await response.json()) as { workspaces: Workspace[] };
            })();
      data.workspaces.forEach((row) => validateWorkspaceSnapshot(row.snapshot));
      queue.entries.clear();
      data.workspaces.forEach((row) => queue.seed(row));
      setRows(data.workspaces);
      setStates(
        Object.fromEntries(data.workspaces.map((row) => [row.id, "saved"])),
      );
      setActive(data.workspaces[0]?.id || "");
      setGeneration((value) => value + 1);
    } catch {
      setError(
        "작성 상태를 불러오지 못했습니다. 로그인 상태와 DB 마이그레이션 적용 여부를 확인해 주세요.",
      );
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    alive.current = true;
    void load();
    const leave = (event: BeforeUnloadEvent) => {
      if (queue.hasUnsaved() || busyRef.current.size) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    const hide = () => {
      if (document.visibilityState === "hidden") void queue.flushAll();
    };
    window.addEventListener("beforeunload", leave);
    document.addEventListener("visibilitychange", hide);
    return () => {
      alive.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
      void queue.flushAll();
      window.removeEventListener("beforeunload", leave);
      document.removeEventListener("visibilitychange", hide);
    };
  }, []);
  async function reload() {
    if (busyIds.size || loading) return;
    await queue.flushAll();
    if (
      queue.hasUnsaved() &&
      !window.confirm(
        "저장되지 않은 변경사항이 있습니다. 백업 후 서버 상태를 다시 불러올까요?",
      )
    )
      return;
    await load();
  }
  async function add() {
    if (queue.entries.size >= 10) return;
    const row: Workspace = {
      id: crypto.randomUUID(),
      revision: 0,
      snapshot: emptySnapshot(),
      updated_at: new Date().toISOString(),
    };
    queue.seed(row);
    queue.entries.get(row.id)!.dirty = true;
    setRows((v) => [...v, row]);
    setActive(row.id);
    await queue.flush(row.id);
  }
  async function remove(id: string) {
    if (
      busyIds.has(id) ||
      !window.confirm("이 민원의 저장된 작성 상태를 삭제할까요?")
    )
      return;
    try {
      await queue.remove(id);
      setRows((v) => v.filter((row) => row.id !== id));
      if (active === id) setActive(rows.find((row) => row.id !== id)?.id || "");
    } catch {
      setError(
        "저장 또는 삭제에 실패했습니다. 작성 내용을 백업한 뒤 다시 시도해 주세요.",
      );
    }
  }
  function backup() {
    const values = [...queue.entries.entries()].map(([id, e]) => ({
      id,
      snapshot: e.snapshot,
    }));
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(values, null, 2)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "민원-작성상태-백업.json";
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <section className="workspaces" aria-label="민원별 작성 작업">
      <div className="workspace-toolbar">
        <div className="workspace-title">
          <span className="workspace-eyebrow">MY WORKSPACE</span>
          <strong>
            민원 작성{" "}
            <span className="workspace-count">
              {rows.length}
              <span> / 10</span>
            </span>
          </strong>
        </div>
        <div className="workspace-actions">
          <button
            className="workspace-add"
            disabled={loading || !!error || rows.length >= 10}
            onClick={() => void add()}
          >
            ＋ 새 민원
          </button>
          <button
            className="workspace-save"
            disabled={loading}
            onClick={() => void queue.flushAll()}
          >
            지금 저장
          </button>
          <details className="workspace-tools">
            <summary aria-label="작성 관리 메뉴">···</summary>
            <div className="workspace-tools-menu">
              <button disabled={!rows.length} onClick={backup}>
                작성 내용 백업
              </button>
              <button
                disabled={loading || busyIds.size > 0}
                onClick={() => void reload()}
              >
                서버 상태 다시 불러오기
              </button>
            </div>
          </details>
        </div>
      </div>
      {userId === "public-test" && (
        <p role="status">
          공개 테스트: 탭은 현재 접속에서만 유지됩니다. 다른 접속에서 이어
          작성하려면 개인 계정이 필요합니다.
        </p>
      )}
      {error && (
        <p role="alert">
          {error} <button onClick={() => void reload()}>불러오기 재시도</button>
        </p>
      )}
      {loading && <p role="status">작성 상태를 불러오는 중…</p>}
      {
        <>
          <div role="tablist" aria-label="민원 탭" className="workspace-tabs">
            {rows.map((row, index) => (
              <div
                key={row.id}
                className={`workspace-tab ${active === row.id ? "active" : ""}`}
              >
                <button
                  role="tab"
                  id={`tab-${row.id}`}
                  aria-controls={`pane-${row.id}`}
                  aria-selected={active === row.id}
                  tabIndex={active === row.id ? 0 : -1}
                  title={
                    queue.entries.get(row.id)?.snapshot.title ||
                    `민원 ${index + 1}`
                  }
                  onKeyDown={(event) => {
                    const next =
                      event.key === "Home"
                        ? 0
                        : event.key === "End"
                          ? rows.length - 1
                          : event.key === "ArrowRight"
                            ? (index + 1) % rows.length
                            : event.key === "ArrowLeft"
                              ? (index + rows.length - 1) % rows.length
                              : -1;
                    if (next < 0) return;
                    event.preventDefault();
                    void queue.flushAll();
                    setActive(rows[next].id);
                    document.getElementById(`tab-${rows[next].id}`)?.focus();
                  }}
                  onClick={() => {
                    void queue.flushAll();
                    setActive(row.id);
                  }}
                >
                  <span className="workspace-tab-number" aria-hidden="true">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span className="workspace-tab-label">
                    {queue.entries.get(row.id)?.snapshot.title ||
                      `민원 ${index + 1}`}
                  </span>
                  {busyIds.has(row.id) && (
                    <span className="workspace-tab-busy">작업 중</span>
                  )}
                </button>
                <button
                  className="workspace-tab-close"
                  disabled={loading || busyIds.has(row.id)}
                  aria-label={`민원 ${index + 1} 삭제`}
                  onClick={() => void remove(row.id)}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
          <div className="workspace-status-row">
            <p
              role="status"
              className={`workspace-save-status ${states[active] || "idle"}`}
            >
              <span className="workspace-status-dot" aria-hidden="true" />
              {(userId === "public-test" && states[active] === "saved"
                ? "테스트 세션에 유지됨"
                : labels[states[active]]) || "새 민원을 추가해 주세요."}
            </p>
            <span
              className="workspace-note"
              title="비식별 질의·답변 방향·초안·선택 근거·답변 예정일을 자동 저장합니다. 원문과 파일 정보는 저장하지 않습니다. 접속 종료 전 저장 완료를 확인하세요."
            >
              원문은 저장하지 않습니다 · 저장 완료 후 접속을 종료하세요
            </span>
          </div>
          {rows.map((row) => (
            <div
              role="tabpanel"
              id={`pane-${row.id}`}
              aria-labelledby={`tab-${row.id}`}
              hidden={row.id !== active}
              key={`${generation}-${row.id}`}
              inert={loading}
            >
              <Pane
                row={row}
                queue={queue}
                render={render}
                schedule={schedule}
                onBusy={onBusy}
              />
            </div>
          ))}
        </>
      }
    </section>
  );
}
