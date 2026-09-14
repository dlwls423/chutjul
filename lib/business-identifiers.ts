const COMPLAINT_IDENTIFIER = /\b(?:1AA|2AA)-\d{4}-\d{6,}\b/gi;

export function maskBusinessIdentifiers(value: string) {
  return String(value || "").replace(COMPLAINT_IDENTIFIER, "[업무식별자]");
}

export function removeBusinessIdentifiers(value: string) {
  return String(value || "")
    .replace(COMPLAINT_IDENTIFIER, "")
    .replace(/\[업무식별자\]/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

export function repairKnownOvermasking(value: string) {
  return String(value || "")
    .replace(/\[(?:비식별|성명)\]\s*처리자/g, "개인정보처리자")
    .replace(/\[(?:비식별|성명)\]\s*보호법/g, "개인정보 보호법");
}
