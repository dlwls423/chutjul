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
  content_masked: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};
type SearchChunk = { document_id: string; content: string; metadata: Record<string, unknown> | null };
export type KeywordSearchResult = { id: string; title: string; documentType: string; department: string | null; category: string; createdAt: string; snippet: string; question: string; answer: string; content: string; score: number; matchedTerms: string[]; legalReferences: string[] };

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
  const docs = await request<SearchDocument[]>(`/rest/v1/rag_documents?department=eq.${encodeURIComponent(department)}&status=eq.ready&select=id,title,document_type,department,category_major,category_middle,category_minor,question_original,answer_original,content_masked,metadata,created_at&order=created_at.desc&limit=500`);
  const chunks: SearchChunk[] = [];
  for (let offset = 0; offset < docs.length; offset += 40) {
    const ids = docs.slice(offset, offset + 40).map((doc) => doc.id).join(",");
    if (ids) chunks.push(...await request<SearchChunk[]>(`/rest/v1/rag_chunks?document_id=in.(${ids})&select=document_id,content,metadata&limit=5000`));
  }
  const byDocument = new Map<string, SearchChunk[]>();
  for (const chunk of chunks) byDocument.set(chunk.document_id, [...(byDocument.get(chunk.document_id) || []), chunk]);
  return docs.map((doc): KeywordSearchResult | null => {
    const docChunks = byDocument.get(doc.id) || [];
    const fields = [doc.title, doc.question_original || "", doc.answer_original || "", doc.content_masked || "", ...docChunks.map((chunk) => chunk.content)];
    const haystack = normalized(fields.join("\n"));
    if (!terms.every((term) => haystack.includes(term))) return null;
    const title = normalized(doc.title);
    const question = normalized(doc.question_original || "");
    const phrase = normalized(query);
    let score = terms.reduce((sum, term) => sum + occurrences(haystack, term), 0);
    if (title.includes(phrase)) score += 100;
    else if (question.includes(phrase)) score += 60;
    else if (haystack.includes(phrase)) score += 35;
    score += terms.filter((term) => title.includes(term)).length * 15;
    const best = fields.find((field) => terms.some((term) => normalized(field).includes(term))) || doc.title;
    const legal = [...new Set(docChunks.flatMap((chunk) => Array.isArray(chunk.metadata?.legal_references) ? chunk.metadata.legal_references.map(String) : []))].slice(0, 8);
    return { id: doc.id, title: doc.title, documentType: doc.document_type, department: doc.department, category: [doc.category_major, doc.category_middle, doc.category_minor].filter(Boolean).join(" › "), createdAt: doc.created_at, snippet: snippet(best, terms), question: doc.question_original || "", answer: doc.answer_original || "", content: (doc.content_masked || "").slice(0, 12000), score, matchedTerms: terms, legalReferences: legal };
  }).filter((item): item is KeywordSearchResult => item !== null).sort((a, b) => b.score - a.score || b.createdAt.localeCompare(a.createdAt)).slice(0, 100);
}
