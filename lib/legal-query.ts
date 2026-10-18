const normalize=(value:string)=>value.normalize('NFKC').toLocaleLowerCase('ko-KR').replace(/\s+/g,' ').trim();
const STOP_WORDS=new Set(['그리고','그러나','대한','대하여','관련','문의','알려주세요','경우','있는','없는','합니다','했습니다','입니다','되어','되는','하는','하여','에서','으로','에게','까지','또한','해당','내용','답변','민원']);
const LEGAL_QUERY_EXPANSIONS:[RegExp,string[]][]=[
  [/신용정보법/, ['신용정보','개인신용정보']],
  [/마이데이터|본인신용정보관리/, ['본인신용정보관리업','개인신용정보','전송요구']],
  [/전송요구권?|정보전송/, ['전송요구','정보전송']],
  [/스크래핑|스크린\s*스크래핑/, ['수집','개인신용정보']],
  [/신용평가/, ['개인신용평가','신용평가회사']],
];

export function analyzeLegalQuery(value:string){
  const normalized=normalize(value);
  const articleNumbers=[...normalized.matchAll(/제\s*(\d+)(?:\s*조의\s*(\d+))?\s*조?/g)].map(match=>`제${match[1]}조${match[2]?`의${match[2]}`:''}`);
  const directTerms=[...new Set(normalized.replace(/[^0-9a-z가-힣제조항의]+/gi,' ').split(' ').filter(term=>term.length>=2&&!STOP_WORDS.has(term)))].sort((a,b)=>b.length-a.length).slice(0,20);
  const expandedTerms=[...new Set(LEGAL_QUERY_EXPANSIONS.filter(([pattern])=>pattern.test(normalized)).flatMap(([,terms])=>terms).map(normalize).filter(term=>!directTerms.includes(term)))].slice(0,12);
  return{normalized,directTerms,expandedTerms,articleNumbers:[...new Set(articleNumbers)]};
}

export function legalSourceHintScore(rawQuery:string,canonicalName:string){
  const query=normalize(rawQuery).replace(/\s+/g,'');
  const name=normalize(canonicalName).replace(/\s+/g,'');
  if(query.includes(name))return 220;
  if(query.includes('신용정보법')&&name.includes('신용정보의이용및보호에관한법률')){
    if(query.includes('시행규칙'))return name.endsWith('시행규칙')?220:0;
    if(query.includes('시행령'))return name.endsWith('시행령')?220:0;
    return name==='신용정보의이용및보호에관한법률'?220:90;
  }
  return 0;
}

export function normalizeOfficialArticleNumber(value:unknown,branchValue:unknown=''){
  const match=String(value??'').trim().match(/^(?:제\s*)?0*(\d+)(?:\s*조)?$/);
  if(!match)return null;
  const base=Number(match[1]);
  if(!Number.isInteger(base)||base<1)return null;
  const branchMatch=String(branchValue??'').trim().match(/^0*(\d+)$/);
  const branch=branchMatch?Number(branchMatch[1]):0;
  return `제${base}조${branch>0?`의${branch}`:''}`;
}
