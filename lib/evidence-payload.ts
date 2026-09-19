export function complaintEvidencePayload(questionSummary: string, officialAnswer: string) {
  const summary = questionSummary.replace(/\u0000/g, "").trim();
  const answer = officialAnswer.replace(/\u0000/g, "").trim();
  return [
    summary && `질문 요약:\n${summary}`,
    answer && `답변:\n${answer}`,
  ].filter(Boolean).join("\n\n");
}
