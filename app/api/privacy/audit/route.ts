import { NextResponse } from "next/server";
import { requireProfile, serviceRequest } from "../../../../lib/auth";
import { maskAnswerAttribution, maskPersonalInfo } from "../../../../lib/ingestion";
import { maskBusinessIdentifiers, removeBusinessIdentifiers, repairKnownOvermasking } from "../../../../lib/business-identifiers";
import { detectResidualSensitiveInfo } from "../../../../lib/privacy-check";

export const runtime = "edge";
const PAGE_SIZE = 5;
type Doc = { id:string; title:string; question_original:string|null; answer_original:string|null; content_original:string; content_masked:string; metadata:Record<string,unknown>|null };
type Chunk = { id:string; chunk_index:number; content:string; metadata:Record<string,unknown>|null };

async function authorize(request:Request){
  const supplied=request.headers.get("authorization")?.replace(/^Bearer\s+/i,"")||"";
  if(supplied&&supplied===process.env.PRIVACY_AUDIT_TOKEN)return;
  await requireProfile({admin:true});
}
function scrubMetadata(value:unknown,key=""):unknown{
  if(key==="application_number"||key==="receipt_number")return undefined;
  if(typeof value==="string")return maskBusinessIdentifiers(repairKnownOvermasking(value));
  if(Array.isArray(value))return value.map(item=>scrubMetadata(item)).filter(item=>item!==undefined);
  if(value&&typeof value==="object")return Object.fromEntries(Object.entries(value as Record<string,unknown>).map(([childKey,child])=>[childKey,scrubMetadata(child,childKey)]).filter(([,child])=>child!==undefined));
  return value;
}
function countKnownOvermasking(value:string){return (value.match(/\[(?:비식별|성명)\]\s*(?:처리자|보호법)/g)||[]).length;}
function safeChunk(value:string){
  const repaired=repairKnownOvermasking(value);
  return removeBusinessIdentifiers(maskPersonalInfo(repaired).masked).replace(/\[업무식별자\]/g,"").trim();
}
async function embeddings(texts:string[]){
  if(!texts.length)return[];
  const key=process.env.OPENAI_API_KEY;if(!key)throw new Error("OPENAI_NOT_CONFIGURED");
  const response=await fetch("https://api.openai.com/v1/embeddings",{method:"POST",headers:{Authorization:`Bearer ${key}`,"Content-Type":"application/json"},body:JSON.stringify({model:process.env.OPENAI_EMBEDDING_MODEL||"text-embedding-3-small",input:texts})});
  if(!response.ok)throw new Error(`EMBEDDING_${response.status}`);
  const payload=await response.json() as {data:{embedding:number[]}[]};return payload.data.map(item=>item.embedding);
}

export async function POST(request:Request){
  try{
    await authorize(request);
    const body=await request.json().catch(()=>({})) as {after?:string;apply?:boolean};
    const after=typeof body.after==="string"&&/^[0-9a-f-]{36}$/i.test(body.after)?`&id=gt.${body.after}`:"";
    const docs=await serviceRequest<Doc[]>(`/rest/v1/rag_documents?document_type=eq.complaint&status=eq.ready${after}&select=id,title,question_original,answer_original,content_original,content_masked,metadata&order=id.asc&limit=${PAGE_SIZE}`);
    const report:{id:string;title:string;missed:number;overmasked:number;changed:boolean;residual:number}[]=[];
    for(const doc of docs){
      const before=[doc.question_original||"",doc.answer_original||"",doc.content_masked||""].join("\n");
      const questionResult=maskPersonalInfo(repairKnownOvermasking(doc.question_original||""));
      const answerResult=maskAnswerAttribution(repairKnownOvermasking(doc.answer_original||""));
      const title=maskBusinessIdentifiers(repairKnownOvermasking(doc.title));
      const question=questionResult.masked;
      const answer=answerResult.masked;
      const content=[question&&`질문: ${question}`,answer&&`답변: ${answer}`].filter(Boolean).join("\n\n");
      const metadata=scrubMetadata(doc.metadata||{}) as Record<string,unknown>;
      const metadataChanged=JSON.stringify(metadata)!==JSON.stringify(doc.metadata||{});
      metadata.privacy_audit={checked_at:new Date().toISOString(),schema_version:10,identifier_policy:"restricted_columns_only",missed_findings:questionResult.findings.length+answerResult.findings.length,known_overmasking_repaired:countKnownOvermasking(before)};
      const changed=title!==doc.title||question!==doc.question_original||answer!==doc.answer_original||content!==doc.content_masked||metadataChanged;
      const chunks=await serviceRequest<Chunk[]>(`/rest/v1/rag_chunks?document_id=eq.${doc.id}&select=id,chunk_index,content,metadata&order=chunk_index.asc`);
      const safeChunks=chunks.map(chunk=>({...chunk,content:safeChunk(chunk.content),metadata:scrubMetadata(chunk.metadata||{}) as Record<string,unknown>}));
      const changedChunks=safeChunks.filter((chunk,index)=>chunk.content!==chunks[index].content||JSON.stringify(chunk.metadata)!==JSON.stringify(chunks[index].metadata||{}));
      if(body.apply===true){
        await serviceRequest(`/rest/v1/rag_documents?id=eq.${doc.id}`,{method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify({title,question_original:question,answer_original:answer,content_original:content,content_masked:content,metadata})});
        if(changedChunks.length){
          const vectors=await embeddings(changedChunks.map(chunk=>chunk.content));
          for(let index=0;index<changedChunks.length;index++)await serviceRequest(`/rest/v1/rag_chunks?id=eq.${changedChunks[index].id}`,{method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify({content:changedChunks[index].content,metadata:changedChunks[index].metadata,token_estimate:Math.ceil(changedChunks[index].content.length/3),embedding:vectors[index]})});
        }
      }
      report.push({id:doc.id,title,missed:questionResult.findings.length+answerResult.findings.length,overmasked:countKnownOvermasking(before),changed:changed||changedChunks.length>0,residual:detectResidualSensitiveInfo(question).length});
    }
    return NextResponse.json({checked:docs.length,changed:report.filter(item=>item.changed).length,missed:report.reduce((sum,item)=>sum+item.missed,0),overmasked:report.reduce((sum,item)=>sum+item.overmasked,0),residual:report.reduce((sum,item)=>sum+item.residual,0),items:report,nextAfter:docs.length===PAGE_SIZE?docs.at(-1)?.id:null,applied:body.apply===true});
  }catch(error){const message=error instanceof Error?error.message:"PRIVACY_AUDIT_FAILED";return NextResponse.json({error:message},{status:message==="AUTH_REQUIRED"?401:message==="ADMIN_REQUIRED"?403:500});}
}
