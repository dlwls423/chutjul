from pathlib import Path
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle

out = Path(__file__).parent / "fixtures" / "pii-complaint.pdf"
out.parent.mkdir(parents=True, exist_ok=True)
pdfmetrics.registerFont(TTFont("Malgun", r"C:\Windows\Fonts\malgun.ttf"))
style = ParagraphStyle("body", fontName="Malgun", fontSize=10, leading=15)
lines = [
    "민원 상세", "공통사항", "민원정보", "신청번호 1AA-2699-1234567 접수번호 2AA-2699-7654321",
    "신청일시 2026-08-20 10:11:12 접수일시 2026-08-20 10:12:13",
    "민원제목 개인정보 전송요구권 적용 여부 질의", "<첨부파일>", "개인정보 전송요구권 제도 안내서.pdf",
    "안녕하세요.", "당사는 홍길동 담당자가 운영하는 정책 추천 서비스입니다.",
    "연락처는 010-1234-5678이고 이메일은 hong@example.com입니다.",
    "주민등록번호 900101-1234568 정보가 포함된 경우 전송요구권 적용 여부를 문의드립니다.",
    "공공데이터 Open API만 사용하며 기관이 보유한 개인정보를 전송받지 않습니다.",
    "민원종류 법령질의 민원처리기간", "처리완료예정일: 2026-09-03 23:59:59", "설정된 처리기간: 14",
    "민원요지 개인정보 전송요구권 적용 여부 질의", "처리결과", "처리부서 범정부마이데이터추진단 담당자 강아영",
    "처리자 강아영", "처리결과 통보일 2026-08-25 15:30 민원인 답변 확인일 2026-08-26 09:10",
    "처리결과 1. 안녕하세요, 개인정보보호위원회입니다.",
    "2. 귀하께서 문의하신 공개정보 API 이용은 개인정보 전송요구권 행사에 해당하지 않을 수 있습니다.",
    "3. 다만 서비스 구조와 이용약관은 별도로 확인해야 합니다.",
    "4. 추가 설명은 02-2100-3176 또는 privacy@korea.kr로 문의해 주십시오. 감사합니다. 끝.",
    "처리결과 첨부파일", "민원만족도"
]
doc = SimpleDocTemplate(str(out), pagesize=A4, leftMargin=42, rightMargin=42, topMargin=42, bottomMargin=42)
story=[]
for line in lines:
    story.extend([Paragraph(line.replace("&", "&amp;"), style), Spacer(1, 3)])
doc.build(story)
print(out)
