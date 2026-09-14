import { NextResponse } from 'next/server';
import { requireProfile } from '../../../lib/auth';
import { keywordSearch, type KeywordSearchResult } from '../../../lib/search';
import { DRAFT_INSTRUCTIONS } from '../../../lib/draft-policy';
import { detectResidualSensitiveInfo } from '../../../lib/privacy-check';
import { maskBusinessIdentifiers, repairKnownOvermasking } from '../../../lib/business-identifiers';
export const runtime = 'edge';
const encoder = new TextEncoder();
const headers = { 'Cache-Control': 'no-store, private' };
type Summary = { purpose:string; essentialFacts:string[]; legalQuestions:string[]; requestedAnswer:string[]; uncertainties:string[] };
const allowedSummaryKeys = ['purpose','essentialFacts','legalQuestions','requestedAnswer','uncertainties'];
const externalIdentifiers = /\b[12]AA-\d{4}-\d{6,}\b|https?:\/\/\S+|\b\d{4}-\d{1,2}-\d{1,2}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?\b/i;
type Evidence={reference:string;recordId:string;documentType:string;title:string;source:string;excerpt:string;score:number};
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
function safeEvidence(item:KeywordSearchResult,index:number):Evidence|null{
  const source=item.documentType==='complaint'?[item.question,item.answer].filter(Boolean).join('\n\n'):
    item.documentType==='guide'?(item.guideMatches.map(match=>match.snippet).join('\n')||item.snippet):item.content;
  let excerpt=maskBusinessIdentifiers(repairKnownOvermasking(String(source||item.snippet||''))).replace(/\u0000/g,'').slice(0,item.documentType==='law'?5000:3200);
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
    if (rawBody.length > 30000) throw new Error('INVALID_INPUT');
    const body = JSON.parse(rawBody);
    if (body.action === 'prepare') {
      if (body.confirmed !== true || Object.keys(body).some(k => !['action', 'summary', 'confirmed'].includes(k))) throw new Error('INVALID_INPUT');
      const summary = validateSummary(body.summary);
      const query = [summary.purpose,...summary.legalQuestions,...summary.requestedAnswer].join(' ').slice(0,500);
      const found=await keywordSearch(profile.department,query);
      const chosenCandidates=['complaint','law','guide'].flatMap(type=>found.filter(item=>item.documentType===type).slice(0,type==='law'?5:4));
      const evidence=chosenCandidates.map(safeEvidence).filter((item):item is Evidence=>Boolean(item)).map((item,index)=>({...item,reference:`E${index+1}`}));
      if (!evidence.length) throw new Error('NO_VERIFIED_EVIDENCE');
      const allowedReferences=evidence.map(item=>item.reference);
      const input = JSON.stringify({ sanitizedComplaint:summary, candidateEvidence:evidence, caution:'민원 원문은 외부에 전송되지 않았으며, 사용자가 승인한 비식별 요약과 개인정보 재검사를 통과한 후보 근거만 제공됨. 구체적인 사실관계는 담당자가 최종 확인해야 함' }, null, 2);
      const outputSchema={type:'object',additionalProperties:false,properties:{selectedEvidence:{type:'array',maxItems:8,items:{type:'object',additionalProperties:false,properties:{reference:{type:'string',enum:allowedReferences},reason:{type:'string'}},required:['reference','reason']}},draft:{type:'string'}},required:['selectedEvidence','draft']};
      const payload = JSON.stringify({ model: process.env.OPENAI_DRAFT_MODEL || 'gpt-4.1-mini', store: false, instructions: DRAFT_INSTRUCTIONS, input, text:{format:{type:'json_schema',name:'complaint_draft_with_evidence',strict:true,schema:outputSchema}}, max_output_tokens: 3000 });
      const envelope = JSON.stringify({ user: profile.id, department: profile.department, expires: Date.now()+10*60*1000, nonce: crypto.randomUUID(), payload });
      const approvedCandidateIds=new Set(evidence.map(item=>item.recordId));
      return NextResponse.json({ envelope, signature: await sign(envelope), payload: JSON.parse(payload), evidence, candidates:chosenCandidates.filter(item=>approvedCandidateIds.has(item.id)) }, { headers });
    }
    if (body.action !== 'generate' || body.confirmed !== true || Object.keys(body).some(k => !['action','confirmed','envelope','signature','selectedReferences'].includes(k))) throw new Error('INVALID_INPUT');
    if (typeof body.envelope !== 'string' || !/^[a-f0-9]{64}$/.test(body.signature || '')) throw new Error('INVALID_INPUT');
    const signature = new Uint8Array(body.signature.match(/../g).map((v: string) => parseInt(v,16)));
    if (!await crypto.subtle.verify('HMAC', await key(), signature, encoder.encode(body.envelope))) throw new Error('INVALID_INPUT');
    const approved = JSON.parse(body.envelope);
    if (approved.user !== profile.id || approved.department !== profile.department || approved.expires < Date.now()) throw new Error('REVIEW_EXPIRED');
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
    const structured=JSON.parse(outputText) as {selectedEvidence:{reference:string;reason:string}[];draft:string};
    const approvedInput=JSON.parse(JSON.parse(outboundPayload).input) as {candidateEvidence:Evidence[]};
    const evidenceMap=new Map(approvedInput.candidateEvidence.map(item=>[item.reference,item]));
    if(!Array.isArray(structured.selectedEvidence)||!structured.selectedEvidence.length||structured.selectedEvidence.some(item=>!evidenceMap.has(item.reference)))throw new Error('OUTPUT_REVIEW_FAILED');
    let draft = String(structured.draft||'');
    const suspect = detectResidualSensitiveInfo(draft);
    for (const finding of suspect.sort((a,b)=>b.value.length-a.value.length)) draft=draft.split(finding.value).join('[추가 검토 필요]');
    if (!draft || detectResidualSensitiveInfo(draft).length) throw new Error('OUTPUT_REVIEW_FAILED');
    const allowed = new Set(structured.selectedEvidence.map(item=>item.reference));
    if ([...draft.matchAll(/\[(E\d+)\]/g)].some(m=>!allowed.has(m[1]))) throw new Error('OUTPUT_REVIEW_FAILED');
    if(suspect.length) draft+='\n\n※ 식별정보로 의심되는 표현을 [추가 검토 필요]로 치환했습니다. 문맥을 확인해 주세요.';
    const selectedEvidence=structured.selectedEvidence.map(item=>{const evidence=evidenceMap.get(item.reference)!;return{...item,title:evidence.title,documentType:evidence.documentType,recordId:evidence.recordId};});
    return NextResponse.json({ draft, selectedEvidence }, { headers });
  } catch (error) {
    const code = error instanceof Error ? error.message : '';
    const messages: Record<string,string> = { PRIVACY_REVIEW_REQUIRED:'비식별 요약에 식별정보로 의심되는 내용이 있어 전송을 차단했습니다. 민원 내용을 확인해 주세요.', NO_VERIFIED_EVIDENCE:'개인정보 재검사를 통과한 관련 근거를 찾지 못했습니다.', REVIEW_EXPIRED:'전송자료 확인 시간이 만료되었습니다. 근거를 다시 확인해 주세요.', NOT_CONFIGURED:'AI 설정이 준비되지 않았습니다.', OUTPUT_REVIEW_FAILED:'생성 결과 검증을 통과하지 못했습니다. 담당자 검토가 필요합니다.', GENERATION_FAILED:'초안 생성에 실패했습니다. 원문은 전송되지 않았습니다.' };
    return NextResponse.json({ error: messages[code] || '요청 검증에 실패하여 처리를 중단했습니다.' }, { status: code === 'AUTH_REQUIRED' ? 401 : 400, headers });
  }
}
