import {parseEpeopleComplaint} from '../lib/epeople-parser.ts';

const sample=`민원 상세
민원정보
신청번호 1AA-2607-1207208 접수번호 2AA-2607-1203261
민원제목 개인정보 전송요구권 제도 적용 여부 관련 질의
<첨부파일>
안내서.pdf
안녕하세요.
민원종류 법령질의
당사는 공개 공공데이터 API만 사용하고 이용자의 인증정보를 사용하지 않습니다.
공공기관이 보유한 개인정보도 전송받지 않습니다.
이 서비스가 개인정보 보호법상 개인정보 전송요구권 적용 대상인지 알려주세요.
민원종류 법령질의
민원요지 개인정보 전송요구권 적용 여부
처리부서 범정부마이데이터추진단
처리결과 1. 안녕하세요, 개인정보보호위원회입니다. 문의하신 사항에 대해 답변드립니다.
2. 공개 정보만 이용하고 개인정보를 전송받지 않는 구조라면 적용 대상에 해당하지 않을 수 있습니다.
3. 구체적인 운영 구조는 추가 확인이 필요합니다.
처리결과 첨부파일`;

const result=parseEpeopleComplaint(sample,'민원.pdf');
if(!result)throw new Error('parser returned null');
if(result.question.length<100)throw new Error(`question too short: ${result.question.length}`);
if(!result.question.includes('공개 공공데이터 API'))throw new Error('question body missing');
if(result.answer.length<100)throw new Error(`answer too short: ${result.answer.length}`);
console.log(`parser OK: question=${result.question.length}, answer=${result.answer.length}`);

const alternate=`민원 상세
신청번호 1AA-2699-7654321
민원제목 다른 기관 답변 양식
<첨부파일>
자료.pdf
안녕하십니까. 공개 API로 제공되는 정보를 활용하는 경우 전송요구권 적용 여부와 별도 준수사항을 확인해 주시기 바랍니다.
민원요지 공개 정보 활용 관련 질의
처리부서 데이터정책과
처리자 김담당
처리결과 통보일 2026-08-31 10:00
처리결과(답변내용)
귀하의 질의에 대해 다음과 같이 답변드립니다. 공개된 정보만 활용하는 경우 개인정보 전송요구 대상정보에 해당하지 않을 수 있습니다. 다만 서비스 구조와 이용약관은 별도로 확인해야 합니다.
민원만족도`;
const alternateResult=parseEpeopleComplaint(alternate,'다른양식.pdf');
if(!alternateResult||alternateResult.question.length<40)throw new Error(`alternate question too short: ${alternateResult?.question.length||0}`);
if(alternateResult.answer.length<40)throw new Error(`alternate answer too short: ${alternateResult.answer.length}`);
console.log(`alternate parser OK: question=${alternateResult.question.length}, answer=${alternateResult.answer.length}`);
