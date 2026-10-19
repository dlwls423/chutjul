const baseUrl = (process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434").replace(/\/$/, "");
const models = (process.env.LOCAL_AI_EVAL_MODELS || "Gemma:latest,qwen3:8b")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

const cases = [
  {
    id: "retention-after-withdrawal",
    question:
      "쇼핑몰 회원 탈퇴 후 두 달이 지났지만 과거 배송지와 연락처가 계정 복구 화면에 조회됨. 즉시 삭제 대상인지 확인을 요청함.",
    evidence: [
      {
        id: "E1",
        title: "개인정보 보호법 제21조(개인정보의 파기)",
        content:
          "개인정보처리자는 보유기간의 경과, 처리 목적 달성 등 개인정보가 불필요하게 되었을 때에는 지체 없이 그 개인정보를 파기하여야 한다. 다만 다른 법령에 따라 보존하여야 하는 경우에는 그러하지 아니하다.",
      },
    ],
  },
  {
    id: "public-api-transfer-right",
    question:
      "공공기관이 누구나 이용하도록 공개한 정책 Open API만 조회하고 이용자의 인증수단이나 기관 보유 개인정보를 이용하지 않는 서비스가 개인정보 전송요구권 적용 대상인지 문의함.",
    evidence: [
      {
        id: "E1",
        title: "개인정보 보호법 제35조의2(개인정보의 전송 요구)",
        content:
          "정보주체는 본인에 관한 개인정보로서 법률이 정한 요건을 충족하는 개인정보를 본인 또는 제3자에게 전송하도록 요구할 수 있다.",
      },
      {
        id: "E2",
        title: "개인정보 전송요구권 제도 안내서 Q&A",
        content:
          "불특정 다수가 접근할 수 있도록 공개된 정보만 이용하고 정보전송자가 보유한 이용자 본인의 개인정보를 조회하거나 전송받지 않는 구조는 본인전송요구권에 따른 전송 대상에 해당하지 않을 수 있다. 다만 홈페이지 이용약관 등 별도 접근 제한은 확인해야 한다.",
      },
    ],
  },
  {
    id: "credit-info-consent",
    question:
      "서비스 제공자가 개인신용정보를 제3자에게 제공하려는 경우 동의와 고지 요건을 어떤 기준으로 확인해야 하는지 문의함.",
    evidence: [
      {
        id: "E1",
        title: "신용정보의 이용 및 보호에 관한 법률 제32조(개인신용정보의 제공ㆍ활용에 대한 동의)",
        content:
          "신용정보제공ㆍ이용자가 개인신용정보를 타인에게 제공하려는 경우에는 법률이 정한 방식에 따라 해당 신용정보주체로부터 동의를 받아야 하며, 제공받는 자와 이용 목적 등 필요한 사항을 알리고 동의를 받아야 한다.",
      },
    ],
  },
];

const schema = {
  type: "object",
  properties: {
    inquirySummary: { type: "string" },
    selectedEvidence: { type: "array", items: { type: "string" } },
    sections: {
      type: "array",
      items: {
        type: "object",
        properties: {
          heading: { type: "string" },
          answer: { type: "string" },
          evidenceIds: { type: "array", items: { type: "string" } },
        },
        required: ["heading", "answer", "evidenceIds"],
      },
    },
  },
  required: ["inquirySummary", "selectedEvidence", "sections"],
};

function percentile(values, ratio) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
}

function citedIds(value) {
  return [...new Set(JSON.stringify(value).match(/E\d+/g) || [])];
}

function articleMentions(value) {
  return [...new Set(JSON.stringify(value).match(/제\s*\d+(?:조의\d+|조)/g) || [])].map((v) =>
    v.replace(/\s+/g, ""),
  );
}

async function evaluateCase(model, testCase) {
  const allowedIds = testCase.evidence.map((item) => item.id);
  const allowedArticles = articleMentions(testCase.evidence);
  const prompt = [
    "아래 비식별 민원과 제공된 근거만 사용해 공공기관 민원 답변 초안의 핵심 내용을 작성하세요.",
    "제공되지 않은 법령, 조문, 사실을 만들지 마세요.",
    "각 답변에는 반드시 사용한 근거 ID를 넣으세요.",
    "JSON 스키마를 정확히 지키고 한국어로 작성하세요.",
    `민원: ${testCase.question}`,
    `근거: ${JSON.stringify(testCase.evidence)}`,
  ].join("\n");
  const startedAt = performance.now();
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      stream: false,
      think: false,
      format: schema,
      messages: [{ role: "user", content: prompt }],
      options: { temperature: 0.1, num_predict: 1400 },
    }),
    signal: AbortSignal.timeout(240_000),
  });
  const elapsedMs = Math.round(performance.now() - startedAt);
  if (!response.ok) throw new Error(`${model}/${testCase.id}: HTTP ${response.status} ${await response.text()}`);
  const body = await response.json();
  let parsed;
  let jsonValid = true;
  try {
    parsed = JSON.parse(body?.message?.content || "");
  } catch {
    jsonValid = false;
    parsed = { raw: body?.message?.content || "" };
  }
  const citations = citedIds(parsed);
  const mentions = articleMentions(parsed);
  const unsupportedArticles = mentions.filter((article) => !allowedArticles.includes(article));
  const missingEvidence = allowedIds.filter((id) => !citations.includes(id));
  return {
    caseId: testCase.id,
    elapsedMs,
    jsonValid,
    summaryPresent: typeof parsed.inquirySummary === "string" && parsed.inquirySummary.trim().length >= 10,
    sectionCount: Array.isArray(parsed.sections) ? parsed.sections.length : 0,
    citations,
    missingEvidence,
    unsupportedArticles,
    response: parsed,
  };
}

async function evaluateEmbeddings() {
  const inputs = [
    "query: 회원 탈퇴 후 남아 있는 배송지 개인정보를 삭제해야 하는가",
    "passage: 개인정보가 불필요하게 된 경우 지체 없이 파기해야 한다.",
    "passage: 공공기관의 정보공개 청구 처리 절차를 설명한다.",
  ];
  const startedAt = performance.now();
  const response = await fetch(`${baseUrl}/api/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "bge-m3", input: inputs }),
    signal: AbortSignal.timeout(120_000),
  });
  const elapsedMs = Math.round(performance.now() - startedAt);
  if (!response.ok) throw new Error(`bge-m3: HTTP ${response.status} ${await response.text()}`);
  const body = await response.json();
  const [query, relevant, irrelevant] = body.embeddings;
  const cosine = (left, right) => {
    let dot = 0;
    let leftNorm = 0;
    let rightNorm = 0;
    for (let index = 0; index < left.length; index += 1) {
      dot += left[index] * right[index];
      leftNorm += left[index] ** 2;
      rightNorm += right[index] ** 2;
    }
    return dot / Math.sqrt(leftNorm * rightNorm);
  };
  const relevantScore = cosine(query, relevant);
  const irrelevantScore = cosine(query, irrelevant);
  return {
    model: "bge-m3",
    elapsedMs,
    dimensions: query.length,
    relevantScore,
    irrelevantScore,
    rankingPassed: relevantScore > irrelevantScore,
  };
}

const results = [];
for (const model of models) {
  for (const testCase of cases) {
    process.stderr.write(`[local-ai-eval] ${model} / ${testCase.id}\n`);
    results.push({ model, ...(await evaluateCase(model, testCase)) });
  }
}

const summaries = models.map((model) => {
  const modelResults = results.filter((item) => item.model === model);
  const latencies = modelResults.map((item) => item.elapsedMs);
  return {
    model,
    averageMs: Math.round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length),
    p95Ms: percentile(latencies, 0.95),
    jsonPasses: modelResults.filter((item) => item.jsonValid).length,
    citationPasses: modelResults.filter((item) => item.missingEvidence.length === 0).length,
    hallucinationPasses: modelResults.filter((item) => item.unsupportedArticles.length === 0).length,
  };
});

console.log(
  JSON.stringify(
    {
      evaluatedAt: new Date().toISOString(),
      cases: cases.map(({ id, question }) => ({ id, question })),
      summaries,
      embedding: await evaluateEmbeddings(),
      results,
    },
    null,
    2,
  ),
);
