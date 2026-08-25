import {NextResponse} from 'next/server';
import {deleteUpload,getConfig,getJobDocuments} from '../../../../lib/ingestion';
import {requireProfile,serviceRequest} from '../../../../lib/auth';

export const runtime='edge';

export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}){try{const{id}=await params;await assertAccess(id);return NextResponse.json(await getJobDocuments(getConfig(),id));}catch(error){return fail(error);}}
export async function DELETE(_request:Request,{params}:{params:Promise<{id:string}>}){try{const{id}=await params;await assertAccess(id);return NextResponse.json(await deleteUpload(getConfig(),id));}catch(error){return fail(error);}}

async function assertAccess(jobId:string){const profile=await requireProfile({approved:true});if(profile.role==='admin')return;const rows=await serviceRequest<{id:string}[]>(`/rest/v1/source_files?job_id=eq.${encodeURIComponent(jobId)}&owning_department=eq.${encodeURIComponent(profile.department)}&select=id&limit=1`);if(!rows.length)throw new Error('FORBIDDEN');}

function fail(error:unknown){const message=error instanceof Error?error.message:'요청을 처리하지 못했습니다.';return NextResponse.json({error:message},{status:message==='AUTH_REQUIRED'?401:message==='FORBIDDEN'||message==='ACCOUNT_NOT_APPROVED'?403:message==='UPLOAD_NOT_FOUND'?404:500});}
