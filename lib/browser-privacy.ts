"use client";
import { extractText } from "unpdf";
import { cleanExtractedText, parseEpeopleComplaint } from "./epeople-parser";

export type BrowserPrivacyPayload = {
  sourceHash: string;
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
  return { value, counts };
}
function compactLines(text: string) {
  return text
    .split(/\n+/)
    .map((v) => v.trim())
    .filter((v) => v.length > 8 && !/^(안녕하세요|감사합니다|끝\.?$)/.test(v))
    .slice(0, 8);
}
function fallbackSummary(masked: string) {
  const lines = compactLines(masked);
  const questions = lines.filter((v) =>
    /(문의|질의|여부|적용|법령|기준|요청|알려)/.test(v),
  );
  return {
    purpose: (questions[0] || lines[0] || "민원 핵심 쟁점 검토 요청").slice(
      0,
      300,
    ),
    essentialFacts: lines.slice(0, 4),
    legalQuestions: (questions.length ? questions : lines.slice(-2)).slice(
      0,
      3,
    ),
    requestedAnswer: (questions.length
      ? questions
      : ["관련 법령과 적용 기준에 근거한 답변 요청"]
    ).slice(0, 3),
    uncertainties: [],
  };
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
  return JSON.parse(found[0]) as BrowserPrivacyPayload["structuredComplaint"];
}

export async function preparePdfInBrowser(
  file: File,
  onProgress: (message: string, progress: number) => void,
): Promise<BrowserPrivacyPayload> {
  onProgress("브라우저에서 PDF 텍스트를 추출하고 있습니다.", 12);
  const bytes = await file.arrayBuffer();
  const [digest, extracted] = await Promise.all([
    crypto.subtle.digest("SHA-256", bytes),
    extractText(new Uint8Array(bytes), { mergePages: true }),
  ]);
  const sourceHash = Array.from(new Uint8Array(digest), (b) =>
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
  let structured = fallbackSummary(first.value);
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
        "로컬 AI가 법적 쟁점과 답변 요청사항만 정리하고 있습니다.",
        64,
      );
      const result = await engine.chat.completions.create({
        messages: [
          {
            role: "system",
            content:
              "개인정보가 마스킹된 한국어 민원을 구조화한다. 원문에 없는 사실을 만들지 말고 JSON만 출력한다. 키는 purpose 문자열, essentialFacts 문자열 배열, legalQuestions 문자열 배열, requestedAnswer 문자열 배열, uncertainties 문자열 배열이다.",
          },
          { role: "user", content: first.value.slice(0, 12000) },
        ],
        temperature: 0.1,
        max_tokens: 700,
        response_format: { type: "json_object" },
      });
      structured = jsonObject(result.choices[0]?.message?.content || "");
      localModel = MODEL;
      await engine.unload();
    } catch {
      localModel = "브라우저 보안 요약기(WebGPU 대체 모드)";
    }
  }
  onProgress(
    "AI 전송 예정자료에 개인정보가 남았는지 다시 검사하고 있습니다.",
    78,
  );
  const second = mask(outboundOf(structured));
  if (mask(second.value).value !== second.value)
    throw new Error("요약문 개인정보 재검사에 실패했습니다.");
  return {
    sourceHash,
    questionLength: parsed.question.length,
    answerLength: parsed.answer.length,
    maskedQuestion: first.value,
    outboundText: second.value,
    outboundSafe: true,
    piiSummary: { ...first.counts, ...second.counts },
    structuredComplaint: structured,
    localModel,
    schemaVersion: 7,
  };
}
