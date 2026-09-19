import { summarizeAnswerForRetrieval } from "../lib/retrieval-summary.ts";

const original = `
1. 안녕하십니까. 개인정보보호위원회입니다. 귀하께서 국민신문고를 통해 신청하신 민원에 대한 검토 결과를 다음과 같이 알려드립니다.
2. 귀하께서는 공개된 정보를 자동화된 도구로 수집하는 행위에 대해 문의하신 것으로 이해됩니다.
가. 개인정보 보호법 제35조의2에 따라 정보주체는 본인에 관한 개인정보의 전송을 요구할 수 있습니다.
불특정 다수가 접근할 수 있도록 공개된 정보라면 본인전송요구권에 따른 전송 대상 정보에는 해당하지 않을 것으로 판단됩니다.
나. 다만, 홈페이지 운영자가 공개 정보에 대한 자동화된 접근을 이용약관으로 제한하는지는 별도로 확인해야 합니다.
답변 내용에 대한 추가 설명이 필요한 경우 담당 부서로 연락주시면 친절히 안내해 드리겠습니다. 감사합니다. 끝.
`;

const summary = summarizeAnswerForRetrieval(original);
for (const required of ["제35조의2", "해당하지", "다만", "별도로 확인"])
  if (!summary.includes(required)) throw new Error(`missing core answer: ${required}`);
for (const excluded of ["안녕하십니까", "국민신문고", "연락주시면", "감사합니다"])
  if (summary.includes(excluded)) throw new Error(`boilerplate leaked: ${excluded}`);
if (summary.length > 1201) throw new Error(`summary too long: ${summary.length}`);
console.log(`retrieval answer summary regression: ok (${summary.length} chars)`);
