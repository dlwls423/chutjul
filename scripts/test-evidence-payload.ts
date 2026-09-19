import { complaintEvidencePayload } from "../lib/evidence-payload.ts";

const originalQuestion = "민원인 개인의 상세한 원문 질문과 식별 가능한 구체적 사정";
const summary = "공개정보 수집에 개인정보 전송요구권이 적용되는지 질의";
const answer = "개인정보 보호법 제35조의2의 요건을 충족하는지 확인해야 합니다.";
const payload = complaintEvidencePayload(summary, answer);

if (!payload.includes(`질문 요약:\n${summary}`)) throw new Error("question summary missing");
if (!payload.includes(`답변:\n${answer}`)) throw new Error("official answer missing");
if (payload.includes(originalQuestion)) throw new Error("original question leaked");
console.log("complaint evidence payload regression: ok");
