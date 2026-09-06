import readXlsxFile from "read-excel-file/universal";
import { extractText } from "unpdf";
import {
  cleanExtractedText,
  extractGuideToc,
  parseEpeopleComplaint,
} from "./epeople-parser";
import { hasGuideFileKeyword } from "./document-classification";
import { detectResidualSensitiveInfo } from "./privacy-check";

export type JobStatus =
  | "queued"
  | "checking"
  | "uploading"
  | "extracting_local"
  | "detecting_pii"
  | "summarizing_local"
  | "verifying_summary"
  | "awaiting_review"
  | "parsing"
  | "masking"
  | "chunking"
  | "embedding"
  | "completed"
  | "failed";
type Config = {
  url: string;
  serviceKey: string;
  bucket: string;
  openaiKey?: string;
  embeddingModel: string;
};
type Row = Record<string, string>;
type Finding = { type: string; value: string };

export function getConfig(): Config {
  const url = process.env.SUPABASE_URL || "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !serviceKey) throw new Error("SUPABASE_NOT_CONFIGURED");
  return {
    url: url.replace(/\/$/, ""),
    serviceKey,
    bucket: process.env.SUPABASE_STORAGE_BUCKET || "complaint-originals",
    openaiKey: process.env.OPENAI_API_KEY,
    embeddingModel:
      process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small",
  };
}

async function supabase<T>(
  config: Config,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await fetch(`${config.url}${path}`, {
    ...init,
    headers: {
      apikey: config.serviceKey,
      Authorization: `Bearer ${config.serviceKey}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(init.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`SUPABASE_${res.status}: ${await res.text()}`);
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}
export async function updateJob(
  config: Config,
  id: string,
  status: JobStatus,
  extra: Record<string, unknown> = {},
) {
  await supabase(
    config,
    `/rest/v1/ingestion_jobs?id=eq.${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        status,
        ...extra,
        updated_at: new Date().toISOString(),
      }),
    },
  );
}
export async function listJobs(config: Config, department: string) {
  try {
    return await supabase<Record<string, unknown>[]>(
      config,
      `/rest/v1/ingestion_jobs?owning_department=eq.${encodeURIComponent(department)}&select=*,source_files(*)&order=created_at.desc&limit=100`,
    );
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("PGRST204"))
      throw error;
    return supabase<Record<string, unknown>[]>(
      config,
      "/rest/v1/ingestion_jobs?select=*,source_files(*)&order=created_at.desc&limit=100",
    );
  }
}
export async function getJobDocuments(config: Config, jobId: string) {
  const jobs = await supabase<Record<string, unknown>[]>(
    config,
    `/rest/v1/ingestion_jobs?id=eq.${encodeURIComponent(jobId)}&select=*&limit=1`,
  );
  const files = await supabase<
    {
      id: string;
      original_name: string;
      storage_bucket: string | null;
      storage_path: string | null;
      masked_storage_path?: string | null;
      redaction_status?: string | null;
      redaction_count?: number;
      redaction_error?: string | null;
      page_count?: number | null;
      record_count?: number | null;
      parse_status?: string | null;
    }[]
  >(
    config,
    `/rest/v1/source_files?job_id=eq.${encodeURIComponent(jobId)}&select=*`,
  );
  if (!files.length) throw new Error("UPLOAD_NOT_FOUND");
  const ids = files.map((file) => file.id).join(",");
  const documents = await supabase<Record<string, unknown>[]>(
    config,
    `/rest/v1/rag_documents?source_file_id=in.(${ids})&select=*&order=created_at.asc`,
  );
  const documentIds = documents
    .map((document) => String(document.id))
    .filter(Boolean);
  const chunks = documentIds.length
    ? await supabase<Record<string, unknown>[]>(
        config,
        `/rest/v1/rag_chunks?document_id=in.(${documentIds.join(",")})&select=id,document_id,chunk_index,content,token_estimate,metadata&order=chunk_index.asc`,
      )
    : [];
  return { job: jobs[0] || null, files, documents, chunks };
}
export async function deleteDocument(config: Config, id: string) {
  await supabase(
    config,
    `/rest/v1/rag_documents?id=eq.${encodeURIComponent(id)}`,
    { method: "DELETE" },
  );
  return { deleted: true };
}
function storageObjectAlreadyMissing(status: number, body: string) {
  if (status === 404) return true;
  if (status !== 400) return false;
  try {
    const parsed = JSON.parse(body) as {
      statusCode?: string | number;
      code?: string;
      message?: string;
    };
    return (
      Number(parsed.statusCode) === 404 ||
      parsed.code === "NoSuchKey" ||
      parsed.message === "Object not found"
    );
  } catch {
    return /NoSuchKey|Object not found|"statusCode"\s*:\s*"?404/.test(body);
  }
}
export async function deleteUpload(config: Config, jobId: string) {
  let files: {
    id: string;
    storage_bucket: string | null;
    storage_path: string | null;
    masked_storage_path?: string | null;
  }[];
  try {
    files = await supabase(
      config,
      `/rest/v1/source_files?job_id=eq.${encodeURIComponent(jobId)}&select=id,storage_bucket,storage_path,masked_storage_path`,
    );
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("PGRST204"))
      throw error;
    files = await supabase(
      config,
      `/rest/v1/source_files?job_id=eq.${encodeURIComponent(jobId)}&select=id,storage_bucket,storage_path`,
    );
  }
  for (const file of files) {
    await supabase(
      config,
      `/rest/v1/rag_documents?source_file_id=eq.${encodeURIComponent(file.id)}`,
      { method: "DELETE" },
    );
    const storagePaths = new Set(
      [file.storage_path, file.masked_storage_path].filter(Boolean) as string[],
    );
    for (const path of storagePaths) {
      const res = await fetch(
        `${config.url}/storage/v1/object/${file.storage_bucket || config.bucket}/${path}`,
        {
          method: "DELETE",
          headers: {
            apikey: config.serviceKey,
            Authorization: `Bearer ${config.serviceKey}`,
          },
        },
      );
      if (!res.ok) {
        const body = await res.text();
        if (!storageObjectAlreadyMissing(res.status, body))
          throw new Error(`STORAGE_DELETE_${res.status}: ${body}`);
      }
    }
  }
  await supabase(
    config,
    `/rest/v1/source_files?job_id=eq.${encodeURIComponent(jobId)}`,
    { method: "DELETE" },
  );
  await supabase(
    config,
    `/rest/v1/ingestion_jobs?id=eq.${encodeURIComponent(jobId)}`,
    { method: "DELETE" },
  );
  return { deleted: true };
}
export async function createJob(
  config: Config,
  file: File,
  hash: string,
  documentType: string,
  department: string,
) {
  let duplicate: { id: string; original_name: string }[];
  try {
    duplicate = await supabase(
      config,
      `/rest/v1/source_files?sha256=eq.${hash}&owning_department=eq.${encodeURIComponent(department)}&select=id,original_name&limit=1`,
    );
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("PGRST204"))
      throw error;
    duplicate = await supabase(
      config,
      `/rest/v1/source_files?sha256=eq.${hash}&select=id,original_name&limit=1`,
    );
  }
  if (duplicate.length)
    throw new Error(`DUPLICATE_FILE:${duplicate[0].original_name}`);
  let jobs: { id: string }[];
  try {
    jobs = await supabase(config, "/rest/v1/ingestion_jobs", {
      method: "POST",
      body: JSON.stringify({
        file_name: file.name,
        file_size: file.size,
        mime_type: file.type || mimeFromName(file.name),
        document_type: documentType,
        owning_department: department,
        status: "queued",
        progress: 0,
      }),
    });
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("PGRST204"))
      throw error;
    jobs = await supabase(config, "/rest/v1/ingestion_jobs", {
      method: "POST",
      body: JSON.stringify({
        file_name: file.name,
        file_size: file.size,
        mime_type: file.type || mimeFromName(file.name),
        document_type: documentType,
        status: "queued",
        progress: 0,
      }),
    });
  }
  const jobId = jobs[0].id;
  let rows: { id: string }[];
  try {
    rows = await supabase(config, "/rest/v1/source_files", {
      method: "POST",
      body: JSON.stringify({
        job_id: jobId,
        original_name: file.name,
        mime_type: file.type || mimeFromName(file.name),
        size_bytes: file.size,
        sha256: hash,
        document_type: documentType,
        owning_department: department,
        storage_bucket: config.bucket,
      }),
    });
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("PGRST204"))
      throw error;
    rows = await supabase(config, "/rest/v1/source_files", {
      method: "POST",
      body: JSON.stringify({
        job_id: jobId,
        original_name: file.name,
        mime_type: file.type || mimeFromName(file.name),
        size_bytes: file.size,
        sha256: hash,
        document_type: documentType,
        storage_bucket: config.bucket,
      }),
    });
  }
  return { jobId, fileId: rows[0].id };
}
export async function storeOriginal(
  config: Config,
  file: File,
  fileId: string,
  maskedOnly = false,
) {
  const extension =
    (file.name.split(".").pop() || "bin")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "") || "bin";
  const key = `${new Date().toISOString().slice(0, 10)}/${fileId}/${maskedOnly ? "masked" : "original"}.${extension}`;
  const res = await fetch(
    `${config.url}/storage/v1/object/${config.bucket}/${key}`,
    {
      method: "POST",
      headers: {
        apikey: config.serviceKey,
        Authorization: `Bearer ${config.serviceKey}`,
        "Content-Type": file.type || "application/pdf",
        "x-upsert": "true",
      },
      body: file,
    },
  );
  if (!res.ok) throw new Error(`STORAGE_${res.status}: ${await res.text()}`);
  await supabase(config, `/rest/v1/source_files?id=eq.${fileId}`, {
    method: "PATCH",
    body: JSON.stringify({
      storage_path: key,
      ...(maskedOnly
        ? { masked_storage_path: key, redaction_status: "completed" }
        : {}),
    }),
  });
  return key;
}
export type BrowserPrivacyResult = {
  sourceHash: string;
  originalHash: string;
  questionLength: number;
  answerLength: number;
  outboundSafe: boolean;
  structuredComplaint: {
    purpose: string;
    essentialFacts: string[];
    legalQuestions: string[];
    requestedAnswer: string[];
    uncertainties: string[];
  };
  outboundText: string;
  maskedQuestion: string;
  piiSummary: Record<string, number>;
  localModel: string;
  schemaVersion: number;
  maskedRecord: Row;
};
function verifyBrowserPrivacy(
  result: BrowserPrivacyResult | undefined,
  hash: string,
) {
  if (!result) throw new Error("BROWSER_PRIVACY_REQUIRED");
  if (result.sourceHash !== hash)
    throw new Error("BROWSER_PRIVACY_HASH_MISMATCH");
  if (!result.outboundSafe || !result.outboundText)
    throw new Error("OUTBOUND_PRIVACY_BLOCKED:EMPTY");
  if (detectResidualSensitiveInfo(result.outboundText).length)
    throw new Error("OUTBOUND_PRIVACY_BLOCKED:SERVER_SECONDARY_CHECK");
  if (!result.structuredComplaint?.purpose)
    throw new Error("BROWSER_PRIVACY_INVALID");
  if (!result.maskedRecord?.question || !result.maskedRecord?.answer)
    throw new Error("BROWSER_PRIVACY_INVALID");
  return { ...result, maskedRecord: maskRow(result.maskedRecord) };
}
function recordsFromPdfText(file: File, text: string, pageCount?: number, documentType?: string) {
  const fullText = cleanExtractedText(text);
  if (documentType === "guide" || hasGuideFileKeyword(file.name))
    return {
      records: [
        {
          title: file.name.replace(/\.pdf$/i, ""),
          document_type: "guide",
          content: fullText,
          question: "",
          answer: "",
          linked_pdf_name: file.name,
          guide_toc: JSON.stringify(extractGuideToc(fullText)),
        },
      ],
      pageCount,
      rawText: text,
    };
  const complaint = parseEpeopleComplaint(text, file.name);
  return {
    records: [
      complaint || {
        title: file.name.replace(/\.pdf$/i, ""),
        content: fullText,
        question: "",
        answer: "",
        linked_pdf_name: file.name,
      },
    ],
    pageCount,
    rawText: text,
  };
}
export async function parseFile(
  file: File,
): Promise<{ records: Row[]; pageCount?: number; rawText: string }> {
  const lower = file.name.toLowerCase();
  if (lower.endsWith(".pdf")) throw new Error("PDF_SECURE_PIPELINE_REQUIRED");
  if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) {
    const rows = await readXlsxFile(await file.arrayBuffer());
    if (rows.length < 2) throw new Error("EMPTY_EXCEL");
    const headers = rows[0].map((v, i) =>
      normalizeHeader(String(v || `column_${i + 1}`)),
    );
    const records = rows
      .slice(1)
      .filter((r) => r.some(Boolean))
      .map((r) => Object.fromEntries(headers.map((h, i) => [h, toText(r[i])])));
    return {
      records: records.map(mapComplaintRow),
      rawText: records.map((r) => Object.values(r).join(" ")).join("\n"),
    };
  }
  throw new Error("UNSUPPORTED_FILE");
}
export function maskPersonalInfo(text: string) {
  const findings: { type: string; value: string }[] = [];
  let masked = text;
  const rules: [string, RegExp, (v: string) => string][] = [
    [
      "휴대전화",
      /(?:\+?82[-.\s]?)?0(?:2|1[016789]|[3-6][1-5]|70)[-.\s]?\d{3,4}[-.\s]?\d{4}/g,
      (v) => `${v.slice(0, 3)}-****-${v.slice(-4)}`,
    ],
    [
      "이메일",
      /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,
      (v) => `${v[0]}***@${v.split("@")[1]}`,
    ],
    [
      "주민등록번호",
      /\b\d{6}[-\s]?[1-8]\d{6}\b/g,
      (v) => `${v.slice(0, 6)}-*******`,
    ],
    [
      "사업자등록번호",
      /\b\d{3}[-\s]?\d{2}[-\s]?\d{5}\b/g,
      (v) => `${v.slice(0, 3)}-**-*****`,
    ],
    [
      "카드·계좌번호",
      /\b\d{3,6}[-\s]\d{2,6}[-\s]\d{3,6}(?:[-\s]\d{1,6})?\b/g,
      (v) => `${v.slice(0, 4)}-****-****`,
    ],
    [
      "성명",
      /(?:성명|이름|대표자|담당자|처리자)\s*[:：]?\s*[가-힣]{2,5}/g,
      (v) => v.replace(/[가-힣]{2,5}$/, "[비식별]"),
    ],
    ["성명", /[가-힣]{2,5}(?=\s*(?:담당자|처리자|대표자))/g, () => "[비식별]"],
    ["직함 인접 성명", /[가-힣]{2,4}(?=\s+(?:대표이사|대표|이사|상무|전무|부장|차장|과장|팀장|주무관|사무관|연구원|책임연구원|선임연구원|교수|변호사|노무사|회계사|담당자|처리자)(?=\s|$|[,.)]))/g, () => "[비식별]"],
    ["직함 인접 성명", /(?:대표이사|대표|이사|상무|전무|부장|차장|과장|팀장|주무관|사무관|연구원|책임연구원|선임연구원|교수|변호사|노무사|회계사|담당자|처리자)\s*[:：]?\s*[가-힣]{2,4}/g, (v) => v.replace(/[가-힣]{2,4}$/, "[비식별]")],
    ["법인명", /(?:㈜|\(주\)|주식회사|유한회사|합자회사|합명회사|사단법인|재단법인|법무법인|의료법인|학교법인|농업회사법인)\s*[가-힣A-Za-z0-9&·_-]{2,30}|[가-힣A-Za-z0-9&·_-]{2,30}\s*(?:㈜|\(주\)|주식회사|유한회사|합자회사|합명회사)/g, () => "[법인명]"],
  ];
  for (const [type, re, fn] of rules)
    masked = masked.replace(re, (v) => {
      findings.push({ type, value: v });
      return fn(v);
    });
  return { masked, findings };
}

/** Preserve an official answer verbatim except for the author signature at its end. */
export function maskAnswerAttribution(text: string) {
  const findings: { type: string; value: string }[] = [];
  const start = Math.max(0, text.length - 800);
  const head = text.slice(0, start);
  let tail = text.slice(start);
  const titles = "주무관|연구원|책임연구원|선임연구원|사무관";
  tail = tail.replace(
    new RegExp(`[가-힣]{2,5}\\s*(?=(?:${titles})(?:\\s|$|[,(（]))`, "g"),
    (value) => {
      findings.push({ type: "답변 작성자", value });
      return "[비식별]";
    },
  );
  tail = tail.replace(
    new RegExp(`((?:${titles})\\s*[（(]?)((?:\\+?82[-.\\s]?)?0(?:2|1[016789]|[3-6][1-5]|70)[-.\\s]?\\d{3,4}[-.\\s]?\\d{4})(?=[)）]?)`, "g"),
    (_match, prefix: string, phone: string) => {
      findings.push({ type: "답변 작성자 연락처", value: phone });
      return `${prefix}[비식별]`;
    },
  );
  return { masked: head + tail, findings };
}
export function chunkText(text: string, max = 900, overlap = 120) {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [];
  const out: string[] = [];
  let start = 0;
  while (start < clean.length) {
    let end = Math.min(start + max, clean.length);
    if (end < clean.length) {
      const boundary = Math.max(
        clean.lastIndexOf(". ", end),
        clean.lastIndexOf("\n", end),
      );
      if (boundary > start + max * 0.55) end = boundary + 1;
    }
    out.push(clean.slice(start, end).trim());
    if (end >= clean.length) break;
    start = Math.max(end - overlap, start + 1);
  }
  return out;
}
function normalizeDate(value: string) {
  if (!value) return null;
  const match = value.match(
    /(20\d{2}|19\d{2})[.\-/년\s]+(\d{1,2})[.\-/월\s]+(\d{1,2})/,
  );
  if (!match) return null;
  const [, y, m, d] = match;
  return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
}
function summarize(text: string, max = 220) {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const boundary = Math.max(
    cut.lastIndexOf("."),
    cut.lastIndexOf("다."),
    cut.lastIndexOf("?"),
  );
  return `${cut.slice(0, boundary > max * 0.55 ? boundary + 1 : max).trim()}…`;
}
function extractKeywords(text: string, limit = 12) {
  const stop = new Set([
    "그리고",
    "그러나",
    "대한",
    "관련",
    "문의",
    "민원",
    "답변",
    "경우",
    "통해",
    "위해",
    "있는",
    "없는",
    "합니다",
    "됩니다",
    "입니다",
    "것으로",
    "내용",
    "질문",
  ]);
  const counts = new Map<string, number>();
  for (const word of text.match(/[가-힣A-Za-z]{2,}/g) || []) {
    const key = word.toLowerCase();
    if (stop.has(key)) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts]
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .slice(0, limit)
    .map(([keyword, count]) => ({ keyword, count }));
}
function extractLegalReferences(text: string) {
  const found = new Set<string>();
  const law =
    /[「『]([^」』]{2,60}(?:법|령|규칙|규정|고시))[」』]\s*(제\s*\d+\s*조(?:의\s*\d+)?(?:\s*제\s*\d+\s*항)?(?:\s*제\s*\d+\s*호)?)/g;
  for (const match of text.matchAll(law))
    found.add(`${match[1].trim()} ${match[2].replace(/\s+/g, "")}`);
  const article =
    /제\s*\d+\s*조(?:의\s*\d+)?(?:\s*제\s*\d+\s*항)?(?:\s*제\s*\d+\s*호)?/g;
  for (const match of text.matchAll(article))
    found.add(match[0].replace(/\s+/g, ""));
  return [...found].slice(0, 30);
}
function maskRow(row: Row) {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key,
      key === "answer"
        ? maskAnswerAttribution(value).masked
        : maskPersonalInfo(value).masked,
    ]),
  );
}
function buildMetadata(args: {
  row: Row;
  file: File;
  fileId: string;
  storagePath?: string;
  pageCount?: number;
  rowNumber: number;
  masked: string;
  findings: Finding[];
}) {
  const {
    row,
    file,
    fileId,
    storagePath,
    pageCount,
    rowNumber,
    masked,
    findings,
  } = args;
  const visibleRow = Object.fromEntries(
    Object.entries(row).filter(
      ([key]) => !key.startsWith("ai_") && !key.startsWith("privacy_"),
    ),
  );
  const structured = parseJsonObject(row.privacy_structured);
  const piiSummary = parseJsonObject(row.privacy_pii_summary);
  return {
    schema_version: 6,
    source: {
      file_id: fileId,
      file_name: file.name,
      file_extension: file.name.split(".").pop()?.toLowerCase() || "",
      mime_type: file.type || mimeFromName(file.name),
      storage_path: storagePath || null,
      excel_row_number: file.name.match(/\.xlsx?$/i) ? rowNumber : null,
      page_count: pageCount || null,
    },
    privacy_gateway: {
      processed: Boolean(row.privacy_outbound_text),
      outbound_safe: row.privacy_outbound_safe === "true",
      local_model: row.privacy_local_model || null,
      schema_version: Number(row.privacy_schema_version) || null,
      pii_summary: piiSummary,
      structured_complaint: structured,
      outbound_text: row.privacy_outbound_text || null,
      review_status: row.privacy_outbound_text ? "pending" : "not_required",
    },
    ai_transfer: {
      extraction: {
        sent: false,
        mode: "local_only",
        model: null,
        content: null,
        content_length: 0,
        privacy_checked: true,
      },
      embedding: {
        sent: true,
        model: "OPENAI_EMBEDDING_MODEL",
        content:
          row.document_type === "complaint"
            ? "개인정보 검증을 통과한 질의 핵심만 전송"
            : "검색 청크를 전송",
      },
    },
    guide: {
      toc: parseJsonArray(row.guide_toc),
      full_text_stored: row.document_type === "guide",
    },
    complaint: {
      application_number: row.application_number || null,
      receipt_number: row.receipt_number || null,
      application_at: row.application_at || row.application_date || null,
      received_at: row.received_at || row.receipt_date || null,
      expected_completion_at: row.expected_completion_at || null,
      notification_at: row.notification_at || row.response_date || null,
      answer_confirmed_at: row.answer_confirmed_at || null,
      summary: row.summary || null,
      attachments: parseJsonArray(row.attachments),
      agency: row.agency || null,
      department: row.department || null,
      handler_masked: row.handler_masked || row.handler || null,
      processor_masked: row.processor_masked || null,
      related_laws: parseJsonArray(row.related_laws),
      application_channel: row.application_channel || null,
      complaint_kind: row.complaint_kind || null,
      processing_result: row.processing_result || null,
      public_status: row.public_status || null,
      processing_period_days: Number(row.processing_period_days) || null,
      notification_method: row.notification_method || null,
      processing_status: row.processing_status || null,
    },
    search: {
      summary:
        row.summary ||
        String(structured.purpose || "") ||
        summarize(row.question || row.content || masked),
      keywords: extractKeywords(row.privacy_outbound_text || masked),
      legal_references: [
        ...new Set([
          ...parseJsonArray(row.related_laws),
          ...extractLegalReferences(row.privacy_outbound_text || masked),
        ]),
      ],
    },
    quality: {
      has_question: Boolean(row.question),
      has_answer: Boolean(row.answer),
      question_length: (row.question || "").length,
      answer_length: (row.answer || "").length,
      total_length: masked.length,
      pii_detected: findings.length > 0,
      pii_count: findings.length,
      pii_types: [...new Set(findings.map((x) => x.type))],
    },
    original_columns: Object.keys(visibleRow),
    masked_row: maskRow(visibleRow),
  };
}
function parseJsonArray(value: string) {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return value ? [value] : [];
  }
}
function parseJsonObject(value: string) {
  try {
    const parsed = JSON.parse(value || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
async function embed(config: Config, texts: string[]) {
  if (!config.openaiKey) throw new Error("OPENAI_NOT_CONFIGURED");
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.openaiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: config.embeddingModel, input: texts }),
  });
  if (!res.ok) throw new Error(`EMBEDDING_${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { data: { embedding: number[] }[] };
  return json.data.map((x) => x.embedding);
}
export async function persistRecords(
  config: Config,
  args: {
    jobId: string;
    fileId: string;
    file: File;
    records: Row[];
    department: string;
    pageCount?: number;
    storagePath?: string;
  },
) {
  let totalPii = 0;
  const prepared: {
    row: Row;
    original: string;
    masked: string;
    findings: { type: string; value: string }[];
    rowNumber: number;
  }[] = [];
  for (let i = 0; i < args.records.length; i++) {
    const row = {
      ...args.records[i],
      department: args.records[i].department || args.department,
    };
    const original = [
      row.question && `질문: ${row.question}`,
      row.answer && `답변: ${row.answer}`,
      row.content,
    ]
      .filter(Boolean)
      .join("\n\n");
    if (!original.trim()) continue;
    const questionResult = maskPersonalInfo(row.question || "");
    const answerResult = maskAnswerAttribution(row.answer || "");
    const contentResult = maskPersonalInfo(row.content || "");
    const findings = [
      ...questionResult.findings,
      ...answerResult.findings,
      ...contentResult.findings,
    ];
    const masked = [
      row.question && `질문: ${questionResult.masked}`,
      row.answer && `답변: ${answerResult.masked}`,
      contentResult.masked,
    ].filter(Boolean).join("\n\n");
    totalPii += findings.length;
    prepared.push({
      row,
      original,
      masked,
      findings,
      rowNumber: i + 2,
    });
  }
  if (!prepared.length) throw new Error("NO_SEARCHABLE_TEXT");
  const rows = prepared.map((p) => ({
    source_file_id: args.fileId,
    title: p.row.title || args.file.name,
    document_type: p.row.document_type || "complaint",
    department: p.row.department || null,
    category_major: p.row.category_major || null,
    category_middle: p.row.category_middle || null,
    category_minor: p.row.category_minor || null,
    question_original: p.row.question
      ? maskPersonalInfo(p.row.question).masked
      : null,
    answer_original: p.row.answer
      ? maskAnswerAttribution(p.row.answer).masked
      : null,
    content_original: p.masked,
    content_masked: p.masked,
    pii_findings: p.findings.map(({ type }) => ({ type })),
    linked_pdf_name: p.row.linked_pdf_name || null,
    pdf_storage_path: p.row.linked_pdf_name ? null : args.storagePath || null,
    metadata: buildMetadata({
      row: p.row,
      file: args.file,
      fileId: args.fileId,
      storagePath: args.storagePath,
      pageCount: args.pageCount,
      rowNumber: p.rowNumber,
      masked: p.masked,
      findings: p.findings,
    }),
    page_count: args.pageCount || null,
    status: "processing",
    application_number: p.row.application_number || null,
    receipt_number: p.row.receipt_number || null,
    application_at: p.row.application_at || null,
    received_at: p.row.received_at || null,
    expected_completion_at: p.row.expected_completion_at || null,
    summary: p.row.summary || null,
    attachments: parseJsonArray(p.row.attachments),
    handler_masked: p.row.handler_masked || null,
    processor_masked: p.row.processor_masked || null,
    notification_at: p.row.notification_at || null,
    answer_confirmed_at: p.row.answer_confirmed_at || null,
    related_laws: parseJsonArray(p.row.related_laws),
    application_channel: p.row.application_channel || null,
    complaint_kind: p.row.complaint_kind || null,
    processing_result: p.row.processing_result || null,
    public_status: p.row.public_status || null,
    processing_period_days: Number(p.row.processing_period_days) || null,
    notification_method: p.row.notification_method || null,
  }));
  let docs: { id: string }[];
  try {
    docs = await supabase(config, "/rest/v1/rag_documents", {
      method: "POST",
      body: JSON.stringify(rows),
    });
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("PGRST204"))
      throw error;
    const optional = [
      "application_number",
      "receipt_number",
      "application_at",
      "received_at",
      "expected_completion_at",
      "summary",
      "attachments",
      "handler_masked",
      "processor_masked",
      "notification_at",
      "answer_confirmed_at",
      "related_laws",
      "application_channel",
      "complaint_kind",
      "processing_result",
      "public_status",
      "processing_period_days",
      "notification_method",
    ];
    const compatibleRows = rows.map((row) =>
      Object.fromEntries(
        Object.entries(row).filter(([key]) => !optional.includes(key)),
      ),
    );
    docs = await supabase(config, "/rest/v1/rag_documents", {
      method: "POST",
      body: JSON.stringify(compatibleRows),
    });
  }
  const pending: {
    documentId: string;
    chunkIndex: number;
    content: string;
    rowNumber: number;
  }[] = [];
  docs.forEach((doc, i) => {
    const item = prepared[i];
    const structured = parseJsonObject(item.row.privacy_structured);
    const summary =
      item.row.summary ||
      String(structured.purpose || "") ||
      summarize(item.row.question || item.masked);
    const context = [
      `제목: ${item.row.title || args.file.name}`,
      summary && `민원요지: ${summary}`,
    ]
      .filter(Boolean)
      .join("\n");
    const searchable =
      item.row.document_type === "complaint" && item.row.privacy_outbound_text
        ? item.row.privacy_outbound_text
        : item.masked;
    const contents = [context, ...chunkText(searchable)].filter(
      (value, index, all) => value && all.indexOf(value) === index,
    );
    contents.forEach((content, chunkIndex) =>
      pending.push({
        documentId: doc.id,
        chunkIndex,
        content,
        rowNumber: item.rowNumber,
      }),
    );
  });
  const vectorRows: {
    document_id: string;
    chunk_index: number;
    content: string;
    token_estimate: number;
    embedding: number[];
    metadata: Record<string, unknown>;
  }[] = [];
  for (let offset = 0; offset < pending.length; offset += 64) {
    const batch = pending.slice(offset, offset + 64);
    const vectors = await embed(
      config,
      batch.map((x) => x.content),
    );
    batch.forEach((x, i) => {
      const docIndex = docs.findIndex((doc) => doc.id === x.documentId);
      const row = docIndex >= 0 ? prepared[docIndex].row : {};
      vectorRows.push({
        document_id: x.documentId,
        chunk_index: x.chunkIndex,
        content: x.content,
        token_estimate: Math.ceil(x.content.length / 3),
        embedding: vectors[i],
        metadata: {
          source_file_id: args.fileId,
          row_number: x.rowNumber,
          title: row.title || args.file.name,
          document_type: row.document_type || "complaint",
          department: row.department || null,
          category_major: row.category_major || null,
          category_middle: row.category_middle || null,
          category_minor: row.category_minor || null,
          legal_references: extractLegalReferences(x.content),
        },
      });
    });
  }
  for (let offset = 0; offset < vectorRows.length; offset += 200)
    await supabase(config, "/rest/v1/rag_chunks", {
      method: "POST",
      body: JSON.stringify(vectorRows.slice(offset, offset + 200)),
    });
  for (let i = 0; i < docs.length; i++)
    await supabase(config, `/rest/v1/rag_documents?id=eq.${docs[i].id}`, {
      method: "PATCH",
      body: JSON.stringify({
        status: "ready",
        chunk_count: pending.filter((x) => x.documentId === docs[i].id).length,
      }),
    });
  await supabase(config, `/rest/v1/source_files?id=eq.${args.fileId}`, {
    method: "PATCH",
    body: JSON.stringify({
      page_count: args.pageCount || null,
      record_count: prepared.length,
      parse_status: "completed",
    }),
  });
  return {
    documentCount: prepared.length,
    chunkCount: pending.length,
    piiCount: totalPii,
  };
}
export async function processUpload(
  file: File,
  documentType: string,
  department: string,
  browserPrivacy?: BrowserPrivacyResult,
) {
  const config = getConfig();
  const hash = await sha256(file);
  const duplicateHash = browserPrivacy?.originalHash || hash;
  const { jobId, fileId } = await createJob(
    config,
    file,
    duplicateHash,
    documentType,
    department,
  );
  return runPipeline(
    config,
    file,
    jobId,
    fileId,
    department,
    browserPrivacy,
    hash,
  );
}
export async function retryUpload(
  file: File,
  jobId: string,
  department: string,
  browserPrivacy?: BrowserPrivacyResult,
) {
  const config = getConfig();
  const hash = await sha256(file);
  const source = await supabase<{ id: string; original_name: string }[]>(
    config,
    `/rest/v1/source_files?job_id=eq.${encodeURIComponent(jobId)}&select=id,original_name&limit=1`,
  );
  if (!source.length) throw new Error("SOURCE_FILE_NOT_FOUND");
  if (source[0].original_name !== file.name)
    throw new Error("RETRY_FILE_MISMATCH");
  await updateJob(config, jobId, "queued", {
    progress: 0,
    error_code: null,
    error_message: null,
    attempt_count: 2,
  });
  await supabase(
    config,
    `/rest/v1/rag_documents?source_file_id=eq.${source[0].id}`,
    { method: "DELETE" },
  );
  return runPipeline(
    config,
    file,
    jobId,
    source[0].id,
    department,
    browserPrivacy,
    hash,
  );
}
async function runPipeline(
  config: Config,
  file: File,
  jobId: string,
  fileId: string,
  department: string,
  browserPrivacy: BrowserPrivacyResult | undefined,
  fileHash: string,
) {
  try {
    await updateJob(config, jobId, "checking", { progress: 8 });
    const isPdf = file.name.toLowerCase().endsWith(".pdf");
    const isGuidePdf = isPdf && documentType === "guide" && !browserPrivacy;
    const isComplaintPdf = isPdf && !isGuidePdf;
    let verifiedPrivacy: BrowserPrivacyResult | undefined;
    let maskedPdfPages: number | undefined;
    if (isComplaintPdf) {
      verifiedPrivacy = verifyBrowserPrivacy(browserPrivacy, fileHash);
      const maskedBytes = new Uint8Array(await file.arrayBuffer());
      const inspected = await extractText(maskedBytes, { mergePages: true });
      maskedPdfPages = inspected.totalPages;
      if (cleanExtractedText(inspected.text).length > 10)
        throw new Error("MASKED_PDF_CONTAINS_EXTRACTABLE_TEXT");
    }
    await updateJob(config, jobId, "uploading", { progress: 18 });
    const storagePath = await storeOriginal(config, file, fileId, isComplaintPdf);
    let parsed: { records: Row[]; pageCount?: number; rawText: string };
    let piiCount = 0;
    if (file.name.toLowerCase().endsWith(".pdf")) {
      await updateJob(config, jobId, "extracting_local", { progress: 30 });
      if (isComplaintPdf && verifiedPrivacy) {
        parsed = {
          records: [{ ...verifiedPrivacy.maskedRecord, document_type: "complaint" }],
          pageCount: maskedPdfPages,
          rawText: "",
        };
      } else {
        const source = new Uint8Array(await file.arrayBuffer());
        const local = await extractText(source, { mergePages: true });
        const localText = cleanExtractedText(local.text);
        if (!localText.trim()) throw new Error("LOCAL_PDF_TEXT_EMPTY");
        parsed = recordsFromPdfText(file, localText, local.totalPages, isGuidePdf ? "guide" : documentType);
      }
    } else {
      await updateJob(config, jobId, "parsing", { progress: 30 });
      parsed = await parseFile(file);
    }
    if (isGuidePdf) {
      await updateJob(config, jobId, "masking", {
        progress: 55,
        total_records: parsed.records.length,
      });
    } else {
      for (const row of parsed.records) {
        const question = row.question || "";
        const answer = row.answer || "";
        if (question.length < 20 || answer.length < 20)
          throw new Error(
            `COMPLAINT_SECTION_EXTRACTION_FAILED:question=${question.length},answer=${answer.length}`,
          );
        await updateJob(config, jobId, "detecting_pii", {
          progress: 42,
          pii_count: maskPersonalInfo(question).findings.length,
        });
        await updateJob(config, jobId, "summarizing_local", { progress: 52 });
        const privacy = verifiedPrivacy || verifyBrowserPrivacy(browserPrivacy, fileHash);
        piiCount += Object.values(privacy.piiSummary).reduce(
          (sum, count) => sum + Number(count || 0),
          0,
        );
        row.privacy_structured = JSON.stringify(privacy.structuredComplaint);
        row.privacy_outbound_text = privacy.outboundText;
        row.privacy_outbound_safe = String(privacy.outboundSafe);
        row.privacy_pii_summary = JSON.stringify(privacy.piiSummary);
        row.privacy_local_model = privacy.localModel;
        row.privacy_schema_version = String(privacy.schemaVersion);
        row.summary = privacy.structuredComplaint.purpose || row.summary;
      }
      await updateJob(config, jobId, "verifying_summary", {
        progress: 64,
        pii_count: piiCount,
      });
    }
    await updateJob(config, jobId, "chunking", {
      progress: 75,
      total_records: parsed.records.length,
    });
    await updateJob(config, jobId, "embedding", { progress: 86 });
    const stats = await persistRecords(config, {
      jobId,
      fileId,
      file,
      records: parsed.records,
      department,
      pageCount: parsed.pageCount,
      storagePath,
    });
    const finalStats = {
      ...stats,
      piiCount: Math.max(stats.piiCount, piiCount),
    };
    await reconcilePdf(config, file.name, fileId, department, storagePath);
    await updateJob(config, jobId, "completed", {
      progress: 100,
      completed_at: new Date().toISOString(),
      document_count: finalStats.documentCount,
      chunk_count: finalStats.chunkCount,
      pii_count: finalStats.piiCount,
    });
    return { jobId, ...finalStats };
  } catch (error) {
    try {
      await supabase(config, `/rest/v1/source_files?id=eq.${fileId}`, {
        method: "PATCH",
        body: JSON.stringify({
          redaction_status: "failed",
          redaction_error: error instanceof Error ? error.message : "UNKNOWN",
        }),
      });
    } catch {}
    await updateJob(config, jobId, "failed", {
      error_code:
        error instanceof Error ? error.message.split(":")[0] : "UNKNOWN",
      error_message:
        error instanceof Error ? error.message : "처리 중 오류가 발생했습니다.",
    });
    throw error;
  }
}
async function reconcilePdf(
  config: Config,
  name: string,
  fileId: string,
  department: string,
  storagePath?: string,
) {
  if (!name.toLowerCase().endsWith(".pdf")) return;
  await supabase(
    config,
    `/rest/v1/rag_documents?linked_pdf_name=eq.${encodeURIComponent(name)}&department=eq.${encodeURIComponent(department)}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        source_file_id: fileId,
        pdf_storage_path: storagePath,
      }),
    },
  );
}
function mapComplaintRow(row: Row) {
  const find = (names: string[]) => {
    for (const n of names) if (row[n]) return row[n];
    return "";
  };
  return {
    ...row,
    title: find(["민원제목", "제목", "title", "건명"]) || "제목 없음",
    question: find([
      "민원내용",
      "질문",
      "질의",
      "question",
      "문의내용",
      "신청내용",
    ]),
    answer: find(["답변내용", "답변", "answer", "회신내용", "처리결과"]),
    department: find([
      "담당부서",
      "부서",
      "department",
      "소관부서",
      "처리부서",
    ]),
    category_major: find(["대분류", "업무대분류"]),
    category_middle: find(["중분류", "업무중분류"]),
    category_minor: find(["소분류", "업무소분류"]),
    linked_pdf_name: find(["pdf파일명", "첨부파일", "원문파일", "pdf"]),
    receipt_number: find(["접수번호", "민원번호", "관리번호", "신청번호"]),
    receipt_date: find(["접수일", "접수일자", "신청일", "등록일"]),
    response_date: find(["답변일", "답변일자", "처리일", "완료일"]),
    handler: find(["담당자", "처리자", "답변자"]),
    agency: find(["기관명", "처리기관", "소관기관", "기관"]),
    processing_status: find(["처리상태", "진행상태", "상태"]),
  };
}
function normalizeHeader(v: string) {
  return v.trim().toLowerCase().replace(/\s+/g, "").replace(/[()]/g, "");
}
function toText(v: unknown) {
  return v instanceof Date
    ? v.toISOString()
    : v == null
      ? ""
      : String(v).trim();
}
function mimeFromName(n: string) {
  return n.toLowerCase().endsWith(".pdf")
    ? "application/pdf"
    : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
}
async function sha256(file: File) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    await file.arrayBuffer(),
  );
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
