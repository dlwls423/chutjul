"use client";
import { maskSensitiveText } from "./browser-privacy";
import { detectResidualSensitiveInfo } from "./privacy-check";
import type { WorkspaceSnapshot } from "./complaint-workspace";

export function prepareWorkspaceSnapshot(
  input: WorkspaceSnapshot,
): WorkspaceSnapshot {
  const safe = (value: string) => {
    let result = maskSensitiveText(value).value;
    for (const finding of detectResidualSensitiveInfo(result))
      result = result.split(finding.value).join(`[${finding.type}]`);
    return result;
  };
  // Construct a new allowlisted object; never spread transient editor state.
  return {
    version: 1,
    title: safe(input.title),
    editorText: safe(input.editorText),
    answerDirection: safe(input.answerDirection),
    draft: safe(input.draft),
    dueDate: input.dueDate,
    evidence: input.evidence
      .slice(0, 20)
      .map((item) => ({
        reference: item.reference,
        reason: safe(item.reason),
        title: safe(item.title),
        documentType: item.documentType,
        recordId: item.recordId,
      })),
    legalArticlesVerified: input.legalArticlesVerified,
  };
}
