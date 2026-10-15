import { withApiSecurity } from "../../../../lib/api-security";
import { NextResponse } from "next/server";
import { requireProfile } from "../../../../lib/auth";
import { legalSyncStatus, syncLegalSources } from "../../../../lib/legal-sync";
export const runtime="edge";
function safeErrorCode(message:string){
  if(message==="LAW_OPEN_API_OC_NOT_CONFIGURED")return message;
  const supabase=message.match(/SUPABASE[_ ]?(\d{3})/i);
  if(supabase)return `SUPABASE_${supabase[1]}`;
  const official=message.match(/(?:LAW_API_RESULT|OFFICIAL_SOURCE|OFFICIAL_ID)[A-Z0-9_:.-]*/i);
  if(official)return official[0].toUpperCase();
  return "LEGAL_SYNC_INTERNAL_ERROR";
}
function responseError(error:unknown){
  const message=error instanceof Error?error.message:"법령 동기화 중 오류가 발생했습니다.";
  const status=message==="AUTH_REQUIRED"?401:message==="FORBIDDEN"?403:message.includes("NOT_CONFIGURED")?503:500;
  if(status>=500)console.error("[legal-sync]",safeErrorCode(message));
  return NextResponse.json({error:"법령 동기화에 실패했습니다.",code:safeErrorCode(message)},{status});
}
async function GETHandler(){try{await requireProfile({approved:true});return NextResponse.json(await legalSyncStatus());}catch(error){return responseError(error);}}
async function POSTHandler(request:Request){try{const supplied=request.headers.get("authorization")?.replace(/^Bearer\s+/i,"")||"";const allowed=[process.env.LEGAL_SYNC_TOKEN,process.env.LEGAL_SYNC_BOOTSTRAP_TOKEN].filter(Boolean);if(!supplied||!allowed.includes(supplied))await requireProfile({admin:true});return NextResponse.json(await syncLegalSources());}catch(error){return responseError(error);}}

export const GET = withApiSecurity(GETHandler);
export const POST = withApiSecurity(POSTHandler);
