// Synthetic values only. Never replace these with actual complaint records.
export const sensitiveCases = [
  ...['+82 10 0000 1234', '+82-10-0000-1234', '+821000001234', '82 10 0000 1234', '+82 (0)10 0000 1234', '+82 010 0000 1234', '+82 2 000 1234'].map((phone, index) => ({ id: `international-phone-${index}`, text: `연락처: ${phone}`, privateValues: [phone], type: '휴대전화' })),
  { id: 'name-no-colon', text: '민원인 김가상', privateValues: ['김가상'], type: '성명' },
  { id: 'name-fullwidth-colon', text: '민원인：김가상', privateValues: ['김가상'], type: '성명' },
  { id: 'representative-name', text: '대표 김가상', privateValues: ['김가상'], type: '직함 인접 성명' },
  { id: 'representative-name-colon', text: '대표:김가상', privateValues: ['김가상'], type: '직함 인접 성명' },
  { id: 'phone-mobile', text: '연락처: 010-0000-1234', privateValues: ['010-0000-1234'], type: '휴대전화' },
  { id: 'phone-office', text: '전화번호: 02-000-1234', privateValues: ['02-000-1234'], type: '휴대전화' },
  { id: 'phone-spaces', text: '전화번호: 010 0000 1234', privateValues: ['010 0000 1234'], type: '휴대전화' },
  { id: 'email', text: '회신: synthetic.person@example.invalid', privateValues: ['synthetic.person@example.invalid'], type: '이메일' },
  { id: 'resident-number', text: '주민등록번호: 991332-1234567', privateValues: ['991332-1234567'], type: '주민등록번호' },
  { id: 'business-number', text: '사업자등록번호: 000-00-00000', privateValues: ['000-00-00000'], type: '사업자등록번호' },
  { id: 'account', text: '계좌번호: 000-0000-000000', privateValues: ['000-0000-000000'], type: '계좌·카드번호' },
  { id: 'card', text: '카드번호: 0000-0000-0000-0000', privateValues: ['0000-0000-0000-0000'], type: '계좌·카드번호' },
  { id: 'address', text: '주소: 가상시 가상구 가상로 999', privateValues: ['가상시 가상구 가상로 999'], type: '주소' },
  { id: 'name-label', text: '성명: 김가상', privateValues: ['김가상'], type: '성명' },
  { id: 'name-title-before', text: '주무관 김가상', privateValues: ['김가상'], type: '직함 인접 성명' },
  { id: 'name-title-after', text: '김가상 주무관', privateValues: ['김가상'], type: '직함 인접 성명' },
  { id: 'company', text: '주식회사 가상테스트', privateValues: ['가상테스트'], type: '법인명' },
  { id: 'vehicle', text: '차량번호: 123가0000', privateValues: ['123가0000'], type: '차량번호' },
  { id: 'vehicle-region', text: '차량번호: 서울 12 가 0000', privateValues: ['서울 12 가 0000'], type: '차량번호' },
  { id: 'application', text: '신청번호 1AA-2026-0000000', privateValues: ['1AA-2026-0000000'], type: '업무식별자' },
  { id: 'receipt', text: '접수번호 2AA-2026-0000000', privateValues: ['2AA-2026-0000000'], type: '업무식별자' },
];

export const safeCases = [
  { id: 'rights-particle', text: '민원인 권리를 보장하고 민원인 권리의 행사 방법을 안내합니다.' },
  { id: 'representative-word', text: '대표적인 사례 및 이사회 의결 기준을 설명합니다.' },
  { id: 'processor-context', text: '개인정보처리자가 파기 의무를 이행하는지 확인합니다.' },
  { id: 'long-digit-boundary', text: '기술 식별값 99100000123499는 전화번호 형식이 아닙니다.' },
  { id: 'legal-article', text: '개인정보 보호법 제35조의2에 따른 전송요구권 적용 여부를 문의합니다.' },
  { id: 'processor', text: '개인정보처리자는 처리 목적이 달성되면 개인정보를 파기해야 합니다.' },
  { id: 'retention-period', text: '보유기간은 30일이며, 철회 후 이미 전송된 자료의 파기 의무를 확인해 주세요.' },
  { id: 'reference-numbers', text: '제15조제1항제1호 및 제17조제4항의 판단 기준을 설명해 주세요.' },
  { id: 'placeholders', text: '성명: [성명]\n주소: [주소]\n전화번호: [전화번호]\n[업무식별자] [차량번호] [법인명]' },
];

// Exploratory probes are reported separately and fail --strict-gaps until fixed.
export const gapCases = [
  { id: 'phone-international', text: '연락처: +82 10 0000 1234', privateValues: ['+82 10 0000 1234'], type: '휴대전화' },
  { id: 'safe-representative-word', text: '대표적인 개인정보 침해 사례와 대응 방법을 안내해 주세요.', safe: true },
  { id: 'safe-complainant-rights', text: '민원인 권리와 개인정보 열람 절차를 설명해 주세요.', safe: true },
];
