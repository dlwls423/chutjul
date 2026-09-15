import { removeBusinessIdentifiers } from "./business-identifiers";

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

export function summarizeQuestionForRetrieval(question: string, browserSummary = "") {
  const safe = removeBusinessIdentifiers(browserSummary || question);
  return select(safe, 8, 2400) || "질의 요약 없음";
}

export function summarizeAnswerForRetrieval(answer: string) {
  const safe = removeBusinessIdentifiers(answer);
  return select(safe, 10, 3200) || "답변 요약 없음";
}
