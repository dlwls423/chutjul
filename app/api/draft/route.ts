import { NextResponse } from 'next/server';
import { requireProfile } from '../../../lib/auth';
import { searchCurrentLaws } from '../../../lib/legal-search';
import { CONCEPTS, DRAFT_INSTRUCTIONS, ISSUE_IDS, validateConcepts } from '../../../lib/draft-policy';
import { detectResidualSensitiveInfo } from '../../../lib/privacy-check';
export const runtime = 'edge';
const encoder = new TextEncoder();
const headers = { 'Cache-Control': 'no-store, private' };
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
    if (rawBody.length > 80000) throw new Error('INVALID_INPUT');
    const body = JSON.parse(rawBody);
    if (body.action === 'prepare') {
      if (Object.keys(body).some(k => !['action', 'ids'].includes(k))) throw new Error('INVALID_INPUT');
      const ids = validateConcepts(body.ids);
      const query = ids.filter(id => ISSUE_IDS.includes(id)).map(id => CONCEPTS[id]).join(' ');
      const found = await searchCurrentLaws(query, profile.department);
      const laws = found.filter(l => l.complaintMetadata.effective_from && String(l.complaintMetadata.effective_from) <= new Date().toISOString().slice(0,10))
        .filter(l => !detectResidualSensitiveInfo(l.content).length).slice(0, 5);
      if (!laws.length) throw new Error('NO_VERIFIED_LAWS');
      const evidence = laws.map((l, i) => ({ reference: `L${i+1}`, title: l.title, effectiveFrom: l.complaintMetadata.effective_from, source: l.complaintMetadata.source_url, excerpt: l.content.slice(0, 5000) }));
      const input = JSON.stringify({ factsAndIssues: ids.map(id => CONCEPTS[id]), evidence, caution: '구체적인 민원 사실관계는 외부에 전송되지 않았으므로 담당자가 최종 확인해야 함' }, null, 2);
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
    // This is the sole outbound path. Body is exactly the server-signed preview.
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
    const messages: Record<string,string> = { ISSUE_REQUIRED:'法的 쟁점을 하나 이상 선택해 주세요.'.replace('法的','법적'), NO_VERIFIED_LAWS:'검토 가능한 현행 법령을 찾지 못해 외부 전송을 중단했습니다.', REVIEW_EXPIRED:'전송자료 확인 시간이 만료되었습니다. 근거를 다시 확인해 주세요.', NOT_CONFIGURED:'AI 설정이 준비되지 않았습니다.', OUTPUT_REVIEW_FAILED:'생성 결과 검증을 통과하지 못했습니다. 담당자 검토가 필요합니다.', GENERATION_FAILED:'초안 생성에 실패했습니다. 원문은 전송되지 않았습니다.' };
    return NextResponse.json({ error: messages[code] || '요청 검증에 실패하여 처리를 중단했습니다.' }, { status: code === 'AUTH_REQUIRED' ? 401 : 400, headers });
  }
}
