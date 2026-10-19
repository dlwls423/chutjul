import { serviceRequest } from "./auth";
import { fetchOfficialLawJson } from "./law-official-client";
import { normalizeOfficialArticleNumber } from "./legal-query";
import { extractLegalProvisions } from "./legal-provisions";

type LegalSource={id:string;canonical_name:string;source_target:"law"|"admrul";external_id:string|null;enabled:boolean};
const RETIRED_LEGAL_SOURCES=["공공기관의 가명정보 결합 및 반출 등에 관한 고시"] as const;
const REQUIRED_CREDIT_LEGAL_SOURCES=[
  {canonical_name:"신용정보의 이용 및 보호에 관한 법률",source_target:"law",priority:90,related_departments:["마이데이터추진단"]},
  {canonical_name:"신용정보의 이용 및 보호에 관한 법률 시행령",source_target:"law",priority:90,related_departments:["마이데이터추진단"]},
  {canonical_name:"신용정보의 이용 및 보호에 관한 법률 시행규칙",source_target:"law",priority:85,related_departments:["마이데이터추진단"]},
  {canonical_name:"신용정보업감독규정",source_target:"admrul",priority:85,related_departments:["마이데이터추진단"]},
] as const;
const text=(value:unknown)=>value==null?"":String(value).trim();
const pick=(object:Record<string,unknown>,keys:string[])=>{for(const key of keys)if(text(object[key]))return text(object[key]);return"";};
function objects(value:unknown,out:Record<string,unknown>[]=[]){if(Array.isArray(value))value.forEach(v=>objects(v,out));else if(value&&typeof value==="object"){out.push(value as Record<string,unknown>);Object.values(value).forEach(v=>objects(v,out));}return out;}
function dateOf(value:string){const digits=value.replace(/\D/g,"");return digits.length>=8?`${digits.slice(0,4)}-${digits.slice(4,6)}-${digits.slice(6,8)}`:null;}
async function sha(value:string){const bytes=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));return Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,"0")).join("");}
function normalizedName(value:string){return value.replace(/<[^>]*>/g,"").replace(/[\s·]/g,"").replace(/^\([^)]*\)/,"").trim();}
function officialApiError(payload:unknown){
  const envelope=objects(payload).find(o=>text(o.resultCode)||text(o.resultMsg));
  if(!envelope)return null;
  const code=text(envelope.resultCode);
  if(!code||code==="00")return null;
  const message=text(envelope.resultMsg).replace(/[^0-9A-Za-z가-힣 _.-]/g,"").slice(0,120);
  return `LAW_API_RESULT_${code}${message?`:${message}`:""}`;
}
function findSearchItem(payload:unknown,name:string){const wanted=normalizedName(name);const candidates=objects(payload).map(o=>{const found=normalizedName(pick(o,["법령명한글","행정규칙명","법령명"]));if(!found)return null;const score=found===wanted?1000:found.startsWith(wanted)||wanted.startsWith(found)?500:found.includes(wanted)||wanted.includes(found)?200:0;return score?{o,score,delta:Math.abs(found.length-wanted.length)}:null;}).filter((v):v is NonNullable<typeof v>=>Boolean(v)).sort((a,b)=>b.score-a.score||a.delta-b.delta);return candidates[0]?.o||null;}

export async function syncLegalSources(){
  const oc=process.env.LAW_OPEN_API_OC;if(!oc)throw new Error("LAW_OPEN_API_OC_NOT_CONFIGURED");
  await serviceRequest("/rest/v1/legal_sources?on_conflict=canonical_name",{method:"POST",headers:{Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify(REQUIRED_CREDIT_LEGAL_SOURCES.map(source=>({...source,enabled:true,updated_at:new Date().toISOString()})))});
  for(const name of RETIRED_LEGAL_SOURCES)await serviceRequest(`/rest/v1/legal_sources?canonical_name=eq.${encodeURIComponent(name)}`,{method:"DELETE",headers:{Prefer:"return=minimal"}});
  const sources=await serviceRequest<LegalSource[]>("/rest/v1/legal_sources?enabled=eq.true&select=id,canonical_name,source_target,external_id,enabled&order=priority.desc");
  const runRows=await serviceRequest<{id:string}[]>("/rest/v1/legal_sync_runs",{method:"POST",headers:{Prefer:"return=representation"},body:JSON.stringify({status:"running"})});const runId=runRows[0]?.id;
  let changed=0;const errors:{name:string;error:string}[]=[];
  for(const source of sources){try{
    const listing=await fetchOfficialLawJson("lawSearch.do",{OC:oc,target:source.source_target,type:"JSON",search:"1",display:"100",query:source.canonical_name});
    const listingError=officialApiError(listing);if(listingError)throw new Error(listingError);
    const item=findSearchItem(listing,source.canonical_name);if(!item)throw new Error("OFFICIAL_SOURCE_NOT_FOUND");
    const externalId=pick(item,["법령일련번호","행정규칙일련번호","법령ID","행정규칙ID"]);if(!externalId)throw new Error("OFFICIAL_ID_NOT_FOUND");
    const detailParams:Record<string,string>={OC:oc,target:source.source_target,type:"JSON"};
    detailParams[source.source_target==="law"?"MST":"ID"]=externalId;
    const detail=await fetchOfficialLawJson("lawService.do",detailParams);
    const serialized=JSON.stringify(detail);const hash=await sha(`legal-provision-parser:v2\n${serialized}`);const info=objects(detail).find(o=>pick(o,["법령명한글","행정규칙명","법령명"]))||item;
    const effective=dateOf(pick(info,["시행일자","시행일"]));const today=new Date().toISOString().slice(0,10);const status=effective&&effective>today?"upcoming":"current";
    const existing=await serviceRequest<{id:string}[]>(`/rest/v1/legal_versions?source_id=eq.${source.id}&version_hash=eq.${hash}&select=id&limit=1`);
    if(!existing.length){if(status==="current")await serviceRequest(`/rest/v1/legal_versions?source_id=eq.${source.id}&status=eq.current`,{method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify({status:"history"})});
      const versions=await serviceRequest<{id:string}[]>("/rest/v1/legal_versions",{method:"POST",headers:{Prefer:"return=representation"},body:JSON.stringify({source_id:source.id,external_serial:externalId,proclamation_number:pick(info,["공포번호","발령번호"] )||null,proclaimed_at:dateOf(pick(info,["공포일자","발령일자"])),effective_from:effective,revision_type:pick(info,["제개정구분명"] )||null,version_hash:hash,status,raw_document:detail})});
      const versionId=versions[0].id;const rows=extractLegalProvisions(detail).map(row=>({...row,version_id:versionId,source_id:source.id}));for(let i=0;i<rows.length;i+=200)await serviceRequest("/rest/v1/legal_provisions",{method:"POST",headers:{Prefer:"return=minimal"},body:JSON.stringify(rows.slice(i,i+200))});changed++;
    }
    await serviceRequest(`/rest/v1/legal_sources?id=eq.${source.id}`,{method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify({external_id:externalId,source_url:`https://www.law.go.kr/법령/${encodeURIComponent(source.canonical_name)}`,last_checked_at:new Date().toISOString(),last_changed_at:existing.length?undefined:new Date().toISOString(),last_error:null,updated_at:new Date().toISOString()})});
  }catch(error){const message="LEGAL_SYNC_FAILED";errors.push({name:source.canonical_name,error:message});await serviceRequest(`/rest/v1/legal_sources?id=eq.${source.id}`,{method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify({last_checked_at:new Date().toISOString(),last_error:message,updated_at:new Date().toISOString()})});}}
  const result={status:errors.length?(changed?"partial":"failed"):"completed",checked_count:sources.length,changed_count:changed,failed_count:errors.length,error_summary:errors,finished_at:new Date().toISOString()};if(runId)await serviceRequest(`/rest/v1/legal_sync_runs?id=eq.${runId}`,{method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify(result)});return result;
}

export async function legalSyncStatus(){const retired=RETIRED_LEGAL_SOURCES.map(encodeURIComponent).join(",");const [sources,runs]=await Promise.all([serviceRequest<Record<string,unknown>[]>(`/rest/v1/legal_sources?canonical_name=not.in.(${retired})&select=canonical_name,source_target,priority,external_id,last_checked_at,last_changed_at,last_error&order=priority.desc`),serviceRequest<Record<string,unknown>[]>("/rest/v1/legal_sync_runs?select=*&order=started_at.desc&limit=10")]);return{sources,runs};}
