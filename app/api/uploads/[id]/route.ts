import {NextResponse} from 'next/server';
import {deleteUpload,getConfig,getJobDocuments} from '../../../../lib/ingestion';

export const runtime='edge';

export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}){try{const{id}=await params;return NextResponse.json(await getJobDocuments(getConfig(),id));}catch(error){return fail(error);}}
export async function DELETE(_request:Request,{params}:{params:Promise<{id:string}>}){try{const{id}=await params;return NextResponse.json(await deleteUpload(getConfig(),id));}catch(error){return fail(error);}}

function fail(error:unknown){const message=error instanceof Error?error.message:'요청을 처리하지 못했습니다.';return NextResponse.json({error:message},{status:message==='UPLOAD_NOT_FOUND'?404:500});}
