export type AiProvider = "openai" | "ollama";

export type StructuredGenerationRequest = {
  instructions: string;
  input: string;
  schema: Record<string, unknown>;
  schemaName: string;
  maxOutputTokens?: number;
  openaiModel?: string;
  ollamaModel?: string;
};

export function configuredAiProvider(): AiProvider {
  return process.env.AI_PROVIDER?.trim().toLowerCase() === "ollama" ? "ollama" : "openai";
}

function ollamaBaseUrl() {
  return (process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434").replace(/\/$/, "");
}

function openAiResponseText(payload: unknown) {
  const output = (payload as { output?: Array<{ content?: Array<{ type?: string; text?: string }> }> })?.output || [];
  return output.flatMap(item => item.content || []).filter(item => item.type === "output_text").map(item => item.text || "").join("\n").trim();
}

export async function generateStructuredText(request: StructuredGenerationRequest) {
  if (configuredAiProvider() === "ollama") {
    const response = await fetch(`${ollamaBaseUrl()}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: request.ollamaModel || process.env.OLLAMA_CHAT_MODEL || "gemma3:4b",
        stream: false,
        think: false,
        format: request.schema,
        options: {
          temperature: 0.1,
          num_predict: Math.min(request.maxOutputTokens || 1800, 1800),
          repeat_penalty: 1.12,
          repeat_last_n: 256,
        },
        messages: [
          { role: "system", content: request.instructions },
          { role: "user", content: request.input },
        ],
      }),
      signal: AbortSignal.timeout(Number(process.env.LOCAL_AI_TIMEOUT_MS || 180000)),
    });
    if (!response.ok) throw new Error(`LOCAL_GENERATION_${response.status}: ${await response.text()}`);
    const payload = await response.json() as { message?: { content?: string } };
    const text = payload.message?.content?.trim() || "";
    if (!text) throw new Error("LOCAL_GENERATION_EMPTY");
    return text;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_NOT_CONFIGURED");
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: request.openaiModel || process.env.OPENAI_DRAFT_MODEL || "gpt-4.1-mini",
      store: false,
      instructions: request.instructions,
      input: request.input,
      text: { format: { type: "json_schema", name: request.schemaName, strict: true, schema: request.schema } },
      max_output_tokens: request.maxOutputTokens || 3000,
    }),
    signal: AbortSignal.timeout(60000),
  });
  if (!response.ok) throw new Error(`OPENAI_GENERATION_${response.status}: ${await response.text()}`);
  const text = openAiResponseText(await response.json());
  if (!text) throw new Error("OPENAI_GENERATION_EMPTY");
  return text;
}

export async function createEmbeddings(texts: string[], expectedDimensions?: number) {
  if (!texts.length) return [] as number[][];
  let vectors: number[][];
  if (configuredAiProvider() === "ollama") {
    const response = await fetch(`${ollamaBaseUrl()}/api/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: process.env.OLLAMA_EMBEDDING_MODEL || "bge-m3", input: texts }),
      signal: AbortSignal.timeout(Number(process.env.LOCAL_AI_TIMEOUT_MS || 180000)),
    });
    if (!response.ok) throw new Error(`LOCAL_EMBEDDING_${response.status}: ${await response.text()}`);
    vectors = ((await response.json()) as { embeddings?: number[][] }).embeddings || [];
  } else {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_NOT_CONFIGURED");
    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small", input: texts }),
    });
    if (!response.ok) throw new Error(`EMBEDDING_${response.status}: ${await response.text()}`);
    vectors = ((await response.json()) as { data?: Array<{ embedding: number[] }> }).data?.map(item => item.embedding) || [];
  }
  if (vectors.length !== texts.length || vectors.some(vector => !Array.isArray(vector) || !vector.length)) throw new Error("EMBEDDING_INVALID_RESPONSE");
  if (expectedDimensions && vectors.some(vector => vector.length !== expectedDimensions)) {
    throw new Error(`EMBEDDING_DIMENSION_MISMATCH:expected=${expectedDimensions},actual=${vectors[0]?.length || 0}`);
  }
  return vectors;
}
