"use client";

import { useEffect, useRef, useState } from "react";

type TourView="analyze"|"search"|"data";
type Step={target:string;view?:TourView;eyebrow:string;title:string;description:string};
const STORAGE_KEY="chutjul.productTour.v1";
const STEPS:Step[]=[
  {target:'[data-tour="analyze-nav"]',view:"analyze",eyebrow:"1 · 민원 분석",title:"질의를 안전하게 준비하세요",description:"PDF를 불러오거나 질문 편집기에 직접 입력한 뒤, 기기에서 만든 비식별 내용을 확인하고 수락할 수 있습니다."},
  {target:'[data-tour="department"]',eyebrow:"2 · 검색 범위",title:"현재 부서를 먼저 확인하세요",description:"민원·Q&A·안내서는 현재 부서 범위로 조회됩니다. 관리자는 필요한 부서로 전환할 수 있습니다."},
  {target:'[data-tour="answer-history"]',view:"analyze",eyebrow:"3 · 답변 기록",title:"저장한 답변을 다시 확인하세요",description:"답변 초안에서 저장한 버전과 사용 근거를 나중에 다시 열어볼 수 있습니다."},
  {target:'[data-tour="search-nav"]',view:"search",eyebrow:"4 · 통합 검색",title:"민원·Q&A·법령·안내서를 함께 찾으세요",description:"자연어 또는 신청번호·법령명·조문번호로 검색하고 원문과 관련도 근거를 확인할 수 있습니다."},
  {target:'[data-tour="data-nav"]',view:"data",eyebrow:"5 · 데이터 관리",title:"업로드 자료와 처리 상태를 관리하세요",description:"자료를 여러 개 등록하고, 처리 단계·실패 원인을 확인하거나 재처리할 수 있습니다."},
  {target:'[data-tour="help"]',eyebrow:"완료",title:"필요할 때 다시 시작할 수 있어요",description:"왼쪽 도움말을 누르면 이 안내를 언제든 다시 볼 수 있습니다."},
];

export default function OnboardingTour({open,onClose,onNavigate}:{open:boolean;onClose:()=>void;onNavigate:(view:TourView)=>void}){
  const [index,setIndex]=useState(0);
  const [rect,setRect]=useState<DOMRect|null>(null);
  const dialogRef=useRef<HTMLDivElement>(null);
  const step=STEPS[index];
  useEffect(()=>{if(open)setIndex(0)},[open]);
  useEffect(()=>{
    if(!open)return;
    if(step.view)onNavigate(step.view);
    const update=()=>{const node=document.querySelector(step.target) as HTMLElement|null;if(!node){setRect(null);return;}node.scrollIntoView({block:"nearest",inline:"nearest"});setRect(node.getBoundingClientRect());};
    const timer=window.setTimeout(update,80);window.addEventListener("resize",update);window.addEventListener("scroll",update,true);
    return()=>{clearTimeout(timer);window.removeEventListener("resize",update);window.removeEventListener("scroll",update,true)};
  },[open,index,step.target,step.view,onNavigate]);
  useEffect(()=>{if(!open)return;const timer=window.setTimeout(()=>dialogRef.current?.querySelector<HTMLElement>("button")?.focus(),100);const key=(event:KeyboardEvent)=>{if(event.key==="Escape")finish();if(event.key==="ArrowRight")next();if(event.key==="ArrowLeft")previous();if(event.key==="Tab"&&dialogRef.current){const items=[...dialogRef.current.querySelectorAll<HTMLElement>('button')];if(!items.length)return;const first=items[0],last=items[items.length-1];if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}}};document.addEventListener("keydown",key);return()=>{clearTimeout(timer);document.removeEventListener("keydown",key)}});
  if(!open)return null;
  function finish(){try{localStorage.setItem(STORAGE_KEY,"done")}catch{}onClose()}
  function next(){if(index===STEPS.length-1)finish();else setIndex(value=>value+1)}
  function previous(){setIndex(value=>Math.max(0,value-1))}
  const pad=8;
  const spotlight=rect?{left:Math.max(4,rect.left-pad),top:Math.max(4,rect.top-pad),width:Math.min(innerWidth-8,rect.width+pad*2),height:rect.height+pad*2}:undefined;
  return <div className="tour-layer" role="presentation">
    {spotlight&&<div className="tour-spotlight" style={spotlight} aria-hidden="true"/>}
    <div className="tour-card" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="tour-title" aria-describedby="tour-description">
      <div className="tour-progress" aria-label={`${index+1}/${STEPS.length} 단계`}>{STEPS.map((_,i)=><i key={i} className={i<=index?"active":""}/>)}</div>
      <span>{step.eyebrow}</span><h2 id="tour-title">{step.title}</h2><p id="tour-description">{step.description}</p>
      <div className="tour-actions"><button type="button" className="tour-skip" onClick={finish}>건너뛰기</button><div>{index>0&&<button type="button" onClick={previous}>이전</button>}<button type="button" className="tour-next" onClick={next}>{index===STEPS.length-1?"시작하기":"다음"}</button></div></div>
    </div>
  </div>;
}

export {STORAGE_KEY as ONBOARDING_STORAGE_KEY};
