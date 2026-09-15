import { buildGuideEvidence } from "../lib/guide-indexing.ts";

const chunks = buildGuideEvidence("개인정보 처리 안내서", [
  "1. 전송요구권 적용 기준\n정보주체는 개인정보 보호법 제35조의2에 따라 전송을 요구할 수 있습니다. 공개 정보는 적용 범위를 별도로 검토합니다.",
  "2. 처리 절차\n본인 확인 후 요청 범위와 전송 대상을 확인합니다. 처리자는 검토 근거를 기록해야 합니다.",
], ["1. 전송요구권 적용 기준", "2. 처리 절차"]);

if (chunks.length < 3) throw new Error(`too few chunks: ${chunks.length}`);
const legal = chunks.find((chunk) => chunk.legalReferences.some((reference) => reference.includes("제35조의2")));
if (!legal || legal.pageNumber !== 1 || legal.sectionTitle !== "1. 전송요구권 적용 기준") throw new Error("legal evidence metadata missing");
const procedure = chunks.find((chunk) => chunk.content.includes("본인 확인"));
if (!procedure || procedure.pageNumber !== 2 || procedure.sectionTitle !== "2. 처리 절차") throw new Error("page or section metadata missing");
console.log(`guide indexing regression: ok (${chunks.length} chunks)`);
