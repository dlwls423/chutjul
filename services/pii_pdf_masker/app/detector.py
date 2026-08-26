from __future__ import annotations
import re
from dataclasses import dataclass

@dataclass(frozen=True)
class Detection:
    kind: str
    text: str

RID=re.compile(r"(?<!\d)\d{6}[\s-]?[1-8]\d{6}(?!\d)")
BID=re.compile(r"(?<!\d)\d{3}[\s-]?\d{2}[\s-]?\d{5}(?!\d)")
PHONE=re.compile(r"(?<!\d)(?:\+?82[\s.-]?)?(?:0(?:2|1[016789]|[3-6][1-5]|70))[\s.-]?\d{3,4}[\s.-]?\d{4}(?!\d)")
EMAIL=re.compile(r"(?<![\w.+-])[\w.+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}(?![\w.-])")
NAME=re.compile(r"(?:성명|이름|대표자(?:명)?|담당자(?:명)?|처리자)[ \t]*[:：]?[ \t]*(?P<v>[가-힣]{2,5})(?![가-힣])")
BUSINESS=re.compile(r"(?:사업자명|사업체명|법인명|상호|회사명)[ \t]*[:：]?[ \t]*(?P<v>(?:주식회사\s*)?(?:\(주\)\s*)?[가-힣A-Za-z0-9][가-힣A-Za-z0-9&·._()\-\s]{1,40}?)(?=\s{2,}|\n|$|사업자등록번호|대표자|주소|전화)")

def _digits(value): return [int(x) for x in value if x.isdigit()]
def valid_rid(value):
    d=_digits(value)
    return len(d)==13 and (11-sum(n*w for n,w in zip(d[:12],[2,3,4,5,6,7,8,9,2,3,4,5]))%11)%10==d[12]
def valid_bid(value):
    d=_digits(value)
    return len(d)==10 and (10-(sum(n*w for n,w in zip(d[:9],[1,3,7,1,3,7,1,3,5]))+(d[8]*5)//10)%10)%10==d[9]
def detect_pii(text, custom_terms=()):
    out=[]
    for kind,pattern,validator in [('resident_id',RID,valid_rid),('business_id',BID,valid_bid),('phone',PHONE,None),('email',EMAIL,None)]:
        out += [Detection(kind,m.group()) for m in pattern.finditer(text) if validator is None or validator(m.group())]
    for kind,pattern in [('name',NAME),('business_name',BUSINESS)]: out += [Detection(kind,m.group('v').strip()) for m in pattern.finditer(text)]
    for term in custom_terms:
        term=term.strip()
        if term: out += [Detection('custom',m.group()) for m in re.finditer(re.escape(term),text,re.I)]
    return list(dict.fromkeys(out))
