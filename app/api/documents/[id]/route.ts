import {NextResponse} from 'next/server';
import {deleteDocument,getConfig} from '../../../../lib/ingestion';

export const runtime='edge';

export async function DELETE(_request:Request,{params}:{params:Promise<{id:string}>}){try{const{id}=await params;return NextResponse.json(await deleteDocument(getConfig(),id));}catch(error){const message=error instanceof Error?error.message:'삭제하지 못했습니다.';return NextResponse.json({error:message},{status:500});}}
