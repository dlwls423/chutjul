import { withApiSecurity } from "../../../lib/api-security";
import { NextResponse } from "next/server";
import { requireProfile, serviceRequest } from "../../../lib/auth";
import {
  validateWorkspaceMutation,
  type ComplaintWorkspace,
} from "../../../lib/complaint-workspace";
export const runtime = "edge";
async function owner() {
  const p = await requireProfile({ approved: true });
  if (p.id === "public-test") throw new Error("LOGIN_REQUIRED");
  return p;
}
function fail(error: unknown) {
  const message =
    error instanceof SyntaxError
      ? "INVALID_INPUT"
      : error instanceof Error
        ? error.message
        : "";
  const code =
    [
      "AUTH_REQUIRED",
      "LOGIN_REQUIRED",
      "ACCOUNT_NOT_APPROVED",
      "INVALID_INPUT",
      "SENSITIVE_INPUT",
    ].find((x) => message === x) || "WORKSPACE_UNAVAILABLE";
  return NextResponse.json(
    { error: code },
    {
      status: code.includes("REQUIRED")
        ? 401
        : code === "ACCOUNT_NOT_APPROVED"
          ? 403
          : code === "INVALID_INPUT" || code === "SENSITIVE_INPUT"
            ? 422
            : 503,
    },
  );
}
async function GETHandler() {
  try {
    const p = await owner();
    const workspaces = await serviceRequest<ComplaintWorkspace[]>(
      `/rest/v1/complaint_workspaces?user_id=eq.${encodeURIComponent(p.id)}&select=id,revision,snapshot,updated_at&order=updated_at.desc&limit=10`,
    );
    return NextResponse.json(
      { workspaces },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (e) {
    return fail(e);
  }
}
async function POSTHandler(request: Request) {
  try {
    const p = await owner();
    if (Number(request.headers.get("content-length") || 0) > 300000)
      throw new Error("INVALID_INPUT");
    const raw = await request.text();
    if (raw.length > 100000) throw new Error("INVALID_INPUT");
    const m = validateWorkspaceMutation(JSON.parse(raw));
    const result = await serviceRequest<{
      status: string;
      workspace?: ComplaintWorkspace;
    }>("/rest/v1/rpc/mutate_complaint_workspace", {
      method: "POST",
      body: JSON.stringify({
        p_user_id: p.id,
        p_id: m.id,
        p_revision: m.revision,
        p_action: m.action,
        p_snapshot: m.snapshot,
      }),
    });
    return NextResponse.json(result, {
      status:
        result.status === "conflict"
          ? 409
          : result.status === "limit"
            ? 409
            : 200,
    });
  } catch (e) {
    return fail(e);
  }
}

export const GET = withApiSecurity(GETHandler);
export const POST = withApiSecurity(POSTHandler);
