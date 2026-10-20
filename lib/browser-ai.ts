'use client';

import type { MLCEngine } from '@mlc-ai/web-llm';

const LIGHT_MODEL = 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC';
const QUALITY_MODEL = 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC';

let enginePromise: Promise<{ engine: MLCEngine; model: string }> | null = null;

function preferredModel() {
  const memory = Number((navigator as Navigator & { deviceMemory?: number }).deviceMemory || 0);
  const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  return !mobile && memory >= 8 ? QUALITY_MODEL : LIGHT_MODEL;
}

export async function getBrowserAiEngine(report: (message: string) => void) {
  if (!('gpu' in navigator)) throw new Error('BROWSER_WEBGPU_REQUIRED');
  if (!enginePromise) {
    enginePromise = (async () => {
      const { CreateMLCEngine } = await import('@mlc-ai/web-llm');
      const model = preferredModel();
      report(`브라우저 AI 준비 중 · ${model.includes('1.5B') ? '고품질' : '경량'} 모델을 확인하고 있습니다.`);
      try {
        const engine = await CreateMLCEngine(model, {
          initProgressCallback: progress => report(`브라우저 AI 준비 ${Math.round(progress.progress * 100)}%`),
        });
        return { engine, model };
      } catch (error) {
        if (model === LIGHT_MODEL) throw error;
        report('기기 메모리에 맞는 경량 모델로 전환하고 있습니다.');
        const engine = await CreateMLCEngine(LIGHT_MODEL, {
          initProgressCallback: progress => report(`브라우저 AI 준비 ${Math.round(progress.progress * 100)}%`),
        });
        return { engine, model: LIGHT_MODEL };
      }
    })().catch(error => {
      enginePromise = null;
      throw error;
    });
  }
  return enginePromise;
}

export function browserAiLabel(model: string) {
  return `${model.includes('1.5B') ? 'Qwen2.5-1.5B' : 'Qwen2.5-0.5B'} · 이 기기에서 실행`;
}
