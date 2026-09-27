import {NextResponse} from 'next/server';
import {requireProfile,serviceRequest} from '../../../lib/auth';
import {OFFICIAL_DEPARTMENTS} from '../../../lib/departments';

export const runtime='edge';
type DepartmentRow={id:string;name:string;sort_order:number;active:boolean};

function isMissingTable(error:unknown){return /PGRST20[45]|42P01|departments.*schema cache|relation .*departments.*does not exist/i.test(error instanceof Error?error.message:String(error));}
function cleanName(value:unknown){return String(value||'').replace(/\s+/g,' ').trim();}
async function activeRows(){return serviceRequest<DepartmentRow[]>('/rest/v1/departments?active=eq.true&select=id,name,sort_order,active&order=sort_order.asc,name.asc');}

export async function GET(){
  try{return NextResponse.json({departments:(await activeRows()).map(row=>row.name),writable:true});}
  catch(error){if(isMissingTable(error))return NextResponse.json({departments:[...OFFICIAL_DEPARTMENTS],writable:false});return fail(error);}
}

export async function POST(request:Request){
  try{
    const profile=await requireProfile({approved:true,admin:true});
    const name=cleanName((await request.json()as{name?:string}).name);
    if(name.length<2||name.length>40||/[\u0000-\u001f\u007f]/.test(name))return NextResponse.json({error:'부서명은 2~40자로 입력해 주세요.'},{status:400});
    if(name==='테스트부서')return NextResponse.json({error:'테스트부서는 공개 테스트 환경에서만 사용합니다.'},{status:400});
    const existing=await serviceRequest<DepartmentRow[]>(`/rest/v1/departments?name=eq.${encodeURIComponent(name)}&select=id,name,sort_order,active&limit=1`);
    if(existing[0]){
      if(existing[0].active)return NextResponse.json({error:'이미 등록된 부서입니다.'},{status:409});
      await serviceRequest(`/rest/v1/departments?id=eq.${existing[0].id}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({active:true,updated_at:new Date().toISOString()})});
      return NextResponse.json({ok:true,name},{status:201});
    }
    const latest=await serviceRequest<Pick<DepartmentRow,'sort_order'>[]>('/rest/v1/departments?select=sort_order&order=sort_order.desc&limit=1');
    await serviceRequest('/rest/v1/departments',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify({name,sort_order:(latest[0]?.sort_order||0)+10,created_by:profile.id})});
    return NextResponse.json({ok:true,name},{status:201});
  }catch(error){if(isMissingTable(error))return NextResponse.json({error:'부서 관리 테이블을 먼저 생성해 주세요.'},{status:503});return fail(error);}
}

export async function DELETE(request:Request){
  try{
    const profile=await requireProfile({approved:true,admin:true});
    const name=cleanName((await request.json()as{name?:string}).name);
    if(!name)return NextResponse.json({error:'삭제할 부서를 선택해 주세요.'},{status:400});
    if(name===profile.department)return NextResponse.json({error:'현재 관리자 소속 부서는 삭제할 수 없습니다.'},{status:409});
    const encoded=encodeURIComponent(name);
    const [users,sources,jobs,requests]=await Promise.all([
      serviceRequest<{id:string}[]>(`/rest/v1/user_profiles?department=eq.${encoded}&select=id&limit=1`),
      serviceRequest<{id:string}[]>(`/rest/v1/source_files?owning_department=eq.${encoded}&select=id&limit=1`),
      serviceRequest<{id:string}[]>(`/rest/v1/ingestion_jobs?owning_department=eq.${encoded}&select=id&limit=1`),
      serviceRequest<{id:string}[]>(`/rest/v1/department_change_requests?or=(current_department.eq.${encoded},requested_department.eq.${encoded})&status=eq.pending&select=id&limit=1`),
    ]);
    if(users.length||sources.length||jobs.length||requests.length)return NextResponse.json({error:'소속 사용자, 저장 자료 또는 대기 중인 신청이 있어 삭제할 수 없습니다. 먼저 해당 항목의 부서를 변경해 주세요.'},{status:409});
    await serviceRequest(`/rest/v1/departments?name=eq.${encoded}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({active:false,updated_at:new Date().toISOString()})});
    return NextResponse.json({ok:true});
  }catch(error){if(isMissingTable(error))return NextResponse.json({error:'부서 관리 테이블을 먼저 생성해 주세요.'},{status:503});return fail(error);}
}

function fail(error:unknown){const message=error instanceof Error?error.message:'부서 정보를 처리하지 못했습니다.';return NextResponse.json({error:message},{status:message==='AUTH_REQUIRED'?401:message==='ADMIN_REQUIRED'?403:500});}
