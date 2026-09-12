import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
const load = async path => stripTypeScriptTypes(await readFile(new URL(path, import.meta.url),'utf8'));
const uri = text => `data:text/javascript;base64,${Buffer.from(text).toString('base64')}`;
const policy = uri(await load('../lib/draft-policy.ts'));
const replacement = {
  'next/server': uri('export const NextResponse={json:(data,options={})=>Response.json(data,options)};'),
  '../../../lib/auth': uri('export async function requireProfile(){return {id:"synthetic-user",department:"테스트부서"}}'),
  '../../../lib/search': uri('export async function keywordSearch(){return [{id:"law-1",title:"합성 검증 법령",documentType:"law",department:"공통 법령",category:"현행 법령",createdAt:"2026-01-01",snippet:"공개 법령 시험 본문입니다.",question:"",answer:"",content:"공개 법령 시험 본문입니다. 개인정보 처리 기준을 규정합니다.",score:90,matchedTerms:["개인정보"],legalReferences:[],complaintMetadata:{source_url:"https://www.law.go.kr/"},guideMatches:[]}]}'),
  '../../../lib/draft-policy': policy,
  '../../../lib/privacy-check': uri(await load('../lib/privacy-check.ts')),
};
let route=await load('../app/api/draft/route.ts');
for(const [path,value] of Object.entries(replacement))route=route.replace(`'${path}'`,`'${value}'`);
process.env.DRAFT_SIGNING_SECRET='synthetic-test-only';process.env.OPENAI_API_KEY='synthetic-key';
const {POST}=await import(uri(route));
const request=(body,origin='https://test.local')=>new Request('https://test.local/api/draft',{method:'POST',headers:{'Content-Type':'application/json',origin},body:JSON.stringify(body)});
let calls=0;let sent;
globalThis.fetch=async(url,init)=>{assert.equal(url,'https://api.openai.com/v1/responses');calls++;sent=JSON.parse(init.body);return Response.json({output:[{content:[{type:'output_text',text:JSON.stringify({selectedEvidence:[{reference:'E1',reason:'쟁점에 직접 관련된 현행 법령'}],draft:'추가 사실 확인이 필요합니다. [E1]'})}]}]});};
const summary={purpose:'개인정보 전송요구권 적용 기준 확인',essentialFacts:['공개 API만 이용하는 서비스임'],legalQuestions:['개인정보 전송요구권 적용 대상인지 여부'],requestedAnswer:['관련 법령과 판단 기준 안내 요청'],uncertainties:[]};
assert.equal((await POST(request({action:'prepare',summary,confirmed:true,raw:'홍길동 010-1234-5678'}))).status,400);
assert.equal((await POST(request({action:'prepare',summary:{...summary,purpose:'홍길동 010-1234-5678 문의'},confirmed:true}))).status,400);
assert.equal((await POST(request({action:'prepare',summary,confirmed:false}))).status,400);
assert.equal((await POST(request({action:'prepare',summary,confirmed:true},'https://foreign.local'))).status,403);
const prepared=await (await POST(request({action:'prepare',summary,confirmed:true}))).json();
assert.ok(prepared.signature);assert.equal(calls,0);
assert.equal((await POST(request({action:'generate',confirmed:false,envelope:prepared.envelope,signature:prepared.signature}))).status,400);
assert.equal((await POST(request({action:'generate',confirmed:true,envelope:prepared.envelope+' ',signature:prepared.signature}))).status,400);
assert.equal(calls,0);
const success=await POST(request({action:'generate',confirmed:true,envelope:prepared.envelope,signature:prepared.signature}));
assert.equal(success.status,200);assert.equal(calls,1);assert.deepEqual(sent,prepared.payload);assert.equal(sent.store,false);
assert.ok(!JSON.stringify(sent).includes('synthetic-user'));assert.ok(!JSON.stringify(sent).includes('010-1234-5678'));
const generated=await success.json();assert.equal(generated.selectedEvidence[0].reference,'E1');assert.match(generated.draft,/\[E1\]/);
console.log('PASS: PII rejection, raw-field rejection, origin, approval, signature tampering, exact outbound preview, no response storage.');
