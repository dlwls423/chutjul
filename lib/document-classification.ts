export const GUIDE_FILE_KEYWORDS = [
  "안내서", "가이드라인", "모델", "표준", "명세", "핸드북",
  "메뉴얼", "매뉴얼", "모음집", "가이드", "작성지침", "우수사례집",
] as const;

export function hasGuideFileKeyword(fileName: string) {
  const normalized = fileName.normalize("NFKC").toLowerCase();
  return GUIDE_FILE_KEYWORDS.some((keyword) =>
    normalized.includes(keyword.normalize("NFKC").toLowerCase()),
  );
}
