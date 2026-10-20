export type GroundingReview = {
  passed: boolean;
  warnings: string[];
};

const conditionalEvidence = /(?:다만|경우에는|경우에|요건|전제|별도.{0,12}확인|확인해야|확인이 필요)/;
const definitiveConclusion = /(?:즉시.{0,12}(?:파기|삭제).{0,8}(?:대상|해야)|반드시|명백히|위반입니다|불법입니다|해당합니다|해당하지 않습니다|의무가 있습니다|불필요하게 되었으므로)/;
const cautionLanguage = /(?:추가.{0,12}확인|별도.{0,12}확인|확인이 필요|확인해야|확인하시|사실관계.{0,12}확인|경우에 한하여|전제로|단정하기 어렵|달라질 수|보존.{0,12}(?:의무|근거).{0,12}확인)/;
const highRiskTerms = ["즉시 파기", "즉시 삭제", "반드시", "명백히", "불법", "법 위반"];

function normalize(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

export function reviewDraftGrounding(answerText: string, evidenceText: string): GroundingReview {
  const answer = normalize(answerText);
  const evidence = normalize(evidenceText);
  const warnings: string[] = [];

  if (conditionalEvidence.test(evidence) && definitiveConclusion.test(answer) && !cautionLanguage.test(answer)) {
    warnings.push("근거에 조건·예외가 있으나 답변이 추가 확인 없이 결론을 단정합니다.");
  }

  for (const term of highRiskTerms) {
    if (answer.includes(term) && !evidence.includes(term) && !cautionLanguage.test(answer)) {
      warnings.push(`근거에 없는 강한 결론 표현(“${term}”)이 포함되어 있습니다.`);
    }
  }

  return { passed: warnings.length === 0, warnings: [...new Set(warnings)] };
}
