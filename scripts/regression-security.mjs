import { register } from 'node:module';
import assert from 'node:assert/strict';
register('./helpers/typescript-loader.mjs', import.meta.url);
const { withApiSecurity, boundedBody } = await import('../lib/api-security.ts');
const { validateAnswerHistory } = await import('../lib/answer-history.ts');
let calls = 0;
const handler = withApiSecurity(async request => {
  calls++;
  if (request.method === 'POST') await request.json();
  return Response.json({ ok: true });
});
const make = (headers = {}, body = '{}') => new Request('https://site.invalid/api/answers', {
  method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body,
});
for (const headers of [{}, { origin: 'null' }, { origin: 'https://evil.invalid' },
  { origin: 'https://site.invalid', 'sec-fetch-site': 'cross-site' },
  { origin: 'https://sibling.site.invalid', 'sec-fetch-site': 'same-site' }]) {
  assert.equal((await handler(make(headers))).status, 403);
}
assert.equal(calls, 0);
let response = await handler(make({ origin: 'https://site.invalid' }));
assert.equal(response.status, 200);
assert.equal(response.headers.get('cache-control'), 'private, no-store');
assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
assert.equal(response.headers.get('strict-transport-security'), 'max-age=31536000');
assert.equal((await handler(make({ origin: 'https://site.invalid' }, '{broken'))).status, 400);
assert.equal((await handler(make({ origin: 'https://site.invalid' }, 'x'.repeat(512 * 1024 + 1)))).status, 413);
assert.equal((await handler(make({ origin: 'https://site.invalid', 'content-type': 'text/plain' }))).status, 415);
let cancelled = false;
const streamed = new Request('https://site.invalid/api/test', { method: 'POST', duplex: 'half', body: new ReadableStream({
  pull(c) { c.enqueue(new Uint8Array(32)); }, cancel() { cancelled = true; },
}) });
await assert.rejects(() => boundedBody(streamed, 48), /REQUEST_TOO_LARGE/);
assert.equal(cancelled, true);
const secretFailure = withApiSecurity(async () => Response.json({ error: 'SECRET_DATABASE_ROW' }, { status: 500 }));
response = await secretFailure(new Request('https://site.invalid/api/test'));
assert.equal(response.status, 500);
assert.ok(!(await response.text()).includes('SECRET_DATABASE_ROW'));
const originalMode = process.env.PUBLIC_TEST_MODE;
process.env.PUBLIC_TEST_MODE = 'true';
assert.equal((await handler(make({ origin: 'https://site.invalid' }))).status, 403);
if (originalMode === undefined) delete process.env.PUBLIC_TEST_MODE; else process.env.PUBLIC_TEST_MODE = originalMode;
const safe = { title: '처리 절차 안내', answerText: '자료 확인 후 안내드립니다.', summary: { editorText: '처리 절차를 문의합니다.' }, evidence: [], qualityChecks: { legal_articles_verified: null } };
assert.equal(validateAnswerHistory(safe).draft, safe.answerText);
for (const key of ['answerText', 'title']) assert.throws(() => validateAnswerHistory({ ...safe, [key]: '전화번호: +82 10 0000 1234' }), /SENSITIVE_INPUT/);
assert.throws(() => validateAnswerHistory({ ...safe, summary: { editorText: '담당자: 김가상' } }), /SENSITIVE_INPUT/);
for (const key of ['applicationNumber', 'rawText', 'user_id', 'filename']) assert.throws(() => validateAnswerHistory({ ...safe, [key]: 'secret' }), /INVALID_INPUT/);
assert.throws(() => validateAnswerHistory({ ...safe, evidence: [{ rawText: 'secret' }] }), /INVALID_INPUT/);
assert.throws(() => validateAnswerHistory({ ...safe, qualityChecks: { rawText: 'secret' } }), /INVALID_INPUT/);
console.log('Security regression passed: cross-origin denial, streaming limits, response privacy, public-test read-only and answer-history whitelist.');
register('./helpers/security-route-loader.mjs', import.meta.url);
const { requireDocumentAccess } = await import('../lib/document-access.ts');
const answers = await import('../app/api/answers/route.ts');
const profile = { id: 'user-a', role: 'user', approval_status: 'approved', department: 'owner-a' };
let owner = 'owner-b';
let writes = 0;
globalThis.workspaceRouteTest = { profile, service: async (path, init) => {
  if (path.includes('rag_documents')) return [{ source_file_id: 'source-1' }];
  if (path.includes('source_files')) return [{ owning_department: owner }];
  assert.ok(path.includes('user_id=eq.user-a') || init?.method === 'POST');
  if (init?.method === 'POST') {
    writes++;
    const row = JSON.parse(init.body);
    assert.equal(row.user_id, profile.id);
    assert.equal(row.application_number, null);
    assert.equal(row.answer_text, safe.answerText);
  }
  return [];
} };
const documentId = '00000000-0000-4000-8000-000000000001';
await assert.rejects(() => requireDocumentAccess(documentId), /FORBIDDEN/);
owner = 'owner-a';
assert.equal((await requireDocumentAccess(documentId)).id, profile.id);
await assert.rejects(() => requireDocumentAccess('id&department=other'), /NOT_FOUND/);
assert.equal((await answers.POST(make({ origin: 'https://site.invalid' }, JSON.stringify(safe)))).status, 201);
assert.equal(writes, 1);
assert.equal((await answers.POST(make({ origin: 'https://site.invalid' }, JSON.stringify({ ...safe, answerText: '연락처: 010-0000-1234' })))).status, 400);
assert.equal(writes, 1);
globalThis.workspaceRouteTest.profile = { ...profile, id: 'public-test' };
assert.equal((await answers.GET(new Request('https://site.invalid/api/answers'))).status, 401);
assert.equal((await answers.POST(make({ origin: 'https://site.invalid' }, JSON.stringify(safe)))).status, 401);
assert.equal(writes, 1);
console.log('Security API regression passed: source-owner authorization, account-scoped history and public-test denial.');
const { revokeCurrentSession } = await import('../lib/session-revocation.ts');
let revokes = [];
await revokeCurrentSession('access', 'refresh', async (path, init) => {
  revokes.push([path, init.headers?.Authorization]);
  return new Response(null, {status:204});
}, async () => assert.fail('no refresh expected'));
assert.deepEqual(revokes, [['/auth/v1/logout?scope=local', 'Bearer access']]);
let retained = false;
await revokeCurrentSession(undefined, 'expired-access-refresh', async path => path.includes('token?')
  ? Response.json({access_token:'new-access',refresh_token:'new-refresh'})
  : (assert.ok(retained), new Response(null,{status:204})), async () => { retained = true; });
await assert.rejects(() => revokeCurrentSession('access', 'refresh', async () => new Response(null,{status:503}), async () => {}), /LOGOUT_FAILED/);
const { allowBurst } = await import('../lib/request-limits.ts');
assert.equal(allowBurst('test', 2, 1), true);
assert.equal(allowBurst('test', 2, 2), true);
assert.equal(allowBurst('test', 2, 3), false);
assert.equal(allowBurst('test', 2, 60002), true);
console.log('Session regression passed: local refresh-token revocation, expired-access rotation, retryable failure and bounded burst windows.');
globalThis.workspaceRouteTest.profile = profile;
const uploads = await import('../app/api/uploads/route.ts');
for (const [name, kind] of [['민원인-김가상.pdf','complaint'], ['민원-0123456789abcdef.pdf','guide'], ['original.xlsx','complaint']]) {
  const form = new FormData();
  form.set('file', new File(['SYNTHETIC ORIGINAL'], name));
  form.set('documentType', kind);
  assert.equal((await uploads.POST(new Request('https://site.invalid/api/uploads', {method:'POST', headers:{origin:'https://site.invalid'}, body:form}))).status,422);
}
console.log('Upload API regression passed: original filenames and raw guide/spreadsheet uploads are rejected before processing.');
