"use client";
import { useEffect, useRef, useState } from "react";
import DocumentViewer from "../components/DocumentViewer";
import "../components/DepartmentScope.css";
import "../components/DataButtons.css";
import "../components/V2Privacy.css";
import AuthGate, { Profile } from "../components/AuthGate";
import { preparePdfInBrowser } from "../lib/browser-privacy";
type View = "analyze" | "search" | "data";
type UploadJob = {
  id: string;
  file_name: string;
  file_size: number;
  document_type: string;
  status: string;
  progress: number;
  document_count?: number;
  chunk_count?: number;
  error_message?: string;
  created_at: string;
  source_files?: { original_name: string; size_bytes: number }[];
};
type RagDocument = {
  id: string;
  title: string;
  document_type: string;
  department?: string;
  category_major?: string;
  category_middle?: string;
  category_minor?: string;
  question_original?: string;
  answer_original?: string;
  content_masked?: string;
  pii_findings?: { type: string }[];
  page_count?: number;
  chunk_count: number;
  metadata?: Record<string, unknown>;
  status: string;
  created_at: string;
};
type JobDetail = {
  job?: UploadJob;
  files?: Record<string, unknown>[];
  documents?: RagDocument[];
  chunks?: Record<string, unknown>[];
};
type UploadNotice = { kind: "success" | "error"; fileName: string; message: string } | null;
const departments = [
  "범정부마이데이터추진단",
  "개인정보보호정책과",
  "조사총괄과",
  "개인정보침해평가과",
  "신기술개인정보과",
  "분쟁조정과",
  "테스트부서",
];
export default function Home() {
  return <AuthGate>{(profile) => <WorkspaceApp profile={profile} />}</AuthGate>;
}
const complaint =
  "마이데이터 사업자 허가를 신청한 지 30일이 지났는데 아직 결과를 받지 못했습니다. 법적으로 처리기한이 언제까지인지, 지연되는 경우 어떤 안내를 받을 수 있는지 알고 싶습니다.";
const cases = [
  [
    "92%",
    "마이데이터 사업자 허가 심사기간 관련 문의",
    "허가 신청 후 법정 처리기간 및 심사 지연 시 통지 절차에 대한 문의입니다.",
    "2026-04-18",
    "금융데이터과",
  ],
  [
    "86%",
    "본인신용정보관리업 허가 처리 절차",
    "허가 심사의 단계와 보완 요청에 따른 기간 산정 문의",
    "2025-11-03",
    "마이데이터추진단",
  ],
  [
    "79%",
    "허가 신청 서류 보완기간 산정 문의",
    "서류 보완 요청을 받은 경우 처리기간 계산 방법 문의",
    "2025-08-22",
    "금융데이터과",
  ],
];
const files = [
  [
    "2026년_민원답변_목록.xlsx",
    "민원",
    "128건",
    "처리 완료",
    "2026-08-24 14:32",
  ],
  [
    "마이데이터_허가심사_안내서.pdf",
    "안내서",
    "42쪽",
    "처리 완료",
    "2026-08-24 11:05",
  ],
  [
    "신용정보법_시행령_개정본.pdf",
    "법령",
    "86쪽",
    "처리 중",
    "2026-08-24 15:08",
  ],
  ["2025년_민원_백업.xlsx", "민원", "—", "처리 실패", "2026-08-23 17:41"],
];
function WorkspaceApp({ profile }: { profile: Profile }) {
  const [view, setView] = useState<View>("analyze");
  const [currentDepartment, setCurrentDepartment] = useState(
    profile.department,
  );
  const [query, setQuery] = useState("허가 처리기간이 30일을 넘은 민원");
  const [text, setText] = useState(complaint);
  const [masked, setMasked] = useState(false);
  const [toast, setToast] = useState("");
  const [modal, setModal] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadStage, setUploadStage] = useState("");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadNotice, setUploadNotice] = useState<UploadNotice>(null);
  const [jobs, setJobs] = useState<UploadJob[]>([]);
  const refreshSequence = useRef(0);
  const [retryId, setRetryId] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  function flash(s: string) {
    setToast(s);
    setTimeout(() => setToast(""), 3000);
  }
  async function refresh() {
    const sequence = ++refreshSequence.current;
    try {
      const r = await fetch(
        `/api/uploads?department=${encodeURIComponent(currentDepartment)}`,
        { cache: "no-store" },
      );
      const j = await r.json();
      if (r.ok && sequence === refreshSequence.current) setJobs(j.jobs || []);
    } catch {}
  }
  useEffect(() => {
    if (view !== "data") return;
    refresh();
    const timer = setInterval(refresh, 2000);
    return () => clearInterval(timer);
  }, [view, currentDepartment]);
  async function upload(f?: File) {
    if (!f) return;
    setUploading(true);
    setUploadNotice(null);
    const form = new FormData();
    setUploadStage("파일을 확인하고 있습니다.");
    setUploadProgress(4);
    try {
      let uploadFile=f;
      if (f.name.toLowerCase().endsWith(".pdf") && !f.name.includes("안내서")) {
        const prepared = await preparePdfInBrowser(f, (message, progress) => {
          setUploadStage(message);
          setUploadProgress(progress);
        });
        uploadFile=prepared.maskedPdf;
        form.append("browserPrivacy", JSON.stringify(prepared.privacy));
      }
      setUploadStage("마스킹된 PDF와 비식별 자료만 저장하고 있습니다.");
      setUploadProgress(84);
      form.append("file", uploadFile);
      form.append("documentType", "complaint");
      form.append("department", currentDepartment);
      if (retryId) form.append("retryJobId", retryId);
      const r = await fetch("/api/uploads", { method: "POST", body: form });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "업로드에 실패했습니다.");
      setUploadNotice({
        kind: "success",
        fileName: f.name,
        message: `저장 완료 · 문서 ${j.documentCount || 0}건 · 청크 ${j.chunkCount || 0}개`,
      });
      flash(
        `${f.name} 처리 완료 · 문서 ${j.documentCount || 0}건 · 청크 ${j.chunkCount || 0}개`,
      );
    } catch (e) {
      const message=e instanceof Error ? e.message : "업로드에 실패했습니다.";
      setUploadNotice({ kind: "error", fileName: f.name, message });
      flash(message);
    } finally {
      setUploading(false);
      setUploadStage("");
      setUploadProgress(0);
      setRetryId("");
      if (inputRef.current) inputRef.current.value = "";
      refresh();
    }
  }
  function retry(id: string) {
    setRetryId(id);
    inputRef.current?.click();
  }
  return (
    <main className="app-shell">
      <Sidebar view={view} setView={setView} />
      <section className="workspace">
        <header className="topbar">
          <div>
            <h1>
              {view === "analyze"
                ? "새 민원 분석"
                : view === "search"
                  ? "통합 검색"
                  : "데이터 관리"}
            </h1>
            <p>
              {view === "analyze"
                ? "민원 내용을 바탕으로 유사 사례와 법령을 찾고 답변 초안을 작성합니다."
                : view === "search"
                  ? "민원·법령·안내서를 자연어로 한 번에 검색합니다."
                  : "검색에 사용할 원문과 처리 상태를 관리합니다."}
            </p>
          </div>
          <div className="head-actions">
            <label className="department-scope">
              <small>현재 부서</small>
              <select
                value={currentDepartment}
                disabled={profile.role !== "admin"}
                onChange={(e) => setCurrentDepartment(e.target.value)}
              >
                {departments.map((department) => (
                  <option key={department}>{department}</option>
                ))}
              </select>
            </label>
            {view === "analyze" ? (
              <button
                className="history"
                onClick={() => setModal("최근 분석 기록")}
              >
                ↶ 분석 기록
              </button>
            ) : (
              <span className="live-refresh">● 2초마다 자동 갱신</span>
            )}
            <div className="head-avatar">{profile.full_name[0]}</div>
          </div>
        </header>
        {view === "analyze" && (
          <>
            <div className="scope-notice">
              🔒 답변 근거 범위: <b>{currentDepartment}</b> 자료만 검색합니다.
            </div>
            <Analyze
              text={text}
              setText={setText}
              masked={masked}
              setMasked={setMasked}
              flash={flash}
              setModal={setModal}
            />
          </>
        )}{" "}
        {view === "search" && (
          <>
            <div className="scope-notice">
              🔒 검색 범위: <b>{currentDepartment}</b> 자료만 표시합니다.
            </div>
            <Search query={query} setQuery={setQuery} setModal={setModal} />
          </>
        )}{" "}
        {view === "data" && (
          <Data
            inputRef={inputRef}
            upload={upload}
            uploading={uploading}
            uploadStage={uploadStage}
            uploadProgress={uploadProgress}
            uploadNotice={uploadNotice}
            clearUploadNotice={() => setUploadNotice(null)}
            jobs={jobs}
            retry={retry}
            refresh={refresh}
            flash={flash}
          />
        )}
      </section>
      {toast && <div className="toast">{toast}</div>}
      {modal && <Modal title={modal} close={() => setModal(null)} />}
      <input
        ref={inputRef}
        className="hidden-input"
        type="file"
        accept=".xlsx,.xls,.pdf"
        onChange={(e) => upload(e.target.files?.[0])}
      />
    </main>
  );
}
function Sidebar({
  view,
  setView,
}: {
  view: View;
  setView: (v: View) => void;
}) {
  function navigate(next: View) {
    window.dispatchEvent(new Event("workspace-navigation"));
    setView(next);
  }
  return (
    <aside className="sidebar">
      <div className="brand">
        <span>첫</span>
        <strong>첫줄</strong>
      </div>
      <nav>
        {(
          [
            ["analyze", "＋", "새 민원 분석"],
            ["search", "⌕", "통합 검색"],
            ["data", "▤", "데이터 관리"],
          ] as const
        ).map((x) => (
          <button
            key={x[0]}
            className={"nav-item " + (view === x[0] ? "active" : "")}
            onClick={() => navigate(x[0])}
          >
            <i>{x[1]}</i>
            <span>{x[2]}</span>
          </button>
        ))}
      </nav>
      <div className="sidebar-bottom">
        <button className="nav-item">
          <i>?</i>
          <span>도움말</span>
        </button>
        <div className="profile">
          <div className="avatar">김</div>
          <div>
            <strong>김민지</strong>
            <small>마이데이터추진단</small>
          </div>
          <b>⋮</b>
        </div>
      </div>
    </aside>
  );
}
function Analyze({
  text,
  setText,
  masked,
  setMasked,
  flash,
  setModal,
}: {
  text: string;
  setText: (s: string) => void;
  masked: boolean;
  setMasked: (b: boolean) => void;
  flash: (s: string) => void;
  setModal: (s: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  function analyze() {
    setBusy(true);
    setTimeout(() => {
      setBusy(false);
      flash("분석이 완료되었습니다.");
    }, 900);
  }
  return (
    <div className="content">
      <section className="input-card">
        <div className="title-row">
          <Title
            n="1"
            title="민원 내용"
            sub="접수된 민원 내용을 입력하거나 붙여넣어 주세요."
          />
          <button
            className={masked ? "mask active" : "mask"}
            onClick={() => {
              setMasked(!masked);
              flash(
                masked
                  ? "원문을 표시합니다."
                  : "개인정보 2건을 마스킹했습니다.",
              );
            }}
          >
            ◉ {masked ? "마스킹 적용됨" : "개인정보 탐지"}
          </button>
        </div>
        <div className="fields">
          <label>
            민원 제목
            <input defaultValue="마이데이터 사업자 허가 처리기한 문의" />
          </label>
          <label>
            민원 본문
            <textarea
              value={
                (masked
                  ? "홍○동 민원인이 010-****-1234로 문의했습니다.\n"
                  : "") + text
              }
              onChange={(e) => setText(e.target.value)}
            />
          </label>
          <div className="meta-row">
            <label>
              접수일
              <input type="date" defaultValue="2026-08-24" />
            </label>
            <label>
              담당자
              <input defaultValue="김민지" />
            </label>
            <label>
              첨부파일<button className="file-btn">＋ 파일 추가</button>
            </label>
          </div>
        </div>
        <div className="input-footer">
          <span>{text.length} / 10,000자</span>
          <button className="analyze" onClick={analyze}>
            {busy ? "분석 중…" : "✦ 민원 분석하기"}
          </button>
        </div>
      </section>
      <div className="analysis-head">
        <Title
          n="2"
          title="분석 결과"
          sub="AI가 찾은 결과를 검토하고 필요한 근거를 선택하세요."
        />
        <span className="done">✓ 분석 완료 · 4.2초</span>
      </div>
      <div className="summary-strip">
        <div>
          <small>소관 판단</small>
          <strong>
            소관 <em>94%</em>
          </strong>
        </div>
        <div>
          <small>업무 분류</small>
          <strong>마이데이터 › 사업자 허가</strong>
        </div>
        <div>
          <small>핵심 쟁점</small>
          <strong>법정 처리기한 · 지연 통지</strong>
        </div>
        <div>
          <small>신규 유형 가능성</small>
          <strong>낮음</strong>
        </div>
      </div>
      <div className="result-grid">
        <ResultCases setModal={setModal} />
        <ResultLaws setModal={setModal} />
      </div>
      <section className="draft-card">
        <div className="draft-head">
          <Title
            n="3"
            title="답변 초안"
            sub="근거 자료를 반영한 초안입니다. 내용을 검토하고 수정하세요."
          />
          <div>
            <button
              onClick={() => flash("선택한 근거로 초안을 다시 작성했습니다.")}
            >
              ↻ 다시 생성
            </button>
            <button
              className="save"
              onClick={() => flash("답변과 사용 근거가 저장되었습니다.")}
            >
              저장하기
            </button>
          </div>
        </div>
        <div className="draft-body">
          <div
            className="editor"
            contentEditable
            suppressContentEditableWarning
          >
            <p>
              안녕하세요. 귀하께서 문의하신 마이데이터 사업자 허가 처리기간에
              대해 다음과 같이 답변드립니다.
            </p>
            <p>
              「신용정보의 이용 및 보호에 관한 법률」 제7조 제2항에 따라
              금융위원회는 허가 신청을 받은 날부터 <mark>3개월 이내</mark>에
              허가 여부를 결정하는 것을 원칙으로 합니다.
            </p>
            <p>
              다만, 신청서류의 보완에 소요된 기간 등은 처리기간에 산입되지 않을
              수 있습니다. 현재 신청 건의 구체적인 진행 상황과 지연 사유는 담당
              부서에 확인이 필요하며, 확인 후 별도로 안내드리겠습니다.
            </p>
            <p>
              추가 문의사항이 있으시면 마이데이터추진단으로 연락하여 주시기
              바랍니다. 감사합니다.
            </p>
          </div>
          <aside className="evidence">
            <h3>
              사용 근거 <span>3</span>
            </h3>
            {[
              "① 유사 민원|허가 심사기간 관련 문의",
              "② 신용정보법|제7조 제2항",
              "③ 허가심사 안내서|제2장 · 14쪽",
            ].map((x) => {
              const a = x.split("|");
              return (
                <div key={x}>
                  <b>{a[0]}</b>
                  <p>{a[1]}</p>
                </div>
              );
            })}
            <label>
              이관 가능 부서
              <select defaultValue="마이데이터추진단">
                <option>마이데이터추진단</option>
                <option>금융데이터과</option>
              </select>
            </label>
            <label>
              답변 예정일
              <input type="date" defaultValue="2026-08-28" />
            </label>
          </aside>
        </div>
      </section>
    </div>
  );
}
function ResultCases({ setModal }: { setModal: (s: string) => void }) {
  return (
    <section className="result-card">
      <Head title="유사 민원" count="5건" />
      {cases.slice(0, 2).map((c, i) => (
        <div className={"case " + (i === 0 ? "selected" : "")} key={c[1]}>
          <div>
            <b>{c[0]} 일치</b>
            <small>
              {c[3]} · {c[4]}
            </small>
          </div>
          <h4>{c[1]}</h4>
          <p>{c[2]}</p>
          {i === 0 && (
            <button onClick={() => setModal(c[1])}>원문 보기 ↗</button>
          )}
        </div>
      ))}
      <button className="more" onClick={() => setModal("유사 민원 전체 결과")}>
        유사 민원 3건 더보기　⌄
      </button>
    </section>
  );
}
function ResultLaws({ setModal }: { setModal: (s: string) => void }) {
  return (
    <section className="result-card">
      <Head title="관련 법령 · 안내서" count="4건" />
      <div className="law selected">
        <b>법령</b>
        <h4>신용정보의 이용 및 보호에 관한 법률</h4>
        <p>제7조(허가) 제2항</p>
        <blockquote>
          금융위원회는 허가 신청을 받은 날부터 3개월 이내에 허가 여부를
          결정하고...
        </blockquote>
        <button onClick={() => setModal("신용정보법 제7조 원문")}>
          법령 원문 ↗
        </button>
      </div>
      <div className="law">
        <b className="guide">안내서</b>
        <h4>마이데이터 허가심사 안내서</h4>
        <p>제2장 허가 절차 · 14쪽</p>
      </div>
      <button className="more" onClick={() => setModal("관련 자료 전체 결과")}>
        관련 자료 2건 더보기　⌄
      </button>
    </section>
  );
}
function Search({
  query,
  setQuery,
  setModal,
}: {
  query: string;
  setQuery: (s: string) => void;
  setModal: (s: string) => void;
}) {
  const [tab, setTab] = useState("전체");
  return (
    <div className="search-page">
      <div className="search-hero">
        <span className="eyebrow">KNOWLEDGE SEARCH</span>
        <h2>어떤 자료를 찾고 계신가요?</h2>
        <p>문장으로 질문하거나 찾고 싶은 단어를 입력해 보세요.</p>
        <div className="big-search">
          <span>⌕</span>
          <input value={query} onChange={(e) => setQuery(e.target.value)} />
          <button>검색</button>
        </div>
        <div className="suggest">
          <span>추천 검색</span>
          <button onClick={() => setQuery("개인정보 전송요구권")}>
            개인정보 전송요구권
          </button>
          <button onClick={() => setQuery("허가 처리기간")}>
            허가 처리기간
          </button>
          <button onClick={() => setQuery("마이데이터 철회")}>
            마이데이터 철회
          </button>
        </div>
      </div>
      <div className="search-content">
        <div className="filters">
          <label>
            부서
            <select>
              <option>마이데이터추진단</option>
              <option>전체 부서</option>
            </select>
          </label>
          <label>
            업무 분류
            <select>
              <option>전체</option>
              <option>사업자 허가</option>
            </select>
          </label>
          <label>
            소관 법령
            <select>
              <option>전체 법령</option>
              <option>신용정보법</option>
            </select>
          </label>
        </div>
        <div className="search-summary">
          <div>
            <h3>“{query}” 검색 결과</h3>
            <p>총 24건의 관련 자료를 찾았습니다.</p>
          </div>
          <select>
            <option>관련도순</option>
            <option>최신순</option>
          </select>
        </div>
        <div className="tabs">
          {["전체 24", "유사민원 12", "법령 7", "안내서 5"].map((x) => (
            <button
              className={tab === x.split(" ")[0] ? "on" : ""}
              onClick={() => setTab(x.split(" ")[0])}
              key={x}
            >
              {x}
            </button>
          ))}
        </div>
        <div className="search-results">
          {cases.map((c, i) => (
            <article key={c[1]}>
              <div className="result-icon">{i === 2 ? "법" : "민"}</div>
              <div>
                <div className="result-meta">
                  <b>{i === 2 ? "법령" : "유사민원"}</b>
                  <span>
                    {c[3]} · {c[4]}
                  </span>
                  <em>{c[0]} 관련</em>
                </div>
                <h4>{c[1]}</h4>
                <p>
                  {c[2]} <mark>처리기간</mark>과 관련한 주요 내용을 포함합니다.
                </p>
                <div className="tags">
                  <span>마이데이터</span>
                  <span>허가</span>
                  <span>처리기한</span>
                </div>
              </div>
              <button className="open" onClick={() => setModal(c[1])}>
                원문 보기 ↗
              </button>
            </article>
          ))}
        </div>
        <button className="load-more">결과 더보기</button>
      </div>
    </div>
  );
}
function Data({
  inputRef,
  upload,
  uploading,
  uploadStage,
  uploadProgress,
  uploadNotice,
  clearUploadNotice,
  jobs,
  retry,
  refresh,
  flash,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  upload: (f?: File) => void;
  uploading: boolean;
  uploadStage: string;
  uploadProgress: number;
  uploadNotice: UploadNotice;
  clearUploadNotice: () => void;
  jobs: UploadJob[];
  retry: (id: string) => void;
  refresh: () => Promise<void>;
  flash: (s: string) => void;
}) {
  const [type, setType] = useState("전체");
  const [search, setSearch] = useState("");
  const [detailJob, setDetailJob] = useState<UploadJob | null>(null);
  const [detailData, setDetailData] = useState<JobDetail>({});
  const [detailDocs, setDetailDocs] = useState<RagDocument[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  async function loadDetails(job: UploadJob, quiet = false) {
    if (job.id.startsWith("sample-")) return;
    if (!quiet) setDetailLoading(true);
    try {
      const r = await fetch(`/api/uploads/${job.id}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      setDetailData(j);
      setDetailDocs(j.documents || []);
      if (j.job) setDetailJob(j.job);
    } catch (e) {
      if (!quiet)
        flash(e instanceof Error ? e.message : "자료를 불러오지 못했습니다.");
    } finally {
      if (!quiet) setDetailLoading(false);
    }
  }
  async function openDetails(job: UploadJob) {
    setDetailJob(job);
    await loadDetails(job);
  }
  useEffect(() => {
    if (!detailJob || ["completed", "failed"].includes(detailJob.status))
      return;
    const timer = setInterval(() => loadDetails(detailJob, true), 2000);
    return () => clearInterval(timer);
  }, [detailJob?.id, detailJob?.status]);
  async function removeDocument(id: string) {
    if (
      !confirm("이 민원과 검색 청크를 삭제할까요? 삭제 후 복구할 수 없습니다.")
    )
      return;
    const r = await fetch(`/api/documents/${id}`, { method: "DELETE" });
    const j = await r.json();
    if (!r.ok) {
      flash(j.error || "삭제하지 못했습니다.");
      return;
    }
    setDetailDocs((v) => v.filter((doc) => doc.id !== id));
    flash("민원과 검색 청크를 삭제했습니다.");
    await refresh();
  }
  async function removeUpload() {
    if (
      !detailJob ||
      !confirm(
        `“${detailJob.file_name}”의 민원, 검색 청크, 마스킹 PDF와 처리 기록을 모두 삭제할까요? 이 작업은 복구할 수 없습니다.`,
      )
    )
      return;
    const r = await fetch(`/api/uploads/${detailJob.id}`, { method: "DELETE" });
    const j = await r.json();
    if (!r.ok) {
      flash(j.error || "삭제하지 못했습니다.");
      return;
    }
    setDetailJob(null);
    setDetailData({});
    setDetailDocs([]);
    flash("업로드 자료 전체를 삭제했습니다.");
    await refresh();
  }
  const active = jobs.filter(
    (j) => !["completed", "failed"].includes(j.status),
  ).length;
  const failed = jobs.filter((j) => j.status === "failed").length;
  const chunks = jobs.reduce((n, j) => n + (j.chunk_count || 0), 0);
  const rows = jobs.length
    ? jobs
    : files.map(
        (f, i) =>
          ({
            id: `sample-${i}`,
            file_name: f[0],
            file_size: [2516582, 9122611, 4299161, 1933312][i],
            document_type: f[1],
            status:
              f[3] === "처리 완료"
                ? "completed"
                : f[3] === "처리 중"
                  ? "parsing"
                  : "failed",
            progress: f[3] === "처리 완료" ? 100 : f[3] === "처리 중" ? 48 : 0,
            document_count:
              f[2] === "—" ? 0 : Number(f[2].replace(/[^0-9]/g, "")),
            created_at: f[4],
          }) as UploadJob,
      );
  const filtered = rows.filter(
    (j) =>
      (type === "전체" || labelType(j.document_type) === type) &&
      j.file_name.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <div className="data-page">
      <div className="pipeline-note">
        <b>V2 브라우저 보호 처리</b>
        <span>PDF 텍스트 추출</span>
        <i>→</i>
        <span>마스킹 PDF 생성</span>
        <i>→</i>
        <span>브라우저 AI 요약</span>
        <i>→</i>
        <span>전송자료 재검사</span>
        <i>→</i>
        <span>안전한 청크 임베딩</span>
        <i>→</i>
        <span>저장 완료</span>
      </div>
      <div className="metric-grid">
        <Metric
          n={String(jobs.length)}
          label="전체 업로드"
          sub="Supabase 저장 작업"
          color="blue"
        />
        <Metric
          n={chunks.toLocaleString()}
          label="검색 가능 청크"
          sub="임베딩 생성 완료"
          color="green"
        />
        <Metric
          n={String(active)}
          label="처리 중"
          sub="2초마다 자동 갱신"
          color="orange"
        />
        <Metric
          n={String(failed)}
          label="처리 실패"
          sub="상세 원인 확인 가능"
          color="red"
        />
      </div>
      <section
        className={"drop-zone " + (uploading ? "loading" : "")}
        onClick={() => !uploading && inputRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (!uploading) upload(e.dataTransfer.files[0]);
        }}
      >
        <div className="upload-icon">⇧</div>
        <h3>
          {uploading
            ? uploadStage || "단계별 처리 상태를 확인하고 있습니다…"
            : "새 민원 자료 업로드"}
        </h3>
        {uploading && <div className="browser-progress"><i style={{width:`${uploadProgress}%`}}/><span>{uploadProgress}%</span></div>}
        <p>Excel 또는 PDF 파일을 끌어놓거나 클릭하여 선택하세요.</p>
        <small>
          민원 원본은 서버·Storage·DB에 저장하지 않음 · 마스킹 PDF와 비식별 요약만 저장
        </small>
        <button disabled={uploading}>
          {uploading ? "처리 중…" : "파일 선택"}
        </button>
      </section>
      {uploadNotice && (
        <div className={`upload-notice ${uploadNotice.kind}`} role="status">
          <div>
            <strong>{uploadNotice.kind === "success" ? "처리 완료" : "처리 실패"}</strong>
            <span>{uploadNotice.fileName}</span>
            <p>{uploadNotice.message}</p>
          </div>
          <button type="button" onClick={clearUploadNotice} aria-label="처리 결과 닫기">×</button>
        </div>
      )}
      <section className="file-section">
        <div className="file-head">
          <div>
            <h2>업로드 및 처리 현황</h2>
            <p>상세 버튼에서 단계별 처리 내용과 AI 전송자료를 확인합니다.</p>
          </div>
          <div className="file-tools">
            <div className="mini-search">
              ⌕{" "}
              <input
                placeholder="파일명 검색"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <select value={type} onChange={(e) => setType(e.target.value)}>
              <option>전체</option>
              <option>민원</option>
              <option>법령</option>
              <option>안내서</option>
            </select>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>파일명</th>
                <th>자료 유형</th>
                <th>추출 결과</th>
                <th>처리 상태</th>
                <th>업로드 일시</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((j) => (
                <tr key={j.id}>
                  <td data-label="파일명">
                    <span
                      className={
                        "file-icon " +
                        (j.file_name.toLowerCase().endsWith(".pdf")
                          ? "pdf"
                          : "excel")
                      }
                    >
                      {j.file_name.toLowerCase().endsWith(".pdf")
                        ? "PDF"
                        : "XLS"}
                    </span>
                    <div>
                      <strong>{j.file_name}</strong>
                      <small>{formatBytes(j.file_size)}</small>
                    </div>
                  </td>
                  <td data-label="자료 유형">
                    <span className="type-chip">
                      {labelType(j.document_type)}
                    </span>
                  </td>
                  <td data-label="추출 결과">
                    {j.status === "completed"
                      ? `문서 ${j.document_count || 0}건 · 청크 ${j.chunk_count || 0}개`
                      : j.error_message || `${j.progress || 0}% 진행 중`}
                  </td>
                  <td data-label="처리 상태">
                    <div className="status-cell">
                      <span className={"status " + statusClass(j.status)}>
                        {statusLabel(j.status)}
                      </span>
                      {!["completed", "failed"].includes(j.status) && (
                        <span className="progress-track">
                          <i style={{ width: `${j.progress || 0}%` }} />
                        </span>
                      )}
                    </div>
                  </td>
                  <td data-label="업로드 일시">{formatDate(j.created_at)}</td>
                  <td data-label="작업">
                    <div className="row-actions">
                      <button
                        className="view-btn"
                        onClick={() => openDetails(j)}
                      >
                        상세
                      </button>
                      {j.status === "failed" && (
                        <button
                          className="retry-btn"
                          onClick={() => retry(j.id)}
                        >
                          재처리
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="table-foot">
          <span>총 {filtered.length}개 자료</span>
          <div>
            <button>‹</button>
            <button className="on">1</button>
            <button>›</button>
          </div>
        </div>
      </section>
      {detailJob && (
        <DocumentViewer
          job={(detailData.job as UploadJob) || detailJob}
          files={detailData.files || []}
          documents={detailDocs}
          chunks={detailData.chunks || []}
          loading={detailLoading}
          close={() => setDetailJob(null)}
          removeDocument={removeDocument}
          removeUpload={removeUpload}
        />
      )}
    </div>
  );
}
function statusLabel(v: string) {
  return (
    (
      {
        queued: "대기 중",
        checking: "중복 검사",
        uploading: "마스킹 PDF 저장",
        extracting_local: "브라우저 PDF 텍스트 추출",
        detecting_pii: "원문 개인정보 탐지",
        summarizing_local: "브라우저 로컬 AI 질의 핵심 정리",
        verifying_summary: "외부 전송자료 재검사",
        awaiting_review: "관리자 검토 대기",
        parsing: "Excel 텍스트 추출",
        masking: "텍스트 개인정보 마스킹",
        chunking: "안전한 검색 단위 분할",
        embedding: "임베딩 생성",
        completed: "처리 완료",
        failed: "처리 실패",
      } as Record<string, string>
    )[v] || v
  );
}
function statusClass(v: string) {
  return v === "completed" ? "success" : v === "failed" ? "fail" : "progress";
}
function labelType(v: string) {
  return (
    (
      { complaint: "민원", law: "법령", guide: "안내서" } as Record<
        string,
        string
      >
    )[v] || v
  );
}
function formatBytes(v: number) {
  if (!v) return "—";
  return v > 1048576
    ? `${(v / 1048576).toFixed(1)} MB`
    : `${Math.ceil(v / 1024)} KB`;
}
function formatDate(v: string) {
  if (!v) return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime())
    ? v
    : d.toLocaleString("ko-KR", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
}
function Metric({
  n,
  label,
  sub,
  color,
}: {
  n: string;
  label: string;
  sub: string;
  color: string;
}) {
  return (
    <div className="metric">
      <span className={color}>▣</span>
      <div>
        <small>{label}</small>
        <strong>{n}</strong>
        <em>{sub}</em>
      </div>
    </div>
  );
}
function Title({ n, title, sub }: { n: string; title: string; sub: string }) {
  return (
    <div className="section-title">
      <span className="step">{n}</span>
      <div>
        <h2>{title}</h2>
        <p>{sub}</p>
      </div>
    </div>
  );
}
function Head({ title, count }: { title: string; count: string }) {
  return (
    <div className="card-head">
      <h3>{title}</h3>
      <span>{count}</span>
    </div>
  );
}
function Modal({ title, close }: { title: string; close: () => void }) {
  return (
    <div className="modal-back" onMouseDown={close}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <button className="modal-x" onClick={close}>
          ×
        </button>
        <span className="eyebrow">SOURCE DOCUMENT</span>
        <h2>{title}</h2>
        <div className="modal-meta">
          <span>마이데이터추진단</span>
          <span>2026-04-18</span>
          <span>원문 ID DOC-2026-0184</span>
        </div>
        <div className="modal-text">
          <h3>질의 내용</h3>
          <p>
            마이데이터 사업자 허가 신청 후 처리기간이 지났으나 결과를 받지 못한
            경우 법정 처리기한과 진행 상황 확인 방법을 문의합니다.
          </p>
          <h3>답변 및 근거</h3>
          <p>
            신용정보법 제7조에 따른 허가 여부 결정 기간은 신청 접수일부터
            3개월입니다. 다만 보완에 필요한 기간은 제외될 수 있으므로 개별 신청
            건의 보완 이력과 담당 부서 확인이 필요합니다.
          </p>
        </div>
        <div className="modal-actions">
          <button onClick={close}>닫기</button>
          <button className="save" onClick={close}>
            이 근거 사용하기
          </button>
        </div>
      </div>
    </div>
  );
}
