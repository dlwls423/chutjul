import json
import unittest
from unittest.mock import patch

import server


SAFE_SUMMARY = {
    "purpose": "개인정보 전송요구권 적용 여부 확인",
    "essentialFacts": ["공개 API만 사용함", "이용자 인증정보를 사용하지 않음"],
    "legalQuestions": ["개인정보 전송요구권 적용 대상인지"],
    "requestedAnswer": ["적용 여부와 법적 근거"],
    "uncertainties": [],
}


class PrivacyGatewayTest(unittest.TestCase):
    def test_detects_korean_pii_and_split_numbers(self):
        text = "민원인 홍길동, 010-1234-5678, a@test.kr, 신청번호 1AA-2607-\n1207208"
        kinds = {item["type"] for item in server.detect(text)}
        self.assertTrue({"PERSON", "PHONE_NUMBER", "EMAIL_ADDRESS", "APPLICATION_NUMBER"} <= kinds)

    def test_masks_values(self):
        masked = server.mask("담당자 홍길동 전화 02-2100-3176")
        self.assertNotIn("홍길동", masked)
        self.assertNotIn("2100", masked)

    @patch("server.summarize", return_value=SAFE_SUMMARY)
    def test_only_safe_summary_becomes_outbound(self, _mock):
        result = server.process({"question": "민원인 김예진의 연락처는 010-1234-5678입니다. 적용 법령을 알려주세요."})
        self.assertTrue(result["outboundSafe"])
        self.assertNotIn("김예진", result["outboundText"])
        self.assertNotIn("010", result["outboundText"])
        self.assertGreater(result["piiSummary"]["PHONE_NUMBER"], 0)

    @patch("server.summarize")
    def test_blocks_llm_output_containing_pii(self, summary):
        unsafe = dict(SAFE_SUMMARY)
        unsafe["purpose"] = "010-1234-5678로 회신"
        summary.return_value = unsafe
        result = server.process({"question": "법령을 알려주세요."})
        self.assertFalse(result["outboundSafe"])
        self.assertEqual(result["outboundText"], "")


if __name__ == "__main__":
    unittest.main()
