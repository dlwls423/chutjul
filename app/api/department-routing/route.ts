import { withApiSecurity } from "../../../lib/api-security";
import { NextResponse } from "next/server";
import { requireProfile } from "../../../lib/auth";
import { detectResidualSensitiveInfo } from "../../../lib/privacy-check";
import { analyzeDepartmentRouting } from "../../../lib/department-routing";
export const runtime = "edge";
const headers = { "Cache-Control": "private, no-store" };
async function POSTHandler(request: Request) {
  try {
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(request.url).origin)
      return NextResponse.json(
        { error: "요청 출처를 확인할 수 없습니다." },
        { status: 403, headers },
      );
    const profile = await requireProfile({ approved: true });
    if (profile.id === "public-test") throw Error("LOGIN_REQUIRED");
    const raw = await request.text();
    if (raw.length > 20000) throw Error("INVALID_INPUT");
    const body = JSON.parse(raw);
    if (
      !body ||
      typeof body.query !== "string" ||
      !body.query.trim() ||
      body.query.length > 10000 ||
      Object.keys(body).some((key) => !["query", "department"].includes(key))
    )
      throw Error("INVALID_INPUT");
    if (detectResidualSensitiveInfo(body.query).length)
      throw Error("SENSITIVE_INPUT");
    const department =
      profile.role === "admin" && typeof body.department === "string"
        ? body.department.trim()
        : profile.department;
    if (!department || department.length > 60) throw Error("INVALID_INPUT");
    const routing = await analyzeDepartmentRouting(
      department,
      [body.query],
      request.signal,
    );
    return NextResponse.json(
      { routing },
      { status: routing.status === "unavailable" ? 503 : 200, headers },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const status =
      message === "AUTH_REQUIRED" || message === "LOGIN_REQUIRED"
        ? 401
        : message === "ACCOUNT_NOT_APPROVED"
          ? 403
          : message === "SENSITIVE_INPUT" ||
              message === "INVALID_INPUT" ||
              error instanceof SyntaxError
            ? 422
            : 503;
    return NextResponse.json(
      {
        error:
          status === 422
            ? "개인정보를 제외한 민원 내용을 확인해 주세요."
            : status === 401
              ? "로그인이 필요합니다."
              : status === 403
                ? "승인된 계정이 필요합니다."
                : "부서 분석을 수행하지 못했습니다.",
      },
      { status, headers },
    );
  }
}

export const POST = withApiSecurity(POSTHandler);
