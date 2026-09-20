"use client";
import { useEffect, useState } from "react";
import './GuideDetails.css';

type GuideDocument={id:string;title:string;page_count?:number;chunk_count:number;metadata?:Record<string,unknown>};
function toc(document:GuideDocument){const guide=document.metadata?.guide as{toc?:unknown}|undefined;return Array.isArray(guide?.toc)?guide.toc.map(String):[];}
export default function GuideDetails({document,remove}:{document:GuideDocument,remove:(id:string)=>Promise<void>}){
  const items=toc(document);
  const [pdfUrl,setPdfUrl]=useState("");
  const [pdfError,setPdfError]=useState("");
  useEffect(()=>{
    let active=true;
    setPdfUrl("");
    setPdfError("");
    fetch(`/api/documents/${encodeURIComponent(document.id)}/pdf`,{cache:"no-store"})
      .then(async response=>{const payload=await response.json() as {pdfUrl?:string;error?:string};if(!response.ok||!payload.pdfUrl)throw new Error(payload.error||"PDF를 불러오지 못했습니다.");if(active)setPdfUrl(payload.pdfUrl);})
      .catch(error=>{if(active)setPdfError(error instanceof Error?error.message:"PDF를 불러오지 못했습니다.");});
    return()=>{active=false;};
  },[document.id]);
  return <><div className="detail-title"><div><span className="type-chip guide-chip">안내서</span><h3>{document.title}</h3></div><button className="delete-doc" onClick={()=>remove(document.id)}>자료 삭제</button></div><div className="guide-summary"><div><small>전체 페이지</small><strong>{document.page_count||'—'}쪽</strong></div><div><small>검색 청크</small><strong>{document.chunk_count||0}개</strong></div><div><small>원문 저장</small><strong>PDF 저장됨</strong></div></div><section className="guide-pdf"><div className="guide-pdf-head"><div><h4>원본 PDF</h4><p>업로드한 안내서 원문을 화면에서 확인할 수 있습니다.</p></div>{pdfUrl&&<a href={pdfUrl} target="_blank" rel="noreferrer">새 창에서 보기 ↗</a>}</div>{pdfUrl?<iframe title={`${document.title} 원본 PDF`} src={`${pdfUrl}#page=1&view=FitH`}/>:pdfError?<div className="guide-pdf-state error"><b>PDF를 불러오지 못했습니다.</b><span>{pdfError}</span></div>:<div className="guide-pdf-state">PDF를 불러오고 있습니다…</div>}</section><section className="guide-toc"><h4>목차</h4>{items.length?<ol>{items.map((item,index)=><li key={`${item}-${index}`}>{item}</li>)}</ol>:<p>PDF에서 구분 가능한 목차를 찾지 못했습니다. 전체 원문은 검색용으로 정상 저장되어 있습니다.</p>}</section></>}
