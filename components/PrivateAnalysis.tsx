'use client';
import { useRef, useState } from 'react';
import { CONCEPTS, Concept, ISSUE_IDS } from '../lib/draft-policy';
import { classifyLocally } from '../lib/local-draft';
import { maskSensitiveText } from '../lib/browser-privacy';
import './PrivateAnalysis.css';
type Preview = { envelope:string;signature:string;payload:unknown;evidence:{reference:string;title:string;effectiveFrom:string;source:string;excerpt:string}[] };
export default function PrivateAnalysis() {
  const [raw,setRaw]=useState('');
  const [masked,setMasked]=useState('');
  const [ids,setIds]=useState<Concept[]>([]);
  const [busy,setBusy]=useState(false);
  const lock=useRef(false);
  const [status,setStatus]=useState('입력 대기');
  const [error,setError]=useState('');
  const [preview,setPreview]=useState<Preview|null>(null);
  const [checked,setChecked]=useState(false);
  const [factsChecked,setFactsChecked]=useState(false);
  const [draft,setDraft]=useState('');
  function invalidate(){setPreview(null);setChecked(false);setFactsChecked(false);setDraft('');}
  async function task(work:()=>Promise<void>){if(lock.current)return;lock.current=true;setBusy(true);setError('');try{await work();}catch(e){setError(e instanceof Error?e.message:'처리하지 못했습니다.');setStatus('중단 · 내용을 확인해 주세요');}finally{lock.current=false;setBusy(false);}}
  async function post(body:unknown){const r=await fetch('/api/draft',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),cache:'no-store'});const j=await r.json();if(!r.ok)throw new Error(j.error);return j;}
  function changeRaw(value:string){setRaw(value);setMasked('');setIds([]);invalidate();setStatus('입력 변경 · 재검토 필요');}
  async function loadPdf(file:File){await task(async()=>{invalidate();setStatus('브라우저에서 PDF 읽는 중');if(file.size>15*1024*1024)throw new Error('15MB 이하 PDF를 사용해 주세요.');const {extractText}=await import('unpdf');const text=await extractText(new Uint8Array(await file.arrayBuffer()),{mergePages:true});if(!text.text.trim())throw new Error('텍스트가 없는 PDF입니다. OCR된 파일이나 질의 내용을 붙여넣어 주세요.');if(text.text.length>10000)throw new Error('질의 부분만 10,000자 이내로 붙여넣어 주세요.');changeRaw(text.text);});}
  async function analyze(){await task(async()=>{invalidate();setIds([]);setMasked(maskSensitiveText(raw).value);const result=await classifyLocally(raw,setStatus);setIds(result.ids);setMasked(result.masked);setStatus('로컬 정리 완료 · 사실과 쟁점을 검토해 주세요');});}
  async function prepare(){await task(async()=>{setPreview(null);setChecked(false);setDraft('');setStatus('일반화된 쟁점으로 공개 법령 조회 중');setPreview(await post({action:'prepare',ids}));setStatus('전송 대기 · 아래 자료를 확인해 주세요');});}
  async function generate(){if(!preview||!checked)return;await task(async()=>{setStatus('승인된 전송자료로 초안 작성 중');const result=await post({action:'generate',confirmed:true,envelope:preview.envelope,signature:preview.signature});setDraft(result.draft);setChecked(false);setStatus('초안 작성 완료 · 담당자 검토 필요');});}
  return <div className="private-analysis">
    <div className="privacy-status" role="status" aria-live="polite"><b>개인정보 보호 모드</b><span>{status}</span></div>
    <section><h2>1. 민원 입력 · 기기 안에서 처리</h2><p>원문과 PDF는 이 화면의 메모리에서만 처리합니다. 화면을 떠나면 입력 내용이 사라집니다.</p>
      <label htmlFor="private-raw">민원 질의 내용</label><textarea id="private-raw" value={raw} maxLength={10000} disabled={busy} onChange={e=>changeRaw(e.target.value)} placeholder="질의 내용을 입력하거나 붙여넣어 주세요."/>
      <div className="private-actions"><label className="pdf-pick">PDF에서 읽기<input type="file" accept="application/pdf,.pdf" disabled={busy} onChange={e=>{const file=e.target.files?.[0];if(file)void loadPdf(file);e.target.value='';}}/></label><span>{raw.length.toLocaleString()} / 10,000자</span><button disabled={busy||!raw.trim()} onClick={analyze}>기기에서 마스킹·쟁점 정리</button></div>
      {masked&&<details><summary>1차 마스킹 내용 확인 · 기기 안에서만 표시</summary><pre>{masked}</pre></details>}
    </section>
    <section><h2>2. 법적 쟁점과 필요한 사실 검토</h2><p>로컬 AI의 선택을 원문과 비교해 수정하세요. 아래에 없는 구체적인 사건·질병·가족관계·고유명사는 전송하지 않습니다. 적절한 항목이 없으면 담당자가 직접 검토해 주세요.</p>
      <div className="private-options">{Object.entries(CONCEPTS).map(([id,label])=><label key={id}><input type="checkbox" disabled={busy} checked={ids.includes(id as Concept)} onChange={e=>{invalidate();setIds(current=>e.target.checked?[...current,id as Concept]:current.filter(v=>v!==id));}}/><span><small>{ISSUE_IDS.includes(id as Concept)?'쟁점':'사실'}</small>{label}</span></label>)}</div>
      <label className="private-consent"><input type="checkbox" disabled={busy} checked={factsChecked} onChange={e=>{setFactsChecked(e.target.checked);setPreview(null);setChecked(false);setDraft('');}}/>선택한 사실·쟁점이 원문의 의미와 부정 표현을 정확하게 반영함을 확인했습니다.</label>
      <button disabled={busy||!factsChecked||!ids.some(id=>ISSUE_IDS.includes(id))} onClick={prepare}>공개 근거 및 전송자료 확인</button>
    </section>
    {error&&<p role="alert" className="private-error">{error}</p>}
    {preview&&<section><h2>3. 외부 AI 전송자료 확인</h2><p>OpenAI에 보낼 전체 요청입니다. 일반화된 항목과 공개 법령만 포함됩니다. API 응답 저장은 비활성화하지만, 제공자의 운영상 데이터 보존 정책까지 해제하는 설정은 아닙니다.</p>
      <div className="private-evidence">{preview.evidence.map(e=><details key={e.reference}><summary>[{e.reference}] {e.title} · 시행 {e.effectiveFrom}</summary><pre>{e.excerpt}</pre>{e.source?.startsWith('https://www.law.go.kr/')&&<a href={e.source} target="_blank" rel="noreferrer">국가법령정보센터 원문</a>}</details>)}</div>
      <details open><summary>실제 전송 요청 전체</summary><pre>{JSON.stringify(preview.payload,null,2)}</pre></details>
      <label className="private-consent"><input type="checkbox" checked={checked} disabled={busy} onChange={e=>setChecked(e.target.checked)}/>전송 내용과 근거를 확인했고 개인·기관·사건을 식별할 정보가 없음을 확인했습니다.</label>
      <button disabled={busy||!checked} onClick={generate}>확인한 자료로 답변 초안 작성</button>
    </section>}
    {draft&&<section><h2>4. 답변 초안 편집</h2><p>검토용 초안입니다. 사실관계와 근거의 적용 여부를 확인해 주세요. 편집 내용은 외부 AI로 다시 보내지 않습니다.</p><textarea aria-label="답변 초안" className="private-draft" value={draft} onChange={e=>setDraft(e.target.value)}/><button onClick={()=>{const url=URL.createObjectURL(new Blob([draft],{type:'text/plain;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='민원답변_검토초안.txt';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}}>내 기기에 초안 저장</button></section>}
  </div>;
}
