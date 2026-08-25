'use client';
import {FormEvent,ReactNode,useEffect,useState} from 'react';
import './AuthGate.css';
import './UserNav.css';

export type Profile={id:string;email:string;full_name:string;department:string;position:string;office_phone:string;role:'admin'|'user';approval_status:'pending'|'approved'|'rejected'};
const departments=['범정부마이데이터추진단','개인정보보호정책과','조사총괄과','개인정보침해평가과','신기술개인정보과','분쟁조정과'];
type AdminData={users:Array<Profile&{created_at:string}>;changes:Array<{id:string;user_id:string;current_department:string;requested_department:string;reason?:string;status:string;created_at:string}>};

export default function AuthGate({children}:{children:(profile:Profile)=>ReactNode}){
  const[profile,setProfile]=useState<Profile|null>(null);
  const[loading,setLoading]=useState(true);
  const[mode,setMode]=useState<'login'|'signup'>('login');
  const[message,setMessage]=useState('');
  const[panel,setPanel]=useState<'profile'|'admin'|null>(null);
  async function load(){try{const r=await fetch('/api/auth');const j=await r.json();setProfile(j.profile||null)}finally{setLoading(false)}}
  useEffect(()=>{load()},[]);
  useEffect(()=>{const closePanel=()=>setPanel(null);window.addEventListener('workspace-navigation',closePanel);return()=>window.removeEventListener('workspace-navigation',closePanel)},[]);
  async function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();setMessage('처리 중…');const body=Object.fromEntries(new FormData(event.currentTarget));const r=await fetch('/api/auth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:mode,...body})});const j=await r.json();if(!r.ok){setMessage(j.error||'요청에 실패했습니다.');return}if(mode==='signup'){setMode('login');setMessage('가입 신청이 완료되었습니다. 관리자 승인 후 로그인할 수 있습니다.')}else{setProfile(j.profile);setMessage('')}}
  async function logout(){await fetch('/api/auth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'logout'})});setProfile(null);setPanel(null)}
  if(loading)return <div className="auth-loading">첫줄을 불러오는 중입니다…</div>;
  if(!profile)return <AuthForm mode={mode} setMode={setMode} submit={submit} message={message}/>;
  if(profile.approval_status!=='approved')return <Pending profile={profile} logout={logout}/>;
  return <><div className="account-dock"><button onClick={()=>setPanel('profile')}><b>{profile.full_name[0]}</b><span>{profile.full_name}<small>{profile.department}</small></span></button>{profile.role==='admin'&&<button className={`admin-link ${panel==='admin'?'active':''}`} onClick={()=>setPanel('admin')}>권한 관리</button>}<button className="logout" onClick={logout}>로그아웃</button></div>{children(profile)}{panel==='profile'&&<ProfilePanel profile={profile} close={()=>setPanel(null)} updated={load}/>} {panel==='admin'&&<AdminPanel close={()=>setPanel(null)}/>}</>
}
function AuthForm({mode,setMode,submit,message}:{mode:'login'|'signup';setMode:(v:'login'|'signup')=>void;submit:(e:FormEvent<HTMLFormElement>)=>void;message:string}){return <main className="auth-page"><section className="auth-card"><div className="auth-brand"><span>첫</span><div><h1>첫줄</h1><p>개인정보위 민원 답변 지원</p></div></div><div className="auth-tabs"><button className={mode==='login'?'on':''} onClick={()=>setMode('login')}>로그인</button><button className={mode==='signup'?'on':''} onClick={()=>setMode('signup')}>회원가입</button></div><form onSubmit={submit}><label>이메일<input name="email" type="email" required placeholder="name@example.com"/></label><label>비밀번호<input name="password" type="password" minLength={8} required placeholder="8자 이상"/></label>{mode==='signup'&&<><label>이름<input name="fullName" required/></label><label>부서<select name="department" required>{departments.map(x=><option key={x}>{x}</option>)}</select></label><div className="auth-row"><label>직급<input name="position" required/></label><label>회사 전화번호<input name="officePhone" required placeholder="02-0000-0000"/></label></div></>}<button className="auth-submit">{mode==='login'?'로그인':'가입 승인 요청'}</button>{message&&<p className="auth-message">{message}</p>}</form></section></main>}
function Pending({profile,logout}:{profile:Profile;logout:()=>void}){return <main className="auth-page"><section className="pending-card"><span>{profile.approval_status==='rejected'?'!':'✓'}</span><h1>{profile.approval_status==='rejected'?'가입 신청이 반려되었습니다':'관리자 승인을 기다리고 있습니다'}</h1><p>{profile.full_name}님의 가입 신청이 접수되었습니다.<br/>승인 후 소속 부서 자료만 이용할 수 있습니다.</p><dl><div><dt>부서</dt><dd>{profile.department}</dd></div><div><dt>이메일</dt><dd>{profile.email}</dd></div></dl><button onClick={logout}>로그아웃</button></section></main>}
function ProfilePanel({profile,close,updated}:{profile:Profile;close:()=>void;updated:()=>Promise<void>}){const[msg,setMsg]=useState('');const[changing,setChanging]=useState(false);async function save(e:FormEvent<HTMLFormElement>){e.preventDefault();const body=Object.fromEntries(new FormData(e.currentTarget));const r=await fetch('/api/profile',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const j=await r.json();setMsg(r.ok?'정보를 수정했습니다.':j.error);if(r.ok)await updated()}async function request(e:FormEvent<HTMLFormElement>){e.preventDefault();const body=Object.fromEntries(new FormData(e.currentTarget));const r=await fetch('/api/profile',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const j=await r.json();setMsg(r.ok?'부서 변경 승인을 요청했습니다.':j.error);if(r.ok)setChanging(false)}return <div className="auth-modal-back"><section className="auth-modal"><button className="auth-x" onClick={close}>×</button><h2>내 정보</h2><form onSubmit={save}><label>이름<input name="fullName" defaultValue={profile.full_name}/></label><label>직급<input name="position" defaultValue={profile.position}/></label><label>회사 전화번호<input name="officePhone" defaultValue={profile.office_phone}/></label><label className="readonly-department">현재 부서 <small>관리자 승인 후 변경됩니다.</small><input value={profile.department} disabled/></label><button className="auth-submit">정보 저장</button></form>{profile.role==='user'&&<div className="department-change"><button type="button" onClick={()=>setChanging(v=>!v)}>{changing?'변경 신청 닫기':'부서 변경 신청'}</button>{changing&&<form className="department-request" onSubmit={request}><h3>변경할 부서</h3><select name="department" defaultValue={departments.find(x=>x!==profile.department)}>{departments.map(x=><option key={x} disabled={x===profile.department}>{x}</option>)}</select><textarea name="reason" required placeholder="부서 변경 사유를 입력해 주세요."/><button>관리자 승인 요청</button></form>}</div>}{msg&&<p className="auth-message">{msg}</p>}</section></div>}
function AdminPanel({close}:{close:()=>void}){
  const[data,setData]=useState<AdminData|null>(null);
  async function load(){const r=await fetch('/api/admin');setData(await r.json())}
  useEffect(()=>{load()},[]);
  async function decide(type:string,id:string,status:string){await fetch('/api/admin',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({type,id,status})});await load()}
  const users=data?.users||[];
  const pending=users.filter(x=>x.role==='user'&&x.approval_status==='pending');
  const changes=data?.changes||[];
  const pendingChanges=changes.filter(x=>x.status==='pending');
  const requestHistory=[
    ...users.filter(x=>x.role==='user'&&x.approval_status!=='pending').map(x=>({id:`user-${x.id}`,kind:'가입 신청',name:x.full_name,detail:`${x.department} · ${x.position}`,status:x.approval_status,date:x.created_at})),
    ...changes.filter(x=>x.status!=='pending').map(x=>{const user=users.find(user=>user.id===x.user_id);return{id:`department-${x.id}`,kind:'부서 변경',name:user?.full_name||'사용자',detail:`${x.current_department} → ${x.requested_department}`,status:x.status,date:x.created_at}})
  ].sort((a,b)=>new Date(b.date).getTime()-new Date(a.date).getTime());
  return <div className="auth-modal-back"><section className="auth-modal admin-modal"><h2>권한 관리</h2>
    <h3>가입 승인 요청 <em>{pending.length}</em></h3>
    {pending.map(user=><article key={user.id}><div><strong>{user.full_name} · {user.position}</strong><p>{user.department} · {user.office_phone} · {user.email}</p></div><div><button onClick={()=>decide('user',user.id,'rejected')}>반려</button><button className="approve" onClick={()=>decide('user',user.id,'approved')}>승인</button></div></article>)}
    {!pending.length&&<p className="admin-empty">대기 중인 가입 요청이 없습니다.</p>}
    <h3>부서 변경 요청 <em>{pendingChanges.length}</em></h3>
    {pendingChanges.map(change=>{const user=users.find(x=>x.id===change.user_id);return <article key={change.id}><div><strong>{user?.full_name||'사용자'}</strong><p>{change.current_department} → {change.requested_department}</p><small>{change.reason||'사유 없음'}</small></div><div><button onClick={()=>decide('department',change.id,'rejected')}>반려</button><button className="approve" onClick={()=>decide('department',change.id,'approved')}>승인</button></div></article>})}
    {!pendingChanges.length&&<p className="admin-empty">대기 중인 부서 변경 요청이 없습니다.</p>}
    <h3>사용자 목록 <em>{users.length}</em></h3>
    <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>사용자</th><th>부서</th><th>직급</th><th>연락처</th><th>권한</th><th>상태</th></tr></thead><tbody>{users.map(user=><tr key={user.id}><td><strong>{user.full_name}</strong><small>{user.email}</small></td><td>{user.department}</td><td>{user.position}</td><td>{user.office_phone}</td><td>{user.role==='admin'?'관리자':'사용자'}</td><td><span className={`approval-badge ${user.approval_status}`}>{approvalLabel(user.approval_status)}</span></td></tr>)}</tbody></table></div>
    <h3>신청 이력 <em>{requestHistory.length}</em></h3>
    <div className="request-history">{requestHistory.map(item=><article key={item.id}><div><strong>{item.kind} · {item.name}</strong><p>{item.detail}</p><small>{new Date(item.date).toLocaleString('ko-KR')}</small></div><span className={`approval-badge ${item.status}`}>{approvalLabel(item.status)}</span></article>)}{!requestHistory.length&&<p className="admin-empty">처리 완료된 신청 이력이 없습니다.</p>}</div>
  </section></div>
}
function approvalLabel(status:string){return status==='approved'?'승인':status==='rejected'?'반려':'대기'}
