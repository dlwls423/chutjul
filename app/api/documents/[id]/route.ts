import {NextResponse} from 'next/server';
import {deleteDocument,getConfig} from '../../../../lib/ingestion';
import {requireProfile,serviceRequest} from '../../../../lib/auth';
import {detectResidualSensitiveInfo} from '../../../../lib/privacy-check';

export const runtime='edge';

export async function DELETE(_request:Request,{params}:{params:Promise<{id:string}>}){try{const{id}=await params;const profile=await requireProfile({approved:true});if(profile.role!=='admin'){const rows=await serviceRequest<{id:string}[]>(`/rest/v1/rag_documents?id=eq.${encodeURIComponent(id)}&department=eq.${encodeURIComponent(profile.department)}&select=id&limit=1`);if(!rows.length)throw new Error('FORBIDDEN');}return NextResponse.json(await deleteDocument(getConfig(),id));}catch(error){const message=error instanceof Error?error.message:'삭제하지 못했습니다.';return NextResponse.json({error:message},{status:message==='AUTH_REQUIRED'?401:message==='FORBIDDEN'||message==='ACCOUNT_NOT_APPROVED'?403:500});}}

export async function PATCH(request:Request,{params}:{params:Promise<{id:string}>}){
  try{
    const{id}=await params;
    const profile=await requireProfile({approved:true});
    const body=await request.json()as{questionSummary?:unknown};
    const questionSummary=String(body.questionSummary||'').replace(/\u0000/g,'').replace(/\r\n/g,'\n').trim();
    if(questionSummary.length<10||questionSummary.length>3000)return NextResponse.json({error:'전송용 질의 요약은 10~3,000자로 입력해 주세요.'},{status:400});
    const findings=detectResidualSensitiveInfo(questionSummary);
    if(findings.length)return NextResponse.json({error:`개인정보로 의심되는 항목을 제거해 주세요: ${[...new Set(findings.map(item=>item.type))].join(', ')}`},{status:400});
    const rows=await serviceRequest<{id:string;document_type:string;department:string|null;metadata:Record<string,unknown>|null;summary_version:number|null}[]>(`/rest/v1/rag_documents?id=eq.${encodeURIComponent(id)}&select=id,document_type,department,metadata,summary_version&limit=1`);
    const document=rows[0];
    if(!document)throw new Error('NOT_FOUND');
    if(document.document_type!=='complaint')return NextResponse.json({error:'민원 자료의 전송용 요약본만 편집할 수 있습니다.'},{status:400});
    if(profile.role!=='admin'&&document.department!==profile.department)throw new Error('FORBIDDEN');
    const metadata={...(document.metadata||{})};
    const retrieval={...((metadata.retrieval||{})as Record<string,unknown>),question_summary:questionSummary,source:'manual_review',version:Number(document.summary_version||3)+1,edited_at:new Date().toISOString(),edited_by:profile.id};
    metadata.retrieval=retrieval;
    await serviceRequest(`/rest/v1/rag_documents?id=eq.${encodeURIComponent(id)}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({question_summary:questionSummary,summary_version:retrieval.version,metadata,updated_at:new Date().toISOString()})});
    return NextResponse.json({ok:true,questionSummary,summaryVersion:retrieval.version});
  }catch(error){const message=error instanceof Error?error.message:'수정하지 못했습니다.';return NextResponse.json({error:message==='NOT_FOUND'?'자료를 찾을 수 없습니다.':message},{status:message==='AUTH_REQUIRED'?401:message==='FORBIDDEN'||message==='ACCOUNT_NOT_APPROVED'?403:message==='NOT_FOUND'?404:500});}
}
