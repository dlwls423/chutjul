export type GuideEvidenceChunk = {
  content: string;
  pageNumber: number;
  pageEnd: number;
  sectionTitle: string | null;
  sectionPath: string[];
  chunkKind: "guide_overview" | "guide_evidence";
  contentType: "overview" | "general" | "faq" | "legal_basis" | "procedure" | "checklist";
  keywords: string[];
  legalReferences: string[];
};

const headingPattern = /^(?:(?:제\s*\d+\s*[장절편])|(?:\d+(?:\.\d+){0,3}[.)]?)|(?:[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]+[.)]?)|(?:[가-힣][.)]))\s*\S+|^(?:부록|붙임|참고|별첨|용어 설명|자주 묻는 질문|FAQ)/i;

function clean(value: string) {
  return value.replace(/\u0000/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

function keywords(text: string, limit = 16) {
  const stop = new Set(["관련", "대한", "경우", "통해", "위한", "있는", "하는", "합니다", "됩니다", "안내", "내용", "따라", "그리고", "또는"]);
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

function headingLevel(value: string) {
  if (/^제\s*\d+\s*[장편]/.test(value) || /^[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]+[.)]/.test(value)) return 1;
  if (/^제\s*\d+\s*절/.test(value)) return 2;
  const numeric = value.match(/^(\d+(?:\.\d+)*)/);
  if (numeric) return Math.min(4, numeric[1].split(".").length);
  if (/^[가-힣][.)]/.test(value)) return 4;
  return 1;
}

function contentType(text: string): GuideEvidenceChunk["contentType"] {
  if (/(?:^|\n)\s*(?:Q[.:]|질문\s*[:：]|자주 묻는 질문)|\?/.test(text)) return "faq";
  if (/제\s*\d+\s*조|법적\s*근거|관련\s*법령|근거\s*규정/.test(text)) return "legal_basis";
  if (/신청\s*절차|처리\s*절차|업무\s*절차|단계별|제출\s*방법/.test(text)) return "procedure";
  if (/(?:^|\n)\s*(?:[-•·✓□]|\d+[.)])\s+/.test(text)) return "checklist";
  return "general";
}

function stripRepeatedMargins(pages: string[]) {
  const edges = new Map<string, number>();
  const pageLines = pages.map((page) => clean(page).split(/\n+/).map((line) => line.trim()).filter(Boolean));
  for (const lines of pageLines) {
    for (const line of [lines[0], lines.at(-1)]) {
      if (line && line.length >= 3 && line.length <= 100) edges.set(line, (edges.get(line) || 0) + 1);
    }
  }
  const threshold = Math.max(3, Math.ceil(pages.length * 0.4));
  const repeated = new Set([...edges].filter(([, count]) => count >= threshold).map(([line]) => line));
  return pageLines.map((lines) => lines.filter((line) => !repeated.has(line) && !/^[-–—]?\s*\d+\s*[-–—]?$/.test(line)).join("\n"));
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

export function buildGuideEvidence(title: string, sourcePages: string[], toc: string[]): GuideEvidenceChunk[] {
  const chunks: GuideEvidenceChunk[] = [];
  const pages = stripRepeatedMargins(sourcePages);
  const overview = [`자료명: ${title}`, toc.length ? `목차: ${toc.slice(0, 80).join(" | ")}` : ""].filter(Boolean).join("\n");
  chunks.push({ content: overview, pageNumber: 1, pageEnd: 1, sectionTitle: null, sectionPath: [], chunkKind: "guide_overview", contentType: "overview", keywords: keywords(overview), legalReferences: legalReferences(overview) });
  const headings: string[] = [];
  pages.forEach((page, pageIndex) => {
    const paragraphs = splitParagraphs(page);
    let bodyParts: string[] = [];
    const flush = (keepOverlap = false) => {
      const body = bodyParts.join("\n").trim();
      if (!body) return;
      const path = headings.filter(Boolean);
      const sectionTitle = path.length ? path.join(" > ") : null;
      const content = [`자료명: ${title}`, sectionTitle && `목차 위치: ${sectionTitle}`, `페이지: ${pageIndex + 1}`, body].filter(Boolean).join("\n");
      chunks.push({ content, pageNumber: pageIndex + 1, pageEnd: pageIndex + 1, sectionTitle, sectionPath: path, chunkKind: "guide_evidence", contentType: contentType(body), keywords: keywords(`${sectionTitle || ""} ${body}`), legalReferences: legalReferences(body) });
      const last = bodyParts.at(-1) || "";
      bodyParts = keepOverlap && last.length <= 220 ? [last] : [];
    };
    for (const paragraph of paragraphs) {
      if (paragraph.length <= 120 && headingPattern.test(paragraph)) {
        flush(false);
        const level = headingLevel(paragraph);
        headings.length = level;
        headings[level - 1] = paragraph;
        continue;
      }
      if (bodyParts.length && bodyParts.join("\n").length + paragraph.length > 950) flush(true);
      if (bodyParts.at(-1) !== paragraph) bodyParts.push(paragraph);
    }
    flush(false);
  });
  return chunks.filter((chunk, index, all) => chunk.content.length >= 20 && all.findIndex((other) => other.content === chunk.content) === index);
}
