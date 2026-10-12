// Shared by browser text/PDF masking, ingestion, and outbound inspection.
// Return fresh regexes so callers never share mutable global-regex state.
export const PHONE_SOURCE = String.raw`(?<!\d)(?:(?:\+?82[-.\s]*(?:\(0\)[-.\s]*)?)0?|0)(?:2|1[016789]|[3-6][1-5]|70)[-.\s]?\d{3,4}[-.\s]?\d{4}(?!\d)`;
const TITLES = '대표이사|대표|이사|상무|전무|부장|차장|과장|팀장|주무관|사무관|책임연구원|선임연구원|연구원|교수|변호사|노무사|회계사|담당자|처리자';
const END = String.raw`(?=\s|$|[,.)/（）"'])`;

export function phoneNumberPattern() {
  return new RegExp(PHONE_SOURCE, 'g');
}

export function labeledNamePattern() {
  // A colon explicitly identifies a field. Without it, preserve the legal
  // phrase "민원인 권리" rather than treating the noun as a person's name.
  return new RegExp(String.raw`(?<![가-힣])(?:성명|이름|민원인|대표자|담당자|처리자|예금주)(?:\s*[:：]\s*|\s*(?!권리))[가-힣]{2,5}${END}`, 'g');
}

export function nameBeforeTitlePattern() {
  return new RegExp(String.raw`(?<![가-힣])[가-힣]{2,4}(?=\s+(?:${TITLES})${END})`, 'g');
}

export function nameAfterTitlePattern() {
  // Require a separator: "대표적인" is a word, not "대표" plus a name.
  return new RegExp(String.raw`(?<![가-힣])(?:${TITLES})(?:\s*[:：]\s*|\s+)(?!권리)[가-힣]{2,4}${END}`, 'g');
}
