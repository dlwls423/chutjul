export type DraftSection = { heading: string; answer: string };

const KOREAN_SECTION_LABELS = ["가", "나", "다", "라"];

export function normalizeInquirySummary(value: string) {
  return value
    .trim()
    .replace(/[.。]\s*$/, "")
    .replace(
      /\s*(?:에\s*대해\s*)?(?:문의|질의)(?:하신\s*내용|한\s*내용|사항)?(?:함|드립니다|드림|입니다)?\s*$/,
      "",
    )
    .replace(/[.。]\s*$/, "")
    .trim();
}

export function formatComplaintAnswer(input: {
  applicationNumber?: string;
  inquirySummary: string;
  sections: DraftSection[];
  department: string;
  userName: string;
  position: string;
  officePhone: string;
}) {
  const applicationNumber = input.applicationNumber?.trim() || "확인 필요";
  const phone = /^0\d{1,2}-\d{3,4}-\d{4}$/.test(input.officePhone.trim())
    ? input.officePhone.trim()
    : "02-2100-0000";
  const sectionText = input.sections
    .slice(0, KOREAN_SECTION_LABELS.length)
    .map(
      (section, index) =>
        `  ${KOREAN_SECTION_LABELS[index]}. ${section.heading.trim()}\n\n  ${section.answer.trim()}`,
    )
    .join("\n\n");

  const inquirySummary =
    normalizeInquirySummary(input.inquirySummary) || "제시하신 사항";

  return [
    `1. 안녕하십니까. 개인정보보호위원회입니다. 귀하께서 국민신문고를 통해 신청하신 민원(신청번호: ${applicationNumber})에 대한 검토 결과를 다음과 같이 알려드립니다.`,
    `2. 귀하께서는 ${inquirySummary}에 대해 문의하신 것으로 이해됩니다.`,
    sectionText,
    `3. 답변 내용에 대한 추가 설명이 필요한 경우 개인정보보호위원회 ${input.department} ${input.userName} ${input.position} (☏${phone})으로 연락주시면 친절히 안내해 드리도록 하겠습니다. 감사합니다. 끝.`,
  ]
    .filter(Boolean)
    .join("\n\n");
}
