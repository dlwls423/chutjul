import { analyzeLegalQuery, legalSourceHintScore } from '../lib/legal-query.ts';

const alias=analyzeLegalQuery('신용정보법 제32조에 따라 개인신용정보를 제공할 수 있나요?');
for(const expected of ['신용정보법','개인신용정보','제32조']){
  if(![...alias.directTerms,...alias.expandedTerms,...alias.articleNumbers].includes(expected))throw new Error(`LEGAL_QUERY_ALIAS_MISSING:${expected}`);
}
if(legalSourceHintScore('신용정보법 제32조','신용정보의 이용 및 보호에 관한 법률')<200)throw new Error('CREDIT_ACT_HINT_MISSING');
if(legalSourceHintScore('신용정보법 시행령 제28조의3','신용정보의 이용 및 보호에 관한 법률 시행령')<200)throw new Error('CREDIT_ACT_DECREE_HINT_MISSING');
if(legalSourceHintScore('신용정보법 시행규칙','신용정보의 이용 및 보호에 관한 법률')!==0)throw new Error('CREDIT_ACT_VARIANT_MISMATCH');

const natural=analyzeLegalQuery('마이데이터 사업자가 스크래핑 방식으로 정보를 수집할 수 있는지');
for(const expected of ['본인신용정보관리업','전송요구','개인신용정보']){
  if(!natural.expandedTerms.includes(expected))throw new Error(`NATURAL_QUERY_EXPANSION_MISSING:${expected}`);
}
console.log('legal query regression: ok');
