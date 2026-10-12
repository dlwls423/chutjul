import { serviceRequest } from "./auth";

type Source = { id: string; owning_department: string };
export type RoutingDocument = {
  id: string;
  source_file_id: string;
  title: string;
  category_major: string | null;
  category_middle: string | null;
  category_minor: string | null;
  question_summary: string | null;
  metadata: Record<string, unknown> | null;
};
export type RoutingCandidate = {
  department: string;
  likelihood: number;
  matchedKeywords: string[];
  sampleBand: string;
  isCurrent: boolean;
};
export type DepartmentRouting = {
  scope: "aggregate_only";
  currentDepartment: string;
  status: "ready" | "no_signal" | "unavailable";
  candidates: RoutingCandidate[];
  issues: Array<{ issue: string; candidates: RoutingCandidate[] }>;
  notice: string;
  evaluatedAt: string;
};
const stopWords = new Set([
  "관련",
  "대한",
  "대해",
  "문의",
  "요청",
  "여부",
  "어떻게",
  "무엇인지",
  "알려",
  "주세요",
  "확인",
  "경우",
  "있는지",
  "하는지",
  "그리고",
  "또한",
  "안녕하세요",
  "안녕하십니까",
  "민원",
  "답변",
  "작성",
  "필요",
  "합니다",
  "있습니다",
  "질문",
  "사항",
]);
function terms(value: string) {
  return [
    ...new Set(
      value
        .normalize("NFKC")
        .toLocaleLowerCase("ko-KR")
        .replace(/[^0-9a-z가-힣\s]/g, " ")
        .split(/\s+/)
        .map((term) =>
          term.length > 3
            ? term.replace(/(?:으로|에서|에게|에|의|을|를|은|는|이|가)$/, "")
            : term,
        )
        .filter((term) => term.length > 1 && !stopWords.has(term)),
    ),
  ].slice(0, 32);
}
function retrieval(doc: RoutingDocument) {
  const meta = (doc.metadata?.retrieval || {}) as Record<string, unknown>;
  return [
    doc.title,
    doc.category_major,
    doc.category_middle,
    doc.category_minor,
    doc.question_summary,
    meta.question_summary,
  ]
    .filter(Boolean)
    .join(" ")
    .normalize("NFKC")
    .toLocaleLowerCase("ko-KR");
}

export function rankDepartments(
  currentDepartment: string,
  query: string,
  sources: Source[],
  documents: RoutingDocument[],
): RoutingCandidate[] {
  const keywords = terms(query);
  if (!keywords.length) return [];
  const owner = new Map(
    sources.map((source) => [source.id, source.owning_department]),
  );
  const corpus = [
    ...new Map(documents.map((doc) => [doc.id, doc])).values(),
  ].filter((doc) => owner.get(doc.source_file_id));
  const texts = corpus.map((doc) => ({ doc, text: retrieval(doc) }));
  const weights = new Map(
    keywords.map((term) => [
      term,
      1 +
        Math.log(
          (corpus.length + 1) /
            (1 + texts.filter((entry) => entry.text.includes(term)).length),
        ),
    ]),
  );
  const totalWeight = [...weights.values()].reduce((a, b) => a + b, 0);
  const departments = new Map<
    string,
    { scores: number[]; matched: Set<string> }
  >();
  for (const { doc, text } of texts) {
    const matched = keywords.filter((term) => text.includes(term));
    if (matched.length < Math.min(2, keywords.length)) continue;
    const score =
      matched.reduce((sum, term) => sum + weights.get(term)!, 0) / totalWeight;
    const department = owner.get(doc.source_file_id)!;
    const bucket = departments.get(department) || {
      scores: [],
      matched: new Set<string>(),
    };
    bucket.scores.push(score);
    matched.forEach((term) => bucket.matched.add(term));
    departments.set(department, bucket);
  }
  // Never expose a department's signal from fewer than three distinct complaints.
  // Mean of strongest five matches prevents larger departments winning by volume alone.
  const ranked = [...departments]
    .filter(([, bucket]) => bucket.scores.length >= 3)
    .map(([department, bucket]) => {
      const best = bucket.scores.sort((a, b) => b - a).slice(0, 5);
      return {
        department,
        score: best.reduce((a, b) => a + b, 0) / best.length,
        matchedKeywords: keywords
          .filter((term) => bucket.matched.has(term))
          .slice(0, 6),
        sampleBand:
          bucket.scores.length < 10
            ? "3~9건"
            : bucket.scores.length < 50
              ? "10~49건"
              : "50건 이상",
        isCurrent: department === currentDepartment,
      };
    })
    .sort(
      (a, b) =>
        b.score - a.score || a.department.localeCompare(b.department, "ko"),
    );
  const total = ranked.reduce((sum, item) => sum + item.score, 0);
  if (!total) return [];
  const shares = ranked.map((item) => (item.score / total) * 100);
  const percentages = shares.map(Math.floor);
  const order = shares
    .map((share, index) => ({ index, remainder: share - Math.floor(share) }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  const remaining = 100 - percentages.reduce((a, b) => a + b, 0);
  for (let i = 0; i < remaining; i++) percentages[order[i].index]++;
  return ranked.map(({ score, ...item }, index) => ({
    ...item,
    likelihood: percentages[index],
  }));
}

async function allRows<T>(path: string, signal?: AbortSignal): Promise<T[]> {
  const result: T[] = [];
  let offset = 0;
  // Supabase may cap a page below the requested limit. Follow its actual size.
  while (true) {
    const page = await serviceRequest<T[]>(
      `${path}&order=id.asc&limit=1000&offset=${offset}`,
      { signal },
    );
    if (!page.length) return result;
    result.push(...page);
    offset += page.length;
  }
}
export async function analyzeDepartmentRouting(
  currentDepartment: string,
  issues: string[],
  signal?: AbortSignal,
): Promise<DepartmentRouting> {
  const queries = issues
    .map((issue) => issue.trim())
    .filter(Boolean)
    .slice(0, 4);
  const base = {
    scope: "aggregate_only" as const,
    currentDepartment,
    evaluatedAt: new Date().toISOString(),
    candidates: [],
    issues: [],
    notice:
      "전체 부서의 준비 완료 민원을 비교한 검색 점수 기반 상대 가능성입니다. 실제 소관 확률이나 확정 판정이 아닙니다. 부서별 일치 민원이 3건 미만이면 제외하며, 제외된 부서의 가능성이 0이라는 뜻은 아닙니다. 다른 부서 원문·답변·개별 출처는 공개하거나 외부 AI에 제공하지 않습니다.",
  };
  if (!queries.length) return { ...base, status: "no_signal" };
  try {
    const sources = await allRows<Source>(
      "/rest/v1/source_files?select=id,owning_department",
      signal,
    );
    const documents = await allRows<RoutingDocument>(
      "/rest/v1/rag_documents?document_type=eq.complaint&status=eq.ready&select=id,source_file_id,title,category_major,category_middle,category_minor,question_summary,metadata",
      signal,
    );
    const candidates = rankDepartments(
      currentDepartment,
      queries.join(" "),
      sources,
      documents,
    );
    return {
      ...base,
      status: candidates.length ? "ready" : "no_signal",
      candidates,
      issues:
        queries.length > 1
          ? queries.map((issue) => ({
              issue,
              candidates: rankDepartments(
                currentDepartment,
                issue,
                sources,
                documents,
              ),
            }))
          : [],
    };
  } catch {
    return { ...base, status: "unavailable" };
  }
}
