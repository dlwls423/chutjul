import { validateAnswerHistory } from "../../../lib/answer-history";
import { withApiSecurity } from "../../../lib/api-security";
import { NextResponse } from "next/server";
import { requireProfile, serviceRequest } from "../../../lib/auth";

export const runtime = "edge";

async function GETHandler() {
  try {
    const profile = await requireProfile({ approved: true });
    if (profile.id === "public-test") throw new Error("AUTH_REQUIRED");
    const userFilter = profile.id === "public-test" ? "is.null" : `eq.${encodeURIComponent(profile.id)}`;
    const rows = await serviceRequest<Record<string, unknown>[]>(
      `/rest/v1/answer_logs?user_id=${userFilter}&select=id,complaint_title,answer_text,approved_summary,version_number,department,created_at&order=created_at.desc&limit=50`,
    );
    return NextResponse.json({ versions: rows });
  } catch (error) {
    return fail(error);
  }
}

async function POSTHandler(request: Request) {
  try {
    const profile = await requireProfile({ approved: true });
    if (profile.id === "public-test") throw new Error("AUTH_REQUIRED");
    const snapshot = validateAnswerHistory(await request.json());
    const applicationNumber = null;
    const userId = profile.id;
    const userFilter = `eq.${encodeURIComponent(userId)}`;
    const previous = await serviceRequest<{ version_number: number }[]>(
      `/rest/v1/answer_logs?user_id=${userFilter}&application_number=${applicationNumber ? `eq.${encodeURIComponent(applicationNumber)}` : "is.null"}&select=version_number&order=version_number.desc&limit=1`,
    );
    const versionNumber = Number(previous[0]?.version_number || 0) + 1;
    await serviceRequest("/rest/v1/answer_logs", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        user_id: userId,
        department: profile.department,
        application_number: applicationNumber,
        complaint_title: snapshot.title,
        approved_summary: { editorText: snapshot.editorText },
        answer_text: snapshot.draft,
        evidence: snapshot.evidence,
        quality_checks: { legal_articles_verified: snapshot.legalArticlesVerified },
        version_number: versionNumber,
      }),
    });
    return NextResponse.json({ ok: true, versionNumber }, { status: 201 });
  } catch (error) {
    return fail(error);
  }
}

function fail(error: unknown) {
  const message = error instanceof Error ? error.message : "SAVE_FAILED";
  const migration = message.includes("PGRST") || message.includes("answer_logs");
  return NextResponse.json(
    { error: migration ? "답변 버전관리 DB 마이그레이션이 필요합니다." : "답변을 저장하지 못했습니다." },
    { status: message === "AUTH_REQUIRED" ? 401 : migration ? 503 : 400 },
  );
}

export const GET = withApiSecurity(GETHandler);
export const POST = withApiSecurity(POSTHandler);
