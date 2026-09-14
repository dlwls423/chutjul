"use client";
import { extractText, getDocumentProxy } from "unpdf";
import { PDFDocument } from "pdf-lib";
import { cleanExtractedText, parseEpeopleComplaint } from "./epeople-parser";
import { maskBusinessIdentifiers } from "./business-identifiers";

export type BrowserPrivacyPayload = {
  sourceHash: string;
  originalHash: string;
  questionLength: number;
  answerLength: number;
  maskedQuestion: string;
  outboundText: string;
  outboundSafe: boolean;
  piiSummary: Record<string, number>;
  structuredComplaint: {
    purpose: string;
    essentialFacts: string[];
    legalQuestions: string[];
    requestedAnswer: string[];
    uncertainties: string[];
  };
  localModel: string;
  schemaVersion: number;
  maskedRecord: Record<string, string>;
};
const MODEL = "Qwen2.5-0.5B-Instruct-q4f16_1-MLC";

function mask(text: string) {
  const counts: Record<string, number> = {};
  const apply = (
    value: string,
    type: string,
    re: RegExp,
    replacement: string | ((value: string) => string),
  ) =>
    value.replace(re, (match) => {
      counts[type] = (counts[type] || 0) + 1;
      return typeof replacement === "string" ? replacement : replacement(match);
    });
  let value = text;
  const identifierMasked = maskBusinessIdentifiers(value);
  if (identifierMasked !== value)
    counts["업무식별자"] = (counts["업무식별자"] || 0) +
      (value.match(/\b(?:1AA|2AA)-\d{4}-\d{6,}\b/gi) || []).length;
  value = identifierMasked;
  value = apply(
    value,
    "주민등록번호",
    /\b\d{6}[-\s]?[1-8]\d{6}\b/g,
    "[주민등록번호]",
  );
  value = apply(
    value,
    "전화번호",
    /(?:\+?82[-.\s]?)?0(?:2|1[016789]|[3-6][1-5]|70)[-.\s]?\d{3,4}[-.\s]?\d{4}/g,
    "[전화번호]",
  );
  value = apply(
    value,
    "이메일",
    /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,
    "[이메일]",
  );
  value = apply(
    value,
    "사업자등록번호",
    /\b\d{3}[-\s]?\d{2}[-\s]?\d{5}\b/g,
    "[사업자등록번호]",
  );
  value = apply(
    value,
    "계좌·카드번호",
    /\b\d{3,6}[-\s]\d{2,6}[-\s]\d{3,6}(?:[-\s]\d{1,6})?\b/g,
    "[계좌·카드번호]",
  );
  value = apply(
    value,
    "주소",
    /(?:주소|소재지|거주지)\s*[:：]?\s*[^\n]{5,80}/g,
    "주소: [주소]",
  );
  value = apply(
    value,
    "성명",
    /(?:성명|이름|민원인|대표자|담당자|처리자)\s*[:：]?\s*[가-힣]{2,5}/g,
    (v) => v.replace(/[가-힣]{2,5}$/, "[성명]"),
  );
  value = apply(
    value,
    "직함 인접 성명",
    /[가-힣]{2,4}(?=\s+(?:대표이사|대표|이사|상무|전무|부장|차장|과장|팀장|주무관|사무관|연구원|책임연구원|선임연구원|교수|변호사|노무사|회계사|담당자|처리자)(?=\s|$|[,.)]))/g,
    "[성명]",
  );
  value = apply(
    value,
    "직함 인접 성명",
    /(?:대표이사|대표|이사|상무|전무|부장|차장|과장|팀장|주무관|사무관|연구원|책임연구원|선임연구원|교수|변호사|노무사|회계사|담당자|처리자)\s*[:：]?\s*[가-힣]{2,4}/g,
    (v) => v.replace(/[가-힣]{2,4}$/, "[성명]"),
  );
  value = apply(
    value,
    "법인명",
    /(?:㈜|\(주\)|주식회사|유한회사|합자회사|합명회사|사단법인|재단법인|법무법인|의료법인|학교법인|농업회사법인)\s*[가-힣A-Za-z0-9&·_-]{2,30}|[가-힣A-Za-z0-9&·_-]{2,30}\s*(?:㈜|\(주\)|주식회사|유한회사|합자회사|합명회사)/g,
    "[법인명]",
  );
  return { value, counts };
}
export const maskSensitiveText = mask;
export async function isComplaintPdfInBrowser(file: File) {
  const extracted = await extractText(new Uint8Array(await file.arrayBuffer()), {
    mergePages: true,
  });
  return Boolean(parseEpeopleComplaint(cleanExtractedText(extracted.text), file.name));
}
export function maskAnswerAttribution(text: string) {
  const counts: Record<string, number> = {};
  const start = Math.max(0, text.length - 800);
  const head = text.slice(0, start);
  let tail = text.slice(start);
  const titles = "주무관|연구원|책임연구원|선임연구원|사무관";
  tail = tail.replace(
    new RegExp(`[가-힣]{2,5}\\s*(?=(?:${titles})(?:\\s|$|[,(（]))`, "g"),
    () => {
      counts["답변 작성자"] = (counts["답변 작성자"] || 0) + 1;
      return "[성명]";
    },
  );
  tail = tail.replace(
    new RegExp(`((?:${titles})\\s*[（(]?)((?:\\+?82[-.\\s]?)?0(?:2|1[016789]|[3-6][1-5]|70)[-.\\s]?\\d{3,4}[-.\\s]?\\d{4})(?=[)）]?)`, "g"),
    (_match, prefix: string) => {
      counts["답변 작성자 연락처"] =
        (counts["답변 작성자 연락처"] || 0) + 1;
      return `${prefix}[전화번호]`;
    },
  );
  return { value: head + tail, counts };
}
function redactionRanges(text: string) {
  const ranges: { start: number; end: number }[] = [];
  const rules = [
    /\b\d{6}[-\s]?[1-8]\d{6}\b/g,
    /(?:\+?82[-.\s]?)?0(?:2|1[016789]|[3-6][1-5]|70)[-.\s]?\d{3,4}[-.\s]?\d{4}/g,
    /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,
    /\b\d{3}[-\s]?\d{2}[-\s]?\d{5}\b/g,
    /\b[12]AA-\d{4}-\d{6,}\b/gi,
    /(?:성명|이름|민원인|대표자|담당자|처리자)\s*[:：]?\s*[가-힣]{2,5}/g,
    /[가-힣]{2,4}(?=\s+(?:대표이사|대표|이사|상무|전무|부장|차장|과장|팀장|주무관|사무관|연구원|책임연구원|선임연구원|교수|변호사|노무사|회계사|담당자|처리자)(?=\s|$|[,.)]))/g,
    /(?:대표이사|대표|이사|상무|전무|부장|차장|과장|팀장|주무관|사무관|연구원|책임연구원|선임연구원|교수|변호사|노무사|회계사|담당자|처리자)\s*[:：]?\s*[가-힣]{2,4}/g,
    /(?:㈜|\(주\)|주식회사|유한회사|합자회사|합명회사|사단법인|재단법인|법무법인|의료법인|학교법인|농업회사법인)\s*[가-힣A-Za-z0-9&·_-]{2,30}|[가-힣A-Za-z0-9&·_-]{2,30}\s*(?:㈜|\(주\)|주식회사|유한회사|합자회사|합명회사)/g,
    /(?:주소|소재지|거주지)\s*[:：]?\s*[^\n]{5,80}/g,
    /\d{1,2}:\d{2}\s+[가-힣]{2,4}(?=\s|$)/g,
  ];
  for (const rule of rules)
    for (const found of text.matchAll(rule)) {
      const start = found.index || 0;
      ranges.push({ start, end: start + found[0].length });
    }
  return ranges;
}
function answerAttributionRanges(text: string) {
  const ranges: { start: number; end: number }[] = [];
  const titles = "주무관|연구원|책임연구원|선임연구원|사무관";
  const rules = [
    new RegExp(`[가-힣]{2,5}\\s*(?=(?:${titles})(?:\\s|$|[,(（]))`, "g"),
    new RegExp(`(?:${titles})\\s*[（(]?\\s*(?:\\+?82[-.\\s]?)?0(?:2|1[016789]|[3-6][1-5]|70)[-.\\s]?\\d{3,4}[-.\\s]?\\d{4}`, "g"),
  ];
  for (const rule of rules)
    for (const found of text.matchAll(rule)) {
      const start = found.index || 0;
      ranges.push({ start, end: start + found[0].length });
    }
  return ranges;
}
async function createMaskedPdf(
  bytes: ArrayBuffer,
  onProgress: (message: string, progress: number) => void,
) {
  // Keep one PDF.js document alive for both rendering and text coordinates.
  // Opening a second document through extractTextItems can destroy a shared
  // browser worker while the first document is still rendering.
  const proxy = await getDocumentProxy(new Uint8Array(bytes.slice(0)));
  const output = await PDFDocument.create();
  let answerStarted = false;
  try {
    for (let pageNumber = 1; pageNumber <= proxy.numPages; pageNumber++) {
    onProgress(
      `PDF ${pageNumber}/${proxy.numPages}쪽 개인정보를 가리고 있습니다.`,
      18 + Math.round((pageNumber / proxy.numPages) * 10),
    );
    const page = await proxy.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1.5 });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("BROWSER_CANVAS_UNAVAILABLE");
    await page.render({ canvas, canvasContext: context, viewport }).promise;
    const textContent = await page.getTextContent();
    const items = textContent.items
      .filter((item): item is typeof item & { str: string; transform: number[]; width: number; height: number } => "str" in item)
      .map((item) => ({
        str: item.str,
        x: item.transform[4],
        y: item.transform[5],
        width: item.width,
        height: item.height,
      }));
    if (!items.some((item) => item.str.trim()))
      throw new Error(
        "텍스트를 확인할 수 없는 스캔 페이지가 있어 원본 저장을 차단했습니다. OCR 처리된 PDF로 다시 시도해 주세요.",
      );
    let combined = "";
    const offsets = items.map((item) => {
      const start = combined.length;
      combined += `${item.str} `;
      return { start, end: start + item.str.length, item };
    });
    const answerMarker = combined.search(/처리결과\s*(?:\(\s*답변내용\s*\)|답변내용)/);
    let ranges: { start: number; end: number }[];
    if (answerStarted) {
      ranges = answerAttributionRanges(combined);
    } else if (answerMarker >= 0) {
      const answerStart = answerMarker + combined.slice(answerMarker).search(/답변내용/) + "답변내용".length;
      ranges = [
        ...redactionRanges(combined.slice(0, answerStart)),
        ...answerAttributionRanges(combined.slice(answerStart)).map((range) => ({
          start: range.start + answerStart,
          end: range.end + answerStart,
        })),
      ];
      answerStarted = true;
    } else {
      ranges = redactionRanges(combined);
    }
    for (const entry of offsets) {
      if (
        !ranges.some(
          (range) => range.start < entry.end && range.end > entry.start,
        )
      )
        continue;
      const item = entry.item;
      const scale = 1.5;
      context.fillStyle = "#000";
      context.fillRect(
        Math.max(0, item.x * scale - 2),
        Math.max(0, canvas.height - (item.y + item.height) * scale - 2),
        Math.max(8, item.width * scale + 4),
        Math.max(8, item.height * scale + 4),
      );
    }
    const image = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) =>
          blob ? resolve(blob) : reject(new Error("MASKED_PDF_IMAGE_FAILED")),
        "image/jpeg",
        0.86,
      ),
    );
    const embedded = await output.embedJpg(await image.arrayBuffer());
    const outPage = output.addPage([
      viewport.width / 1.5,
      viewport.height / 1.5,
    ]);
    outPage.drawImage(embedded, {
      x: 0,
      y: 0,
      width: outPage.getWidth(),
      height: outPage.getHeight(),
    });
    canvas.width = 0;
    canvas.height = 0;
    }
    return await output.save();
  } finally {
    // Cleanup failures must never turn a successfully redacted PDF into an
    // upload failure. PDF.js versions expose cleanup through different paths.
    try {
      await proxy.destroy();
    } catch {}
  }
}
function maskedRecord(row: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => {
      if (key === "application_number" || key === "receipt_number") return [key, value];
      if (key === "answer") return [key, maskBusinessIdentifiers(maskAnswerAttribution(value).value)];
      if (key === "question" || key === "content")
        return [key, mask(value).value];
      if (/handler|processor|담당|처리자/i.test(key))
        return [key, mask(`담당자: ${value}`).value.replace(/^담당자:\s*/, "")];
      return [key, mask(value).value];
    }),
  );
}
type Structured = BrowserPrivacyPayload["structuredComplaint"];
function has(text: string, pattern: RegExp) {
  return pattern.test(text);
}
function fallbackSummary(masked: string): Structured {
  const facts: string[] = [];
  const issues: string[] = [];
  const requests: string[] = [];
  if (has(masked, /공공데이터|공개\s*(?:정보|API)|Open\s*API/i))
    facts.push("불특정 다수에게 공개된 데이터 또는 API를 이용하는 서비스임");
  if (has(masked, /직접\s*입력|입력한\s*정보/))
    facts.push("사용자가 직접 입력한 정보를 서비스 내부에서 활용함");
  if (
    has(masked, /(?:공동|금융)?인증서|간편인증|ID\/?비밀번호/) &&
    has(masked, /이용하지|사용하지|접속하지/)
  )
    facts.push("이용자 인증수단으로 외부 기관 시스템에 접근하지 않음");
  if (
    has(
      masked,
      /개인정보를\s*(?:조회|전송|수집).*않|개인정보를\s*(?:조회|전송|수집)하지/,
    )
  )
    facts.push("외부 기관이 보유한 이용자 개인정보를 조회하거나 전송받지 않음");
  if (has(masked, /전송요구권|본인전송요구/))
    issues.push("해당 서비스 구조가 개인정보 전송요구권 적용 대상인지 여부");
  if (has(masked, /처리기한|처리기간|지연/))
    issues.push("법정 처리기간과 지연 시 적용되는 절차");
  if (has(masked, /동의|제3자\s*제공/))
    issues.push("개인정보 처리의 적법한 근거와 동의 요건");
  if (has(masked, /보유|파기|보존/))
    issues.push("개인정보 보유기간과 파기 의무");
  if (!issues.length)
    issues.push(
      "민원에서 제시한 업무 구조에 적용되는 개인정보 보호 법령상 기준",
    );
  if (has(masked, /적용\s*(?:대상|여부)|해당하는지/))
    requests.push("법령 적용 대상 여부와 판단 기준 안내 요청");
  if (has(masked, /추가.*(?:검토|준수)|준수.*사항/))
    requests.push("추가로 검토하거나 준수해야 할 사항 안내 요청");
  if (has(masked, /법령|가이드라인|안내서|근거/))
    requests.push("관련 법령·지침과 구체적인 근거 안내 요청");
  if (!requests.length)
    requests.push("관련 법령과 적용 기준에 근거한 답변 요청");
  const detailedFacts=masked
    .replace(/\[(?:주소|성명|전화번호|이메일|주민등록번호|사업자등록번호|계좌·카드번호|법인명)\]/g, "")
    .replace(/^(?:안녕하세요|안녕하십니까)[.。,]?\s*/i, "")
    .split(/(?<=[.!?다요])\s+|\n+/)
    .map(cleanPoint)
    .filter((sentence)=>sentence.length>=18&&!/^(?:감사합니다|연락|회신)/.test(sentence))
    .slice(0,6);
  return {
    purpose: issues[0],
    essentialFacts: [...facts,...detailedFacts].filter((v,i,a)=>a.indexOf(v)===i).slice(0,6),
    legalQuestions: issues.slice(0, 3),
    requestedAnswer: requests.slice(0, 3),
    uncertainties: [],
  };
}
function cleanPoint(value: unknown) {
  return String(value || "")
    .replace(
      /\[(?:주소|성명|전화번호|이메일|주민등록번호|사업자등록번호|계좌·카드번호|법인명)\]/g,
      "",
    )
    .replace(/\b[12]AA-\d{4}-\d{6,}\b/gi, "")
    .replace(/\b\d{4}-\d{1,2}-\d{1,2}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?\b/g, "")
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/\s+/g, " ")
    .replace(/^[\s:：,.-]+|[\s:：,.-]+$/g, "")
    .slice(0, 180);
}
function normalizeStructured(
  value: Partial<Structured>,
  fallback: Structured,
): Structured {
  const list = (input: unknown, backup: string[]) => {
    const source = Array.isArray(input) ? input : [];
    const cleaned = source
      .map(cleanPoint)
      .filter((v) => v.length >= 5)
      .slice(0, 6);
    return cleaned.length ? cleaned : backup;
  };
  return {
    purpose: cleanPoint(value.purpose) || fallback.purpose,
    essentialFacts: list(value.essentialFacts, fallback.essentialFacts),
    legalQuestions: list(value.legalQuestions, fallback.legalQuestions),
    requestedAnswer: list(value.requestedAnswer, fallback.requestedAnswer),
    uncertainties: list(value.uncertainties, []),
  };
}
function copiedOriginalPassage(outbound: string, masked: string) {
  const source = masked.replace(/\s+/g, " ");
  return outbound
    .split(/\n/)
    .map((v) => v.replace(/^[-\s]+/, "").trim())
    .some((v) => v.length >= 55 && source.includes(v));
}
function outboundOf(value: BrowserPrivacyPayload["structuredComplaint"]) {
  return [
    `민원 목적: ${value.purpose}`,
    `핵심 사실:\n- ${value.essentialFacts.join("\n- ")}`,
    `법적 쟁점:\n- ${value.legalQuestions.join("\n- ")}`,
    `답변 요청사항:\n- ${value.requestedAnswer.join("\n- ")}`,
    value.uncertainties.length
      ? `추가 확인사항:\n- ${value.uncertainties.join("\n- ")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}
function jsonObject(text: string) {
  const found = text.match(/\{[\s\S]*\}/);
  if (!found) throw new Error("LOCAL_MODEL_INVALID_RESPONSE");
  return JSON.parse(found[0]) as Partial<
    BrowserPrivacyPayload["structuredComplaint"]
  >;
}

export async function preparePdfInBrowser(
  file: File,
  onProgress: (message: string, progress: number) => void,
): Promise<{ privacy: BrowserPrivacyPayload; maskedPdf: File }> {
  onProgress("브라우저에서 PDF 텍스트를 추출하고 있습니다.", 12);
  const bytes = await file.arrayBuffer();
  const [digest, extracted] = await Promise.all([
    crypto.subtle.digest("SHA-256", bytes.slice(0)),
    extractText(new Uint8Array(bytes.slice(0)), { mergePages: true }),
  ]);
  const originalHash = Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
  const parsed = parseEpeopleComplaint(
    cleanExtractedText(extracted.text),
    file.name,
  );
  if (!parsed)
    throw new Error(
      "민원 양식을 인식하지 못했습니다. 안내서 PDF라면 파일명에 안내서를 포함해 주세요.",
    );
  if ((parsed.question || "").length < 20 || (parsed.answer || "").length < 20)
    throw new Error(
      `질의 또는 답변을 분리하지 못했습니다 (질의 ${parsed.question?.length || 0}자, 답변 ${parsed.answer?.length || 0}자).`,
    );
  onProgress("개인정보를 브라우저 안에서 마스킹하고 있습니다.", 28);
  const first = mask(parsed.question);
  const safeRecord = maskedRecord(parsed);
  const safeFallback = fallbackSummary(first.value);
  let structured = safeFallback;
  let localModel = "브라우저 보안 요약기";
  if ("gpu" in navigator) {
    try {
      onProgress(
        "브라우저 로컬 AI를 준비하고 있습니다. 최초 1회는 모델 다운로드가 필요합니다.",
        36,
      );
      const { CreateMLCEngine } = await import("@mlc-ai/web-llm");
      const engine = await CreateMLCEngine(MODEL, {
        initProgressCallback: (report) =>
          onProgress(
            `브라우저 로컬 AI 준비: ${report.text}`,
            36 + Math.round(report.progress * 24),
          ),
      });
      onProgress(
        "로컬 AI가 핵심 내용을 정리하고 있습니다. 최대 20초 후 빠른 요약으로 전환합니다.",
        64,
      );
      const completion = engine.chat.completions.create({
        messages: [
          {
            role: "system",
            content:
              "개인정보와 법인명이 마스킹된 한국어 민원을 외부 AI 전송용으로 재작성한다. 사건번호·날짜·연락처·인명·법인명·주소 등 식별정보는 모두 제거하되, 서비스 운영 방식, 데이터 흐름, 당사자가 제시한 전제, 예외 조건, 법적 쟁점과 답변 요청 맥락은 충분히 보존한다. 지나치게 짧게 요약하지 말고 원문에 없는 사실은 만들지 않는다. JSON만 출력하며 키는 purpose 문자열, essentialFacts 문자열 배열, legalQuestions 문자열 배열, requestedAnswer 문자열 배열, uncertainties 문자열 배열이다. essentialFacts는 최대 6개, 나머지 배열은 최대 4개, 각 문장은 180자 이내로 작성한다.",
          },
          { role: "user", content: first.value.slice(0, 7000) },
        ],
        temperature: 0,
        max_tokens: 650,
        response_format: { type: "json_object" },
      });
      void completion.finally(() => engine.unload()).catch(() => undefined);
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("LOCAL_MODEL_TIMEOUT")), 35000),
      );
      const result = await Promise.race([completion, timeout]);
      const candidate = normalizeStructured(
        jsonObject(result.choices[0]?.message?.content || ""),
        safeFallback,
      );
      structured = copiedOriginalPassage(outboundOf(candidate), first.value)
        ? safeFallback
        : candidate;
      localModel = MODEL;
    } catch {
      localModel = "브라우저 보안 요약기(WebGPU 대체 모드)";
    }
  }
  onProgress(
    "AI 전송 예정자료에 개인정보가 남았는지 다시 검사하고 있습니다.",
    78,
  );
  let outbound = outboundOf(structured);
  if (copiedOriginalPassage(outbound, first.value)) {
    structured = safeFallback;
    outbound = outboundOf(structured);
  }
  const second = mask(outbound.slice(0, 3200));
  if (mask(second.value).value !== second.value)
    throw new Error("요약문 개인정보 재검사에 실패했습니다.");
  onProgress("개인정보가 제거된 PDF 사본을 생성하고 있습니다.", 82);
  const maskedBytes = await createMaskedPdf(bytes.slice(0), onProgress);
  const maskedPdf = new File([maskedBytes], file.name, {
    type: "application/pdf",
    lastModified: Date.now(),
  });
  const maskedDigest = await crypto.subtle.digest("SHA-256", maskedBytes);
  const maskedHash = Array.from(new Uint8Array(maskedDigest), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
  const privacy: BrowserPrivacyPayload = {
    sourceHash: maskedHash,
    originalHash,
    questionLength: parsed.question.length,
    answerLength: parsed.answer.length,
    maskedQuestion: first.value,
    outboundText: second.value,
    outboundSafe: true,
    piiSummary: { ...first.counts, ...second.counts },
    structuredComplaint: structured,
    localModel,
    schemaVersion: 9,
    maskedRecord: safeRecord,
  };
  return { privacy, maskedPdf };
}
