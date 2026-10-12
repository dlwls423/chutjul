import { detectResidualSensitiveInfo } from "./privacy-check";
export type WorkspaceEvidence = {
  reference: string;
  reason: string;
  title: string;
  documentType: string;
  recordId: string;
};
export type WorkspaceSnapshot = {
  version: 1;
  title: string;
  editorText: string;
  answerDirection: string;
  draft: string;
  dueDate: string;
  evidence: WorkspaceEvidence[];
  legalArticlesVerified: boolean | null;
};
export type ComplaintWorkspace = {
  id: string;
  revision: number;
  snapshot: WorkspaceSnapshot;
  updated_at: string;
};
export const emptySnapshot = (): WorkspaceSnapshot => ({
  version: 1,
  title: "새 민원",
  editorText: "",
  answerDirection: "",
  draft: "",
  dueDate: "",
  evidence: [],
  legalArticlesVerified: null,
});
export function validateWorkspaceSnapshot(value: unknown): WorkspaceSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("INVALID_INPUT");
  const v = value as Record<string, unknown>;
  if (
    v.version !== 1 ||
    Object.keys(v).some(
      (k) =>
        ![
          "version",
          "title",
          "editorText",
          "answerDirection",
          "draft",
          "dueDate",
          "evidence",
          "legalArticlesVerified",
        ].includes(k),
    )
  )
    throw new Error("INVALID_INPUT");
  for (const [k, max] of [
    ["title", 500],
    ["editorText", 30000],
    ["answerDirection", 5000],
    ["draft", 30000],
    ["dueDate", 10],
  ] as const) {
    if (typeof v[k] !== "string" || (v[k] as string).length > max)
      throw new Error("INVALID_INPUT");
    if (detectResidualSensitiveInfo(v[k] as string).length)
      throw new Error("SENSITIVE_INPUT");
  }
  if (
    v.legalArticlesVerified !== null &&
    typeof v.legalArticlesVerified !== "boolean"
  )
    throw new Error("INVALID_INPUT");
  if (!Array.isArray(v.evidence) || v.evidence.length > 20)
    throw new Error("INVALID_INPUT");
  for (const item of v.evidence) {
    if (
      !item ||
      typeof item !== "object" ||
      Array.isArray(item) ||
      Object.keys(item).sort().join(",") !==
        "documentType,reason,recordId,reference,title"
    )
      throw new Error("INVALID_INPUT");
    for (const k of [
      "reference",
      "reason",
      "title",
      "documentType",
      "recordId",
    ])
      if (
        typeof item[k] !== "string" ||
        item[k].length > 2000 ||
        detectResidualSensitiveInfo(item[k]).length
      )
        throw new Error("SENSITIVE_INPUT");
  }
  if (v.dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(v.dueDate as string))
    throw new Error("INVALID_INPUT");
  return v as WorkspaceSnapshot;
}
export function validateWorkspaceMutation(value: unknown) {
  const v = value as Record<string, unknown>;
  if (
    !v ||
    !["save", "delete"].includes(String(v.action)) ||
    typeof v.id !== "string" ||
    !/^([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i.test(
      v.id,
    ) ||
    !Number.isSafeInteger(v.revision) ||
    Number(v.revision) < 0
  )
    throw new Error("INVALID_INPUT");
  return {
    action: v.action as "save" | "delete",
    id: v.id,
    revision: Number(v.revision),
    snapshot:
      v.action === "save" ? validateWorkspaceSnapshot(v.snapshot) : null,
  };
}
