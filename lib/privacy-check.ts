export type SensitiveFinding = { type: string; value: string };
export function detectResidualSensitiveInfo(text: string) {
  const findings: SensitiveFinding[] = [];
  const rules: [string, RegExp][] = [
    [
      "휴대전화",
      /(?:\+?82[-.\s]?)?0(?:2|1[016789]|[3-6][1-5]|70)[-.\s]?\d{3,4}[-.\s]?\d{4}/g,
    ],
    ["이메일", /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi],
    ["주민등록번호", /\b\d{6}[-\s]?[1-8]\d{6}\b/g],
    ["사업자등록번호", /\b\d{3}[-\s]?\d{2}[-\s]?\d{5}\b/g],
    [
      "계좌·카드번호",
      /(?:계좌|카드)(?:번호)?\s*[:：]?\s*\d{3,6}(?:[-\s]\d{2,6}){2,3}/g,
    ],
    ["주소", /(?:주소|소재지|거주지)\s*[:：]\s*[^\n]{5,80}/g],
    [
      "성명",
      /(?:성명|이름|민원인|대표자|담당자|처리자)\s*[:：]\s*[가-힣]{2,5}(?=\s|$|[,.)])/g,
    ],
  ];
  for (const [type, pattern] of rules)
    for (const match of text.matchAll(pattern)) {
      if (
        /\[(?:주소|성명|전화번호|이메일|주민등록번호|사업자등록번호|계좌·카드번호)\]/.test(
          match[0],
        )
      )
        continue;
      findings.push({ type, value: match[0] });
    }
  return findings;
}
