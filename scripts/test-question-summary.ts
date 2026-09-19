import { summarizeQuestionForRetrieval } from "../lib/retrieval-summary.ts";

const summary = summarizeQuestionForRetrieval("긴 민원 원문", "긴 외부 전송자료", {
  purpose: "회원 탈퇴 이후 개인정보 보유 문제",
  essentialFacts: ["쇼핑몰 회원 탈퇴 후 두 달이 지났지만 과거 배송지와 연락처가 계정 복구 화면에 조회됨"],
  legalQuestions: ["해당 개인정보가 즉시 삭제 대상인지"],
  requestedAnswer: ["해당 정보가 즉시 삭제 대상인지 확인 요청"],
});

for (const required of ["회원 탈퇴 후 두 달", "배송지와 연락처", "즉시 삭제 대상", "확인을 요청함"])
  if (!summary.includes(required)) throw new Error(`missing question core: ${required}`);
for (const excluded of ["긴 민원 원문", "긴 외부 전송자료"])
  if (summary.includes(excluded)) throw new Error(`raw question leaked: ${excluded}`);
if (summary.length > 361) throw new Error(`question summary too long: ${summary.length}`);
console.log(`question summary regression: ok (${summary})`);
