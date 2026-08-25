import {NextResponse} from 'next/server';
import {deleteDocument,getConfig} from '../../../../lib/ingestion';
import {requireProfile,serviceRequest} from '../../../../lib/auth';

export const runtime='edge';

export async function DELETE(_request:Request,{params}:{params:Promise<{id:string}>}){try{const{id}=await params;const profile=await requireProfile({approved:true});if(profile.role!=='admin'){const rows=await serviceRequest<{id:string}[]>(`/rest/v1/rag_documents?id=eq.${encodeURIComponent(id)}&department=eq.${encodeURIComponent(profile.department)}&select=id&limit=1`);if(!rows.length)throw new Error('FORBIDDEN');}return NextResponse.json(await deleteDocument(getConfig(),id));}catch(error){const message=error instanceof Error?error.message:'삭제하지 못했습니다.';return NextResponse.json({error:message},{status:message==='AUTH_REQUIRED'?401:message==='FORBIDDEN'||message==='ACCOUNT_NOT_APPROVED'?403:500});}}
