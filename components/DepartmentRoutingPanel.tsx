"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { DepartmentRouting } from "../lib/department-routing";
import { prepareWorkspaceSnapshot } from "../lib/browser-workspace";
import { emptySnapshot } from "../lib/complaint-workspace";
import "./DepartmentRouting.css";

export default function DepartmentRoutingPanel({
  query,
  department,
  departments,
  uploadRevision,
}: {
  query: string;
  department: string;
  departments: string[];
  uploadRevision: number;
}) {
  const [routing, setRouting] = useState<DepartmentRouting | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const requestRef = useRef<AbortController | null>(null),
    lastUpload = useRef(0);
  const run = useCallback(async () => {
    if (!query.trim()) return;
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setBusy(true);
    setError("");
    setRouting(null);
    try {
      const safeQuery = prepareWorkspaceSnapshot({
        ...emptySnapshot(),
        editorText: query,
      }).editorText;
      const response = await fetch("/api/department-routing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: safeQuery, department }),
        signal: AbortSignal.any([
          controller.signal,
          AbortSignal.timeout(60000),
        ]),
      });
      const result = (await response.json()) as {
        routing?: DepartmentRouting;
        error?: string;
      };
      if (!response.ok || !result.routing)
        throw Error(
          result.error ||
            "전체 부서 자료를 비교하지 못했습니다. 다시 시도해 주세요.",
        );
      if (requestRef.current === controller) setRouting(result.routing);
    } catch (cause) {
      if (controller.signal.aborted) return;
      if (requestRef.current === controller)
        setError(
          cause instanceof Error ? cause.message : "부서 분석에 실패했습니다.",
        );
    } finally {
      if (requestRef.current === controller) {
        requestRef.current = null;
        setBusy(false);
      }
    }
  }, [query, department]);
  useEffect(() => {
    requestRef.current?.abort();
    requestRef.current = null;
    setBusy(false);
    setError("");
    setRouting(null);
  }, [query, department]);
  useEffect(() => {
    if (uploadRevision > lastUpload.current) {
      lastUpload.current = uploadRevision;
      void run();
    }
  }, [uploadRevision, run]);
  useEffect(() => () => requestRef.current?.abort(), []);
  const missing = departments.filter(
    (name) =>
      !routing?.candidates.some((candidate) => candidate.department === name),
  );
  return (
    <section className="department-routing" aria-label="전체 부서 소관 분석">
      <div className="routing-heading">
        <div>
          <span>전체 부서 민원 데이터 비교</span>
          <h3>소관 부서 가능성</h3>
          <p>
            유사 민원 비교 점수로 계산한 상대 추정치입니다. 문서 업로드 후 자동
            분석하며, 질의를 수정한 경우 다시 분석하세요.
          </p>
        </div>
        <button disabled={busy || !query.trim()} onClick={() => void run()}>
          {busy ? "비교 중…" : "소관 부서 분석"}
        </button>
      </div>
      {busy && (
        <p className="routing-state" role="status">
          전체 부서의 준비 완료 민원에서 유사 쟁점을 비교하고 있습니다.
        </p>
      )}
      {error && (
        <p className="routing-state" role="alert">
          {error}
        </p>
      )}
      {!busy && !error && !routing && (
        <p className="routing-state">
          민원을 불러오거나 비식별 질의를 작성하면 소관 가능성을 확인할 수
          있습니다.
        </p>
      )}
      {routing && (
        <>
          {routing.candidates.length ? (
            <>
              <div className="routing-lead">
                <span>
                  비교 가능한 {routing.candidates.length}개 부서 중 가장 높은
                  상대 가능성
                </span>
                <strong>{routing.candidates[0].department}</strong>
                <b>{routing.candidates[0].likelihood}%</b>
              </div>
              <ol className="routing-ranking">
                {routing.candidates.map((candidate, index) => (
                  <li
                    key={candidate.department}
                    className={candidate.isCurrent ? "is-current" : ""}
                  >
                    <header>
                      <span className="routing-rank">{index + 1}</span>
                      <strong>{candidate.department}</strong>
                      {candidate.isCurrent && <small>현재 부서</small>}
                      <em>{candidate.likelihood}%</em>
                    </header>
                    <div
                      className="routing-meter"
                      role="meter"
                      aria-label={`${candidate.department} 상대 가능성`}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={candidate.likelihood}
                    >
                      <i style={{ width: `${candidate.likelihood}%` }} />
                    </div>
                    <p>
                      일치 쟁점: {candidate.matchedKeywords.join(" · ")}{" "}
                      <span>관련 민원 {candidate.sampleBand}</span>
                    </p>
                  </li>
                ))}
              </ol>
            </>
          ) : (
            <p className="routing-state">
              소관 가능성을 추정할 만큼 충분한 일치 민원을 찾지 못했습니다.
              이것만으로 해당 부서의 소관이 아니라고 판단할 수는 없습니다.
            </p>
          )}
          {!!missing.length && (
            <details className="routing-unscored">
              <summary>추정치를 제공하지 않은 부서 {missing.length}곳</summary>
              <p>
                일치 신호가 약하거나 공개 가능한 최소 집계 기준을 충족하지 않아
                퍼센트를 표시하지 않습니다.
              </p>
              <div>
                {missing.map((name) => (
                  <span key={name}>{name}</span>
                ))}
              </div>
            </details>
          )}
          <footer>{routing.notice}</footer>
        </>
      )}
    </section>
  );
}
