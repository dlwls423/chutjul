import { emptySnapshot, validateWorkspaceSnapshot } from './complaint-workspace';

export function validateAnswerHistory(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_INPUT');
  const v = value as Record<string, unknown>;
  if (Object.keys(v).some(key => !['answerText', 'title', 'summary', 'evidence', 'qualityChecks'].includes(key))) throw new Error('INVALID_INPUT');
  const summary = v.summary as Record<string, unknown>;
  const quality = v.qualityChecks as Record<string, unknown>;
  if (!summary || Object.keys(summary).join(',') !== 'editorText' || !quality || Object.keys(quality).some(k => k !== 'legal_articles_verified')) throw new Error('INVALID_INPUT');
  const snapshot = validateWorkspaceSnapshot({ ...emptySnapshot(), title: v.title,
    editorText: summary.editorText, draft: v.answerText, evidence: v.evidence,
    legalArticlesVerified: quality.legal_articles_verified ?? null });
  if (!snapshot.draft.trim()) throw new Error('INVALID_INPUT');
  return snapshot;
}
