import { strict as assert } from "node:assert";
import { buildGuideEvidence } from "../lib/guide-indexing.ts";

const pages = [
  "개인정보 처리 안내서\n제1장 총칙\n1. 목적\n이 안내서는 개인정보 처리 업무의 기준을 설명합니다.\n- 확인 사항\n- 기록 방법\n1",
  "개인정보 처리 안내서\n제2장 파기\n2.1 파기 절차\n개인정보 보호법 제21조에 따라 보유기간이 지나면 지체 없이 파기합니다.\n2",
  "개인정보 처리 안내서\n자주 묻는 질문\nQ. 회원 탈퇴 뒤 개인정보는 언제 삭제하나요?\n목적 달성 후 관련 법령에 따른 보존기간을 확인합니다.\n3",
];
const chunks = buildGuideEvidence("개인정보 처리 안내서", pages, ["제1장 총칙", "제2장 파기", "자주 묻는 질문"]);
assert.equal(chunks[0].chunkKind, "guide_overview");
assert.ok(chunks.some((chunk) => chunk.sectionPath.includes("제2장 파기")));
assert.ok(chunks.some((chunk) => chunk.legalReferences.some((ref) => ref.includes("제21조"))));
assert.ok(chunks.some((chunk) => chunk.contentType === "faq"));
assert.ok(chunks.every((chunk) => !chunk.content.includes("\n개인정보 처리 안내서\n")));
console.log(`guide indexing regression: ok (${chunks.length} chunks)`);
