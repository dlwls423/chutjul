import {
  formatComplaintAnswer,
  normalizeInquirySummary,
} from "../lib/answer-template.ts";

const normalized = normalizeInquirySummary(
  "신용카드 결제내역 스크래핑의 법적 허용 여부 문의함.",
);
if (normalized !== "신용카드 결제내역 스크래핑의 법적 허용 여부") {
  throw new Error("INQUIRY_NORMALIZATION_REGRESSION");
}

const answer = formatComplaintAnswer({
  applicationNumber: "1AA-2026-1234567",
  inquirySummary: `${normalized} 문의함.`,
  sections: [
    { heading: "허용 여부", answer: "선택 근거에 따른 검토 내용입니다. [E1]" },
    { heading: "관련 기준", answer: "관련 조문의 적용 여부를 확인합니다. [E2]" },
  ],
  department: "테스트부서",
  userName: "테스트사용자",
  position: "주무관",
  officePhone: "02-2100-0000",
});

for (const expected of [
  "1. 안녕하십니까.",
  "에 대해 문의하신 것으로 이해됩니다.",
  "가. 허용 여부",
  "나. 관련 기준",
  "3. 답변 내용에 대한 추가 설명",
]) {
  if (!answer.includes(expected)) throw new Error(`ANSWER_FORMAT_REGRESSION:${expected}`);
}
if (answer.includes("문의함.에 대해")) throw new Error("DUPLICATE_INQUIRY_ENDING");
console.log("answer template regression: ok");
