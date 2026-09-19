import { removeBusinessIdentifiers } from "./business-identifiers.ts";

function sentences(value: string) {
  return value
    .replace(/\u0000/g, "")
    .split(/(?<=[.!?다요])\s+|\n+/)
    .map((item) => item.replace(/\s+/g, " ").trim())
    .filter((item) => item.length >= 12);
}

function select(value: string, maxSentences: number, maxChars: number) {
  const all = sentences(value);
  const legal = all.filter((item) => /(?:법|시행령|고시|제\s*\d+조|요건|의무|권리|적용|위반|가능|필요)/.test(item));
  const selected = [...new Set([...legal, ...all])].slice(0, maxSentences);
  return selected.join(" ").slice(0, maxChars).trim();
}

type StructuredQuestion = {
  purpose?: unknown;
  essentialFacts?: unknown;
  legalQuestions?: unknown;
  requestedAnswer?: unknown;
};

function compactLine(value: unknown) {
  return removeBusinessIdentifiers(String(value || ""))
    .replace(/^(?:핵심 사실|법적 쟁점|답변 요청사항|질의 목적)\s*[:：-]?\s*/g, "")
    .replace(/^[\s•*-]+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function compactRequest(value: string) {
  const clean = value
    .replace(/(?:인지|하는지)\s*(?:문의|질의)(?:함|합니다)?[.]?$/g, "인지 확인을 요청함.")
    .replace(/(?:여부를?)\s*(?:문의|질의)(?:함|합니다)?[.]?$/g, "여부 확인을 요청함.")
    .replace(/(?:알려\s*달라|답변을?\s*요청)(?:고\s*)?(?:함|합니다)?[.]?$/g, "확인을 요청함.")
    .replace(/확인\s*요청[.]?$/g, "확인을 요청함.");
  if (/[.?!]$/.test(clean)) return clean;
  if (/(?:요청함|확인 필요|문의함|질의함)$/.test(clean)) return `${clean}.`;
  return `${clean} 확인을 요청함.`;
}

function asSentence(value: string) {
  return /[.?!]$/.test(value) ? value : `${value}.`;
}

export function summarizeQuestionForRetrieval(question: string, browserSummary = "", structured: StructuredQuestion = {}) {
  const facts = Array.isArray(structured.essentialFacts) ? structured.essentialFacts.map(compactLine).filter(Boolean) : [];
  const requests = Array.isArray(structured.requestedAnswer) ? structured.requestedAnswer.map(compactLine).filter(Boolean) : [];
  const issues = Array.isArray(structured.legalQuestions) ? structured.legalQuestions.map(compactLine).filter(Boolean) : [];
  const purpose = compactLine(structured.purpose);
  const fact = facts[0] || purpose;
  const request = requests[0] || issues[0];
  const compact = [fact && asSentence(fact), request && compactRequest(request)]
    .filter((value, index, all): value is string => Boolean(value) && all.indexOf(value) === index)
    .join(" ");
  if (compact) return trimAtSentence(compact, 360);
  const safe = removeBusinessIdentifiers(browserSummary || question);
  return select(safe, 3, 500) || "질의 요약 없음";
}

const answerBoilerplate = /안녕하십니까|개인정보보호위원회입니다|국민신문고를 통해|검토 결과를 다음과 같이|귀하께서는.+문의|추가 설명이 필요한 경우|연락주시면|친절히 안내|감사합니다|\s끝[.]?$/;
const legalBasis = /(?:개인정보 보호법|시행령|시행규칙|고시|가이드라인|안내서|제\s*\d+\s*조|제\s*\d+\s*항|제\s*\d+\s*호)/;
const conclusion = /(?:해당하지|해당할|적용되지|적용될|가능합니다|가능하지|허용되지|허용됩니다|필요합니다|필요하지|판단됩니다|볼 수 있습니다|보기 어렵|준수해야|확인해야)/;
const condition = /(?:다만|단,|경우에는|경우라면|요건|전제|예외|별도로|구체적인 사실관계|추가 확인)/;

function trimAtSentence(value: string, maxChars: number) {
  if (value.length <= maxChars) return value;
  const clipped = value.slice(0, maxChars);
  const boundary = Math.max(clipped.lastIndexOf("다."), clipped.lastIndexOf("요."), clipped.lastIndexOf("."));
  return `${clipped.slice(0, boundary >= maxChars * 0.6 ? boundary + 2 : maxChars).trim()}…`;
}

export function summarizeAnswerForRetrieval(answer: string) {
  const safe = removeBusinessIdentifiers(answer);
  const candidates = sentences(safe)
    .map((text, index) => {
      if (answerBoilerplate.test(text)) return { text, index, score: -100 };
      let score = 0;
      if (legalBasis.test(text)) score += 6;
      if (conclusion.test(text)) score += 6;
      if (condition.test(text)) score += 4;
      if (/따라|근거|대상|범위|의무|권리/.test(text)) score += 2;
      if (text.length > 420) score -= 2;
      return { text, index, score };
    })
    .filter((item) => item.score > -100);
  const important = candidates
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, 5);
  const selected = (important.length ? important : candidates.slice(0, 3))
    .sort((a, b) => a.index - b.index)
    .map((item) => item.text);
  return trimAtSentence([...new Set(selected)].join(" "), 1200) || "답변 요약 없음";
}
