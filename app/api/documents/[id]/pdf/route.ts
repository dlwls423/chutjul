import { NextResponse } from "next/server";
import { extractText } from "unpdf";
import { requireProfile, serviceRequest } from "../../../../../lib/auth";

export const runtime = "edge";
type Doc = { id: string; source_file_id: string; document_type: string };
type Source = { id: string; owning_department: string; storage_bucket: string | null; storage_path: string | null; masked_storage_path: string | null };
function normalized(value: string) { return value.normalize("NFKC").toLocaleLowerCase("ko-KR").replace(/\s+/g, " ").trim(); }
function excerpt(text: string, terms: string[]) { const clean = text.replace(/\s+/g, " ").trim(); const lower = normalized(clean); let at = -1; for (const term of terms) { const found = lower.indexOf(term); if (found >= 0 && (at < 0 || found < at)) at = found; } if (at < 0) return clean.slice(0, 360); const start = Math.max(0, at - 130); const end = Math.min(clean.length, at + 300); return `${start ? "…" : ""}${clean.slice(start, end)}${end < clean.length ? "…" : ""}`; }

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const profile = await requireProfile({ approved: true });
    const { id } = await params;
    const docs = await serviceRequest<Doc[]>(`/rest/v1/rag_documents?id=eq.${encodeURIComponent(id)}&select=id,source_file_id,document_type&limit=1`);
    if (!docs.length || docs[0].document_type !== "guide") return NextResponse.json({ error: "안내서 PDF를 찾을 수 없습니다." }, { status: 404 });
    const files = await serviceRequest<Source[]>(`/rest/v1/source_files?id=eq.${encodeURIComponent(docs[0].source_file_id)}&select=id,owning_department,storage_bucket,storage_path,masked_storage_path&limit=1`);
    const source = files[0];
    if (!source || (profile.role !== "admin" && source.owning_department !== profile.department)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
    const base = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
    const bucket = source.storage_bucket || process.env.SUPABASE_STORAGE_BUCKET || "complaint-originals";
    const path = source.masked_storage_path || source.storage_path;
    if (!base || !key || !path) throw new Error("PDF_STORAGE_NOT_CONFIGURED");
    const encodedPath = path.split("/").map(encodeURIComponent).join("/");
    const headers = { apikey: key, Authorization: `Bearer ${key}` };
    const [download, signed] = await Promise.all([
      fetch(`${base}/storage/v1/object/${encodeURIComponent(bucket)}/${encodedPath}`, { headers, cache: "no-store" }),
      fetch(`${base}/storage/v1/object/sign/${encodeURIComponent(bucket)}/${encodedPath}`, { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ expiresIn: 900 }), cache: "no-store" }),
    ]);
    if (!download.ok) throw new Error(`PDF_DOWNLOAD_${download.status}`);
    if (!signed.ok) throw new Error(`PDF_SIGN_${signed.status}`);
    const signedBody = await signed.json() as { signedURL?: string; signedUrl?: string };
    const relative = signedBody.signedURL || signedBody.signedUrl || "";
    const pdfUrl = relative.startsWith("http") ? relative : `${base}/storage/v1${relative.startsWith("/") ? "" : "/"}${relative}`;
    const query = new URL(request.url).searchParams.get("q") || "";
    const terms = [...new Set(normalized(query).split(" ").filter(Boolean))];
    const parsed = await extractText(new Uint8Array(await download.arrayBuffer()), { mergePages: false });
    const pages = Array.isArray(parsed.text) ? parsed.text : [parsed.text];
    const matches = pages.map((text, index) => ({ pageNumber: index + 1, text: String(text) })).filter((page) => terms.some((term) => normalized(page.text).includes(term))).map((page) => ({ pageNumber: page.pageNumber, snippet: excerpt(page.text, terms), matchedTerms: terms.filter((term) => normalized(page.text).includes(term)) }));
    return NextResponse.json({ pdfUrl, pageCount: parsed.totalPages, matches });
  } catch (error) {
    const message = error instanceof Error ? error.message : "PDF를 조회하지 못했습니다.";
    return NextResponse.json({ error: message }, { status: message === "AUTH_REQUIRED" ? 401 : 500 });
  }
}
