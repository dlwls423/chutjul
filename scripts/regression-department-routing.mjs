import { register } from "node:module";
import assert from "node:assert/strict";
register("./helpers/typescript-loader.mjs", import.meta.url);
register("./helpers/routing-test-loader.mjs", import.meta.url);
const { rankDepartments, analyzeDepartmentRouting } =
  await import("../lib/department-routing.ts");
const { POST } = await import("../app/api/department-routing/route.ts");
const sources = ["현재부서", "다른부서", "소수부서"].map(
  (department, index) => ({
    id: `source-${index}`,
    owning_department: department,
  }),
);
const doc = (id, source = 0, text = "개인정보 전송요구권") => ({
  id,
  source_file_id: `source-${source}`,
  title: "SECRET_OTHER_TITLE",
  category_major: null,
  category_middle: null,
  category_minor: null,
  question_summary: text,
  metadata: {
    rawText: "SECRET_RAW_TEXT",
    retrieval: { answer_summary: "SECRET_ANSWER_TEXT" },
  },
});
const documents = [
  ...Array.from({ length: 3 }, (_, i) => doc(`a-${i}`)),
  ...Array.from({ length: 40 }, (_, i) => doc(`b-${i}`, 1)),
  ...Array.from({ length: 2 }, (_, i) => doc(`c-${i}`, 2)),
];
let candidates = rankDepartments(
  "현재부서",
  "개인정보 전송요구권",
  sources,
  documents,
);
assert.equal(candidates.length, 2);
assert.deepEqual(
  candidates.map((item) => item.likelihood),
  [50, 50],
);
assert.equal(
  candidates.find((item) => item.department === "현재부서").isCurrent,
  true,
);
assert.equal(
  candidates.find((item) => item.department === "다른부서").sampleBand,
  "10~49건",
);
for (const forbidden of [
  "SECRET_OTHER_TITLE",
  "SECRET_RAW_TEXT",
  "SECRET_ANSWER_TEXT",
  "source-",
  "a-0",
  "matchedDocuments",
])
  assert.ok(!JSON.stringify(candidates).includes(forbidden));
assert.deepEqual(
  rankDepartments("현재부서", "개인정보 전송요구권", sources, [
    doc("duplicate"),
    doc("duplicate"),
    doc("duplicate"),
  ]),
  [],
);
assert.deepEqual(
  rankDepartments("현재부서", "건축 인허가", sources, documents),
  [],
);
candidates = rankDepartments("현재부서", "개인정보 전송요구권", sources, [
  ...documents,
  ...Array.from({ length: 3 }, (_, i) => doc(`extra-${i}`, 2)),
]);
assert.equal(
  candidates.reduce((sum, item) => sum + item.likelihood, 0),
  100,
);
assert.equal(candidates.length, 3);
// Exact query terms in answer metadata alone must not determine complaint jurisdiction.
assert.deepEqual(
  rankDepartments(
    "현재부서",
    "개인정보 전송요구권",
    sources,
    Array.from({ length: 3 }, (_, i) => ({
      ...doc(`answer-only-${i}`, 0, "다른 내용"),
      metadata: { retrieval: { answer_summary: "개인정보 전송요구권" } },
    })),
  ),
  [],
);
// Read beyond the old 5,000-source cutoff and honor a server page cap of 700/2.
const largeSources = Array.from({ length: 5001 }, (_, i) => ({
  id: `unused-${i}`,
  owning_department: "자료없는부서",
})).concat(sources);
let calls = 0,
  fail = false;
const profile = {
  id: "00000000-0000-4000-8000-000000000001",
  department: "현재부서",
  role: "user",
  approval_status: "approved",
};
globalThis.workspaceRouteTest = {
  profile,
  service: async (path) => {
    calls++;
    if (fail) throw Error("SECRET_DB_FAILURE");
    const url = new URL("https://test.invalid" + path);
    const offset = Number(url.searchParams.get("offset"));
    if (path.includes("/source_files"))
      return largeSources.slice(offset, offset + 700);
    assert.equal(url.searchParams.get("document_type"), "eq.complaint");
    assert.equal(url.searchParams.get("status"), "eq.ready");
    assert.ok(!url.searchParams.get("select").includes("question_original"));
    assert.ok(!url.searchParams.get("select").includes("answer_original"));
    return documents.slice(offset, offset + 2);
  },
};
let routing = await analyzeDepartmentRouting("현재부서", [
  "개인정보 전송요구권",
]);
assert.equal(routing.status, "ready");
assert.equal(routing.candidates.length, 2);
assert.ok(calls > 8);
assert.ok(!JSON.stringify(routing).includes("SECRET_"));
const request = (body, origin) =>
  new Request("http://localhost/api/department-routing", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(origin ? { origin } : {}),
    },
    body: JSON.stringify(body),
  });
let response = await POST(
  request({ query: "개인정보 전송요구권", department: "다른부서" }),
);
assert.equal(response.status, 200);
assert.equal((await response.json()).routing.currentDepartment, "현재부서");
assert.equal(response.headers.get("Cache-Control"), "private, no-store");
let before = calls;
response = await POST(
  request({ query: "담당자: 김가상 연락처: 010-0000-1234" }),
);
assert.equal(response.status, 422);
assert.equal(calls, before);
assert.equal(
  (
    await POST(
      request({ query: "개인정보 전송요구권" }, "https://evil.invalid"),
    )
  ).status,
  403,
);
for (const other of [
  null,
  { ...profile, approval_status: "pending" },
  { ...profile, id: "public-test" },
]) {
  globalThis.workspaceRouteTest.profile = other;
  before = calls;
  assert.equal(
    (await POST(request({ query: "개인정보 전송요구권" }))).status,
    other?.approval_status === "pending" ? 403 : 401,
  );
  assert.equal(calls, before);
}
globalThis.workspaceRouteTest.profile = profile;
fail = true;
routing = await analyzeDepartmentRouting("현재부서", ["개인정보 전송요구권"]);
assert.equal(routing.status, "unavailable");
assert.equal(routing.candidates.length, 0);
response = await POST(request({ query: "개인정보 전송요구권" }));
assert.equal(response.status, 503);
assert.ok(!(await response.text()).includes("SECRET_DB_FAILURE"));
console.log(
  "Department routing regression passed: complete pagination, three-complaint privacy threshold, duplicate suppression, volume-neutral ranking, 100% allocation, safe aggregate output, authentication, department scope and failure state.",
);
