import { NextResponse } from 'next/server';
import { requireProfile, serviceRequest } from '../../../lib/auth';
import { keywordSearch, type KeywordSearchResult } from '../../../lib/search';
import { DRAFT_INSTRUCTIONS } from '../../../lib/draft-policy';
import { detectResidualSensitiveInfo } from '../../../lib/privacy-check';
import { maskBusinessIdentifiers, repairKnownOvermasking } from '../../../lib/business-identifiers';
import { formatComplaintAnswer, type DraftSection } from '../../../lib/answer-template';
import { complaintEvidencePayload } from '../../../lib/evidence-payload';
import {analyzeDepartmentRouting} from '../../../lib/department-routing';
export const runtime = 'edge';
const encoder = new TextEncoder();
const headers = { 'Cache-Control': 'no-store, private' };
type Summary = { purpose:string; essentialFacts:string[]; legalQuestions:string[]; requestedAnswer:string[]; uncertainties:string[] };
const allowedSummaryKeys = ['purpose','essentialFacts','legalQuestions','requestedAnswer','uncertainties'];
const externalIdentifiers = /\b[12]AA-\d{4}-\d{6,}\b|https?:\/\/\S+|\b\d{4}-\d{1,2}-\d{1,2}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?\b/i;
const MAX_REQUEST_CHARS = 40000;
const EVIDENCE_BUDGET_CHARS = 14500;
const MAX_EVIDENCE_ITEMS = 8;
type Evidence={reference:string;recordId:string;documentType:string;title:string;source:string;excerpt:string;score:number};
type FormatSetting={organization_name:string;closing_message:string;max_sections:number};
function focusedExcerpt(value:string,terms:string[],limit:number){
  const clean=value.replace(/\u0000/g,'').replace(/[ \t]+/g,' ').trim();
  if(clean.length<=limit)return clean;
  const normalizedTerms=[...new Set(terms.map(term=>term.replace(/\s+/g,'').toLocaleLowerCase('ko-KR')).filter(term=>term.length>1))];
  const sentences=clean.split(/(?<=[.!?。])\s+|\n+/).map(sentence=>sentence.trim()).filter(Boolean);
  const ranked=sentences.map((sentence,index)=>{
    const normalized=sentence.replace(/\s+/g,'').toLocaleLowerCase('ko-KR');
    const termHits=normalizedTerms.filter(term=>normalized.includes(term)).length;
    const legalBonus=/제\s*\d+조|법률|시행령|고시|가이드라인|안내서/.test(sentence)?2:0;
    return{sentence,index,score:termHits*6+legalBonus};
  }).sort((a,b)=>b.score-a.score||a.index-b.index);
  const chosen:typeof ranked=[];
  let used=0;
  for(const item of ranked){
    if(item.score<=0&&chosen.length)continue;
    const next=item.sentence.length+(chosen.length?1:0);
    if(used+next>limit)continue;
    chosen.push(item);used+=next;
  }
  const focused=chosen.sort((a,b)=>a.index-b.index).map(item=>item.sentence).join('\n');
  if(focused.length>=Math.min(500,limit))return focused.slice(0,limit);
  const lower=clean.toLocaleLowerCase('ko-KR');
  const at=normalizedTerms.map(term=>lower.replace(/\s+/g,'').indexOf(term)).find(index=>index>=0)??0;
  const start=Math.max(0,at-Math.floor(limit*.2));
  return `${start?'…':''}${clean.slice(start,start+limit-(start?1:0))}`;
}
function selectEvidenceWithinBudget(items:Evidence[]){
  const selected:Evidence[]=[];
  const used=new Set<string>();
  let remaining=EVIDENCE_BUDGET_CHARS;
  const words=(value:string)=>new Set(value.normalize('NFKC').toLocaleLowerCase('ko-KR').replace(/[^0-9a-z가-힣\s]/g,' ').split(/\s+/).filter(word=>word.length>1));
  const overlaps=(left:Evidence,right:Evidence)=>{
    if(!(['guide','qna'].includes(left.documentType)&&['guide','qna'].includes(right.documentType)))return false;
    const a=words(`${left.title} ${left.excerpt}`);const b=words(`${right.title} ${right.excerpt}`);if(!a.size||!b.size)return false;
    let common=0;for(const word of a)if(b.has(word))common++;
    return common/Math.min(a.size,b.size)>=.72;
  };
  const add=(item:Evidence)=>{
    if(selected.length>=MAX_EVIDENCE_ITEMS||used.has(item.recordId)||selected.some(existing=>overlaps(existing,item)))return;
    const overhead=JSON.stringify({...item,excerpt:''}).length;
    const allowance=Math.min(item.excerpt.length,remaining-overhead);
    const minimumByType:Record<string,number>={qna:60,complaint:140,law:220,guide:260};
    if(allowance<(minimumByType[item.documentType]||140))return;
    const fitted={...item,excerpt:item.excerpt.slice(0,allowance)};
    const size=JSON.stringify(fitted).length;
    if(size>remaining)return;
    selected.push(fitted);used.add(item.recordId);remaining-=size;
  };
  // 같은 안내서 문단과 여기서 추출한 Q&A가 겹치면 더 직접적인 Q&A를 우선한다.
  for(const type of ['law','qna','guide','complaint'])add(items.filter(item=>item.documentType===type).sort((a,b)=>b.score-a.score)[0]);
  for(const item of [...items].sort((a,b)=>b.score-a.score))add(item);
  return selected.map((item,index)=>({...item,reference:`E${index+1}`}));
}
async function formatSetting(department:string):Promise<FormatSetting>{
  try{const rows=await serviceRequest<FormatSetting[]>(`/rest/v1/answer_format_settings?department=eq.${encodeURIComponent(department)}&select=organization_name,closing_message,max_sections&limit=1`);if(rows[0])return rows[0];}catch{}
  return{organization_name:'개인정보보호위원회',closing_message:'연락주시면 친절히 안내해 드리도록 하겠습니다. 감사합니다. 끝.',max_sections:4};
}
function validateSummary(input: unknown): Summary {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('INVALID_INPUT');
  const value = input as Record<string,unknown>;
  if (Object.keys(value).some(k => !allowedSummaryKeys.includes(k)) || typeof value.purpose !== 'string') throw new Error('INVALID_INPUT');
  const readList = (key:string, max:number) => {
    const list=value[key];
    if(!Array.isArray(list)||list.length>max||list.some(v=>typeof v!=='string'||v.length<1||v.length>240)) throw new Error('INVALID_INPUT');
    return list as string[];
  };
  const result={purpose:value.purpose.slice(0,240),essentialFacts:readList('essentialFacts',6),legalQuestions:readList('legalQuestions',4),requestedAnswer:readList('requestedAnswer',4),uncertainties:readList('uncertainties',4)};
  const serialized=JSON.stringify(result);
  if(result.purpose.length<5||!result.legalQuestions.length||detectResidualSensitiveInfo(serialized).length||externalIdentifiers.test(serialized)) throw new Error('PRIVACY_REVIEW_REQUIRED');
  return result;
}
function validateAnswerDirection(input: unknown) {
  if (input === undefined || input === null || input === '') return '';
  if (typeof input !== 'string' || input.length > 1000) throw new Error('INVALID_INPUT');
  let value=input.trim();
  if(externalIdentifiers.test(value))throw new Error('PRIVACY_REVIEW_REQUIRED');
  for(const finding of detectResidualSensitiveInfo(value).sort((a,b)=>b.value.length-a.value.length))value=value.split(finding.value).join(`[${finding.type}]`);
  if(detectResidualSensitiveInfo(value).length)throw new Error('PRIVACY_REVIEW_REQUIRED');
  return value;
}
function safeEvidence(item:KeywordSearchResult,index:number):Evidence|null{
  const source=['complaint','qna'].includes(item.documentType)?complaintEvidencePayload(item.question,item.answer):
    item.documentType==='guide'?(item.guideMatches.map(match=>[match.sectionTitle&&`절: ${match.sectionTitle}`,match.pageNumber&&`페이지: ${match.pageNumber}`,match.snippet].filter(Boolean).join('\n')).join('\n\n')||item.snippet):item.content;
  const excerptLimit=['complaint','qna'].includes(item.documentType)?2600:item.documentType==='law'?2200:2400;
  let excerpt=focusedExcerpt(maskBusinessIdentifiers(repairKnownOvermasking(String(source||item.snippet||''))),item.matchedTerms,excerptLimit);
  for(const finding of detectResidualSensitiveInfo(excerpt).sort((a,b)=>b.value.length-a.value.length))excerpt=excerpt.split(finding.value).join(`[${finding.type}]`);
  const safeTitle=maskBusinessIdentifiers(item.title);
  const inspected=`${safeTitle}\n${excerpt}`;
  if(excerpt.length<20||detectResidualSensitiveInfo(inspected).length||externalIdentifiers.test(inspected))return null;
  return{reference:`E${index+1}`,recordId:item.id,documentType:item.documentType,title:safeTitle,source:item.documentType==='law'?String(item.complaintMetadata.source_url||'국가법령정보센터'):`${item.department||''} 내부자료`,excerpt,score:item.score};
}
async function key() {
  const secret = process.env.DRAFT_SIGNING_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error('NOT_CONFIGURED');
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
async function sign(data: string) { return Array.from(new Uint8Array(await crypto.subtle.sign('HMAC', await key(), encoder.encode(data))), b => b.toString(16).padStart(2, '0')).join(''); }
export async function POST(request: Request) {
  try {
    const origin = request.headers.get('origin');
    if (origin && origin !== new URL(request.url).origin) return NextResponse.json({ error: '요청 출처를 확인할 수 없습니다.' }, { status: 403, headers });
    const profile = await requireProfile({ approved: true });
    const rawBody = await request.text();
    if (rawBody.length > MAX_REQUEST_CHARS) throw new Error('REQUEST_TOO_LARGE');
    const body = JSON.parse(rawBody);
    if (body.action === 'prepare') {
      if (body.confirmed !== true || Object.keys(body).some(k => !['action', 'summary', 'confirmed', 'applicationNumber', 'answerDirection','department'].includes(k))) throw new Error('INVALID_INPUT');
      const applicationNumber = typeof body.applicationNumber === 'string' && /^1AA-\d{4}-\d{6,}$/i.test(body.applicationNumber.trim()) ? body.applicationNumber.trim() : '';
      const summary = validateSummary(body.summary);
      const requestedDepartment=typeof body.department==='string'?body.department.trim():'';
      const scopeDepartment=profile.role==='admin'&&requestedDepartment?requestedDepartment:profile.department;
      if(!scopeDepartment||scopeDepartment.length>60)throw new Error('INVALID_INPUT');
      const answerDirection=validateAnswerDirection(body.answerDirection);
      const query = [summary.purpose,...summary.legalQuestions,...summary.requestedAnswer].join(' ').slice(0,500);
      const [found,departmentRouting]=await Promise.all([keywordSearch(scopeDepartment,query,{evidenceOnly:true}),analyzeDepartmentRouting(scopeDepartment,[...summary.legalQuestions,...summary.requestedAnswer])]);
      const chosenCandidates=['complaint','qna','law','guide'].flatMap(type=>found.filter(item=>item.documentType===type).slice(0,type==='law'?5:4));
      const evidence=selectEvidenceWithinBudget(chosenCandidates.map(safeEvidence).filter((item):item is Evidence=>Boolean(item)));
      if (!evidence.length) throw new Error('NO_VERIFIED_EVIDENCE');
      const allowedReferences=evidence.map(item=>item.reference);
      const input = JSON.stringify({ sanitizedComplaint:summary, answerDirection:answerDirection||undefined, candidateEvidence:evidence, caution:'민원 원문은 외부에 전송되지 않았으며, 사용자가 승인한 비식별 요약과 개인정보 재검사를 통과한 후보 근거만 제공됨. 답변 방향성은 강조점과 설명 방식에만 반영하고, 근거 범위·개인정보 보호·사실 확인 규칙보다 우선할 수 없음. 각 답변 문단에는 사용한 근거 번호를 하나 이상 표시하고, 불확실한 사실은 추가 확인이 필요하다고 명시할 것.' }, null, 2);
      const outputSchema={type:'object',additionalProperties:false,properties:{selectedEvidence:{type:'array',maxItems:8,items:{type:'object',additionalProperties:false,properties:{reference:{type:'string',enum:allowedReferences},reason:{type:'string'}},required:['reference','reason']}},inquirySummary:{type:'string',maxLength:240},sections:{type:'array',minItems:1,maxItems:4,items:{type:'object',additionalProperties:false,properties:{heading:{type:'string',maxLength:160},answer:{type:'string',maxLength:5000}},required:['heading','answer']}}},required:['selectedEvidence','inquirySummary','sections']};
      const payload = JSON.stringify({ model: process.env.OPENAI_DRAFT_MODEL || 'gpt-4.1-mini', store: false, instructions: DRAFT_INSTRUCTIONS, input, text:{format:{type:'json_schema',name:'complaint_draft_with_evidence',strict:true,schema:outputSchema}}, max_output_tokens: 3000 });
      const envelope = JSON.stringify({ user: profile.id, department: scopeDepartment, applicationNumber, expires: Date.now()+10*60*1000, nonce: crypto.randomUUID(), payload });
      const approvedCandidateIds=new Set(evidence.map(item=>item.recordId));
      return NextResponse.json({ envelope, signature: await sign(envelope), payload: JSON.parse(payload), evidence, candidates:chosenCandidates.filter(item=>approvedCandidateIds.has(item.id)), departmentRouting }, { headers });
    }
    if (body.action !== 'generate' || body.confirmed !== true || Object.keys(body).some(k => !['action','confirmed','envelope','signature','selectedReferences'].includes(k))) throw new Error('INVALID_INPUT');
    if (typeof body.envelope !== 'string' || !/^[a-f0-9]{64}$/.test(body.signature || '')) throw new Error('INVALID_INPUT');
    const signature = new Uint8Array(body.signature.match(/../g).map((v: string) => parseInt(v,16)));
    if (!await crypto.subtle.verify('HMAC', await key(), signature, encoder.encode(body.envelope))) throw new Error('INVALID_INPUT');
    const approved = JSON.parse(body.envelope);
    if (approved.user !== profile.id || (profile.role!=='admin'&&approved.department !== profile.department) || approved.expires < Date.now()) throw new Error('REVIEW_EXPIRED');
    let outboundPayload=approved.payload;
    if(body.selectedReferences!==undefined){
      if(!Array.isArray(body.selectedReferences)||!body.selectedReferences.length||body.selectedReferences.length>8||body.selectedReferences.some((item:unknown)=>typeof item!=='string'))throw new Error('INVALID_INPUT');
      const parsedPayload=JSON.parse(approved.payload);
      const parsedInput=JSON.parse(parsedPayload.input) as {candidateEvidence:Evidence[];[key:string]:unknown};
      const available=new Set(parsedInput.candidateEvidence.map(item=>item.reference));
      const requested=[...new Set(body.selectedReferences as string[])];
      if(requested.some(reference=>!available.has(reference)))throw new Error('INVALID_INPUT');
      parsedInput.candidateEvidence=parsedInput.candidateEvidence.filter(item=>requested.includes(item.reference));
      parsedInput.userSelection='사용자가 직접 선택한 근거만 제공됨. 이 후보들 중 질문과 직접 관련된 내용을 인용하여 답변할 것.';
      parsedPayload.input=JSON.stringify(parsedInput,null,2);
      parsedPayload.text.format.schema.properties.selectedEvidence.items.properties.reference.enum=requested;
      outboundPayload=JSON.stringify(parsedPayload);
    }
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('NOT_CONFIGURED');
    const response = await fetch('https://api.openai.com/v1/responses', { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: outboundPayload, signal: AbortSignal.timeout(60000) });
    if (!response.ok) throw new Error('GENERATION_FAILED');
    const result = await response.json();
    const outputText=(result.output || []).flatMap((item: {content?: {type:string;text?:string}[]}) => (item.content || []).filter(c => c.type === 'output_text').map(c => c.text || '')).join('\n');
    const structured=JSON.parse(outputText) as {selectedEvidence:{reference:string;reason:string}[];inquirySummary:string;sections:DraftSection[]};
    const approvedInput=JSON.parse(JSON.parse(outboundPayload).input) as {candidateEvidence:Evidence[];sanitizedComplaint?:Summary};
    const evidenceMap=new Map(approvedInput.candidateEvidence.map(item=>[item.reference,item]));
    if(!evidenceMap.size)throw new Error('OUTPUT_REVIEW_FAILED');
    const validSelected=Array.isArray(structured.selectedEvidence)?structured.selectedEvidence.filter(item=>item&&evidenceMap.has(String(item.reference||''))).map(item=>({reference:String(item.reference),reason:String(item.reason||'답변 근거로 사용')})):[];
    let inquirySummary=String(structured.inquirySummary||'').trim();
    let sections=Array.isArray(structured.sections)?structured.sections.map(section=>({heading:String(section?.heading||'').trim(),answer:String(section?.answer||'').trim()})):[];
    if(!inquirySummary)inquirySummary=String(approvedInput.sanitizedComplaint?.purpose||'민원에서 제시한 사항').trim();
    sections=sections.filter(section=>section.heading&&section.answer);
    if(!inquirySummary||!sections.length)throw new Error('OUTPUT_REVIEW_FAILED');
    const citedValid=[...new Set(sections.flatMap(section=>[...section.answer.matchAll(/\[(E\d+)\]/g)].map(match=>match[1])).filter(reference=>evidenceMap.has(reference)))];
    const preferredReference=validSelected[0]?.reference||citedValid[0]||approvedInput.candidateEvidence.find(item=>item.documentType==='law')?.reference||approvedInput.candidateEvidence[0].reference;
    sections=sections.map(section=>{
      const repaired=section.answer.replace(/\[(E\d+)\]/g,(match,reference)=>evidenceMap.has(reference)?match:'');
      return{...section,answer:/\[E\d+\]/.test(repaired)?repaired:`${repaired.trim()} [${preferredReference}]`};
    });
    const usedReferences=[...new Set(sections.flatMap(section=>[...section.answer.matchAll(/\[(E\d+)\]/g)].map(match=>match[1])))];
    const selectedByReference=new Map(validSelected.map(item=>[item.reference,item]));
    for(const reference of usedReferences)if(!selectedByReference.has(reference))selectedByReference.set(reference,{reference,reason:'답변 본문에서 인용된 근거'});
    if(!selectedByReference.size)selectedByReference.set(preferredReference,{reference:preferredReference,reason:'질문과 가장 관련성이 높은 검증 근거'});
    const initialGeneratedText=[inquirySummary,...sections.flatMap(section=>[section.heading,section.answer])].join('\n');
    const suspect=detectResidualSensitiveInfo(initialGeneratedText);
    const sanitizeGenerated=(value:string)=>{
      let safe=value;
      for(const finding of detectResidualSensitiveInfo(safe).sort((a,b)=>b.value.length-a.value.length))safe=safe.split(finding.value).join('[추가 검토 필요]');
      return safe;
    };
    inquirySummary=sanitizeGenerated(inquirySummary);
    sections=sections.map(section=>({heading:sanitizeGenerated(section.heading),answer:sanitizeGenerated(section.answer)}));
    if(detectResidualSensitiveInfo([inquirySummary,...sections.flatMap(section=>[section.heading,section.answer])].join('\n')).length)throw new Error('OUTPUT_REVIEW_FAILED');
    const allowed = new Set(selectedByReference.keys());
    const generatedForCitation=[inquirySummary,...sections.flatMap(section=>[section.heading,section.answer])].join('\n');
    if ([...generatedForCitation.matchAll(/\[(E\d+)\]/g)].some(m=>!allowed.has(m[1]))) throw new Error('OUTPUT_REVIEW_FAILED');
    const citedArticles=[...generatedForCitation.matchAll(/제\s*\d+조(?:의\s*\d+)?/g)].map(match=>match[0].replace(/\s+/g,''));
    const evidenceText=approvedInput.candidateEvidence.filter(item=>allowed.has(item.reference)).map(item=>item.excerpt.replace(/\s+/g,'')).join('\n');
    const unsupportedArticles=[...new Set(citedArticles.filter(article=>!evidenceText.includes(article)))];
    const qualityChecks={format_valid:true,evidence_per_section:true,citation_scope_valid:true,legal_articles_verified:unsupportedArticles.length===0,unsupported_articles:unsupportedArticles,privacy_reviewed:true,requires_human_review:true};
    const setting=await formatSetting(String(approved.department||profile.department));
    let draft=formatComplaintAnswer({applicationNumber:String(approved.applicationNumber||''),inquirySummary,sections,department:String(approved.department||profile.department),userName:profile.full_name,position:profile.position,officePhone:profile.office_phone,organizationName:setting.organization_name,closingMessage:setting.closing_message,maxSections:setting.max_sections});
    if(suspect.length) draft+='\n\n※ 식별정보로 의심되는 표현을 [추가 검토 필요]로 치환했습니다. 문맥을 확인해 주세요.';
    const selectedEvidence=[...selectedByReference.values()].map(item=>{const evidence=evidenceMap.get(item.reference)!;return{...item,title:evidence.title,documentType:evidence.documentType,recordId:evidence.recordId};});
    return NextResponse.json({ draft, selectedEvidence, qualityChecks }, { headers });
  } catch (error) {
    const code = error instanceof Error ? error.message : '';
    const messages: Record<string,string> = { INVALID_INPUT:'요청 형식이 올바르지 않습니다. 화면을 새로고침한 뒤 다시 시도해 주세요.', REQUEST_TOO_LARGE:'선택된 근거가 너무 많아 안전한 크기로 처리하지 못했습니다. 근거를 줄여 다시 시도해 주세요.', PRIVACY_REVIEW_REQUIRED:'비식별 요약에 식별정보로 의심되는 내용이 있어 전송을 차단했습니다. 민원 내용을 확인해 주세요.', NO_VERIFIED_EVIDENCE:'개인정보 재검사를 통과한 관련 근거를 찾지 못했습니다.', REVIEW_EXPIRED:'전송자료 확인 시간이 만료되었습니다. 근거를 다시 확인해 주세요.', NOT_CONFIGURED:'AI 설정이 준비되지 않았습니다.', OUTPUT_REVIEW_FAILED:'생성 결과 검증을 통과하지 못했습니다. 담당자 검토가 필요합니다.', GENERATION_FAILED:'초안 생성에 실패했습니다. 원문은 전송되지 않았습니다.' };
    return NextResponse.json({ error: messages[code] || '요청 검증에 실패하여 처리를 중단했습니다.' }, { status: code === 'AUTH_REQUIRED' ? 401 : 400, headers });
  }
}
