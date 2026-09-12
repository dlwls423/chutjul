import { NextResponse } from 'next/server';
import { requireProfile } from '../../../lib/auth';
import { searchCurrentLaws } from '../../../lib/legal-search';
import { DRAFT_INSTRUCTIONS } from '../../../lib/draft-policy';
import { detectResidualSensitiveInfo } from '../../../lib/privacy-check';
export const runtime = 'edge';
const encoder = new TextEncoder();
const headers = { 'Cache-Control': 'no-store, private' };
type Summary = { purpose:string; essentialFacts:string[]; legalQuestions:string[]; requestedAnswer:string[]; uncertainties:string[] };
const allowedSummaryKeys = ['purpose','essentialFacts','legalQuestions','requestedAnswer','uncertainties'];
const externalIdentifiers = /\b[12]AA-\d{4}-\d{6,}\b|https?:\/\/\S+|\b\d{4}-\d{1,2}-\d{1,2}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?\b/i;
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
      if (Object.keys(body).some(k => !['action', 'summary'].includes(k))) throw new Error('INVALID_INPUT');
      const summary = validateSummary(body.summary);
      const query = [...summary.legalQuestions,...summary.requestedAnswer].join(' ');
      const found = await searchCurrentLaws(query, profile.department);
      const laws = found.filter(l => l.complaintMetadata.effective_from && String(l.complaintMetadata.effective_from) <= new Date().toISOString().slice(0,10))
        .filter(l => !detectResidualSensitiveInfo(l.content).length).slice(0, 5);
      if (!laws.length) throw new Error('NO_VERIFIED_LAWS');
      const evidence = laws.map((l, i) => ({ reference: `L${i+1}`, title: l.title, effectiveFrom: l.complaintMetadata.effective_from, source: l.complaintMetadata.source_url, excerpt: l.content.slice(0, 5000) }));
      const input = JSON.stringify({ sanitizedComplaint:summary, evidence, caution:'민원 원문은 외부에 전송되지 않았으며, 비식별 요약과 공개 법령만 제공됨. 구체적인 사실관계는 담당자가 최종 확인해야 함' }, null, 2);
      const payload = JSON.stringify({ model: process.env.OPENAI_DRAFT_MODEL || 'gpt-4.1-mini', store: false, instructions: DRAFT_INSTRUCTIONS, input, max_output_tokens: 2400 });
      const envelope = JSON.stringify({ user: profile.id, department: profile.department, expires: Date.now()+10*60*1000, nonce: crypto.randomUUID(), payload });
      return NextResponse.json({ envelope, signature: await sign(envelope), payload: JSON.parse(payload), evidence }, { headers });
    }
    if (body.action !== 'generate' || body.confirmed !== true || Object.keys(body).some(k => !['action','confirmed','envelope','signature'].includes(k))) throw new Error('INVALID_INPUT');
    if (typeof body.envelope !== 'string' || !/^[a-f0-9]{64}$/.test(body.signature || '')) throw new Error('INVALID_INPUT');
    const signature = new Uint8Array(body.signature.match(/../g).map((v: string) => parseInt(v,16)));
    if (!await crypto.subtle.verify('HMAC', await key(), signature, encoder.encode(body.envelope))) throw new Error('INVALID_INPUT');
    const approved = JSON.parse(body.envelope);
    if (approved.user !== profile.id || approved.department !== profile.department || approved.expires < Date.now()) throw new Error('REVIEW_EXPIRED');
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('NOT_CONFIGURED');
    const response = await fetch('https://api.openai.com/v1/responses', { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: approved.payload, signal: AbortSignal.timeout(60000) });
    if (!response.ok) throw new Error('GENERATION_FAILED');
    const result = await response.json();
    let draft = (result.output || []).flatMap((item: {content?: {type:string;text?:string}[]}) => (item.content || []).filter(c => c.type === 'output_text').map(c => c.text || '')).join('\n');
    const suspect = detectResidualSensitiveInfo(draft);
    for (const finding of suspect.sort((a,b)=>b.value.length-a.value.length)) draft=draft.split(finding.value).join('[추가 검토 필요]');
    if (!draft || detectResidualSensitiveInfo(draft).length) throw new Error('OUTPUT_REVIEW_FAILED');
    const allowed = new Set(JSON.parse(JSON.parse(approved.payload).input).evidence.map((e: {reference:string})=>e.reference));
    if ([...draft.matchAll(/\[(L\d+)\]/g)].some(m=>!allowed.has(m[1]))) throw new Error('OUTPUT_REVIEW_FAILED');
    if(suspect.length) draft+='\n\n※ 식별정보로 의심되는 표현을 [추가 검토 필요]로 치환했습니다. 문맥을 확인해 주세요.';
    return NextResponse.json({ draft }, { headers });
  } catch (error) {
    const code = error instanceof Error ? error.message : '';
    const messages: Record<string,string> = { PRIVACY_REVIEW_REQUIRED:'비식별 요약에 식별정보로 의심되는 내용이 있어 전송을 차단했습니다. 민원 내용을 확인해 주세요.', NO_VERIFIED_LAWS:'검토 가능한 현행 법령을 찾지 못해 외부 전송을 중단했습니다.', REVIEW_EXPIRED:'전송자료 확인 시간이 만료되었습니다. 근거를 다시 확인해 주세요.', NOT_CONFIGURED:'AI 설정이 준비되지 않았습니다.', OUTPUT_REVIEW_FAILED:'생성 결과 검증을 통과하지 못했습니다. 담당자 검토가 필요합니다.', GENERATION_FAILED:'초안 생성에 실패했습니다. 원문은 전송되지 않았습니다.' };
    return NextResponse.json({ error: messages[code] || '요청 검증에 실패하여 처리를 중단했습니다.' }, { status: code === 'AUTH_REQUIRED' ? 401 : 400, headers });
  }
}
