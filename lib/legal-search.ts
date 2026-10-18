import { serviceRequest } from "./auth";
import { analyzeLegalQuery, legalSourceHintScore } from "./legal-query";

type Provision = { id:string; source_id:string; article_number:string|null; heading:string|null; body:string; version_id:string };
type Source = { id:string; canonical_name:string; source_url:string|null; priority:number; related_departments:unknown };
type Version = { id:string; effective_from:string|null; proclamation_number:string|null; status:string; fetched_at:string };

const norm=(value:string)=>value.normalize("NFKC").toLocaleLowerCase("ko-KR").replace(/\s+/g," ").trim();
function provisionFilter(terms:string[]){const safe=terms.map(term=>term.replace(/[,()*%._]/g,"").trim()).filter(Boolean).slice(0,16);const clauses=safe.flatMap(term=>[`article_number.ilike.*${term}*`,`heading.ilike.*${term}*`,`body.ilike.*${term}*`]);return clauses.length?`&or=${encodeURIComponent(`(${clauses.join(",")})`)}`:"";}
const clip=(text:string,terms:string[])=>{const clean=text.replace(/\s+/g," ").trim();const lower=norm(clean);const at=Math.min(...terms.map(t=>lower.indexOf(t)).filter(n=>n>=0));if(!Number.isFinite(at))return clean.slice(0,260);const start=Math.max(0,at-70);return `${start?"…":""}${clean.slice(start,start+330)}${start+330<clean.length?"…":""}`;};

export async function searchCurrentLaws(rawQuery:string,department:string){
  const analysis=analyzeLegalQuery(rawQuery);
  const terms=[...new Set([...analysis.directTerms,...analysis.expandedTerms,...analysis.articleNumbers])];
  if(!terms.length)return[];
  let versions:Version[];
  try{versions=await serviceRequest<Version[]>(`/rest/v1/legal_versions?status=eq.current&select=id,effective_from,proclamation_number,status,fetched_at&limit=500`);}catch(error){if(error instanceof Error&&/(42P01|PGRST20[45])/.test(error.message))return[];throw error;}
  if(!versions.length)return[];
  const versionIds=versions.map(v=>v.id);
  const provisions:Provision[]=[];
  for(let i=0;i<versionIds.length;i+=40){const ids=versionIds.slice(i,i+40).join(",");provisions.push(...await serviceRequest<Provision[]>(`/rest/v1/legal_provisions?version_id=in.(${ids})${provisionFilter(terms)}&select=id,source_id,article_number,heading,body,version_id&limit=1000`));}
  const sourceIds=[...new Set(provisions.map(p=>p.source_id))];
  const sources=sourceIds.length?await serviceRequest<Source[]>(`/rest/v1/legal_sources?id=in.(${sourceIds.join(",")})&enabled=eq.true&select=id,canonical_name,source_url,priority,related_departments`):[];
  const sourceMap=new Map(sources.map(s=>[s.id,s]));const versionMap=new Map(versions.map(v=>[v.id,v]));
  return provisions.map(p=>{const s=sourceMap.get(p.source_id);if(!s)return null;const lawName=norm(s.canonical_name);const heading=norm(p.heading||"");const body=norm(p.body);const article=norm(p.article_number||"");const hay=`${lawName} ${article} ${heading} ${body}`;const directMatched=analysis.directTerms.filter(t=>hay.includes(t));const expandedMatched=analysis.expandedTerms.filter(t=>hay.includes(t));const articleMatched=analysis.articleNumbers.filter(t=>article.replace(/\s+/g,"")===t.replace(/\s+/g,""));const sourceHint=legalSourceHintScore(rawQuery,s.canonical_name);const directCoverage=directMatched.length/Math.max(1,analysis.directTerms.length);const sufficientlyRelevant=sourceHint>0||articleMatched.length>0||directMatched.length>=(analysis.directTerms.length>=3?2:1)||(!analysis.directTerms.length&&expandedMatched.length>=2);if(!sufficientlyRelevant)return null;const matched=[...new Set([...directMatched,...articleMatched,...expandedMatched])];const dept=Array.isArray(s.related_departments)?s.related_departments.map(String):[];const nameHits=directMatched.filter(t=>lawName.includes(t)).length;const headingHits=directMatched.filter(t=>heading.includes(t)).length;const score=Math.round(directCoverage*150)+directMatched.length*28+expandedMatched.length*8+nameHits*90+headingHits*45+articleMatched.length*180+sourceHint+(s.priority||0)+(dept.includes("전체")||dept.includes(department)?25:0);const v=versionMap.get(p.version_id);return{id:`law:${p.id}`,title:`${s.canonical_name}${p.article_number?` ${p.article_number}`:""}`,documentType:"law",department:"공통 법령",category:"현행 법령",createdAt:v?.fetched_at||"",snippet:clip(`${p.heading||""} ${p.body}`,matched),question:"",answer:"",content:p.body,score,matchedTerms:matched,legalReferences:[`${s.canonical_name} ${p.article_number||""}`.trim()],complaintMetadata:{effective_from:v?.effective_from,proclamation_number:v?.proclamation_number,source_url:s.source_url},guideMatches:[]};}).filter((v):v is NonNullable<typeof v>=>Boolean(v)).sort((a,b)=>b.score-a.score).slice(0,40);
}
