import {serviceRequest} from './auth';

type Source={id:string;owning_department:string};
type Document={source_file_id:string;title:string;category_major:string|null;category_middle:string|null;category_minor:string|null;question_summary:string|null;answer_summary:string|null;metadata:Record<string,unknown>|null};
export type DepartmentRouting={scope:'aggregate_only';currentDepartment:string;issues:Array<{issue:string;candidates:Array<{department:string;likelihood:number;matchedKeywords:string[];matchedDocuments:number;isCurrent:boolean}>}>;notice:string};

const stopWords=new Set(['관련','대한','대해','문의','요청','여부','어떻게','무엇인지','알려','주세요','확인','경우','있는지','하는지','그리고','또한']);
function terms(value:string){return [...new Set(value.normalize('NFKC').toLocaleLowerCase('ko-KR').replace(/[^0-9a-z가-힣\s]/g,' ').split(/\s+/).filter(term=>term.length>1&&!stopWords.has(term)))].slice(0,18);}
function retrieval(doc:Document){const meta=(doc.metadata?.retrieval||{})as Record<string,unknown>;return [doc.title,doc.category_major,doc.category_middle,doc.category_minor,doc.question_summary,doc.answer_summary,meta.question_summary,meta.answer_summary].filter(Boolean).join(' ').normalize('NFKC').toLocaleLowerCase('ko-KR');}

export async function analyzeDepartmentRouting(currentDepartment:string,issues:string[]):Promise<DepartmentRouting>{
  const normalizedIssues=issues.map(issue=>issue.trim()).filter(Boolean).slice(0,4);
  const empty={scope:'aggregate_only' as const,currentDepartment,issues:[],notice:'다른 부서의 원문과 답변은 표시하거나 답변 근거로 제공하지 않습니다.'};
  if(!normalizedIssues.length)return empty;
  try{
    const sources=await serviceRequest<Source[]>('/rest/v1/source_files?select=id,owning_department&limit=5000');
    if(!sources.length)return empty;
    const sourceDepartment=new Map(sources.map(source=>[source.id,source.owning_department]));
    const batches=Array.from({length:Math.ceil(sources.length/40)},(_,index)=>sources.slice(index*40,index*40+40));
    const documents=(await Promise.all(batches.map(batch=>serviceRequest<Document[]>(`/rest/v1/rag_documents?source_file_id=in.(${batch.map(source=>source.id).join(',')})&document_type=in.(complaint,qna)&status=eq.ready&select=source_file_id,title,category_major,category_middle,category_minor,question_summary,answer_summary,metadata&limit=1000`)))).flat();
    const routedIssues=normalizedIssues.map(issue=>{
      const keywords=terms(issue);const departments=new Map<string,{score:number;matched:Set<string>;documents:number}>();
      for(const document of documents){const department=sourceDepartment.get(document.source_file_id);if(!department)continue;const text=retrieval(document);const matched=keywords.filter(keyword=>text.includes(keyword));if(!matched.length)continue;const phrase=text.includes(issue.normalize('NFKC').toLocaleLowerCase('ko-KR'))?8:0;const score=matched.length*3+phrase+(matched.length===keywords.length&&keywords.length>1?4:0);const current=departments.get(department)||{score:0,matched:new Set<string>(),documents:0};current.score+=score;current.documents+=1;matched.forEach(keyword=>current.matched.add(keyword));departments.set(department,current);}
      const ranked=[...departments.entries()].map(([department,value])=>({department,...value})).sort((a,b)=>b.score-a.score).slice(0,5);
      const total=ranked.reduce((sum,item)=>sum+item.score,0)||1;
      const candidates=ranked.map(item=>({department:item.department,likelihood:Math.max(1,Math.round(item.score/total*100)),matchedKeywords:[...item.matched].slice(0,5),matchedDocuments:item.documents,isCurrent:item.department===currentDepartment}));
      const delta=100-candidates.reduce((sum,item)=>sum+item.likelihood,0);if(candidates[0])candidates[0].likelihood+=delta;
      return{issue,candidates};
    });
    return{scope:'aggregate_only',currentDepartment,issues:routedIssues,notice:'참고용 가능성입니다. 다른 부서 자료는 서버 안에서 집계만 하며 원문·답변·개별 출처는 사용자나 외부 AI에 제공하지 않습니다.'};
  }catch{return empty;}
}
