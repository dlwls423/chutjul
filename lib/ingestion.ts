import readXlsxFile from 'read-excel-file/universal';
import {extractText} from 'unpdf';

export type JobStatus='queued'|'checking'|'uploading'|'parsing'|'masking'|'chunking'|'embedding'|'completed'|'failed';
type Config={url:string;serviceKey:string;bucket:string;openaiKey?:string;embeddingModel:string};
type Row=Record<string,string>;

export function getConfig():Config{
  const url=process.env.SUPABASE_URL||'';
  const serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY||'';
  if(!url||!serviceKey)throw new Error('SUPABASE_NOT_CONFIGURED');
  return{url:url.replace(/\/$/,''),serviceKey,bucket:process.env.SUPABASE_STORAGE_BUCKET||'complaint-originals',openaiKey:process.env.OPENAI_API_KEY,embeddingModel:process.env.OPENAI_EMBEDDING_MODEL||'text-embedding-3-small'};
}

async function supabase<T>(config:Config,path:string,init:RequestInit={}):Promise<T>{
  const res=await fetch(`${config.url}${path}`,{...init,headers:{apikey:config.serviceKey,Authorization:`Bearer ${config.serviceKey}`,'Content-Type':'application/json',Prefer:'return=representation',...(init.headers||{})}});
  if(!res.ok)throw new Error(`SUPABASE_${res.status}: ${await res.text()}`);
  const text=await res.text();return(text?JSON.parse(text):null)as T;
}
export async function updateJob(config:Config,id:string,status:JobStatus,extra:Record<string,unknown>={}){await supabase(config,`/rest/v1/ingestion_jobs?id=eq.${encodeURIComponent(id)}`,{method:'PATCH',body:JSON.stringify({status,...extra,updated_at:new Date().toISOString()})});}
export async function listJobs(config:Config){return supabase<Record<string,unknown>[]>(config,'/rest/v1/ingestion_jobs?select=*,source_files(*)&order=created_at.desc&limit=100');}
export async function createJob(config:Config,file:File,hash:string,documentType:string){
  const duplicate=await supabase<{id:string;original_name:string}[]>(config,`/rest/v1/source_files?sha256=eq.${hash}&select=id,original_name&limit=1`);
  if(duplicate.length)throw new Error(`DUPLICATE_FILE:${duplicate[0].original_name}`);
  const jobs=await supabase<{id:string}[]>(config,'/rest/v1/ingestion_jobs',{method:'POST',body:JSON.stringify({file_name:file.name,file_size:file.size,mime_type:file.type||mimeFromName(file.name),document_type:documentType,status:'queued',progress:0})});
  const jobId=jobs[0].id;
  const rows=await supabase<{id:string}[]>(config,'/rest/v1/source_files',{method:'POST',body:JSON.stringify({job_id:jobId,original_name:file.name,mime_type:file.type||mimeFromName(file.name),size_bytes:file.size,sha256:hash,document_type:documentType,storage_bucket:config.bucket})});
  return{jobId,fileId:rows[0].id};
}
export async function storeOriginal(config:Config,file:File,fileId:string){
  const extension=(file.name.split('.').pop()||'bin').toLowerCase().replace(/[^a-z0-9]/g,'')||'bin';
  const key=`${new Date().toISOString().slice(0,10)}/${fileId}/original.${extension}`;
  const res=await fetch(`${config.url}/storage/v1/object/${config.bucket}/${key}`,{method:'POST',headers:{apikey:config.serviceKey,Authorization:`Bearer ${config.serviceKey}`,'Content-Type':file.type||'application/pdf','x-upsert':'true'},body:file});
  if(!res.ok)throw new Error(`STORAGE_${res.status}: ${await res.text()}`);
  await supabase(config,`/rest/v1/source_files?id=eq.${fileId}`,{method:'PATCH',body:JSON.stringify({storage_path:key})});return key;
}
export async function parseFile(file:File):Promise<{records:Row[];pageCount?:number;rawText:string}>{
  const lower=file.name.toLowerCase();
  if(lower.endsWith('.pdf')){const data=new Uint8Array(await file.arrayBuffer());const result=await extractText(data,{mergePages:true});return{records:[{title:file.name.replace(/\.pdf$/i,''),content:result.text,question:'',answer:'',linked_pdf_name:file.name}],pageCount:result.totalPages,rawText:result.text};}
  if(lower.endsWith('.xlsx')||lower.endsWith('.xls')){const rows=await readXlsxFile(await file.arrayBuffer());if(rows.length<2)throw new Error('EMPTY_EXCEL');const headers=rows[0].map((v,i)=>normalizeHeader(String(v||`column_${i+1}`)));const records=rows.slice(1).filter(r=>r.some(Boolean)).map(r=>Object.fromEntries(headers.map((h,i)=>[h,toText(r[i])])));return{records:records.map(mapComplaintRow),rawText:records.map(r=>Object.values(r).join(' ')).join('\n')};}
  throw new Error('UNSUPPORTED_FILE');
}
export function maskPersonalInfo(text:string){const findings:{type:string;value:string}[]=[];let masked=text;const rules:[string,RegExp,(v:string)=>string][]=[['휴대전화',/01[016789][-.\s]?\d{3,4}[-.\s]?\d{4}/g,v=>`${v.slice(0,3)}-****-${v.slice(-4)}`],['이메일',/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,v=>`${v[0]}***@${v.split('@')[1]}`],['주민등록번호',/\b\d{6}[-\s]?\d{7}\b/g,v=>`${v.slice(0,6)}-*******`],['카드·계좌번호',/\b\d{3,6}[-\s]\d{2,6}[-\s]\d{3,6}(?:[-\s]\d{1,6})?\b/g,v=>`${v.slice(0,4)}-****-****`]];for(const[type,re,fn]of rules)masked=masked.replace(re,v=>{findings.push({type,value:v});return fn(v)});return{masked,findings};}
export function chunkText(text:string,max=900,overlap=120){const clean=text.replace(/\s+/g,' ').trim();if(!clean)return[];const out:string[]=[];let start=0;while(start<clean.length){let end=Math.min(start+max,clean.length);if(end<clean.length){const boundary=Math.max(clean.lastIndexOf('. ',end),clean.lastIndexOf('\n',end));if(boundary>start+max*.55)end=boundary+1;}out.push(clean.slice(start,end).trim());if(end>=clean.length)break;start=Math.max(end-overlap,start+1);}return out;}
async function embed(config:Config,texts:string[]){if(!config.openaiKey)throw new Error('OPENAI_NOT_CONFIGURED');const res=await fetch('https://api.openai.com/v1/embeddings',{method:'POST',headers:{Authorization:`Bearer ${config.openaiKey}`,'Content-Type':'application/json'},body:JSON.stringify({model:config.embeddingModel,input:texts})});if(!res.ok)throw new Error(`EMBEDDING_${res.status}: ${await res.text()}`);const json=await res.json()as{data:{embedding:number[]}[]};return json.data.map(x=>x.embedding);}
export async function persistRecords(config:Config,args:{jobId:string;fileId:string;file:File;records:Row[];pageCount?:number;storagePath?:string}){
  let totalPii=0;const prepared:{row:Row;original:string;masked:string;findings:{type:string;value:string}[];rowNumber:number}[]=[];
  for(let i=0;i<args.records.length;i++){const row=args.records[i];const original=[row.question&&`질문: ${row.question}`,row.answer&&`답변: ${row.answer}`,row.content].filter(Boolean).join('\n\n');if(!original.trim())continue;const result=maskPersonalInfo(original);totalPii+=result.findings.length;prepared.push({row,original,masked:result.masked,findings:result.findings,rowNumber:i+2});}
  if(!prepared.length)throw new Error('NO_SEARCHABLE_TEXT');
  const docs=await supabase<{id:string}[]>(config,'/rest/v1/rag_documents',{method:'POST',body:JSON.stringify(prepared.map(p=>({source_file_id:args.fileId,title:p.row.title||args.file.name,document_type:p.row.document_type||'complaint',department:p.row.department||null,category_major:p.row.category_major||null,category_middle:p.row.category_middle||null,category_minor:p.row.category_minor||null,question_original:p.row.question||null,answer_original:p.row.answer||null,content_original:p.original,content_masked:p.masked,pii_findings:p.findings,linked_pdf_name:p.row.linked_pdf_name||null,metadata:p.row,page_count:args.pageCount||null,status:'processing'})))});
  const pending:{documentId:string;chunkIndex:number;content:string;rowNumber:number}[]=[];docs.forEach((doc,i)=>chunkText(prepared[i].masked).forEach((content,chunkIndex)=>pending.push({documentId:doc.id,chunkIndex,content,rowNumber:prepared[i].rowNumber})));
  const vectorRows:{document_id:string;chunk_index:number;content:string;token_estimate:number;embedding:number[];metadata:Record<string,unknown>}[]=[];
  for(let offset=0;offset<pending.length;offset+=64){const batch=pending.slice(offset,offset+64);const vectors=await embed(config,batch.map(x=>x.content));batch.forEach((x,i)=>vectorRows.push({document_id:x.documentId,chunk_index:x.chunkIndex,content:x.content,token_estimate:Math.ceil(x.content.length/3),embedding:vectors[i],metadata:{source_file_id:args.fileId,row_number:x.rowNumber}}));}
  for(let offset=0;offset<vectorRows.length;offset+=200)await supabase(config,'/rest/v1/rag_chunks',{method:'POST',body:JSON.stringify(vectorRows.slice(offset,offset+200))});
  for(let i=0;i<docs.length;i++)await supabase(config,`/rest/v1/rag_documents?id=eq.${docs[i].id}`,{method:'PATCH',body:JSON.stringify({status:'ready',chunk_count:pending.filter(x=>x.documentId===docs[i].id).length})});
  await supabase(config,`/rest/v1/source_files?id=eq.${args.fileId}`,{method:'PATCH',body:JSON.stringify({page_count:args.pageCount||null,record_count:prepared.length,parse_status:'completed'})});return{documentCount:prepared.length,chunkCount:pending.length,piiCount:totalPii};
}
export async function processUpload(file:File,documentType:string){const config=getConfig();const hash=await sha256(file);const{jobId,fileId}=await createJob(config,file,hash,documentType);return runPipeline(config,file,jobId,fileId);}
export async function retryUpload(file:File,jobId:string){const config=getConfig();const source=await supabase<{id:string;original_name:string}[]>(config,`/rest/v1/source_files?job_id=eq.${encodeURIComponent(jobId)}&select=id,original_name&limit=1`);if(!source.length)throw new Error('SOURCE_FILE_NOT_FOUND');if(source[0].original_name!==file.name)throw new Error('RETRY_FILE_MISMATCH');await updateJob(config,jobId,'queued',{progress:0,error_code:null,error_message:null,attempt_count:2});await supabase(config,`/rest/v1/rag_documents?source_file_id=eq.${source[0].id}`,{method:'DELETE'});return runPipeline(config,file,jobId,source[0].id);}
async function runPipeline(config:Config,file:File,jobId:string,fileId:string){try{await updateJob(config,jobId,'checking',{progress:10});await updateJob(config,jobId,'uploading',{progress:22});const storagePath=await storeOriginal(config,file,fileId);await updateJob(config,jobId,'parsing',{progress:38});const parsed=await parseFile(file);await updateJob(config,jobId,'masking',{progress:55,total_records:parsed.records.length});await updateJob(config,jobId,'chunking',{progress:68});await updateJob(config,jobId,'embedding',{progress:78});const stats=await persistRecords(config,{jobId,fileId,file,records:parsed.records,pageCount:parsed.pageCount,storagePath});await reconcilePdf(config,file.name,fileId,storagePath);await updateJob(config,jobId,'completed',{progress:100,completed_at:new Date().toISOString(),document_count:stats.documentCount,chunk_count:stats.chunkCount,pii_count:stats.piiCount});return{jobId,...stats};}catch(error){await updateJob(config,jobId,'failed',{error_code:error instanceof Error?error.message.split(':')[0]:'UNKNOWN',error_message:error instanceof Error?error.message:'처리 중 오류가 발생했습니다.'});throw error;}}
async function reconcilePdf(config:Config,name:string,fileId:string,storagePath?:string){if(!name.toLowerCase().endsWith('.pdf'))return;await supabase(config,`/rest/v1/rag_documents?linked_pdf_name=eq.${encodeURIComponent(name)}`,{method:'PATCH',body:JSON.stringify({source_file_id:fileId,pdf_storage_path:storagePath})});}
function mapComplaintRow(row:Row){const find=(names:string[])=>{for(const n of names)if(row[n])return row[n];return''};return{...row,title:find(['민원제목','제목','title','건명'])||'제목 없음',question:find(['민원내용','질문','질의','question','문의내용']),answer:find(['답변내용','답변','answer','회신내용']),department:find(['담당부서','부서','department','소관부서']),category_major:find(['대분류','업무대분류']),category_middle:find(['중분류','업무중분류']),category_minor:find(['소분류','업무소분류']),linked_pdf_name:find(['pdf파일명','첨부파일','원문파일','pdf'])};}
function normalizeHeader(v:string){return v.trim().toLowerCase().replace(/\s+/g,'').replace(/[()]/g,'');}function toText(v:unknown){return v instanceof Date?v.toISOString():v==null?'':String(v).trim();}function mimeFromName(n:string){return n.toLowerCase().endsWith('.pdf')?'application/pdf':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';}async function sha256(file:File){const digest=await crypto.subtle.digest('SHA-256',await file.arrayBuffer());return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');}
