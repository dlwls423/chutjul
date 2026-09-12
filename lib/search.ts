type SearchDocument = {
  id: string;
  title: string;
  document_type: string;
  department: string | null;
  category_major: string | null;
  category_middle: string | null;
  category_minor: string | null;
  question_original: string | null;
  answer_original: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};
type SearchChunk = { document_id: string; content: string; metadata: Record<string, unknown> | null };
type ScopedSource = { id: string };
import { searchCurrentLaws } from "./legal-search";
export type KeywordSearchResult = { id: string; title: string; documentType: string; department: string | null; category: string; createdAt: string; snippet: string; question: string; answer: string; content: string; score: number; matchedTerms: string[]; legalReferences: string[]; complaintMetadata: Record<string, unknown>; guideMatches: { pageNumber: number | null; snippet: string }[] };
type CachedSearch={expires:number;value:KeywordSearchResult[]};
const searchCache=new Map<string,CachedSearch>();

function config() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_NOT_CONFIGURED");
  return { url: url.replace(/\/$/, ""), key };
}
async function request<T>(path: string) {
  const { url, key } = config();
  const response = await fetch(`${url}${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`SUPABASE_${response.status}: ${await response.text()}`);
  return (await response.json()) as T;
}
function normalized(value: string) { return value.normalize("NFKC").toLocaleLowerCase("ko-KR").replace(/\s+/g, " ").trim(); }
function filterTerms(terms: string[]) { return terms.map((term) => term.replace(/[,()*%._]/g, "").trim()).filter(Boolean).slice(0, 10); }
function textMatchFilter(terms: string[], columns: string[]) { const clauses = filterTerms(terms).flatMap((term) => columns.map((column) => `${column}.ilike.*${term}*`)); return clauses.length ? `&or=${encodeURIComponent(`(${clauses.join(",")})`)}` : ""; }
function occurrences(text: string, term: string) { let count = 0; let at = 0; while ((at = text.indexOf(term, at)) >= 0) { count += 1; at += Math.max(1, term.length); } return count; }
function snippet(source: string, terms: string[]) {
  const clean = source.replace(/\s+/g, " ").trim();
  const lower = normalized(clean);
  let index = -1;
  for (const term of terms) { const found = lower.indexOf(term); if (found >= 0 && (index < 0 || found < index)) index = found; }
  if (index < 0) return clean.slice(0, 260);
  const start = Math.max(0, index - 80);
  const end = Math.min(clean.length, index + 220);
  return `${start ? "…" : ""}${clean.slice(start, end)}${end < clean.length ? "…" : ""}`;
}

export async function keywordSearch(department: string, rawQuery: string) {
  const query = rawQuery.normalize("NFKC").replace(/\s+/g, " ").trim().slice(0, 100);
  const terms = [...new Set(normalized(query).split(" ").filter(Boolean))];
  if (!terms.length) return [];
  const cacheKey=`${department}\u0000${normalized(query)}`;
  const cached=searchCache.get(cacheKey);
  if(cached&&cached.expires>Date.now())return cached.value;
  // rag_documents.department is the complaint's processing department. Access
  // scope belongs to source_files.owning_department, so resolve source IDs first.
  const [sources, legalResults] = await Promise.all([
    request<ScopedSource[]>(`/rest/v1/source_files?owning_department=eq.${encodeURIComponent(department)}&select=id&limit=1000`),
    searchCurrentLaws(rawQuery, department),
  ]);
  if (!sources.length) return legalResults;
  const sourceBatches=Array.from({length:Math.ceil(sources.length/40)},(_,index)=>sources.slice(index*40,index*40+40));
  const docs=(await Promise.all(sourceBatches.map((batch)=>{const ids=batch.map(source=>source.id).join(",");return request<SearchDocument[]>(`/rest/v1/rag_documents?source_file_id=in.(${ids})&status=eq.ready&select=id,title,document_type,department,category_major,category_middle,category_minor,question_original,answer_original,metadata,created_at&order=created_at.desc&limit=500`);}))).flat();
  const documentBatches=Array.from({length:Math.ceil(docs.length/40)},(_,index)=>docs.slice(index*40,index*40+40));
  const chunks=(await Promise.all(documentBatches.map((batch)=>{const ids=batch.map(doc=>doc.id).join(",");return request<SearchChunk[]>(`/rest/v1/rag_chunks?document_id=in.(${ids})${textMatchFilter(terms,["content"])}&select=document_id,content,metadata&limit=1000`);}))).flat();
  const byDocument = new Map<string, SearchChunk[]>();
  for (const chunk of chunks) byDocument.set(chunk.document_id, [...(byDocument.get(chunk.document_id) || []), chunk]);
  const documentResults = docs.map((doc): KeywordSearchResult | null => {
    const docChunks = byDocument.get(doc.id) || [];
    const complaintMeta = doc.metadata?.complaint as Record<string, unknown> | undefined;
    const searchMeta = doc.metadata?.search as Record<string, unknown> | undefined;
    const metadataFields = [searchMeta?.summary, complaintMeta?.summary, complaintMeta?.application_number, complaintMeta?.receipt_number].filter((value): value is string => typeof value === "string");
    const fields = [doc.title, ...metadataFields, doc.question_original || "", doc.answer_original || "", ...docChunks.map((chunk) => chunk.content)];
    const haystack = normalized(fields.join("\n"));
    const matchedTerms = terms.filter((term) => haystack.includes(term));
    if (!matchedTerms.length) return null;
    const title = normalized(doc.title);
    const question = normalized(doc.question_original || "");
    const phrase = normalized(query);
    let score = matchedTerms.reduce((sum, term) => sum + occurrences(haystack, term), 0);
    score += Math.round((matchedTerms.length / terms.length) * 40);
    if (title.includes(phrase)) score += 100;
    else if (question.includes(phrase)) score += 60;
    else if (haystack.includes(phrase)) score += 35;
    score += matchedTerms.filter((term) => title.includes(term)).length * 15;
    const best = fields.find((field) => matchedTerms.some((term) => normalized(field).includes(term))) || doc.title;
    const legal = [...new Set(docChunks.flatMap((chunk) => Array.isArray(chunk.metadata?.legal_references) ? chunk.metadata.legal_references.map(String) : []))].slice(0, 8);
    const guideMatches = doc.document_type === "guide" ? docChunks.filter((chunk) => matchedTerms.some((term) => normalized(chunk.content).includes(term))).slice(0, 12).map((chunk) => ({ pageNumber: Number(chunk.metadata?.page_number) || null, snippet: snippet(chunk.content, matchedTerms) })) : [];
    const compactContent=doc.document_type==="complaint"?[doc.question_original,doc.answer_original].filter(Boolean).join("\n\n").slice(0,12000):"";
    return { id: doc.id, title: doc.title, documentType: doc.document_type, department: doc.department, category: [doc.category_major, doc.category_middle, doc.category_minor].filter(Boolean).join(" › "), createdAt: doc.created_at, snippet: snippet(best, matchedTerms), question: doc.question_original || "", answer: doc.answer_original || "", content: compactContent, score, matchedTerms, legalReferences: legal, complaintMetadata: complaintMeta || {}, guideMatches };
  }).filter((item): item is KeywordSearchResult => item !== null);
  const result=[...legalResults,...documentResults].sort((a, b) => b.score - a.score || b.createdAt.localeCompare(a.createdAt)).slice(0, 100);
  searchCache.set(cacheKey,{expires:Date.now()+60_000,value:result});
  if(searchCache.size>100){const first=searchCache.keys().next().value;if(first)searchCache.delete(first);}
  return result;
}
