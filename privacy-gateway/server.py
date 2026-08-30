"""Local-only privacy gateway for Chutjul V2.

Runs with the Python standard library and calls a locally running Ollama server.
Raw complaint text never leaves this process except for the configured Ollama URL.
"""
from __future__ import annotations

import json
import os
import re
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.request import Request, urlopen

HOST = os.getenv("PRIVACY_GATEWAY_HOST", "127.0.0.1")
PORT = int(os.getenv("PRIVACY_GATEWAY_PORT", "8765"))
API_KEY = os.getenv("PRIVACY_GATEWAY_API_KEY", "")
OLLAMA_URL = os.getenv("OLLAMA_URL", "http://127.0.0.1:11434").rstrip("/")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "")

SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "purpose": {"type": "string"},
        "essentialFacts": {"type": "array", "items": {"type": "string"}},
        "legalQuestions": {"type": "array", "items": {"type": "string"}},
        "requestedAnswer": {"type": "array", "items": {"type": "string"}},
        "uncertainties": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["purpose", "essentialFacts", "legalQuestions", "requestedAnswer", "uncertainties"],
}

RULES = [
    ("RESIDENT_ID", re.compile(r"(?<!\d)\d{6}\s*[- ]?\s*[1-8]\d{6}(?!\d)")),
    ("EMAIL_ADDRESS", re.compile(r"[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}", re.I)),
    ("PHONE_NUMBER", re.compile(r"(?<!\d)(?:\+?82\s*[-.]?\s*)?0(?:2|1[016789]|[3-6][1-5]|70)(?:\s*[-.]?\s*\d){7,8}(?!\d)")),
    ("APPLICATION_NUMBER", re.compile(r"(?<![A-Z0-9])[12]AA\s*-\s*\d{4}\s*-\s*\d{7}(?!\d)", re.I)),
    ("BUSINESS_NUMBER", re.compile(r"(?<!\d)\d{3}\s*[- ]\s*\d{2}\s*[- ]\s*\d{5}(?!\d)")),
    ("CARD_OR_ACCOUNT", re.compile(r"(?<!\d)\d{3,6}(?:\s*[- ]\s*\d{2,6}){2,3}(?!\d)")),
    ("PERSON", re.compile(r"(?:민원인|성명|이름|대표자|담당자|처리자)\s*[:：]?\s*[가-힣]{2,5}(?:입니다|이다|씨)?")),
]


def detect(text: str) -> list[dict]:
    findings = []
    for entity_type, pattern in RULES:
        for match in pattern.finditer(text):
            if any(match.start() < found["end"] and match.end() > found["start"] for found in findings):
                continue
            findings.append({"type": entity_type, "start": match.start(), "end": match.end()})
    return sorted(findings, key=lambda item: (item["start"], item["end"]))


def mask(text: str) -> str:
    masked = text
    replacements = {
        "RESIDENT_ID": "[주민등록번호 삭제]", "EMAIL_ADDRESS": "[이메일 삭제]",
        "PHONE_NUMBER": "[전화번호 삭제]", "APPLICATION_NUMBER": "[민원번호 삭제]",
        "BUSINESS_NUMBER": "[사업자번호 삭제]", "CARD_OR_ACCOUNT": "[금융번호 삭제]",
        "PERSON": "[성명 삭제]",
    }
    for entity_type, pattern in RULES:
        masked = pattern.sub(replacements[entity_type], masked)
    return masked


def validate_summary(value: dict) -> dict:
    if not isinstance(value, dict):
        raise ValueError("LOCAL_LLM_JSON_INVALID")
    allowed = set(SCHEMA["properties"])
    if set(value) - allowed:
        raise ValueError("LOCAL_LLM_SCHEMA_INVALID")
    purpose = str(value.get("purpose", "")).strip()
    result = {"purpose": purpose}
    for key in ("essentialFacts", "legalQuestions", "requestedAnswer", "uncertainties"):
        items = value.get(key)
        if not isinstance(items, list):
            raise ValueError("LOCAL_LLM_SCHEMA_INVALID")
        result[key] = [str(item).strip() for item in items if str(item).strip()][:12]
    if not purpose or not result["legalQuestions"]:
        raise ValueError("LOCAL_LLM_SUMMARY_INCOMPLETE")
    return result


def summarize(question: str) -> dict:
    if not OLLAMA_MODEL:
        raise ValueError("OLLAMA_MODEL_NOT_CONFIGURED")
    prompt = """당신은 기관 내부망에서 작동하는 한국어 민원 최소화 처리기입니다.
원문을 인용하거나 문장을 길게 복사하지 말고 법률 답변 작성에 필요한 최소 사실만 일반화하십시오.
이름, 연락처, 이메일, 주소, 민원번호, 담당자, 회사명, 서비스명, 고유 날짜와 개인 식별 단서를 절대 출력하지 마십시오.
모든 필드의 값은 반드시 한국어로 작성하십시오. 확실하지 않은 사실은 uncertainties에 넣고 추측하지 마십시오. JSON 스키마만 출력하십시오.

민원 질의:\n""" + question
    def call(messages: list[dict]) -> dict:
        payload = json.dumps({
        "model": OLLAMA_MODEL,
        "stream": False,
        "format": SCHEMA,
        "options": {"temperature": 0},
        "messages": messages,
        }).encode("utf-8")
        request = Request(f"{OLLAMA_URL}/api/chat", data=payload, headers={"Content-Type": "application/json"})
        with urlopen(request, timeout=180) as response:
            body = json.loads(response.read().decode("utf-8"))
        return validate_summary(json.loads(body.get("message", {}).get("content", "")))

    system = {"role": "system", "content": "모든 응답 값은 한국어로만 작성한다. 영어나 원문의 개인정보를 출력하지 않는다."}
    result = call([system, {"role": "user", "content": prompt}])
    rendered = json.dumps(result, ensure_ascii=False)
    if len(re.findall(r"[가-힣]", rendered)) < max(10, len(rendered) // 20):
        result = call([system, {"role": "user", "content": "다음 JSON의 키와 구조는 그대로 유지하고 모든 문자열 값을 자연스러운 한국어로만 번역하십시오. 설명은 추가하지 마십시오.\n" + rendered}])
    return result


def process(payload: dict) -> dict:
    question = str(payload.get("question", "")).strip()
    if not question:
        raise ValueError("QUESTION_REQUIRED")
    original_findings = detect(question)
    # The local model may inspect the original inside the trusted boundary. Its output is scanned again.
    # Deterministic first-pass redaction reduces the chance that the model copies identifiers.
    summary = summarize(mask(question))
    outbound_text = json.dumps(summary, ensure_ascii=False)
    residual = detect(outbound_text)
    safe = not residual and len(outbound_text) <= 8000
    counts: dict[str, int] = {}
    for finding in original_findings:
        counts[finding["type"]] = counts.get(finding["type"], 0) + 1
    return {
        "success": True,
        "outboundSafe": safe,
        "blockedReasons": [] if safe else sorted({f["type"] for f in residual}) or ["OUTBOUND_TOO_LARGE"],
        "structuredComplaint": summary,
        "outboundText": outbound_text if safe else "",
        "maskedQuestion": mask(question),
        "piiSummary": counts,
        "localModel": OLLAMA_MODEL,
        "schemaVersion": 1,
    }


class Handler(BaseHTTPRequestHandler):
    def send_json(self, status: int, value: dict) -> None:
        body = json.dumps(value, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        if self.path == "/health":
            self.send_json(200, {"ok": True, "model": OLLAMA_MODEL})
        else:
            self.send_json(404, {"error": "NOT_FOUND"})

    def do_POST(self) -> None:
        if self.path != "/v1/sanitize-complaint":
            return self.send_json(404, {"error": "NOT_FOUND"})
        if API_KEY and self.headers.get("Authorization") != f"Bearer {API_KEY}":
            return self.send_json(401, {"error": "UNAUTHORIZED"})
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > 5_000_000:
                raise ValueError("INVALID_REQUEST_SIZE")
            self.send_json(200, process(json.loads(self.rfile.read(length))))
        except Exception as error:  # fail closed; never return the raw input
            self.send_json(422, {"success": False, "error": str(error)[:300]})

    def log_message(self, fmt: str, *args) -> None:
        # Avoid accidentally logging request bodies or identifiers.
        print("privacy-gateway", fmt % args)


if __name__ == "__main__":
    print(f"Privacy gateway listening on http://{HOST}:{PORT}; model={OLLAMA_MODEL or '(not configured)'}")
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
