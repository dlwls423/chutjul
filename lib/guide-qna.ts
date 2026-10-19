export type GuideQna = {
  question: string;
  answer: string;
  pageNumber: number;
  heading: string;
  confidence: number;
};

type CandidatePage = { pageNumber: number; text: string };

function clean(value: string) {
  return value.replace(/\u0000/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

function normalized(value: string) {
  return value.normalize("NFKC").replace(/[\s\p{P}\p{S}]/gu, "").toLocaleLowerCase("ko-KR");
}

function candidateScore(text: string) {
  const header = text.split(/\n+/).slice(0, 14).join(" ");
  let score = 0;
  if (/(질의\s*응답|질문\s*(?:과|및|·|\/)?\s*답변|Q\s*&\s*A|Q&A|FAQ|자주\s*묻는\s*질문|문답)/i.test(header)) score += 8;
  if (/(사례|문의|궁금한\s*점|해설)/.test(header)) score += 2;
  if (/(?:^|\n|\s)(?:Q\s*\d*|질문|질의|문)\s*[:：.)|]/im.test(text)) score += 4;
  if (/(?:^|\n|\s)(?:A\s*\d*|답변|답|해설|검토의견)\s*[:：.)|]/im.test(text)) score += 4;
  if ((text.match(/[?？]/g) || []).length >= 1) score += 2;
  if (/(?:인지|되는지|있는지|가능한지|어떻게|무엇인가|여부)[?？.\s]/.test(text)) score += 2;
  return score;
}

export function selectGuideQnaCandidatePages(sourcePages: string[], limit = 72): CandidatePage[] {
  const pages = sourcePages.map((text, index) => ({ pageNumber: index + 1, text: clean(text) }));
  const direct = new Set(pages.filter((page) => page.text.length >= 80 && candidateScore(page.text) >= 5).map((page) => page.pageNumber));
  // 질문이나 답변이 다음 페이지로 이어지는 안내서를 위해 후보의 바로 앞뒤 페이지도 포함한다.
  const selected = new Set<number>();
  for (const page of direct) for (const adjacent of [page - 1, page, page + 1]) if (adjacent >= 1 && adjacent <= pages.length) selected.add(adjacent);
  return pages.filter((page) => selected.has(page.pageNumber)).slice(0, limit);
}

export async function extractGuideQnaWithAi(args: {
  title: string;
  sourcePages: string[];
  apiKey?: string;
  model?: string;
}) {
  if (!args.apiKey && process.env.AI_PROVIDER !== "ollama") return [] as GuideQna[];
  const candidates = selectGuideQnaCandidatePages(args.sourcePages);
  const extracted: GuideQna[] = [];
  for (let offset = 0; offset < candidates.length; offset += 6) {
    const batch = candidates.slice(offset, offset + 6);
    const source = batch.map((page) => `[[PAGE ${page.pageNumber}]]\n${page.text}`).join("\n\n");
    const schema = {
      type: "object", additionalProperties: false,
      properties: { items: { type: "array", maxItems: 30, items: { type: "object", additionalProperties: false,
        properties: { question: { type: "string" }, answer: { type: "string" }, pageNumber: { type: "integer" }, heading: { type: "string" }, confidence: { type: "number", minimum: 0, maximum: 1 } },
        required: ["question", "answer", "pageNumber", "heading", "confidence"] } } }, required: ["items"],
    };
    try {
      const outputText = await generateStructuredText({
        instructions: "공개 안내서에서 독립적으로 재사용할 수 있는 질의-답변 쌍만 추출한다. Q1/A1 표기만 보지 말고 페이지 제목, 절 제목, 표의 열 제목, 사례·문의·해설 구조와 문맥을 종합해 판단한다. 일반 설명문을 억지로 질문으로 바꾸지 않는다. 질문과 답변은 원문의 문장을 그대로 유지하고 요약하거나 새 사실을 만들지 않는다. 질문과 답변이 모두 명시적으로 존재할 때만 포함한다. 여러 페이지에 이어진 답변은 하나로 합칠 수 있다. pageNumber는 질문이 시작된 [[PAGE n]] 번호다. heading에는 가장 가까운 페이지 또는 절 제목을 적는다. 애매하면 제외한다.",
        input: `자료명: ${args.title}\n\n${source}`,
        schema,
        schemaName: "guide_qna_pairs",
        maxOutputTokens: 5000,
        openaiModel: args.model || "gpt-4.1-mini",
      });
      const parsed = JSON.parse(outputText) as { items?: GuideQna[] };
      const batchText = normalized(batch.map((page) => page.text).join("\n"));
      for (const item of parsed.items || []) {
        const page = batch.find((candidate) => candidate.pageNumber === item.pageNumber);
        if (!page || item.confidence < 0.72) continue;
        const question = clean(item.question).slice(0, 1000);
        const answer = clean(item.answer).slice(0, 12000);
        if (question.length < 8 || answer.length < 15 || !batchText.includes(normalized(question)) || !batchText.includes(normalized(answer))) continue;
        extracted.push({ ...item, question, answer, heading: clean(item.heading).slice(0, 200) });
      }
    } catch {}
  }
  const seen = new Set<string>();
  return extracted.filter((item) => { const key = normalized(item.question); if (seen.has(key)) return false; seen.add(key); return true; }).slice(0, 300);
}
import { generateStructuredText } from "./ai-runtime";

