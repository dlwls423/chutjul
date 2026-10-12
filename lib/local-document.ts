'use client';
import { maskSensitiveText, type BrowserPrivacyPayload } from './browser-privacy';
import { detectResidualSensitiveInfo } from './privacy-check';
import { cleanExtractedText, parseEpeopleComplaint } from './epeople-parser';
import { editableTextToSummary, summaryText } from './local-draft';
import { validateLocalDocument, validatePreparedDocument, type LocalDocument, type PreparedDocument } from './prepared-document';

export function localParserEnabled() { return typeof window !== 'undefined' && localStorage.getItem('chutjul-kordoc-enabled') === 'true'; }
export async function readDocumentLocally(file: File): Promise<LocalDocument> {
  if (file.size > 30 * 1024 * 1024) throw new Error('로컬 문서는 최대 30MB까지 읽을 수 있습니다.');
  const base = 'http://127.0.0.1:43127';
  let health: {extensions:string[];token:string};
  try {
    const response = await fetch(`${base}/health`, { cache:'no-store', signal:AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error('LOCAL');
    health = await response.json() as {extensions:string[];token:string};
  } catch { throw new Error('PC의 kordoc 로컬 도우미를 실행하고 이 사이트의 연결 허용을 확인해 주세요.'); }
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  if (!health.extensions?.includes(ext)) throw new Error('지원하지 않는 문서 형식입니다.');
  const response = await fetch(`${base}/parse`, { method:'POST', headers:{'Content-Type':'application/octet-stream','X-Chutjul-Token':health.token,'X-Document-Extension':ext}, body:file, signal:AbortSignal.timeout(130000) });
  const result = await response.json() as {error?:string};
  if (!response.ok) throw new Error(result.error || '문서를 읽지 못했습니다.');
  return validateLocalDocument(result);
}
function safe(text:string) {
  let value = maskSensitiveText(text).value;
  for (const finding of detectResidualSensitiveInfo(value)) value = value.split(finding.value).join(`[${finding.type}]`);
  if (detectResidualSensitiveInfo(value).length) throw new Error('LOCAL_PRIVACY_FAILED');
  return value;
}
const hash = async (bytes: ArrayBuffer) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)), b=>b.toString(16).padStart(2,'0')).join('');

export async function prepareLocalDocument(file:File, kind:'complaint'|'guide', parsed:LocalDocument) {
  const originalHash = await hash(await file.arrayBuffer());
  let source = parseEpeopleComplaint(cleanExtractedText(parsed.markdown.replace(/[|]/g,' ')), file.name);
  if (kind === 'complaint' && (!source?.question || !source.answer)) throw new Error('민원 질의와 답변을 분리하지 못했습니다. 새 민원 분석에서 본문을 확인하거나 질의·답변 자료를 직접 등록해 주세요.');
  const record: Record<string,string> = {
    title:safe(source?.title || file.name.replace(/\.[^.]+$/,'')), document_type:kind,
    question:kind === 'complaint' ? safe(source!.question) : '',
    answer:kind === 'complaint' ? safe(source!.answer) : '',
    content:kind === 'guide' ? safe(parsed.markdown) : '',
    parser:parsed.parser, source_format:parsed.format, page_mode:parsed.pageMode,
    parser_warnings:JSON.stringify(parsed.warnings),
    category_major: kind === 'guide' ? '안내서·참고자료' : '민원',
    guide_pages:JSON.stringify(parsed.pages.length ? Array.from({length:Math.max(...parsed.pages.map(p=>p.pageNumber))},(_,i)=>safe(parsed.pages.find(p=>p.pageNumber===i+1)?.markdown || '')) : [safe(parsed.markdown)]),
    guide_toc:JSON.stringify(parsed.chunks.filter(c=>c.type==='heading').map(c=>safe(c.text))),
    kordoc_chunks:JSON.stringify(parsed.chunks.map(c=>({type:c.type,text:safe(c.text),breadcrumb:c.breadcrumb.map(safe),...(c.page?{page:c.page}:{})}))),
  };
  // Complaint search uses only its two-track question/answer, not full source chunks.
  if (kind === 'complaint') { record.guide_pages='[]'; record.guide_toc='[]'; record.kordoc_chunks='[]'; }
  const envelope:PreparedDocument = {version:1,kind,record};
  validatePreparedDocument(envelope);
  const uploadFile = new File([JSON.stringify(envelope)], `자료-${originalHash.slice(0,16)}.chutjul.json`, {type:'application/json'});
  let privacy:BrowserPrivacyPayload | undefined;
  if (kind === 'complaint') {
    const structured = editableTextToSummary(record.question);
    privacy = {sourceHash:await hash(await uploadFile.arrayBuffer()), originalHash, questionLength:source!.question.length, answerLength:source!.answer.length, maskedQuestion:record.question, outboundText:safe(summaryText(structured)),outboundSafe:true, piiSummary:maskSensitiveText(source!.question).counts, structuredComplaint:structured,localModel:parsed.parser,schemaVersion:11,maskedRecord:record};
  }
  return {uploadFile,privacy};
}
