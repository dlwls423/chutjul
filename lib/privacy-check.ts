import { phoneNumberPattern, labeledNamePattern, nameBeforeTitlePattern, nameAfterTitlePattern } from "./privacy-patterns";
import { vehicleNumberPattern } from "./vehicle-identifiers";

export type SensitiveFinding = { type: string; value: string };
export function detectResidualSensitiveInfo(text: string) {
  const findings: SensitiveFinding[] = [];
  const rules: [string, RegExp][] = [
    ["업무식별자", /\b(?:1AA|2AA)-\d{4}-\d{6,}\b/gi],
    ["차량번호", vehicleNumberPattern()],
    [
      "휴대전화",
      phoneNumberPattern(),
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
      labeledNamePattern(),
    ],
    ["직함 인접 성명", nameBeforeTitlePattern()],
    ["직함 인접 성명", nameAfterTitlePattern()],
    ["법인명", /(?:㈜|\(주\)|주식회사|유한회사|합자회사|합명회사|사단법인|재단법인|법무법인|의료법인|학교법인|농업회사법인)\s*[가-힣A-Za-z0-9&·_-]{2,30}|[가-힣A-Za-z0-9&·_-]{2,30}\s*(?:㈜|\(주\)|주식회사|유한회사|합자회사|합명회사)/g],
  ];
  for (const [type, pattern] of rules)
    for (const match of text.matchAll(pattern)) {
      if (
        /\[(?:주소|성명|전화번호|이메일|주민등록번호|사업자등록번호|계좌·카드번호|법인명|차량번호)\]/.test(
          match[0],
        )
      )
        continue;
      findings.push({ type, value: match[0] });
    }
  return findings;
}
