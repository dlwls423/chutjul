"use client";
import { useEffect, useRef, useState } from "react";
import DocumentViewer from "../components/DocumentViewer";
import "../components/DepartmentScope.css";
import "../components/DataButtons.css";
import "../components/V2Privacy.css";
import "../components/AnalysisEnhancements.css";
import AuthGate, { Profile } from "../components/AuthGate";
import { isComplaintPdfInBrowser, maskSensitiveText, preparePdfInBrowser } from "../lib/browser-privacy";
import { hasGuideFileKeyword } from "../lib/document-classification";
import { editableTextToSummary, type SafeComplaintSummary } from "../lib/local-draft";
import { cleanExtractedText, parseEpeopleComplaint } from "../lib/epeople-parser";
import { WORKSPACE_DEPARTMENTS } from "../lib/departments";
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
type BatchUploadItem = { fileName: string; status: "queued" | "processing" | "success" | "error"; message?: string };
type SearchItem = {
  id: string; title: string; documentType: string; department?: string; category?: string;
  createdAt: string; snippet: string; question: string; answer: string; content: string;
  score: number; matchedTerms: string[]; legalReferences: string[];
  complaintMetadata: Record<string, unknown>;
  guideMatches: { pageNumber: number | null; snippet: string }[];
  evidenceReference?: string;
};
type SearchCache = { results: SearchItem[]; searchedQuery: string; tab: string; sort: string; category: string; legal: string; visibleCount: number };
let searchCache: SearchCache | null = null;
const searchResponseCache = new Map<string, { at: number; results: SearchItem[] }>();
function useElapsed(active:boolean){
  const [seconds,setSeconds]=useState(0);
  useEffect(()=>{if(!active){setSeconds(0);return;}const started=Date.now();setSeconds(0);const timer=setInterval(()=>setSeconds(Math.floor((Date.now()-started)/1000)),1000);return()=>clearInterval(timer);},[active]);
  return seconds;
}
function AnalysisWaiting({phase,seconds}:{phase:"searching"|"generating";seconds:number}){
  const active=phase==="searching"?1:2;
  const steps=[["확인 완료","비식별 질의를 안전하게 준비했습니다."],["자료 검색","현재 부서의 민원·Q&A·법령·안내서를 비교합니다."],["근거 선별","질문과 직접 관련된 근거만 추립니다."],["초안 작성","선택한 근거를 바탕으로 답변을 구성합니다."]];
  const tip=phase==="searching"?(seconds<6?"저장된 자료의 제목과 본문을 함께 확인하고 있어요.":"법령과 안내서까지 교차 확인하고 있어요."):(seconds<8?"근거의 관련성과 중복 여부를 확인하고 있어요.":"문단마다 출처가 연결되도록 답변을 작성하고 있어요.");
  return <section className="analysis-waiting" role="status" aria-live="polite"><div className="waiting-orbit" aria-hidden="true"><i/><span>{seconds}<small>초</small></span></div><div className="waiting-copy"><span>답변 준비 중</span><h3>{phase==="searching"?"관련 자료를 꼼꼼히 찾고 있습니다":"근거를 선별해 답변을 구성하고 있습니다"}</h3><p>{tip}</p></div><div className="waiting-steps">{steps.map(([title,description],index)=><div className={index<active?"complete":index===active?"active":""} key={title}><b>{index<active?"✓":index+1}</b><span><strong>{title}</strong><small>{description}</small></span></div>)}</div></section>;
}
function SearchWaiting({seconds}:{seconds:number}){
  const message=seconds<3?"민원·Q&A에서 일치 내용을 찾고 있습니다.":seconds<7?"현행 법령과 안내서를 함께 확인하고 있습니다.":"관련도 순으로 결과를 정리하고 있습니다.";
  return <div className="search-waiting" role="status" aria-live="polite"><div className="search-waiting-head"><div><span className="search-pulse" aria-hidden="true"/><b>{message}</b></div><small>{seconds}초 경과</small></div><div className="search-scope-progress"><i/></div><p>검색 중에도 입력한 검색어와 필터는 그대로 유지됩니다.</p><div className="search-skeletons" aria-hidden="true">{[0,1,2].map(item=><div key={item}><i/><span/><span/><span/></div>)}</div></div>;
}
export default function Home() {
  return <AuthGate>{(profile) => <WorkspaceApp profile={profile} />}</AuthGate>;
}
const complaint = "";
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
  const [departmentOptions, setDepartmentOptions] = useState<string[]>([...WORKSPACE_DEPARTMENTS]);
  const [query, setQuery] = useState("허가 처리기간이 30일을 넘은 민원");
  const [text, setText] = useState(complaint);
  const [masked, setMasked] = useState(false);
  const [toast, setToast] = useState("");
  const [modal, setModal] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadStage, setUploadStage] = useState("");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadNotice, setUploadNotice] = useState<UploadNotice>(null);
  const [uploadBatch, setUploadBatch] = useState<BatchUploadItem[]>([]);
  const [jobs, setJobs] = useState<UploadJob[]>([]);
  const refreshSequence = useRef(0);
  const [retryId, setRetryId] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const departmentStorageKey = `chutjul.currentDepartment.${profile.id}`;
  useEffect(() => {
    if (profile.role !== 'admin') return;
    try {
      const saved = window.localStorage.getItem(departmentStorageKey)?.trim();
      if (saved) setCurrentDepartment(saved);
    } catch {}
  }, [departmentStorageKey, profile.role]);
  useEffect(() => {
    async function loadDepartments() {
      try {
        const response = await fetch('/api/departments', { cache: 'no-store' });
        const json = await response.json();
        if (!response.ok || !Array.isArray(json.departments)) return;
        const next = [...json.departments];
        if (!next.includes(currentDepartment)) next.push(currentDepartment);
        setDepartmentOptions(next);
      } catch {}
    }
    void loadDepartments();
    window.addEventListener('departments-updated', loadDepartments);
    return () => window.removeEventListener('departments-updated', loadDepartments);
  }, [currentDepartment]);
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
  async function upload(selected?: File[]) {
    if (!selected?.length) return;
    const uploadFiles = retryId ? selected.slice(0, 1) : selected;
    setUploading(true);
    setUploadNotice(null);
    setUploadBatch(uploadFiles.map((file) => ({ fileName: file.name, status: "queued" })));
    let successCount = 0;
    let errorCount = 0;
    for (let index = 0; index < uploadFiles.length; index++) {
      const f = uploadFiles[index];
      const updateItem = (patch: Partial<BatchUploadItem>) =>
        setUploadBatch((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
      updateItem({ status: "processing", message: "파일 확인 중" });
      const form = new FormData();
      setUploadStage(`${index + 1}/${uploadFiles.length} · ${f.name} · 파일을 확인하고 있습니다.`);
      setUploadProgress(4);
      try {
        let uploadFile=f;
        let documentType = "complaint";
        if (f.name.toLowerCase().endsWith(".pdf") && hasGuideFileKeyword(f.name)) {
          setUploadStage(`${index + 1}/${uploadFiles.length} · ${f.name} · 민원 양식 여부를 확인하고 있습니다.`);
          updateItem({ message: "민원 양식 여부 확인 중" });
          documentType = (await isComplaintPdfInBrowser(f)) ? "complaint" : "guide";
        }
        if (f.name.toLowerCase().endsWith(".pdf") && documentType === "complaint") {
          const prepared = await preparePdfInBrowser(f, (message, progress) => {
            setUploadStage(`${index + 1}/${uploadFiles.length} · ${f.name} · ${message}`);
            setUploadProgress(progress);
            updateItem({ message });
          });
          uploadFile=prepared.maskedPdf;
          form.append("browserPrivacy", JSON.stringify(prepared.privacy));
        }
        setUploadStage(`${index + 1}/${uploadFiles.length} · ${f.name} · 안전한 자료를 저장하고 있습니다.`);
        setUploadProgress(84);
        updateItem({ message: "저장 및 검색 데이터 생성 중" });
        form.append("file", uploadFile);
        form.append("documentType", documentType);
        form.append("department", currentDepartment);
        if (retryId) form.append("retryJobId", retryId);
        const r = await fetch("/api/uploads", { method: "POST", body: form });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || "업로드에 실패했습니다.");
        updateItem({ status: "success", message: `문서 ${j.documentCount || 0}건 · 청크 ${j.chunkCount || 0}개` });
        successCount++;
      } catch (e) {
        updateItem({ status: "error", message: e instanceof Error ? e.message : "업로드에 실패했습니다." });
        errorCount++;
      }
      refresh();
    }
    setUploadNotice({ kind: errorCount ? "error" : "success", fileName: uploadFiles.length === 1 ? uploadFiles[0].name : `${uploadFiles.length}개 파일`, message: `처리 완료 ${successCount}개${errorCount ? ` · 실패 ${errorCount}개` : ""}` });
    flash(`파일 ${uploadFiles.length}개 처리 완료 · 성공 ${successCount}개${errorCount ? ` · 실패 ${errorCount}개` : ""}`);
    setUploading(false);
    setUploadStage("");
    setUploadProgress(0);
    setRetryId("");
    if (inputRef.current) inputRef.current.value = "";
    refresh();
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
                onChange={(e) => {
                  const next = e.target.value;
                  setCurrentDepartment(next);
                  try { window.localStorage.setItem(departmentStorageKey, next); } catch {}
                }}
              >
                {departmentOptions.map((department) => (
                  <option key={department}>{department}</option>
                ))}
              </select>
            </label>
            {view === "analyze" ? (
              <button
                className="history"
                onClick={() => setModal("최근 분석 기록")}
              >
                <span aria-hidden="true">↶</span><b>답변 기록</b>
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
              🔒 민원 원문은 기기 안에서 처리하며, 외부 AI 전송자료는 담당자가 확인한 뒤에만 전송합니다.
            </div>
            <Analyze
              text={text}
              setText={setText}
              masked={masked}
              setMasked={setMasked}
              flash={flash}
              setModal={setModal}
              department={currentDepartment}
            />
          </>
        )}{" "}
        {view === "search" && (
          <>
            <div className="scope-notice">
              🔒 검색 범위: <b>{currentDepartment}</b> 자료만 표시합니다.
            </div>
            <Search query={query} setQuery={setQuery} department={currentDepartment} />
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
            uploadBatch={uploadBatch}
            clearUploadNotice={() => { setUploadNotice(null); setUploadBatch([]); }}
            jobs={jobs}
            retry={retry}
            refresh={refresh}
            flash={flash}
            department={currentDepartment}
          />
        )}
      </section>
      {toast && <div className="toast">{toast}</div>}
      {modal && <Modal title={modal} close={() => setModal(null)} />}
      <input
        ref={inputRef}
        className="hidden-input"
        type="file"
        multiple={!retryId}
        accept=".xlsx,.xls,.pdf"
        onChange={(e) => upload(Array.from(e.target.files || []))}
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
  department,
}: {
  text: string;
  setText: (s: string) => void;
  masked: boolean;
  setMasked: (b: boolean) => void;
  flash: (s: string) => void;
  setModal: (s: string) => void;
  department: string;
}) {
  const [busy, setBusy] = useState(false);
  const [analysisPhase,setAnalysisPhase]=useState<"idle"|"searching"|"generating">("idle");
  const analysisSeconds=useElapsed(analysisPhase!=="idle");
  const [title, setTitle] = useState("");
  const [editorText, setEditorText] = useState("");
  const [answerDirection,setAnswerDirection]=useState("");
  const [sourceMode, setSourceMode] = useState<"direct"|"pdf">("direct");
  const [temporaryMeta, setTemporaryMeta] = useState<Record<string,string>>({});
  const pdfInputRef=useRef<HTMLInputElement>(null);
  const [results, setResults] = useState<SearchItem[]>([]);
  const [analysisError, setAnalysisError] = useState("");
  const [analysisStatus, setAnalysisStatus] = useState("분석 전");
  const [safeSummary, setSafeSummary] = useState<SafeComplaintSummary | null>(null);
  const [summaryApproved, setSummaryApproved] = useState(false);
  const [preview, setPreview] = useState<{ envelope:string; signature:string; payload:unknown; evidence:{reference:string;recordId:string;documentType:string;title:string;source:string;excerpt:string;score:number}[]; candidates:SearchItem[] } | null>(null);
  const [draft, setDraft] = useState("");
  const [visibleDraft,setVisibleDraft]=useState("");
  const [draftTyping,setDraftTyping]=useState(false);
  const [draftCopied,setDraftCopied]=useState(false);
  const typingTimerRef=useRef<ReturnType<typeof setInterval>|null>(null);
  const [qualityChecks,setQualityChecks]=useState<Record<string,unknown>>({});
  const [selectedEvidence, setSelectedEvidence] = useState<{reference:string;reason:string;title:string;documentType:string;recordId:string}[]>([]);
  const [manualEvidenceRefs, setManualEvidenceRefs] = useState<string[]>([]);
  const [selectedResult, setSelectedResult] = useState<SearchItem|null>(null);
  useEffect(()=>()=>{if(typingTimerRef.current)clearInterval(typingTimerRef.current);},[]);
  function clearDraft(){if(typingTimerRef.current)clearInterval(typingTimerRef.current);typingTimerRef.current=null;setDraft('');setVisibleDraft('');setDraftTyping(false);}
  function revealDraft(value:string){
    if(typingTimerRef.current)clearInterval(typingTimerRef.current);
    setDraft(value);setVisibleDraft('');setDraftTyping(true);
    let index=0;
    typingTimerRef.current=setInterval(()=>{index=Math.min(value.length,index+Math.max(8,Math.ceil(value.length/110)));setVisibleDraft(value.slice(0,index));if(index>=value.length){if(typingTimerRef.current)clearInterval(typingTimerRef.current);typingTimerRef.current=null;setDraftTyping(false);}},18);
  }
  async function postDraft(body: unknown) {
    const response=await fetch('/api/draft',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),cache:'no-store'});
    const payload=await response.json();
    if(!response.ok)throw new Error(payload.error||'초안 자료를 준비하지 못했습니다.');
    return payload;
  }
  async function loadComplaintPdf(file:File){
    if(busy)return;
    setBusy(true);
    setAnalysisError("");setPreview(null);clearDraft();setResults([]);setSelectedEvidence([]);setSummaryApproved(false);setSourceMode('pdf');setAnalysisStatus('기기에서 PDF 내용을 읽고 있습니다');
    try{
      if(file.size>15*1024*1024)throw new Error('15MB 이하 PDF를 사용해 주세요.');
      const {extractText}=await import('unpdf');
      const extracted=await extractText(new Uint8Array(await file.arrayBuffer()),{mergePages:true});
      const parsed=parseEpeopleComplaint(cleanExtractedText(extracted.text),file.name);
      if(!parsed||!parsed.question)throw new Error('민원 제목과 본문을 분리하지 못했습니다. 국민신문고 민원 상세 PDF인지 확인해 주세요.');
      const maskedQuestion=maskSensitiveText(parsed.question).value;
      setTitle(parsed.title||file.name.replace(/\.pdf$/i,''));setText(maskedQuestion);setMasked(true);
      setTemporaryMeta({file_name:file.name,application_number:parsed.application_number||'',receipt_number:parsed.receipt_number||'',received_at:parsed.received_at||parsed.application_at||'',handler:parsed.handler_masked||'',department:parsed.department||department});
      setSafeSummary(null);setEditorText(maskedQuestion);setAnalysisStatus('PDF 민원 본문을 질문에 입력했습니다 · 내용을 보완한 뒤 수락해 주세요');
    }catch(error){const message=error instanceof Error?error.message:'PDF를 처리하지 못했습니다.';setAnalysisError(message);setAnalysisStatus('PDF 처리 중단');flash(message);}finally{setBusy(false);if(pdfInputRef.current)pdfInputRef.current.value='';}
  }
  function resetDirect(){setSourceMode('direct');setTitle('');setText('');setEditorText('');setAnswerDirection('');setTemporaryMeta({});setSafeSummary(null);setPreview(null);clearDraft();setQualityChecks({});setResults([]);setSelectedEvidence([]);setSummaryApproved(false);setMasked(false);setAnalysisError('');setAnalysisStatus('질문을 작성해 주세요');}
  async function acceptSummary() {
    if (busy || !editorText.trim()) return;
    const maskedEditor=maskSensitiveText(editorText).value;
    if(maskedEditor!==editorText){setEditorText(maskedEditor);setSummaryApproved(false);setAnalysisStatus('개인정보를 마스킹했습니다 · 내용을 다시 확인해 주세요');flash('개인정보로 의심되는 내용을 마스킹했습니다. 수정된 내용을 확인해 주세요.');return;}
    const accepted=editableTextToSummary(editorText);
    setSafeSummary(accepted);setSummaryApproved(true);
    await findEvidence(accepted);
  }
  async function findEvidence(acceptedSummary=safeSummary){
    if(busy||!acceptedSummary)return;
    const maskedDirection=maskSensitiveText(answerDirection).value;
    if(maskedDirection!==answerDirection){setAnswerDirection(maskedDirection);setSummaryApproved(false);setAnalysisStatus('답변 방향성에서 개인정보를 마스킹했습니다 · 다시 확인해 주세요');flash('답변 방향성에서 개인정보로 의심되는 내용을 마스킹했습니다. 확인 후 다시 수락해 주세요.');return;}
    setBusy(true);setAnalysisPhase('searching');setAnalysisError('');setPreview(null);setResults([]);setSelectedEvidence([]);clearDraft();setAnalysisStatus('수락한 요약으로 관련 자료를 찾고 있습니다');
    try{
      const prepared=await postDraft({action:'prepare',summary:acceptedSummary,confirmed:true,applicationNumber:temporaryMeta.application_number||'',answerDirection:answerDirection.trim()});
      const references=new Map(prepared.evidence.map((item:{recordId:string;reference:string})=>[item.recordId,item.reference]));
      setPreview(prepared);setResults((prepared.candidates||[]).map((item:SearchItem)=>({...item,evidenceReference:references.get(item.id)})));
      setAnalysisPhase('generating');
      setAnalysisStatus('관련 자료를 찾았습니다 · AI가 적절한 근거를 선별하고 있습니다');
      const result=await postDraft({action:'generate',confirmed:true,envelope:prepared.envelope,signature:prepared.signature});
      revealDraft(result.draft);setQualityChecks(result.qualityChecks||{});setSelectedEvidence(result.selectedEvidence||[]);setManualEvidenceRefs((result.selectedEvidence||[]).map((item:{reference:string})=>item.reference));setAnalysisStatus('AI 근거 선별 및 초안 작성 완료 · 담당자 검토 필요');flash('관련 자료 검색, 근거 선별, 답변 초안 작성이 완료되었습니다.');
    }catch(error){const message=error instanceof Error?error.message:'관련 자료 검색 중 오류가 발생했습니다.';setAnalysisError(message);setAnalysisStatus('근거 검색 중단');flash(message);}finally{setBusy(false);setAnalysisPhase('idle');}
  }
  async function retryDraft(){
    if(busy||!preview)return;
    setBusy(true);setAnalysisPhase('generating');setAnalysisError('');setAnalysisStatus('AI가 적절한 근거를 선별하고 있습니다');
    try{
      const result=await postDraft({action:'generate',confirmed:true,envelope:preview.envelope,signature:preview.signature});
      revealDraft(result.draft);setQualityChecks(result.qualityChecks||{});setSelectedEvidence(result.selectedEvidence||[]);setAnalysisStatus('AI 근거 선별 및 초안 작성 완료 · 담당자 검토 필요');flash('근거 선별과 답변 초안 작성이 완료되었습니다.');
    }catch(error){const message=error instanceof Error?error.message:'초안 작성 중 오류가 발생했습니다.';setAnalysisError(message);setAnalysisStatus('초안 작성 중단');flash(message);}finally{setBusy(false);setAnalysisPhase('idle');}
  }
  async function regenerateWithSelected(){
    if(busy||!preview||!manualEvidenceRefs.length)return;
    setBusy(true);setAnalysisPhase('generating');setAnalysisError('');setAnalysisStatus('선택한 근거로 답변을 다시 작성하고 있습니다');
    try{
      const result=await postDraft({action:'generate',confirmed:true,envelope:preview.envelope,signature:preview.signature,selectedReferences:manualEvidenceRefs});
      revealDraft(result.draft);setQualityChecks(result.qualityChecks||{});setSelectedEvidence(result.selectedEvidence||[]);setAnalysisStatus('선택 근거 기반 초안 작성 완료 · 담당자 검토 필요');flash('선택한 근거로 답변 초안을 다시 작성했습니다.');
    }catch(error){const message=error instanceof Error?error.message:'답변을 다시 작성하지 못했습니다.';setAnalysisError(message);setAnalysisStatus('재작성 중단');flash(message);}finally{setBusy(false);setAnalysisPhase('idle');}
  }
  async function saveDraftVersion(){
    if(busy||!draft)return;setBusy(true);
    try{const response=await fetch('/api/answers',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({answerText:draft,title,applicationNumber:temporaryMeta.application_number||'',summary:safeSummary||{},evidence:selectedEvidence,qualityChecks})});const payload=await response.json();if(!response.ok)throw new Error(payload.error||'저장하지 못했습니다.');flash(`답변과 사용 근거를 버전 ${payload.versionNumber}로 저장했습니다.`);}catch(error){flash(error instanceof Error?error.message:'저장하지 못했습니다.');}finally{setBusy(false);}
  }
  async function copyDraft(){
    if(!draft)return;
    try{await navigator.clipboard.writeText(draft);setDraftCopied(true);flash('답변 초안을 복사했습니다.');setTimeout(()=>setDraftCopied(false),1800);}catch{flash('복사하지 못했습니다. 답변 내용을 직접 선택해 복사해 주세요.');}
  }
  return (
    <div className="content">
      <section className="input-card">
        <div className="title-row">
          <Title n="1" title="민원 질의 준비" sub="민원 PDF를 불러오거나 답변이 필요한 질문을 직접 작성하세요." />
          <div className="analysis-source-tabs"><button className={sourceMode==='pdf'?'on':''} disabled={busy} onClick={()=>pdfInputRef.current?.click()}>PDF 불러오기</button><button className={sourceMode==='direct'?'on':''} disabled={busy} onClick={resetDirect}>직접 질문 작성</button></div>
          <input ref={pdfInputRef} className="hidden-input" type="file" accept="application/pdf,.pdf" onChange={event=>{const file=event.target.files?.[0];if(file)void loadComplaintPdf(file);}} />
        </div>
        {sourceMode==='pdf'&&Object.keys(temporaryMeta).length>0&&<div className="temporary-intake"><div className="temporary-heading"><div><b>PDF에서 불러온 민원 정보</b><small>현재 화면에만 임시 보관되며 저장 버튼을 누르기 전에는 DB에 저장되지 않습니다.</small></div><span>임시 저장</span></div><div className="temporary-meta"><div><small>민원 제목</small><strong>{title||'—'}</strong></div><div><small>접수일시</small><strong>{temporaryMeta.received_at||'—'}</strong></div><div><small>담당자</small><strong>{temporaryMeta.handler||'—'}</strong></div><div><small>처리부서</small><strong>{temporaryMeta.department||'—'}</strong></div><div><small>신청번호</small><strong>{temporaryMeta.application_number||'—'}</strong></div><div><small>접수번호</small><strong>{temporaryMeta.receipt_number||'—'}</strong></div></div><details><summary>마스킹된 민원 본문 확인</summary><p>{maskSensitiveText(text).value}</p></details></div>}
        <div className="question-editor-wrap"><div className="question-editor-head"><label htmlFor="safe-question-editor">답변받을 질문</label><span>{editorText.length.toLocaleString()} / 10,000자</span></div><p>{sourceMode==='pdf'?'PDF에서 추출하고 개인정보를 가린 민원 본문입니다. 내용을 확인하고 필요하면 직접 보완하세요.':'개인정보 없이 법적 쟁점, 필요한 사실과 답변 요청사항을 작성하세요.'}</p><textarea id="safe-question-editor" className="safe-question-editor" value={editorText} maxLength={10000} disabled={busy||Boolean(preview)} onChange={event=>{setEditorText(event.target.value);setSafeSummary(null);setSummaryApproved(false);setPreview(null);clearDraft();setResults([]);}} placeholder={sourceMode==='pdf'?'PDF를 불러오면 비식별 민원 본문이 여기에 자동 입력됩니다.':'예: 공개 API만 사용하는 서비스가 개인정보 전송요구권 적용 대상인지, 관련 법령과 판단 기준을 알려주세요.'}/></div>
        <div className="answer-direction"><div className="question-editor-head"><label htmlFor="answer-direction">답변 방향성 <small>선택</small></label><span>{answerDirection.length.toLocaleString()} / 1,000자</span></div><p>강조할 판단 기준, 설명 순서나 문체를 적으세요. 개인정보는 입력하지 마세요.</p><textarea id="answer-direction" value={answerDirection} maxLength={1000} disabled={busy||Boolean(preview)} onChange={event=>setAnswerDirection(event.target.value)} placeholder="예: 결론을 먼저 제시하고, 법적 근거와 예외 사항을 순서대로 설명해 주세요. 단정하기 어려운 부분은 추가 확인사항으로 구분해 주세요." /></div>
        <div className="accept-panel"><label className="transmission-consent"><input type="checkbox" checked={summaryApproved} disabled={busy||Boolean(preview)||!editorText.trim()} onChange={event=>setSummaryApproved(event.target.checked)} /><span>편집한 질의에 개인정보가 없고 민원의 핵심을 올바르게 반영함을 확인했습니다. 수락하면 근거 검색과 초안 작성까지 자동으로 진행됩니다.</span></label><button className="analyze" disabled={busy||!summaryApproved||Boolean(preview)||!editorText.trim()} onClick={acceptSummary}>{preview?'질의 수락 완료':busy?analysisStatus:'질의 수락하고 답변 초안 작성'}</button></div>
      </section>
      {analysisPhase!=="idle"&&<AnalysisWaiting phase={analysisPhase} seconds={analysisSeconds}/>}
      <div className="analysis-head">
        <Title
          n="2"
          title="분석 결과"
          sub="AI가 찾은 결과를 검토하고 필요한 근거를 선택하세요."
        />
        <span className="done">{busy ? analysisStatus : results.length ? `✓ 근거 ${results.length}건 확인` : analysisStatus}</span>
      </div>
      <div className="summary-strip">
        <div>
          <small>개인정보 처리</small>
          <strong>{safeSummary ? "기기 내 비식별 완료" : "분석 전"}</strong>
        </div>
        <div>
          <small>검색 범위</small>
          <strong>{department} 자료</strong>
        </div>
        <div>
          <small>핵심 쟁점</small>
          <strong>{safeSummary?.legalQuestions[0] || "요약 확인 후 표시"}</strong>
        </div>
        <div>
          <small>근거 후보</small>
          <strong>{results.length ? `${results.length}건` : "요약 수락 후 검색"}</strong>
        </div>
      </div>
      <div className="result-grid">
        <ResultCases kind="complaint" open={setSelectedResult} selected={new Set(manualEvidenceRefs)} results={results.filter((item) => item.documentType === "complaint")} />
        <ResultCases kind="qna" open={setSelectedResult} selected={new Set(manualEvidenceRefs)} results={results.filter((item) => item.documentType === "qna")} />
        <ResultLaws open={setSelectedResult} selected={new Set(manualEvidenceRefs)} results={results.filter((item) => item.documentType === "law" || item.documentType === "guide")} />
      </div>
      {!!results.length&&<div className="evidence-color-guide"><i/><span><b>하늘색 자료</b>는 AI가 답변에 실제로 선택한 근거입니다. 각 목록은 AI 선택 자료를 먼저, 그다음 관련도 점수가 높은 순서로 표시합니다.</span></div>}
      {analysisError && <p className="upload-error">{analysisError}</p>}
      <section className="draft-card">
        <div className="draft-head">
          <Title
            n="3"
            title="답변 초안"
            sub={draft ? "생성된 초안을 담당자가 검토하고 수정하세요." : "비식별 요약을 수락하면 근거 선별과 초안 작성까지 자동으로 진행됩니다."}
          />
          {draft && <div>{draftTyping&&<span className="typing-status" role="status">초안 작성 중<span aria-hidden="true">•••</span></span>}<button className={draftCopied?'copy-done':''} disabled={draftTyping} onClick={copyDraft}>{draftCopied?'✓ 복사 완료':'초안 복사'}</button><button onClick={clearDraft}>전송자료 다시 보기</button><button className="save" disabled={busy||draftTyping} onClick={saveDraftVersion}>{busy?'저장 중…':'버전 저장'}</button></div>}
        </div>
        <div className="draft-body">
          {draft ? <textarea className={`editor draft-editor${draftTyping?' is-typing':''}`} aria-label="답변 초안" value={visibleDraft} onChange={event=>{if(typingTimerRef.current)clearInterval(typingTimerRef.current);typingTimerRef.current=null;setDraftTyping(false);setDraft(event.target.value);setVisibleDraft(event.target.value);}} /> : preview ? <div className="editor transmission-review">
            <div className="review-heading"><b>승인된 비식별 자료</b><span>민원 원문·PDF·개인 식별정보는 전송하지 않습니다.</span></div>
            <details open><summary>실제 OpenAI 전송자료 전체 보기</summary><pre>{JSON.stringify(preview.payload,null,2)}</pre></details>
            <p>처리가 중단된 경우에만 아래 버튼으로 이어서 진행할 수 있습니다.</p><button className="analyze" disabled={busy} onClick={retryDraft}>{busy?analysisStatus:'초안 작성 다시 시도'}</button>
          </div> : <div className="editor draft-empty"><b>비식별 요약을 확인하고 수락해 주세요.</b><p>수락하면 관련 자료 검색, 근거 선별, 답변 초안 작성이 자동으로 이어집니다.</p></div>}
          <aside className="evidence">
            <h3>
              {draft ? "AI가 선택한 근거" : "AI 선택 후보"} <span>{draft ? selectedEvidence.length : preview?.evidence.length || 0}</span>
            </h3>
            {!preview?.evidence.length && <p>분석 후 현행 법령 근거가 표시됩니다.</p>}
            {(draft?selectedEvidence:preview?.evidence||[]).map(item=><div className={draft?'selected-evidence':''} key={item.reference}><b>[{item.reference}] {item.title}</b><p>{'reason' in item?item.reason:`${item.documentType==='complaint'?'유사 민원':item.documentType==='qna'?'Q&A':item.documentType==='guide'?'안내서':'현행 법령'} · 후보 관련도 ${Math.round(item.score)}`}</p></div>)}
            {draft&&<div className="draft-quality"><strong>자동 품질검사</strong><p>✓ 문단별 근거 표시 · ✓ 허용 근거만 인용 · ✓ 개인정보 재검사</p><p>{qualityChecks.legal_articles_verified===false?'⚠ 근거 원문에서 확인되지 않은 조문 표현이 있어 담당자 확인이 필요합니다.':'✓ 기재 조문을 선택 근거에서 확인'}</p></div>}
            {draft&&preview?.evidence.length&&<div className="manual-evidence-picker"><strong>재작성에 사용할 근거</strong><p>선택을 바꾼 뒤 아래 버튼을 누르면 선택 자료만 AI에 제공합니다.</p>{preview.evidence.map(item=><label key={item.reference}><input type="checkbox" checked={manualEvidenceRefs.includes(item.reference)} disabled={busy} onChange={event=>setManualEvidenceRefs(current=>event.target.checked?[...current,item.reference]:current.filter(reference=>reference!==item.reference))}/><span><b>[{item.reference}] {item.title}</b><small>{item.documentType==='complaint'?'유사 민원':item.documentType==='qna'?'Q&A':item.documentType==='guide'?'안내서':'현행 법령'}</small></span></label>)}<button className="analyze" disabled={busy||!manualEvidenceRefs.length} onClick={regenerateWithSelected}>{busy?'작성 중…':'선택한 근거로 다시 작성'}</button></div>}
            <label>
              이관 가능 부서
              <select defaultValue={department}><option>{department}</option></select>
            </label>
            <label>
              답변 예정일
              <input type="date" defaultValue="2026-08-28" />
            </label>
          </aside>
        </div>
      </section>
      {selectedResult && <AnalysisResultDetail item={selectedResult} query={safeSummary?.purpose||title} close={()=>setSelectedResult(null)} />}
    </div>
  );
}
function AnalysisResultDetail({item,query,close}:{item:SearchItem;query:string;close:()=>void}){
  const [pdfData,setPdfData]=useState<{pdfUrl:string;matches:{pageNumber:number;snippet:string;matchedTerms:string[]}[]}|null>(null);
  const [loading,setLoading]=useState(item.documentType==='guide');
  const [activePage,setActivePage]=useState(1);
  useEffect(()=>{
    if(item.documentType!=='guide')return;
    let active=true;
    fetch(`/api/documents/${encodeURIComponent(item.id)}/pdf?q=${encodeURIComponent(query)}`,{cache:'no-store'}).then(async response=>{const payload=await response.json();if(!response.ok)throw new Error(payload.error);if(active){setPdfData(payload);setActivePage(payload.matches?.[0]?.pageNumber||1);}}).catch(()=>{if(active)setPdfData(null);}).finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[item.id,item.documentType,query]);
  return <div className="search-detail-backdrop" onMouseDown={close}><section className="search-detail" onMouseDown={event=>event.stopPropagation()} role="dialog" aria-modal="true" aria-label="분석 근거 상세">
    <header><div><span>{item.documentType==='complaint'?'유사민원':item.documentType==='guide'?'안내서':'현행 법령'} {item.evidenceReference&&`후보 ${item.evidenceReference}`}</span><h3>{item.title}</h3><p>{item.department} · {item.createdAt?.slice(0,10)}</p></div><button aria-label="닫기" onClick={close}>×</button></header>
    <div className="search-detail-body">
      {(item.documentType==='complaint'||item.documentType==='qna')&&<>{item.documentType==='complaint'&&<ComplaintSearchMetadata item={item}/>}<section className="complaint-text-card question-card"><div className="text-card-heading"><span>Q</span><div><h4>{item.documentType==='qna'?'질문':'민원 질의'}</h4><small>저장된 비식별 질의</small></div></div><p>{item.question||'질의 내용이 없습니다.'}</p></section><section className="complaint-text-card answer-card"><div className="text-card-heading"><span>A</span><div><h4>{item.documentType==='qna'?'공식 답변':'답변 내용'}</h4><small>검토가 완료된 답변</small></div></div><p>{item.answer||'답변 내용이 없습니다.'}</p></section></>}
      {item.documentType==='law'&&<section><h4>현행 법령 내용</h4><p>{item.content||item.snippet}</p>{String(item.complaintMetadata.source_url||'').startsWith('https://www.law.go.kr/')&&<a href={String(item.complaintMetadata.source_url)} target="_blank" rel="noreferrer">국가법령정보센터 원문 ↗</a>}</section>}
      {item.documentType==='guide'&&<section className="guide-search-pages"><h4>관련 문장과 원본 페이지</h4>{loading?<p>안내서 페이지를 불러오고 있습니다…</p>:pdfData?<div className="pdf-search-layout"><div className="pdf-page-list">{pdfData.matches.map((match,index)=><button className={activePage===match.pageNumber?'on':''} key={`${match.pageNumber}-${index}`} onClick={()=>setActivePage(match.pageNumber)}><b>{match.pageNumber}쪽</b><span>{match.snippet}</span></button>)}</div><div className="pdf-preview"><div><b>{activePage}쪽</b><a href={`${pdfData.pdfUrl}#page=${activePage}&view=FitH`} target="_blank" rel="noreferrer">새 창에서 보기 ↗</a></div><iframe key={`${item.id}-${activePage}`} title={`${item.title} ${activePage}쪽`} src={`${pdfData.pdfUrl}#page=${activePage}&view=FitH`}/></div></div>:<p>원본 PDF 페이지 정보를 불러오지 못했습니다.</p>}</section>}
    </div>
  </section></div>;
}
function ResultCases({ kind, open, selected, results }: { kind:"complaint"|"qna"; open: (item:SearchItem) => void; selected:Set<string>; results: SearchItem[] }) {
  const ranked=[...results].sort((a,b)=>Number(selected.has(b.evidenceReference||''))-Number(selected.has(a.evidenceReference||''))||b.score-a.score);
  return (
    <section className="result-card">
      <Head title={kind==="qna"?"관련 Q&A":"유사 민원"} count={`${results.length}건`} />
      {!results.length && <div className="case"><p>{kind==="qna"?"질문과 직접 관련된 검토 Q&A가 있으면 표시됩니다.":"민원을 분석하면 현재 부서의 유사 사례가 표시됩니다."}</p></div>}
      {ranked.map((c, i) => (
        <div className={"case " + (selected.has(c.evidenceReference||'') ? "ai-selected" : "")} key={c.id}>
          <div>
            <b>{selected.has(c.evidenceReference||'') ? `✓ AI 선택 · ${i+1}순위 · ${c.evidenceReference}` : `${i+1}순위 · 후보 ${c.evidenceReference||''} · 관련도 ${Math.round(c.score)}`}</b>
            <small>{c.createdAt?.slice(0, 10)} · {c.department}</small>
          </div>
          <h4>{c.title}</h4>
          <p>{c.snippet}</p>
          <button onClick={() => open(c)}>{kind==="qna"?"Q&A 보기 ↗":"원문 보기 ↗"}</button>
        </div>
      ))}
    </section>
  );
}
function ResultLaws({ open, selected, results }: { open: (item:SearchItem) => void; selected:Set<string>; results: SearchItem[] }) {
  const ranked=[...results].sort((a,b)=>Number(selected.has(b.evidenceReference||''))-Number(selected.has(a.evidenceReference||''))||b.score-a.score);
  return (
    <section className="result-card">
      <Head title="관련 법령 · 안내서" count={`${results.length}건`} />
      {!results.length && <div className="law"><p>민원을 분석하면 최신 현행 법령과 안내서가 표시됩니다.</p></div>}
      {ranked.map((item, index) => <div className={`law ${selected.has(item.evidenceReference||'') ? "ai-selected" : ""}`} key={item.id}>
        <b className={item.documentType === "guide" ? "guide" : ""}>{selected.has(item.evidenceReference||'') ? `✓ AI 선택 · ${index+1}순위 · ${item.evidenceReference}` : `${index+1}순위 · ${item.documentType === "guide" ? "안내서" : "현행 법령"} 후보 ${item.evidenceReference||''} · 관련도 ${Math.round(item.score)}`}</b>
        <h4>{item.title}</h4>
        <p>{item.complaintMetadata?.effective_from ? `시행일 ${String(item.complaintMetadata.effective_from)}` : item.category}</p>
        <blockquote>{item.snippet}</blockquote>
        <button onClick={() => open(item)}>상세 보기 ↗</button>
      </div>)}
    </section>
  );
}
function Search({
  query,
  setQuery,
  department,
}: {
  query: string;
  setQuery: (s: string) => void;
  department: string;
}) {
  const [tab, setTab] = useState(searchCache?.tab || "전체");
  const [results, setResults] = useState<SearchItem[]>(searchCache?.results || []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [searchedQuery, setSearchedQuery] = useState(searchCache?.searchedQuery || "");
  const [sort, setSort] = useState(searchCache?.sort || "관련도순");
  const [category, setCategory] = useState(searchCache?.category || "전체");
  const [legal, setLegal] = useState(searchCache?.legal || "전체 법령");
  const [visibleCount, setVisibleCount] = useState(searchCache?.visibleCount || 20);
  const [selected, setSelected] = useState<SearchItem | null>(null);
  const [pdfData, setPdfData] = useState<{ pdfUrl: string; pageCount: number; matches: { pageNumber: number; snippet: string; matchedTerms: string[] }[] } | null>(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [activePage, setActivePage] = useState(1);
  const searchAbortRef=useRef<AbortController|null>(null);
  const searchSeconds=useElapsed(loading);
  useEffect(()=>()=>searchAbortRef.current?.abort(),[]);
  useEffect(() => { searchCache = { results, searchedQuery, tab, sort, category, legal, visibleCount }; }, [results, searchedQuery, tab, sort, category, legal, visibleCount]);
  async function runSearch(value = query) {
    const word = value.trim();
    if (!word) { setError("검색어를 입력해 주세요."); return; }
    const cacheKey=`${department}\u0000${word.normalize("NFKC").toLocaleLowerCase("ko-KR")}`;
    const cached=searchResponseCache.get(cacheKey);
    if(cached&&Date.now()-cached.at<5*60_000){setResults(cached.results);setSearchedQuery(word);setTab("전체");setCategory("전체");setLegal("전체 법령");setVisibleCount(20);setError("");return;}
    searchAbortRef.current?.abort();
    const controller=new AbortController();searchAbortRef.current=controller;
    setLoading(true); setError(""); setSelected(null);
    try {
      const response = await fetch(`/api/search?q=${encodeURIComponent(word)}&department=${encodeURIComponent(department)}`, { cache: "no-store",signal:controller.signal });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "검색 중 오류가 발생했습니다.");
      const nextResults=payload.results||[];searchResponseCache.set(cacheKey,{at:Date.now(),results:nextResults});
      setResults(nextResults); setSearchedQuery(word); setTab("전체");
      setCategory("전체"); setLegal("전체 법령"); setVisibleCount(20);
    } catch (cause) { if(cause instanceof DOMException&&cause.name==="AbortError")return;setError(cause instanceof Error ? cause.message : "검색 중 오류가 발생했습니다."); }
    finally { if(searchAbortRef.current===controller){searchAbortRef.current=null;setLoading(false);} }
  }
  const typeForTab = (item: SearchItem) => tab === "전체" || (tab === "유사민원" && item.documentType === "complaint") || (tab === "Q&A" && item.documentType === "qna") || (tab === "법령" && item.documentType === "law") || (tab === "안내서" && item.documentType === "guide");
  const filtered = results.filter((item) => typeForTab(item) && (category === "전체" || item.category === category) && (legal === "전체 법령" || item.legalReferences.includes(legal)));
  const sorted = [...filtered].sort((a, b) => sort === "최신순" ? b.createdAt.localeCompare(a.createdAt) : b.score - a.score || b.createdAt.localeCompare(a.createdAt));
  const counts = { 전체: results.length, 유사민원: results.filter((x) => x.documentType === "complaint").length, "Q&A": results.filter((x) => x.documentType === "qna").length, 법령: results.filter((x) => x.documentType === "law").length, 안내서: results.filter((x) => x.documentType === "guide").length };
  const categories = [...new Set(results.map((x) => x.category).filter(Boolean))] as string[];
  const laws = [...new Set(results.flatMap((x) => x.legalReferences))];
  const groupedResults = {
    complaint: sorted.filter((item) => item.documentType === "complaint"),
    qna: sorted.filter((item) => item.documentType === "qna"),
    law: sorted.filter((item) => item.documentType === "law"),
    guide: sorted.filter((item) => item.documentType === "guide"),
  };
  const recommend = (word: string) => { setQuery(word); void runSearch(word); };
  async function openResult(item: SearchItem) {
    setSelected(item); setPdfData(null); setActivePage(1);
    if (item.documentType !== "guide") return;
    setPdfLoading(true);
    try {
      const response = await fetch(`/api/documents/${encodeURIComponent(item.id)}/pdf?q=${encodeURIComponent(searchedQuery)}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "PDF를 불러오지 못했습니다.");
      setPdfData(payload); setActivePage(payload.matches?.[0]?.pageNumber || 1);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "PDF를 불러오지 못했습니다."); }
    finally { setPdfLoading(false); }
  }
  function resultCard(item: SearchItem) {
    const kind = item.documentType === "complaint" ? "민원" : item.documentType === "qna" ? "Q&A" : item.documentType === "law" ? "법령" : "안내서";
    const complaintPreview = ["complaint","qna"].includes(item.documentType) ? item.question.replace(/\s+/g, " ").trim().slice(0, 240) : "";
    return <article key={item.id}>
      <div className="result-icon">{kind.slice(0, 1)}</div>
      <div>
        <div className="result-meta">
          <b>{kind}</b>
          <span>{item.createdAt?.slice(0, 10)} · {item.department}</span>
          <em>일치도 {Math.min(99, Math.max(1, Math.round(item.score)))}점</em>
        </div>
        <h4><Highlighted text={item.title} terms={item.matchedTerms} /></h4>
        <p><Highlighted text={item.snippet} terms={item.matchedTerms} /></p>
        {complaintPreview && <div className="complaint-result-preview"><strong>민원 내용</strong><p><Highlighted text={`${complaintPreview}${item.question.length > complaintPreview.length ? "…" : ""}`} terms={item.matchedTerms} /></p></div>}
        {item.documentType === "guide" && item.guideMatches.length > 0 && <div className="guide-hit-group"><b>본문 일치 결과 {item.guideMatches.length}개</b>{item.guideMatches.slice(0, 3).map((match, index) => <span key={`${match.pageNumber}-${index}`}>{match.pageNumber ? `${match.pageNumber}쪽 · ` : ""}<Highlighted text={match.snippet} terms={item.matchedTerms} /></span>)}</div>}
        <div className="tags">
          {item.category && <span>{item.category}</span>}
          {item.matchedTerms.slice(0, 4).map((word) => <span key={word}>{word}</span>)}
        </div>
      </div>
      <button className="open" onClick={() => void openResult(item)}>상세 보기 ↗</button>
    </article>;
  }
  return (
    <div className="search-page">
      <div className="search-hero">
        <span className="eyebrow">KNOWLEDGE SEARCH</span>
        <h2>어떤 자료를 찾고 계신가요?</h2>
        <p>문장으로 질문하거나 찾고 싶은 단어를 입력해 보세요.</p>
        <form className="big-search" onSubmit={(event) => { event.preventDefault(); void runSearch(); }}>
          <span>⌕</span>
          <input aria-label="통합 검색어" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="검색할 단어나 문장을 입력하세요" />
          <button type="submit" disabled={loading}>{loading ? "검색 중…" : "검색"}</button>
        </form>
        <div className="suggest">
          <span>추천 검색</span>
          <button onClick={() => recommend("개인정보 전송요구권")}>
            개인정보 전송요구권
          </button>
          <button onClick={() => recommend("허가 처리기간")}>
            허가 처리기간
          </button>
          <button onClick={() => recommend("마이데이터 철회")}>
            마이데이터 철회
          </button>
        </div>
      </div>
      <div className="search-content">
        <div className="filters">
          <label>
            부서
            <select disabled value={department}>
              <option>{department}</option>
            </select>
          </label>
          <label>
            업무 분류
            <select value={category} onChange={(e) => setCategory(e.target.value)}>
              <option>전체</option>
              {categories.map((value) => <option key={value}>{value}</option>)}
            </select>
          </label>
          <label>
            소관 법령
            <select value={legal} onChange={(e) => setLegal(e.target.value)}>
              <option>전체 법령</option>
              {laws.map((value) => <option key={value}>{value}</option>)}
            </select>
          </label>
        </div>
        <div className="search-summary">
          <div>
            <h3>{searchedQuery ? `“${searchedQuery}” 검색 결과` : "통합 검색"}</h3>
            <p>{searchedQuery ? `총 ${filtered.length}건의 일치 자료를 찾았습니다.` : `${department}에 저장된 민원·Q&A·법령·안내서를 검색합니다.`}</p>
          </div>
          <select value={sort} onChange={(e) => setSort(e.target.value)}>
            <option>관련도순</option>
            <option>최신순</option>
          </select>
        </div>
        <div className="tabs">
          {(["전체", "유사민원", "Q&A", "법령", "안내서"] as const).map((name) => (
            <button
              className={tab === name ? "on" : ""}
              onClick={() => { setTab(name); setVisibleCount(20); }}
              key={name}
            >
              {name} {counts[name]}
            </button>
          ))}
        </div>
        {error && <div className="search-state search-error">{error}</div>}
        {loading && <SearchWaiting seconds={searchSeconds}/>}
        {!loading && !error && searchedQuery && !sorted.length && <div className="search-state search-empty"><b>일치하는 자료가 없습니다.</b><span>띄어쓰기나 검색 단어를 줄여 다시 검색해 보세요.</span></div>}
        {!loading && !error && !searchedQuery && <div className="search-state search-empty"><b>검색어를 입력해 주세요.</b><span>입력한 단어가 제목·민원요지·질의·답변·본문에 포함된 자료를 찾아드립니다.</span></div>}
        {tab === "전체" && searchedQuery && !loading && !error && <div className="search-wide-board">
          {([['complaint', '민원'], ['qna', 'Q&A'], ['law', '법령'], ['guide', '안내서']] as const).map(([type, label]) => <section className={`search-result-column type-${type}`} key={type}>
            <header><div><span>{label.slice(0, 1)}</span><h4>{label}</h4></div><b>{groupedResults[type].length}건</b></header>
            <div className="search-results">{groupedResults[type].slice(0, 6).map(resultCard)}</div>
            {!groupedResults[type].length && <p className="column-empty">일치하는 {label} 자료가 없습니다.</p>}
            {groupedResults[type].length > 6 && <button className="column-more" onClick={() => { setTab(type === 'complaint' ? '유사민원' : label); setVisibleCount(20); }}>전체 {label} 결과 보기</button>}
          </section>)}
        </div>}
        <div className={`search-results search-standard-results ${tab === "전체" ? "all-tab" : ""}`}>
          {!loading && sorted.slice(0, visibleCount).map(resultCard)}
        </div>
        {visibleCount < sorted.length && <button className={`load-more ${tab === "전체" ? "all-tab" : ""}`} onClick={() => setVisibleCount((count) => count + 20)}>결과 더보기</button>}
      </div>
      {selected && <div className="search-detail-backdrop" onMouseDown={() => setSelected(null)}>
        <section className="search-detail" onMouseDown={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label="검색 결과 상세">
          <header><div><span>{selected.documentType === "complaint" ? "유사민원" : selected.documentType === "qna" ? "Q&A" : selected.documentType === "law" ? "법령" : "안내서"}</span><h3><Highlighted text={selected.title} terms={selected.matchedTerms} /></h3><p>{selected.department} · {selected.createdAt?.slice(0, 10)}</p></div><button aria-label="닫기" onClick={() => setSelected(null)}>×</button></header>
          <div className="search-detail-body">
            {selected.documentType === "complaint" && <ComplaintSearchMetadata item={selected} />}
            {selected.question && <section className="complaint-text-card question-card"><div className="text-card-heading"><span>Q</span><div><h4>{selected.documentType === "qna" ? "질문" : "민원 질의"}</h4><small>{selected.documentType === "qna" ? "등록된 질문" : "민원인이 요청한 내용"}</small></div></div><p><Highlighted text={selected.question} terms={selected.matchedTerms} /></p></section>}
            {selected.answer && <section className="complaint-text-card answer-card"><div className="text-card-heading"><span>A</span><div><h4>{selected.documentType === "qna" ? "공식 답변" : "답변 내용"}</h4><small>검토가 완료된 답변</small></div></div><p><Highlighted text={selected.answer} terms={selected.matchedTerms} /></p></section>}
            {selected.documentType === "guide" && <section className="guide-search-pages"><h4>검색어가 나온 문장</h4>{pdfLoading ? <p>원본 PDF의 페이지를 찾고 있습니다…</p> : pdfData ? <><div className="pdf-search-layout"><div className="pdf-page-list">{pdfData.matches.length ? pdfData.matches.map((match) => <button className={activePage === match.pageNumber ? "on" : ""} key={match.pageNumber} onClick={() => setActivePage(match.pageNumber)}><b>{match.pageNumber}쪽</b><span><Highlighted text={match.snippet} terms={match.matchedTerms} /></span></button>) : <p>PDF에서 일치 문장을 찾지 못했습니다.</p>}</div><div className="pdf-preview"><div><b>{activePage}쪽</b><span>검색어: <mark>{searchedQuery}</mark></span><a href={`${pdfData.pdfUrl}#page=${activePage}&search=${encodeURIComponent(searchedQuery)}&view=FitH`} target="_blank" rel="noreferrer">새 창에서 보기 ↗</a></div><iframe key={`${selected.id}-${activePage}`} title={`${selected.title} ${activePage}쪽`} src={`${pdfData.pdfUrl}#page=${activePage}&view=FitH`} /></div></div></> : <p>PDF 조회 정보를 불러오지 못했습니다.</p>}</section>}
            {!selected.question && selected.documentType !== "guide" && selected.content && <section><h4>자료 내용</h4><p><Highlighted text={selected.content} terms={selected.matchedTerms} /></p></section>}
            {!!selected.legalReferences.length && <section><h4>관련 법령</h4><div className="tags">{selected.legalReferences.map((law) => <span key={law}>{law}</span>)}</div></section>}
          </div>
        </section>
      </div>}
    </div>
  );
}
function ComplaintSearchMetadata({ item }: { item: SearchItem }) {
  const values = { ...item.complaintMetadata, department: item.department || item.complaintMetadata.department };
  const value = (key: string) => { const raw = values[key]; return Array.isArray(raw) ? raw.join(", ") : raw == null || raw === "" ? "—" : String(raw).replace("T", " ").replace(/\+00:00$/, ""); };
  const fields = (items: [string, string][]) => items.map(([key, label]) => <div key={key}><small>{label}</small><strong><Highlighted text={value(key)} terms={item.matchedTerms} /></strong></div>);
  return <section className="complaint-overview">
    <div className="complaint-summary-banner"><span>민원요지</span><strong><Highlighted text={value("summary")} terms={item.matchedTerms} /></strong></div>
    <div className="meta-section-heading"><span>01</span><h4>접수 정보</h4></div>
    <div className="search-complaint-meta key-meta">{fields([["application_number", "신청번호"], ["receipt_number", "접수번호"], ["application_at", "신청일시"], ["received_at", "접수일시"], ["expected_completion_at", "처리완료 예정일"], ["application_channel", "신청경로"]])}</div>
    <div className="meta-section-heading"><span>02</span><h4>처리 정보</h4></div>
    <div className="search-complaint-meta">{fields([["department", "처리부서"], ["handler_masked", "담당자"], ["processor_masked", "처리자"], ["notification_at", "처리결과 통보일"], ["answer_confirmed_at", "민원인 답변 확인일"], ["processing_result", "처리구분"], ["complaint_kind", "민원종류"], ["public_status", "공개여부"], ["processing_period_days", "처리기간(일)"], ["notification_method", "답변 통지방식"]])}</div>
  </section>;
}
function Highlighted({ text, terms }: { text: string; terms: string[] }) {
  if (!text || !terms.length) return <>{text}</>;
  const escaped = terms.filter(Boolean).map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (!escaped.length) return <>{text}</>;
  const matcher = new RegExp(`(${escaped.join("|")})`, "gi");
  const lookup = new Set(terms.map((term) => term.normalize("NFKC").toLocaleLowerCase("ko-KR")));
  return <>{text.split(matcher).map((part, index) => lookup.has(part.normalize("NFKC").toLocaleLowerCase("ko-KR")) ? <mark key={index}>{part}</mark> : part)}</>;
}
function Data({
  inputRef,
  upload,
  uploading,
  uploadStage,
  uploadProgress,
  uploadNotice,
  uploadBatch,
  clearUploadNotice,
  jobs,
  retry,
  refresh,
  flash,
  department,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  upload: (files?: File[]) => void;
  uploading: boolean;
  uploadStage: string;
  uploadProgress: number;
  uploadNotice: UploadNotice;
  uploadBatch: BatchUploadItem[];
  clearUploadNotice: () => void;
  jobs: UploadJob[];
  retry: (id: string) => void;
  refresh: () => Promise<void>;
  flash: (s: string) => void;
  department: string;
}) {
  const [entryMode, setEntryMode] = useState<"file" | "qna">("file");
  const [type, setType] = useState("전체");
  const [search, setSearch] = useState("");
  const [detailJob, setDetailJob] = useState<UploadJob | null>(null);
  const [detailData, setDetailData] = useState<JobDetail>({});
  const [detailDocs, setDetailDocs] = useState<RagDocument[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [qnaSaving, setQnaSaving] = useState(false);
  const [qnaForm, setQnaForm] = useState({ title: "", category: "", question: "", answer: "" });
  const [qnaDocuments,setQnaDocuments]=useState<RagDocument[]>([]);
  const [qnaLoading,setQnaLoading]=useState(false);
  const [selectedQna,setSelectedQna]=useState<RagDocument|null>(null);
  async function loadQnaDocuments(){
    setQnaLoading(true);
    try{const response=await fetch(`/api/qna?department=${encodeURIComponent(department)}`,{cache:'no-store'});const payload=await response.json();if(!response.ok)throw new Error(payload.error||'Q&A 자료를 불러오지 못했습니다.');setQnaDocuments(payload.documents||[]);}catch(error){flash(error instanceof Error?error.message:'Q&A 자료를 불러오지 못했습니다.');}finally{setQnaLoading(false);}
  }
  useEffect(()=>{if(type==='Q&A')void loadQnaDocuments();},[type,department]);
  async function saveQna() {
    if (qnaSaving) return;
    if (qnaForm.title.trim().length < 2 || qnaForm.question.trim().length < 10 || qnaForm.answer.trim().length < 10) {
      flash("제목과 10자 이상의 질문·답변을 입력해 주세요.");
      return;
    }
    setQnaSaving(true);
    try {
      const response = await fetch("/api/qna", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...qnaForm, department }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Q&A를 저장하지 못했습니다.");
      setQnaForm({ title: "", category: "", question: "", answer: "" });
      flash("Q&A를 저장하고 검색 자료로 등록했습니다.");
      await refresh();
      await loadQnaDocuments();
    } catch (error) {
      flash(error instanceof Error ? error.message : "Q&A를 저장하지 못했습니다.");
    } finally {
      setQnaSaving(false);
    }
  }
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
      !confirm("이 자료와 검색 청크를 삭제할까요? 삭제 후 복구할 수 없습니다.")
    )
      return;
    const r = await fetch(`/api/documents/${id}`, { method: "DELETE" });
    const j = await r.json();
    if (!r.ok) {
      flash(j.error || "삭제하지 못했습니다.");
      return;
    }
    setDetailDocs((v) => v.filter((doc) => doc.id !== id));
    flash("자료와 검색 청크를 삭제했습니다.");
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
  const filteredQna=qnaDocuments.filter((doc)=>[doc.title,doc.question_original,doc.answer_original].some(value=>String(value||'').toLocaleLowerCase('ko-KR').includes(search.toLocaleLowerCase('ko-KR'))));
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
      <section className="data-entry-card">
        <div className="data-entry-tabs" role="tablist" aria-label="자료 등록 방식">
          <button role="tab" aria-selected={entryMode === "file"} className={entryMode === "file" ? "on" : ""} onClick={() => setEntryMode("file")}><span>⇧</span><div><b>파일 업로드</b><small>민원·안내서 PDF</small></div></button>
          <button role="tab" aria-selected={entryMode === "qna"} className={entryMode === "qna" ? "on" : ""} onClick={() => setEntryMode("qna")}><span>Q</span><div><b>Q&A 직접 등록</b><small>질문과 공식 답변 한 쌍</small></div></button>
        </div>
        {entryMode === "file" ? <section
          className={"drop-zone embedded " + (uploading ? "loading" : "")}
          onClick={() => !uploading && inputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); if (!uploading) upload(Array.from(e.dataTransfer.files)); }}
        >
          <div className="upload-icon">⇧</div>
          <h3>{uploading ? uploadStage || "단계별 처리 상태를 확인하고 있습니다…" : "새 자료 업로드"}</h3>
          {uploading && <div className="browser-progress"><i style={{width:`${uploadProgress}%`}}/><span>{uploadProgress}%</span></div>}
          <p>PDF 파일을 여러 개 끌어놓거나 한 번에 선택하세요.</p>
          <small>민원 원본은 저장하지 않으며 마스킹 PDF와 비식별 요약만 저장합니다.</small>
          <button disabled={uploading}>{uploading ? "처리 중…" : "파일 선택"}</button>
        </section> : <div className="qna-entry" role="tabpanel">
          <div className="qna-entry-head"><div><span>Q&A 자료</span><h3>질문과 공식 답변 등록</h3><p>등록 후 현재 부서의 통합 검색과 답변 초안 근거로 활용됩니다.</p></div><div className="qna-safe-note">질문은 비식별 요약본으로 검색·AI 근거에 사용</div></div>
          <div className="qna-grid">
            <label><span>제목 <em>필수</em></span><input maxLength={200} value={qnaForm.title} onChange={(e) => setQnaForm({...qnaForm, title:e.target.value})} placeholder="예: 회원 탈퇴 후 개인정보 삭제 기준" /></label>
            <label><span>업무 분류 <small>선택</small></span><input maxLength={100} value={qnaForm.category} onChange={(e) => setQnaForm({...qnaForm, category:e.target.value})} placeholder="예: 개인정보 파기" /></label>
          </div>
          <div className="qna-pair">
            <label><span><i>Q</i><b>질문</b><small>{qnaForm.question.length.toLocaleString()} / 10,000자</small></span><textarea maxLength={10000} value={qnaForm.question} onChange={(e) => setQnaForm({...qnaForm, question:e.target.value})} placeholder="질문 내용을 입력하세요. 개인정보는 입력하지 않는 것을 권장합니다." /></label>
            <label><span><i>A</i><b>공식 답변</b><small>{qnaForm.answer.length.toLocaleString()} / 30,000자</small></span><textarea maxLength={30000} value={qnaForm.answer} onChange={(e) => setQnaForm({...qnaForm, answer:e.target.value})} placeholder="검토가 완료된 답변 내용을 입력하세요." /></label>
          </div>
          <div className="qna-actions"><p>저장 시 개인정보 마스킹, 검색 청크 생성 및 임베딩 처리가 자동으로 진행됩니다.</p><button disabled={qnaSaving} onClick={saveQna}>{qnaSaving ? "저장 중…" : "Q&A 저장"}</button></div>
        </div>}
      </section>
      {uploadBatch.length > 0 && (
        <div className="upload-batch" aria-live="polite">
          <div className="upload-batch-head">
            <strong>파일별 처리 현황</strong>
            <span>{uploadBatch.filter((item) => ["success", "error"].includes(item.status)).length}/{uploadBatch.length} 완료</span>
          </div>
          <div className="upload-batch-list">
            {uploadBatch.map((item, index) => (
              <div className={`upload-batch-item ${item.status}`} key={`${item.fileName}-${index}`}>
                <i>{item.status === "success" ? "✓" : item.status === "error" ? "!" : item.status === "processing" ? "…" : String(index + 1)}</i>
                <span><b>{item.fileName}</b><small>{item.message || "대기 중"}</small></span>
              </div>
            ))}
          </div>
        </div>
      )}
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
              <option>Q&A</option>
              <option>법령</option>
              <option>안내서</option>
            </select>
          </div>
        </div>
        {type==='Q&A'?<div className="table-wrap qna-library-table">
          <table><thead><tr><th>Q&A 제목</th><th>등록 방식</th><th>출처</th><th>상태</th><th>등록일</th><th></th></tr></thead><tbody>
            {qnaLoading?<tr><td colSpan={6}>Q&A 자료를 불러오고 있습니다…</td></tr>:filteredQna.length?filteredQna.map((doc)=>{const masked=(doc.metadata?.masked_row||{}) as Record<string,unknown>;const source=(doc.metadata?.source||{}) as Record<string,unknown>;const guide=String(masked.source_guide_title||'');const page=String(masked.source_page||'');return <tr key={doc.id}><td data-label="Q&A 제목"><div><strong>{doc.title}</strong><small>{doc.category_major||'Q&A'}</small></div></td><td data-label="등록 방식"><span className="type-chip">{guide?'안내서 자동 추출':'직접 등록'}</span></td><td data-label="출처">{guide?`${guide}${page?` · ${page}쪽`:''}`:String(source.file_name||'직접 등록')}</td><td data-label="상태"><span className="status done">검색 가능</span></td><td data-label="등록일">{formatDate(doc.created_at)}</td><td data-label="작업"><button className="view-btn" onClick={()=>setSelectedQna(doc)}>조회</button></td></tr>}):<tr><td colSpan={6}>저장된 Q&A 자료가 없습니다.</td></tr>}
          </tbody></table>
        </div>:<div className="table-wrap">
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
        </div>}
        <div className="table-foot">
          <span>총 {type==='Q&A'?filteredQna.length:filtered.length}개 자료</span>
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
      {selectedQna&&<QnaDataDetail document={selectedQna} close={()=>setSelectedQna(null)}/>}
    </div>
  );
}
function QnaDataDetail({document,close}:{document:RagDocument;close:()=>void}){
  const masked=(document.metadata?.masked_row||{}) as Record<string,unknown>;
  const source=(document.metadata?.source||{}) as Record<string,unknown>;
  const guide=String(masked.source_guide_title||'');
  const page=String(masked.source_page||'');
  return <div className="search-detail-backdrop" onMouseDown={close}><section className="search-detail" onMouseDown={event=>event.stopPropagation()} role="dialog" aria-modal="true" aria-label="Q&A 상세"><header><div><span>Q&A · {guide?'안내서 자동 추출':'직접 등록'}</span><h3>{document.title}</h3><p>{guide?`${guide}${page?` · ${page}쪽`:''}`:String(source.file_name||'직접 등록')} · {formatDate(document.created_at)}</p></div><button aria-label="닫기" onClick={close}>×</button></header><div className="search-detail-body"><section className="complaint-text-card question-card"><div className="text-card-heading"><span>Q</span><div><h4>질문</h4><small>검색·답변 근거로 저장된 질문</small></div></div><p>{document.question_original||'저장된 질문이 없습니다.'}</p></section><section className="complaint-text-card answer-card"><div className="text-card-heading"><span>A</span><div><h4>공식 답변</h4><small>검토된 답변 원문</small></div></div><p>{document.answer_original||'저장된 답변이 없습니다.'}</p></section></div></section></div>;
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
        extracting_qna: "안내서 Q&A 의미 분석",
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
      { complaint: "민원", qna: "Q&A", law: "법령", guide: "안내서" } as Record<
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
type AnswerHistoryItem={id:string;complaint_title?:string;application_number?:string;answer_text?:string;approved_summary?:Record<string,unknown>;version_number?:number;department?:string;created_at?:string};
function Modal({ close }: { title: string; close: () => void }) {
  const[items,setItems]=useState<AnswerHistoryItem[]>([]);
  const[selected,setSelected]=useState<AnswerHistoryItem|null>(null);
  const[loading,setLoading]=useState(true);
  const[error,setError]=useState('');
  useEffect(()=>{let active=true;(async()=>{try{const response=await fetch('/api/answers',{cache:'no-store'});const payload=await response.json();if(!response.ok)throw new Error(payload.error||'기록을 불러오지 못했습니다.');const versions=Array.isArray(payload.versions)?payload.versions:[];if(active){setItems(versions);setSelected(versions[0]||null);}}catch(reason){if(active)setError(reason instanceof Error?reason.message:'기록을 불러오지 못했습니다.');}finally{if(active)setLoading(false);}})();return()=>{active=false};},[]);
  const summary=selected?.approved_summary||{};
  const inquiry=String(summary.inquirySummary||summary.summary||summary.question||'').trim();
  return <div className="modal-back" onMouseDown={close}><div className="modal history-modal" onMouseDown={(e)=>e.stopPropagation()}><button className="modal-x" onClick={close} aria-label="닫기">×</button><span className="eyebrow">SAVED ANSWERS</span><h2>답변 기록</h2><p className="history-help">직접 저장한 답변 초안과 사용 근거의 버전을 확인할 수 있습니다.</p>{loading?<div className="history-state">저장된 답변을 불러오는 중입니다…</div>:error?<div className="history-state error">{error}</div>:!items.length?<div className="history-state"><b>아직 저장된 답변이 없습니다.</b><span>답변 초안에서 ‘저장’을 누르면 여기에 버전별로 기록됩니다.</span></div>:<div className="history-layout"><div className="history-list" role="list">{items.map(item=><button type="button" role="listitem" className={selected?.id===item.id?'active':''} key={item.id} onClick={()=>setSelected(item)}><strong>{item.complaint_title||'제목 없는 민원'}</strong><span>{item.application_number||'신청번호 없음'} · 버전 {item.version_number||1}</span><small>{item.created_at?new Date(item.created_at).toLocaleString('ko-KR'):'저장일 없음'}</small></button>)}</div>{selected&&<div className="history-detail"><div className="modal-meta"><span>{selected.department||'부서 정보 없음'}</span><span>버전 {selected.version_number||1}</span>{selected.application_number&&<span>{selected.application_number}</span>}</div>{inquiry&&<section><h3>승인한 질의 요약</h3><p>{inquiry}</p></section>}<section><h3>저장된 답변</h3><p>{selected.answer_text||'저장된 답변 내용이 없습니다.'}</p></section></div>}</div>}<div className="modal-actions"><button onClick={close}>닫기</button></div></div></div>;
}
