"use client";
import { useState } from "react";
import "./DocumentViewer.css";
import "./DocumentViewerDetails.css";
import "./ProcessingAudit.css";
import GuideDetails from "./GuideDetails";

type Job = {
  file_name: string;
  status: string;
  progress?: number;
  pii_count?: number;
  document_count?: number;
  chunk_count?: number;
  error_message?: string;
  created_at?: string;
  completed_at?: string;
};
type Document = {
  id: string;
  title: string;
  document_type: string;
  department?: string;
  question_original?: string;
  answer_original?: string;
  content_masked?: string;
  page_count?: number;
  chunk_count: number;
  metadata?: Record<string, unknown>;
  status: string;
  [key: string]: unknown;
};
type Chunk = {
  id?: string;
  document_id?: string;
  chunk_index?: number;
  content?: string;
  token_estimate?: number;
  metadata?: Record<string, unknown>;
};
type SourceFile = Record<string, unknown>;
type Complaint = Record<string, unknown>;
type AiTransfer = {
  extraction?: {
    sent?: boolean;
    mode?: string;
    model?: string;
    content?: string;
    content_length?: number;
    privacy_checked?: boolean;
  };
  embedding?: { sent?: boolean; model?: string; content?: string };
};
type PrivacyGateway = {
  processed?: boolean;
  outbound_safe?: boolean;
  local_model?: string;
  schema_version?: number;
  pii_summary?: Record<string, number>;
  structured_complaint?: Record<string, unknown>;
  outbound_text?: string;
  review_status?: string;
};
const labels = [
  ["application_number", "신청번호"],
  ["receipt_number", "접수번호"],
  ["application_at", "신청일시"],
  ["received_at", "접수일시"],
  ["expected_completion_at", "처리완료 예정일"],
  ["summary", "민원요지"],
  ["handler_masked", "담당자"],
  ["department", "처리부서"],
  ["processor_masked", "처리자"],
  ["notification_at", "처리결과 통보일"],
  ["answer_confirmed_at", "답변 확인일"],
  ["application_channel", "신청경로"],
  ["complaint_kind", "민원종류"],
  ["processing_result", "처리구분"],
  ["public_status", "공개여부"],
  ["processing_period_days", "처리기간(일)"],
  ["notification_method", "답변 통지방식"],
];
const pdfStages = [
  ["checking", "중복 검사", 8, "파일 해시와 중복 여부 확인"],
  ["uploading", "원본 격리 저장", 18, "비공개 Storage에 원본 저장"],
  [
    "extracting_local",
    "브라우저 PDF 텍스트 추출",
    30,
    "외부 AI 없이 PDF 텍스트 추출",
  ],
  [
    "detecting_pii",
    "원문 개인정보 탐지",
    42,
    "질의 원문에서 개인정보 유형 탐지",
  ],
  [
    "summarizing_local",
    "브라우저 로컬 AI 핵심 정리",
    52,
    "사용자 기기의 브라우저가 최소 필요 정보만 구조화",
  ],
  [
    "verifying_summary",
    "외부 전송자료 재검사",
    64,
    "요약문 개인정보 잔존 여부 검사",
  ],
  ["chunking", "안전한 검색 단위 분할", 75, "검증된 질의 핵심만 청크로 분할"],
  ["embedding", "임베딩 생성", 86, "안전한 청크의 검색 벡터 생성"],
  ["completed", "저장 완료", 100, "문서·청크·개인정보 감사 기록 저장"],
] as const;
const excelStages = [
  ["checking", "중복 검사", 8, "파일 해시와 중복 여부 확인"],
  ["uploading", "원본 격리 저장", 18, "업로드 원본 정보 저장"],
  ["parsing", "Excel 텍스트 추출", 38, "열 이름에 따라 질의·답변 분리"],
  ["masking", "개인정보 마스킹", 55, "추출 텍스트에서 개인정보 가림"],
  ["chunking", "검색 단위 분할", 72, "제목·민원요지·질의·답변을 청크로 분할"],
  ["embedding", "임베딩 생성", 84, "마스킹된 청크의 검색 벡터 생성"],
  ["completed", "저장 완료", 100, "문서·청크·메타데이터 저장"],
] as const;
function complaintData(doc: Document) {
  return (doc.metadata?.complaint || {}) as Complaint;
}
function field(doc: Document, key: string) {
  const value = doc[key] ?? complaintData(doc)[key];
  if (Array.isArray(value)) return value.join(", ");
  return value == null || value === ""
    ? "—"
    : String(value)
        .replace("T", " ")
        .replace(/\+00:00$/, "");
}
function list(doc: Document, key: string) {
  const value = doc[key] ?? complaintData(doc)[key];
  return Array.isArray(value) ? value.map(String) : [];
}
function aiData(doc: Document) {
  return (doc.metadata?.ai_transfer || {}) as AiTransfer;
}
function privacyData(doc: Document) {
  return (doc.metadata?.privacy_gateway || {}) as PrivacyGateway;
}

export default function DocumentViewer({
  job,
  files,
  documents,
  chunks,
  loading,
  close,
  removeDocument,
  removeUpload,
}: {
  job: Job;
  files: SourceFile[];
  documents: Document[];
  chunks: Chunk[];
  loading: boolean;
  close: () => void;
  removeDocument: (id: string) => Promise<void>;
  removeUpload: () => Promise<void>;
}) {
  const [selected, setSelected] = useState("");
  const active = documents.find(
    (doc) => doc.id === (selected || documents[0]?.id),
  );
  const stages = job.file_name.toLowerCase().endsWith(".pdf")
    ? pdfStages
    : excelStages;
  const progress = job.progress || 0;
  const source = files[0] || {};
  const activeChunks = active
    ? chunks.filter((chunk) => chunk.document_id === active.id)
    : chunks;
  const transfer = active ? aiData(active) : {};
  const privacy = active ? privacyData(active) : {};
  return (
    <div className="viewer-back">
      <section className="document-viewer">
        <header>
          <div>
            <span className="eyebrow">PROCESSING DETAILS</span>
            <h2>{job.file_name}</h2>
            <p>
              처리 단계와 마스킹된 AI 전송자료를 확인합니다. 처리 중에는 2초마다
              자동 갱신됩니다.
            </p>
          </div>
          <button className="viewer-close" aria-label="닫기" onClick={close}>
            ×
          </button>
        </header>
        <div className="processing-summary">
          <div>
            <small>현재 상태</small>
            <strong className={job.status === "failed" ? "failed" : ""}>
              {job.status === "failed"
                ? "처리 실패"
                : job.status === "completed"
                  ? "처리 완료"
                  : `${progress}% 처리 중`}
            </strong>
          </div>
          <div>
            <small>개인정보 탐지</small>
            <strong>{job.pii_count || source.redaction_count || 0}건</strong>
          </div>
          <div>
            <small>추출 문서</small>
            <strong>{job.document_count || documents.length}건</strong>
          </div>
          <div>
            <small>검색 청크</small>
            <strong>{job.chunk_count || chunks.length}개</strong>
          </div>
        </div>
        <div className="stage-timeline">
          {stages.map(([key, label, threshold, description]) => {
            const failed = job.status === "failed" && progress < threshold;
            const state =
              job.status === "completed" || progress >= threshold
                ? "done"
                : failed
                  ? "blocked"
                  : job.status === key
                    ? "active"
                    : "pending";
            return (
              <div className={`stage ${state}`} key={key}>
                <i>
                  {state === "done" ? "✓" : state === "blocked" ? "!" : "•"}
                </i>
                <span>
                  <strong>{label}</strong>
                  <small>{description}</small>
                </span>
              </div>
            );
          })}
        </div>
        {job.error_message && (
          <div className="processing-error">
            <b>실패 원인</b>
            <span>{job.error_message}</span>
          </div>
        )}
        <div className="viewer-body">
          <aside className="document-list">
            {loading ? (
              <p className="empty-doc">불러오는 중…</p>
            ) : documents.length === 0 ? (
              <p className="empty-doc">처리 중이거나 저장된 문서가 없습니다.</p>
            ) : (
              documents.map((doc, index) => (
                <button
                  className={active?.id === doc.id ? "active" : ""}
                  onClick={() => setSelected(doc.id)}
                  key={doc.id}
                >
                  <small>
                    문서 {index + 1} · 청크 {doc.chunk_count || 0}개
                  </small>
                  <strong>{doc.title}</strong>
                  <span>
                    {doc.department || "부서 미지정"} ·{" "}
                    {doc.status === "ready" ? "검색 가능" : doc.status}
                  </span>
                </button>
              ))
            )}
            <button className="delete-upload" onClick={removeUpload}>
              업로드 자료 전체 삭제
            </button>
          </aside>
          <article className="document-detail">
            {active ? (
              active.document_type === "guide" ? (
                <GuideDetails document={active} remove={removeDocument} />
              ) : (
                <>
                  <div className="detail-title">
                    <div>
                      <span className="type-chip">민원</span>
                      <h3>{active.title}</h3>
                    </div>
                    <button
                      className="delete-doc"
                      onClick={() => removeDocument(active.id)}
                    >
                      민원 삭제
                    </button>
                  </div>
                  <div className="complaint-info">
                    {labels.map(([key, label]) => (
                      <div
                        className={key === "summary" ? "wide" : ""}
                        key={key}
                      >
                        <small>{label}</small>
                        <strong>{field(active, key)}</strong>
                      </div>
                    ))}
                  </div>
                  {list(active, "attachments").length > 0 && (
                    <section>
                      <h4>첨부파일</h4>
                      <div className="attachment-list">
                        {list(active, "attachments").map((name) => (
                          <span key={name}>▧ {name}</span>
                        ))}
                      </div>
                    </section>
                  )}
                  <section>
                    <h4>민원내용</h4>
                    <p>
                      {active.question_original ||
                        "분리된 민원내용이 없습니다."}
                    </p>
                  </section>
                  <section>
                    <h4>처리결과</h4>
                    <p>
                      {active.answer_original || "분리된 처리결과가 없습니다."}
                    </p>
                  </section>
                  <section className="ai-transfer">
                    <div className="audit-heading">
                      <div>
                        <h4>브라우저 로컬 AI 처리 및 외부 AI 전송 예정자료</h4>
                        <p>
                          원문은 외부 AI에 보내지 않고, 브라우저 안에서 만든 최소
                          질의만 표시합니다.
                        </p>
                      </div>
                      <span
                        className={privacy.outbound_safe ? "safe" : "muted"}
                      >
                        {privacy.outbound_safe
                          ? "✓ 외부 전송 안전성 검사 완료"
                          : "로컬 처리 기록 없음"}
                      </span>
                    </div>
                    {privacy.processed ? (
                      <>
                        <div className="transfer-meta">
                          <span>브라우저 모델: {privacy.local_model || "—"}</span>
                          <span>
                            탐지 개인정보:{" "}
                            {Object.values(privacy.pii_summary || {}).reduce(
                              (sum, value) => sum + Number(value || 0),
                              0,
                            )}
                            건
                          </span>
                          <span>
                            검토 상태:{" "}
                            {privacy.review_status === "pending"
                              ? "검토 대기"
                              : privacy.review_status || "—"}
                          </span>
                        </div>
                        <pre>
                          {privacy.outbound_text ||
                            "안전성 검사에서 차단되었습니다."}
                        </pre>
                      </>
                    ) : (
                      <p>
                        이 문서에는 V2 개인정보 게이트웨이 처리 기록이 없습니다.
                      </p>
                    )}
                  </section>
                  <section>
                    <div className="audit-heading">
                      <div>
                        <h4>임베딩 전송 청크</h4>
                        <p>
                          검색 벡터 생성을 위해 OpenAI Embedding API에 전송된
                          마스킹 텍스트입니다.
                        </p>
                      </div>
                      <span>{activeChunks.length}개</span>
                    </div>
                    <div className="chunk-audit">
                      {activeChunks.length ? (
                        activeChunks.map((chunk, index) => (
                          <details key={chunk.id || index}>
                            <summary>
                              청크 {Number(chunk.chunk_index ?? index) + 1} · 약{" "}
                              {chunk.token_estimate || 0} 토큰
                            </summary>
                            <p>{chunk.content || ""}</p>
                          </details>
                        ))
                      ) : (
                        <p>아직 생성된 청크가 없습니다.</p>
                      )}
                    </div>
                  </section>
                  <details>
                    <summary>마스킹 본문·전체 메타데이터</summary>
                    <section>
                      <h4>마스킹 본문</h4>
                      <p>{active.content_masked || "본문이 없습니다."}</p>
                    </section>
                    <pre>{JSON.stringify(active.metadata || {}, null, 2)}</pre>
                  </details>
                </>
              )
            ) : (
              <div className="empty-detail">
                {job.status === "failed"
                  ? "위 실패 원인을 확인하고 재처리해 주세요."
                  : "처리가 진행되면 추출 문서와 AI 전송자료가 여기에 표시됩니다."}
              </div>
            )}
          </article>
        </div>
      </section>
    </div>
  );
}
