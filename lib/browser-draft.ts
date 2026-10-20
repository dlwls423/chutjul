'use client';

import { browserAiLabel, getBrowserAiEngine } from './browser-ai';

type DraftPayload = {
  instructions: string;
  input: string;
  text: { format: { schema: Record<string, unknown> } };
  max_output_tokens?: number;
};

function parsePayload(value: unknown): DraftPayload {
  if (!value || typeof value !== 'object') throw new Error('BROWSER_DRAFT_PAYLOAD_INVALID');
  const payload = value as DraftPayload;
  if (typeof payload.instructions !== 'string' || typeof payload.input !== 'string' || !payload.text?.format?.schema)
    throw new Error('BROWSER_DRAFT_PAYLOAD_INVALID');
  return payload;
}

export function selectBrowserEvidence(value: unknown, references: string[]) {
  const payload = structuredClone(parsePayload(value));
  const input = JSON.parse(payload.input) as { candidateEvidence?: Array<{ reference?: string }>; [key: string]: unknown };
  const allowed = new Set(references);
  input.candidateEvidence = (input.candidateEvidence || []).filter(item => allowed.has(String(item.reference || '')));
  input.userSelection = '사용자가 직접 선택한 근거만 사용하여 답변할 것.';
  payload.input = JSON.stringify(input, null, 2);
  const schema = payload.text.format.schema as { properties?: { selectedEvidence?: { items?: { properties?: { reference?: { enum?: string[] } } } } } };
  const referenceRule = schema.properties?.selectedEvidence?.items?.properties?.reference;
  if (referenceRule) referenceRule.enum = references;
  return payload;
}

export async function generateDraftInBrowser(value: unknown, report: (message: string) => void) {
  const payload = parsePayload(value);
  const { engine, model } = await getBrowserAiEngine(report);
  report('민원 원문을 보내지 않고 이 기기에서 근거를 선별하고 초안을 작성하고 있습니다.');
  const response = await engine.chat.completions.create({
    messages: [
      { role: 'system', content: `${payload.instructions}\n반드시 요청된 JSON 구조만 출력하십시오.` },
      { role: 'user', content: payload.input },
    ],
    temperature: 0.1,
    max_tokens: Math.min(payload.max_output_tokens || 2200, 2400),
    response_format: { type: 'json_object' },
  });
  const text = response.choices[0]?.message.content?.trim() || '';
  const found = text.match(/\{[\s\S]*\}/)?.[0];
  if (!found) throw new Error('BROWSER_DRAFT_OUTPUT_INVALID');
  JSON.parse(found);
  return { outputText: found, model: browserAiLabel(model) };
}
