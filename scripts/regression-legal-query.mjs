import { analyzeLegalQuery, legalSourceHintScore, normalizeOfficialArticleNumber } from '../lib/legal-query.ts';
import { extractLegalProvisions } from '../lib/legal-provisions.ts';

const alias=analyzeLegalQuery('신용정보법 제32조에 따라 개인신용정보를 제공할 수 있나요?');
for(const expected of ['신용정보법','개인신용정보','제32조']){
  if(![...alias.directTerms,...alias.expandedTerms,...alias.articleNumbers].includes(expected))throw new Error(`LEGAL_QUERY_ALIAS_MISSING:${expected}`);
}
if(legalSourceHintScore('신용정보법 제32조','신용정보의 이용 및 보호에 관한 법률')<200)throw new Error('CREDIT_ACT_HINT_MISSING');
if(legalSourceHintScore('신용정보법 시행령 제28조의3','신용정보의 이용 및 보호에 관한 법률 시행령')<200)throw new Error('CREDIT_ACT_DECREE_HINT_MISSING');
if(legalSourceHintScore('신용정보법 시행규칙','신용정보의 이용 및 보호에 관한 법률')!==0)throw new Error('CREDIT_ACT_VARIANT_MISMATCH');
if(normalizeOfficialArticleNumber('32')!=='제32조')throw new Error('ARTICLE_NUMBER_NORMALIZATION_FAILED');
if(normalizeOfficialArticleNumber('제32조')!=='제32조')throw new Error('FORMATTED_ARTICLE_NUMBER_NORMALIZATION_FAILED');
if(normalizeOfficialArticleNumber('0028','3')!=='제28조의3')throw new Error('BRANCHED_ARTICLE_NUMBER_NORMALIZATION_FAILED');
for(const malformed of ['①','1.','항1'])if(normalizeOfficialArticleNumber(malformed)!==null)throw new Error(`MALFORMED_ARTICLE_NUMBER_ACCEPTED:${malformed}`);

const nested=extractLegalProvisions({법령:{조문:{조문단위:[{조문번호:'32',조문제목:'개인신용정보의 제공',조문내용:'제32조 본문',항:[{항내용:'① 첫 번째 항',호:[{호내용:'1. 첫 번째 호'},{호내용:'2. 두 번째 호'}]},{항내용:'② 두 번째 항',호:[{호내용:'1. 별도 동의'}]}]}]}}});
if(nested.length!==1)throw new Error(`LEGAL_PROVISION_COUNT_MISMATCH:${nested.length}`);
for(const expected of ['제32조 본문','① 첫 번째 항','1. 첫 번째 호','2. 두 번째 호','② 두 번째 항','1. 별도 동의'])if(!nested[0].body.includes(expected))throw new Error(`LEGAL_PROVISION_NESTED_TEXT_MISSING:${expected}`);

const natural=analyzeLegalQuery('마이데이터 사업자가 스크래핑 방식으로 정보를 수집할 수 있는지');
for(const expected of ['본인신용정보관리업','전송요구','개인신용정보']){
  if(!natural.expandedTerms.includes(expected))throw new Error(`NATURAL_QUERY_EXPANSION_MISSING:${expected}`);
}
console.log('legal query regression: ok');
