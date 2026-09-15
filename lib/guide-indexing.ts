export type GuideEvidenceChunk = {
  content: string;
  pageNumber: number;
  pageEnd: number;
  sectionTitle: string | null;
  chunkKind: "guide_overview" | "guide_evidence";
  keywords: string[];
  legalReferences: string[];
};

const headingPattern = /^(?:(?:제\s*\d+\s*[장절편])|(?:\d+(?:\.\d+){0,3}[.)]?)|(?:[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]+[.)]?)|(?:[가-힣][.)]))\s*\S+|^(?:부록|붙임|참고|별첨|용어 설명|자주 묻는 질문|FAQ)/i;

function clean(value: string) {
  return value.replace(/\u0000/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

function keywords(text: string, limit = 14) {
  const stop = new Set(["관련", "대한", "경우", "통해", "위한", "있는", "하는", "합니다", "됩니다", "안내", "내용", "따라"]);
  const counts = new Map<string, number>();
  for (const raw of text.match(/[가-힣A-Za-z]{2,}/g) || []) {
    const word = raw.toLocaleLowerCase("ko-KR");
    if (!stop.has(word)) counts.set(word, (counts.get(word) || 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length).slice(0, limit).map(([word]) => word);
}

function legalReferences(text: string) {
  const found = new Set<string>();
  for (const match of text.matchAll(/(?:「([^」]{2,60})」\s*)?(제\s*\d+\s*조(?:의\s*\d+)?(?:\s*제\s*\d+\s*항)?(?:\s*제\s*\d+\s*호)?)/g))
    found.add([match[1], match[2].replace(/\s+/g, "")].filter(Boolean).join(" "));
  return [...found].slice(0, 30);
}

function splitParagraphs(page: string) {
  const lines = clean(page).split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const paragraphs: string[] = [];
  let buffer = "";
  for (const line of lines) {
    const heading = line.length <= 120 && headingPattern.test(line);
    if (heading) {
      if (buffer) paragraphs.push(buffer);
      paragraphs.push(line);
      buffer = "";
      continue;
    }
    buffer = buffer ? `${buffer} ${line}` : line;
    if (buffer.length >= 520 || /[.?!。]$/.test(line)) {
      paragraphs.push(buffer);
      buffer = "";
    }
  }
  if (buffer) paragraphs.push(buffer);
  return paragraphs;
}

export function buildGuideEvidence(title: string, pages: string[], toc: string[]): GuideEvidenceChunk[] {
  const chunks: GuideEvidenceChunk[] = [];
  const overview = [`자료명: ${title}`, toc.length ? `목차: ${toc.slice(0, 60).join(" | ")}` : ""].filter(Boolean).join("\n");
  chunks.push({ content: overview, pageNumber: 1, pageEnd: 1, sectionTitle: null, chunkKind: "guide_overview", keywords: keywords(overview), legalReferences: legalReferences(overview) });
  let sectionTitle: string | null = null;
  pages.forEach((page, pageIndex) => {
    const paragraphs = splitParagraphs(page);
    let body = "";
    const flush = () => {
      if (!body.trim()) return;
      const content = [`자료명: ${title}`, sectionTitle && `절: ${sectionTitle}`, `페이지: ${pageIndex + 1}`, body.trim()].filter(Boolean).join("\n");
      chunks.push({ content, pageNumber: pageIndex + 1, pageEnd: pageIndex + 1, sectionTitle, chunkKind: "guide_evidence", keywords: keywords(body), legalReferences: legalReferences(body) });
      body = "";
    };
    for (const paragraph of paragraphs) {
      if (paragraph.length <= 120 && headingPattern.test(paragraph)) {
        flush();
        sectionTitle = paragraph;
        continue;
      }
      if (body && body.length + paragraph.length > 950) flush();
      body = body ? `${body}\n${paragraph}` : paragraph;
    }
    flush();
  });
  return chunks.filter((chunk, index, all) => chunk.content.length >= 20 && all.findIndex((other) => other.content === chunk.content) === index);
}
