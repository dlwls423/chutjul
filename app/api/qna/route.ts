import { NextResponse } from "next/server";
import { requireProfile, serviceRequest } from "../../../lib/auth";
import { processQnaPair } from "../../../lib/ingestion";

export const runtime = "edge";

type SourceRow = { id: string };

export async function GET(request: Request) {
  try {
    const profile = await requireProfile({ approved: true });
    const requested = new URL(request.url).searchParams.get("department");
    const department = profile.role === "admin" && requested ? requested : profile.department;
    const sources = await serviceRequest<SourceRow[]>(`/rest/v1/source_files?owning_department=eq.${encodeURIComponent(department)}&select=id&limit=1000`);
    if (!sources.length) return NextResponse.json({ documents: [] });
    const batches = Array.from({ length: Math.ceil(sources.length / 40) }, (_, index) => sources.slice(index * 40, index * 40 + 40));
    const documents = (await Promise.all(batches.map((batch) => serviceRequest<Record<string, unknown>[]>(`/rest/v1/rag_documents?source_file_id=in.(${batch.map((item) => item.id).join(",")})&document_type=eq.qna&status=eq.ready&select=id,title,document_type,department,category_major,question_original,answer_original,metadata,chunk_count,status,created_at&order=created_at.desc&limit=500`)))).flat();
    return NextResponse.json({ documents });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Q&A 자료를 불러오지 못했습니다.";
    const status = message === "AUTH_REQUIRED" ? 401 : message === "ACCOUNT_NOT_APPROVED" ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function POST(request: Request) {
  try {
    const profile = await requireProfile({ approved: true });
    const body = await request.json() as Record<string, unknown>;
    if (Object.keys(body).some((key) => !["title", "question", "answer", "category", "department"].includes(key)))
      return NextResponse.json({ error: "지원하지 않는 입력 항목이 포함되어 있습니다." }, { status: 400 });
    const title = typeof body.title === "string" ? body.title.trim() : "";
    const question = typeof body.question === "string" ? body.question.trim() : "";
    const answer = typeof body.answer === "string" ? body.answer.trim() : "";
    const category = typeof body.category === "string" ? body.category.trim() : "";
    if (title.length < 2 || question.length < 10 || answer.length < 10)
      return NextResponse.json({ error: "제목과 10자 이상의 질문·답변을 입력해 주세요." }, { status: 400 });
    if (title.length > 200 || question.length > 10000 || answer.length > 30000 || category.length > 100)
      return NextResponse.json({ error: "입력 가능한 글자 수를 초과했습니다." }, { status: 413 });
    const requestedDepartment = typeof body.department === "string" ? body.department.trim() : "";
    const selectedDepartment = profile.role === "admin" && requestedDepartment ? requestedDepartment : profile.department;
    const department = selectedDepartment === "범정부마이데이터추진단" ? "마이데이터추진단" : selectedDepartment;
    const result = await processQnaPair({ title, question, answer, category, department });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Q&A 저장 중 오류가 발생했습니다.";
    const status = message === "AUTH_REQUIRED" ? 401 : message === "ACCOUNT_NOT_APPROVED" ? 403 : message.startsWith("DUPLICATE_FILE:") ? 409 : 500;
    return NextResponse.json({ error: message.startsWith("DUPLICATE_FILE:") ? "동일한 Q&A가 이미 등록되어 있습니다." : message }, { status });
  }
}
