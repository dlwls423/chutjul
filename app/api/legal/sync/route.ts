import { NextResponse } from "next/server";
import { requireProfile } from "../../../../lib/auth";
import { legalSyncStatus, syncLegalSources } from "../../../../lib/legal-sync";
export const runtime="edge";
function responseError(error:unknown){const message=error instanceof Error?error.message:"법령 동기화 중 오류가 발생했습니다.";const status=message==="AUTH_REQUIRED"?401:message==="FORBIDDEN"?403:message.includes("NOT_CONFIGURED")?503:500;return NextResponse.json({error:message},{status});}
export async function GET(){try{await requireProfile({approved:true});return NextResponse.json(await legalSyncStatus());}catch(error){return responseError(error);}}
export async function POST(request:Request){try{const expected=process.env.LEGAL_SYNC_TOKEN||"";const supplied=request.headers.get("authorization")?.replace(/^Bearer\s+/i,"")||"";if(!expected||supplied!==expected)await requireProfile({admin:true});return NextResponse.json(await syncLegalSources());}catch(error){return responseError(error);}}
