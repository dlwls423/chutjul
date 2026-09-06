import { serviceRequest } from "./auth";

type LegalSource={id:string;canonical_name:string;source_target:"law"|"admrul";external_id:string|null;enabled:boolean};
const API="https://www.law.go.kr/DRF";
const text=(value:unknown)=>value==null?"":String(value).trim();
const pick=(object:Record<string,unknown>,keys:string[])=>{for(const key of keys)if(text(object[key]))return text(object[key]);return"";};
function objects(value:unknown,out:Record<string,unknown>[]=[]){if(Array.isArray(value))value.forEach(v=>objects(v,out));else if(value&&typeof value==="object"){out.push(value as Record<string,unknown>);Object.values(value).forEach(v=>objects(v,out));}return out;}
function dateOf(value:string){const digits=value.replace(/\D/g,"");return digits.length>=8?`${digits.slice(0,4)}-${digits.slice(4,6)}-${digits.slice(6,8)}`:null;}
async function api(path:string){const response=await fetch(`${API}/${path}`,{cache:"no-store"});if(!response.ok)throw new Error(`LAW_API_${response.status}`);return response.json() as Promise<unknown>;}
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
function findSearchItem(payload:unknown,name:string){const wanted=normalizedName(name);const candidates=objects(payload).filter(o=>{const found=normalizedName(pick(o,["법령명한글","행정규칙명","법령명"]));return found===wanted||found.includes(wanted)||wanted.includes(found);});return candidates[0]||null;}
function provisions(payload:unknown){const rows:{provision_key:string;article_number:string|null;heading:string|null;body:string;sequence:number}[]=[];for(const object of objects(payload)){const number=pick(object,["조문번호","조문가지번호","항번호","호번호","목번호"]);const heading=pick(object,["조문제목","조문명","항제목"]);const body=pick(object,["조문내용","항내용","호내용","목내용"]);if(!body||body.length<4)continue;const key=`${number||"본문"}-${rows.length+1}`;rows.push({provision_key:key,article_number:number?`제${number.replace(/^제|조$/g,"")}조`:null,heading:heading||null,body,sequence:rows.length});}if(!rows.length){const all=JSON.stringify(payload,null,2);rows.push({provision_key:"전체-1",article_number:null,heading:"전체 본문",body:all.slice(0,500000),sequence:0});}return rows;}

export async function syncLegalSources(){
  const oc=process.env.LAW_OPEN_API_OC;if(!oc)throw new Error("LAW_OPEN_API_OC_NOT_CONFIGURED");
  const sources=await serviceRequest<LegalSource[]>("/rest/v1/legal_sources?enabled=eq.true&select=id,canonical_name,source_target,external_id,enabled&order=priority.desc");
  const runRows=await serviceRequest<{id:string}[]>("/rest/v1/legal_sync_runs",{method:"POST",headers:{Prefer:"return=representation"},body:JSON.stringify({status:"running"})});const runId=runRows[0]?.id;
  let changed=0;const errors:{name:string;error:string}[]=[];
  for(const source of sources){try{
    const listing=await api(`lawSearch.do?OC=${encodeURIComponent(oc)}&target=${source.source_target}&type=JSON&search=1&display=20&query=${encodeURIComponent(source.canonical_name)}`);
    const listingError=officialApiError(listing);if(listingError)throw new Error(listingError);
    const item=findSearchItem(listing,source.canonical_name);if(!item)throw new Error("OFFICIAL_SOURCE_NOT_FOUND");
    const externalId=pick(item,["법령일련번호","행정규칙일련번호","법령ID","행정규칙ID"]);if(!externalId)throw new Error("OFFICIAL_ID_NOT_FOUND");
    const detail=await api(`lawService.do?OC=${encodeURIComponent(oc)}&target=${source.source_target}&type=JSON&ID=${encodeURIComponent(externalId)}`);
    const serialized=JSON.stringify(detail);const hash=await sha(serialized);const info=objects(detail).find(o=>pick(o,["법령명한글","행정규칙명","법령명"]))||item;
    const effective=dateOf(pick(info,["시행일자","시행일"]));const today=new Date().toISOString().slice(0,10);const status=effective&&effective>today?"upcoming":"current";
    const existing=await serviceRequest<{id:string}[]>(`/rest/v1/legal_versions?source_id=eq.${source.id}&version_hash=eq.${hash}&select=id&limit=1`);
    if(!existing.length){if(status==="current")await serviceRequest(`/rest/v1/legal_versions?source_id=eq.${source.id}&status=eq.current`,{method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify({status:"history"})});
      const versions=await serviceRequest<{id:string}[]>("/rest/v1/legal_versions",{method:"POST",headers:{Prefer:"return=representation"},body:JSON.stringify({source_id:source.id,external_serial:externalId,proclamation_number:pick(info,["공포번호","발령번호"] )||null,proclaimed_at:dateOf(pick(info,["공포일자","발령일자"])),effective_from:effective,revision_type:pick(info,["제개정구분명"] )||null,version_hash:hash,status,raw_document:detail})});
      const versionId=versions[0].id;const rows=provisions(detail).map(row=>({...row,version_id:versionId,source_id:source.id}));for(let i=0;i<rows.length;i+=200)await serviceRequest("/rest/v1/legal_provisions",{method:"POST",headers:{Prefer:"return=minimal"},body:JSON.stringify(rows.slice(i,i+200))});changed++;
    }
    await serviceRequest(`/rest/v1/legal_sources?id=eq.${source.id}`,{method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify({external_id:externalId,source_url:`https://www.law.go.kr/법령/${encodeURIComponent(source.canonical_name)}`,last_checked_at:new Date().toISOString(),last_changed_at:existing.length?undefined:new Date().toISOString(),last_error:null,updated_at:new Date().toISOString()})});
  }catch(error){const message=error instanceof Error?error.message:"UNKNOWN";errors.push({name:source.canonical_name,error:message});await serviceRequest(`/rest/v1/legal_sources?id=eq.${source.id}`,{method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify({last_checked_at:new Date().toISOString(),last_error:message,updated_at:new Date().toISOString()})});}}
  const result={status:errors.length?(changed?"partial":"failed"):"completed",checked_count:sources.length,changed_count:changed,failed_count:errors.length,error_summary:errors,finished_at:new Date().toISOString()};if(runId)await serviceRequest(`/rest/v1/legal_sync_runs?id=eq.${runId}`,{method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify(result)});return result;
}

export async function legalSyncStatus(){const [sources,runs]=await Promise.all([serviceRequest<Record<string,unknown>[]>("/rest/v1/legal_sources?select=canonical_name,source_target,priority,external_id,last_checked_at,last_changed_at,last_error&order=priority.desc"),serviceRequest<Record<string,unknown>[]>("/rest/v1/legal_sync_runs?select=*&order=started_at.desc&limit=10")]);return{sources,runs};}
