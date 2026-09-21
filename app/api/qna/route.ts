import { NextResponse } from "next/server";
import { requireProfile } from "../../../lib/auth";
import { processQnaPair } from "../../../lib/ingestion";

export const runtime = "edge";

export async function POST(request: Request) {
  try {
    const profile = await requireProfile({ approved: true });
    const body = await request.json() as Record<string, unknown>;
    if (Object.keys(body).some((key) => !["title", "question", "answer", "category"].includes(key)))
      return NextResponse.json({ error: "지원하지 않는 입력 항목이 포함되어 있습니다." }, { status: 400 });
    const title = typeof body.title === "string" ? body.title.trim() : "";
    const question = typeof body.question === "string" ? body.question.trim() : "";
    const answer = typeof body.answer === "string" ? body.answer.trim() : "";
    const category = typeof body.category === "string" ? body.category.trim() : "";
    if (title.length < 2 || question.length < 10 || answer.length < 10)
      return NextResponse.json({ error: "제목과 10자 이상의 질문·답변을 입력해 주세요." }, { status: 400 });
    if (title.length > 200 || question.length > 10000 || answer.length > 30000 || category.length > 100)
      return NextResponse.json({ error: "입력 가능한 글자 수를 초과했습니다." }, { status: 413 });
    const result = await processQnaPair({ title, question, answer, category, department: profile.department });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Q&A 저장 중 오류가 발생했습니다.";
    const status = message === "AUTH_REQUIRED" ? 401 : message === "ACCOUNT_NOT_APPROVED" ? 403 : message.startsWith("DUPLICATE_FILE:") ? 409 : 500;
    return NextResponse.json({ error: message.startsWith("DUPLICATE_FILE:") ? "동일한 Q&A가 이미 등록되어 있습니다." : message }, { status });
  }
}
