import { detectResidualSensitiveInfo } from './privacy-check';

export type LocalDocument = {
  version: 1; parser: string; format: string; markdown: string; pageMode: string;
  pages: { pageNumber: number; markdown: string }[];
  chunks: { type: string; text: string; breadcrumb: string[]; page?: number }[];
  warnings: { code: string; page?: number }[];
};
export type PreparedDocument = { version: 1; kind: 'complaint' | 'guide'; record: Record<string,string> };
export const DOCUMENT_ACCEPT = '.pdf,.hwp,.hwpx,.hml,.docx,.pptx,.xls,.xlsx,.png,.jpg,.jpeg,.webp';

export function validateLocalDocument(input: unknown): LocalDocument {
  const d = input as LocalDocument;
  if (!d || d.version !== 1 || d.parser !== 'kordoc@4.21.25' || typeof d.markdown !== 'string' || !d.markdown.trim() || d.markdown.length > 600000 || !Array.isArray(d.pages) || !Array.isArray(d.chunks) || !Array.isArray(d.warnings)) throw new Error('LOCAL_DOCUMENT_INVALID');
  if (d.pages.length > 2000 || d.chunks.length > 10000 || d.pages.some(p => !Number.isInteger(p.pageNumber) || p.pageNumber < 1 || p.pageNumber > 2000 || typeof p.markdown !== 'string') || d.chunks.some(c => typeof c.text !== 'string' || !Array.isArray(c.breadcrumb) || c.breadcrumb.some(b => typeof b !== 'string'))) throw new Error('LOCAL_DOCUMENT_INVALID');
  return d;
}

// Server validation happens before creating a job or storing the uploaded copy.
// Prepared JSON is a protocol, not a generic JSON upload escape hatch.
export function validatePreparedDocument(input: unknown): PreparedDocument {
  const d = input as PreparedDocument;
  if (!d || d.version !== 1 || !['complaint','guide'].includes(d.kind) || !d.record || Array.isArray(d.record)) throw new Error('PREPARED_DOCUMENT_INVALID');
  const keys = new Set(['title','question','answer','content','document_type','guide_pages','guide_toc','kordoc_chunks','parser','source_format','page_mode','category_major','parser_warnings']);
  for (const [key, value] of Object.entries(d.record)) {
    if (!keys.has(key) || typeof value !== 'string' || value.length > 2000000) throw new Error('PREPARED_DOCUMENT_INVALID');
    if (detectResidualSensitiveInfo(value).length) throw new Error('PREPARED_DOCUMENT_PRIVACY_REQUIRED');
  }
  if (d.record.document_type !== d.kind || d.record.parser !== 'kordoc@4.21.25') throw new Error('PREPARED_DOCUMENT_INVALID');
  if (d.kind === 'complaint' && (!d.record.question || !d.record.answer)) throw new Error('COMPLAINT_SECTION_EXTRACTION_FAILED');
  if (d.kind === 'guide' && !d.record.content?.trim()) throw new Error('NO_SEARCHABLE_TEXT');
  for (const key of ['guide_pages','guide_toc','kordoc_chunks']) {
    const list = JSON.parse(d.record[key] || '[]');
    if (!Array.isArray(list)) throw new Error('PREPARED_DOCUMENT_INVALID');
    if (key !== 'kordoc_chunks' && list.some(v => typeof v !== 'string')) throw new Error('PREPARED_DOCUMENT_INVALID');
    if (key === 'kordoc_chunks' && list.some(c => !c || typeof c.text !== 'string' || !Array.isArray(c.breadcrumb) || c.breadcrumb.some((b:unknown) => typeof b !== 'string') || (c.page !== undefined && (!Number.isInteger(c.page) || c.page < 1 || c.page > 2000)))) throw new Error('PREPARED_DOCUMENT_INVALID');
  }
  return d;
}
