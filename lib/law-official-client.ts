const BASE = "https://www.law.go.kr/DRF";
const RETRYABLE = new Set([429, 500, 502, 503, 504]);

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function looksLikeJson(value: string) {
  const trimmed = value.trim();
  return trimmed.startsWith("{") || trimmed.startsWith("[");
}

export async function fetchOfficialLawJson(path: "lawSearch.do" | "lawService.do", params: Record<string, string>) {
  const url = new URL(`${BASE}/${path}`);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  let lastError = "LAW_API_FAILED";

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await fetch(url, {
        cache: "no-store",
        redirect: "follow",
        signal: controller.signal,
        headers: {
          Accept: "application/json,text/plain;q=0.9,*/*;q=0.5",
          Referer: "https://www.law.go.kr/",
          "User-Agent": "Mozilla/5.0 (compatible; ChutjulLegalSync/1.0; +https://www.law.go.kr/)",
        },
      });
      const body = await response.text();
      if (!response.ok) {
        lastError = `LAW_API_${response.status}`;
        if (!RETRYABLE.has(response.status)) throw new Error(lastError);
      } else if (looksLikeJson(body)) {
        return JSON.parse(body) as unknown;
      } else {
        lastError = body.trim().startsWith("<") ? "LAW_API_HTML_RESPONSE" : "LAW_API_EMPTY_RESPONSE";
      }
    } catch (error) {
      lastError = error instanceof Error && error.name !== "AbortError" ? error.message : "LAW_API_TIMEOUT";
    } finally {
      clearTimeout(timer);
    }
    if (attempt < 3) await delay(350 * 2 ** attempt);
  }
  throw new Error(lastError);
}
