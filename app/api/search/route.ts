import { NextResponse } from "next/server";
import { requireProfile } from "../../../lib/auth";
import { keywordSearch } from "../../../lib/search";
export const runtime = "edge";

export async function GET(request: Request) {
  try {
    const profile = await requireProfile({ approved: true });
    const params = new URL(request.url).searchParams;
    const query = String(params.get("q") || "").trim();
    if (!query) return NextResponse.json({ error: "검색어를 입력해 주세요." }, { status: 400 });
    const requested = String(params.get("department") || "").trim();
    const department = profile.role === "admin" && requested ? requested : profile.department;
    const results = await keywordSearch(department, query);
    return NextResponse.json({ query, department, results, count: results.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : "검색 중 오류가 발생했습니다.";
    const status = message === "AUTH_REQUIRED" ? 401 : message === "ACCOUNT_NOT_APPROVED" ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
