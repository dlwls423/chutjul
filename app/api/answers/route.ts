import { NextResponse } from "next/server";
import { requireProfile, serviceRequest } from "../../../lib/auth";

export const runtime = "edge";

export async function GET() {
  try {
    const profile = await requireProfile({ approved: true });
    const userFilter = profile.id === "public-test" ? "is.null" : `eq.${encodeURIComponent(profile.id)}`;
    const rows = await serviceRequest<Record<string, unknown>[]>(
      `/rest/v1/answer_logs?user_id=${userFilter}&select=*&order=created_at.desc&limit=50`,
    );
    return NextResponse.json({ versions: rows });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    const profile = await requireProfile({ approved: true });
    const body = (await request.json()) as Record<string, unknown>;
    const answerText = String(body.answerText || "").trim();
    const applicationNumber = /^1AA-\d{4}-\d{6,}$/i.test(String(body.applicationNumber || "").trim())
      ? String(body.applicationNumber).trim()
      : null;
    if (!answerText || answerText.length > 30000) throw new Error("INVALID_INPUT");
    const userId = profile.id === "public-test" ? null : profile.id;
    const userFilter = userId ? `eq.${encodeURIComponent(userId)}` : "is.null";
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
        complaint_title: String(body.title || "").slice(0, 500),
        approved_summary: body.summary || {},
        answer_text: answerText,
        evidence: Array.isArray(body.evidence) ? body.evidence : [],
        quality_checks: body.qualityChecks || {},
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
