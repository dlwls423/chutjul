import { register } from "node:module";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
register("./helpers/typescript-loader.mjs", import.meta.url);
const { emptySnapshot, validateWorkspaceSnapshot, validateWorkspaceMutation } =
  await import("../lib/complaint-workspace.ts");
const { WorkspaceSaveQueue } = await import("../lib/workspace-save-queue.ts");
const id = "00000000-0000-4000-8000-000000000001";
const row = (revision = 1) => ({
  id,
  revision,
  snapshot: emptySnapshot(),
  updated_at: "2026-10-12T00:00:00Z",
});
const snapshot = (draft) => ({ ...emptySnapshot(), draft });
assert.deepEqual(validateWorkspaceSnapshot(emptySnapshot()), emptySnapshot());
for (const key of ["title", "editorText", "answerDirection", "draft"]) {
  assert.throws(
    () =>
      validateWorkspaceSnapshot({
        ...emptySnapshot(),
        [key]: "연락처: +82 10 0000 1234",
      }),
    /SENSITIVE_INPUT/,
  );
}
for (const forbidden of [
  "rawText",
  "temporaryMeta",
  "fileName",
  "signature",
  "envelope",
  "summaryApproved",
  "user_id",
]) {
  assert.throws(
    () =>
      validateWorkspaceSnapshot({ ...emptySnapshot(), [forbidden]: "secret" }),
    /INVALID_INPUT/,
  );
}
assert.throws(
  () =>
    validateWorkspaceSnapshot({ ...emptySnapshot(), draft: "x".repeat(30001) }),
  /INVALID_INPUT/,
);
assert.throws(
  () =>
    validateWorkspaceSnapshot({
      ...emptySnapshot(),
      evidence: [
        {
          reference: "C1",
          recordId: "x",
          title: "담당자: 김가상",
          reason: "사례",
          documentType: "complaint",
        },
      ],
    }),
  /SENSITIVE_INPUT/,
);
assert.throws(
  () =>
    validateWorkspaceMutation({
      action: "save",
      id: "1&user_id=other",
      revision: 0,
      snapshot: emptySnapshot(),
    }),
  /INVALID_INPUT/,
);
assert.throws(
  () => validateWorkspaceMutation({ action: "delete", id, revision: -1 }),
  /INVALID_INPUT/,
);
assert.equal(
  validateWorkspaceMutation({ action: "delete", id, revision: 1 }).snapshot,
  null,
);
// Two callers share one in-flight save. Edits during it save using the returned revision.
const requests = [],
  states = [];
let release;
const queue = new WorkspaceSaveQueue(
  async (body) => {
    requests.push(body);
    if (requests.length === 1)
      await new Promise((resolve) => (release = resolve));
    return {
      status: "saved",
      workspace: { ...row(body.revision + 1), snapshot: body.snapshot },
    };
  },
  (_, state) => states.push(state),
);
queue.seed(row());
queue.update(id, snapshot("첫 초안"));
const first = queue.flush(id);
const duplicate = queue.flush(id);
queue.update(id, snapshot("수정한 초안"));
assert.equal(requests.length, 1);
release();
await Promise.all([first, duplicate]);
assert.deepEqual(
  requests.map((x) => [x.revision, x.snapshot.draft]),
  [
    [1, "첫 초안"],
    [2, "수정한 초안"],
  ],
);
assert.equal(queue.entries.get(id).revision, 3);
assert.equal(queue.hasUnsaved(), false);
assert.equal(states.at(-1), "saved");
// Failed transport keeps the latest changes and explicit retry succeeds.
let fail = true;
const retry = new WorkspaceSaveQueue(
  async (body) => {
    if (fail) throw Error("offline");
    return {
      status: "saved",
      workspace: { ...row(body.revision + 1), snapshot: body.snapshot },
    };
  },
  () => {},
);
retry.seed(row());
retry.update(id, snapshot("오프라인 초안"));
await retry.flush(id);
assert.equal(retry.hasUnsaved(), true);
await assert.rejects(() => retry.remove(id), /UNSAVED/);
fail = false;
await retry.flush(id);
assert.equal(retry.entries.get(id).snapshot.draft, "오프라인 초안");
// Concurrent device conflicts and ten-tab limit never cause blind retries.
for (const status of ["conflict", "limit"]) {
  let calls = 0;
  const blocked = new WorkspaceSaveQueue(
    async () => {
      calls++;
      return { status };
    },
    () => {},
  );
  blocked.seed(row());
  blocked.update(id, snapshot("보존할 초안"));
  await blocked.flush(id);
  blocked.update(id, snapshot("추가 수정"));
  await blocked.flushAll();
  assert.equal(calls, 1);
  assert.equal(blocked.hasUnsaved(), true);
  await assert.rejects(() => blocked.remove(id), /UNSAVED/);
}
// Deleting after save uses the latest revision.
const mutations = [];
const deletion = new WorkspaceSaveQueue(
  async (body) => {
    mutations.push(body);
    return body.action === "delete"
      ? { status: "deleted" }
      : {
          status: "saved",
          workspace: { ...row(body.revision + 1), snapshot: body.snapshot },
        };
  },
  () => {},
);
deletion.seed(row());
deletion.update(id, snapshot("최종"));
await deletion.remove(id);
assert.deepEqual(
  mutations.map((x) => [x.action, x.revision]),
  [
    ["save", 1],
    ["delete", 2],
  ],
);
assert.equal(deletion.entries.size, 0);
// Separate tabs never overwrite each other's state.
const separate = new WorkspaceSaveQueue(
  async (b) => ({
    status: "saved",
    workspace: { ...row(b.revision + 1), id: b.id, snapshot: b.snapshot },
  }),
  () => {},
);
const second = "00000000-0000-4000-8000-000000000002";
separate.seed(row());
separate.seed({ ...row(), id: second });
separate.update(id, snapshot("민원 하나"));
separate.update(second, snapshot("민원 둘"));
await separate.flushAll();
assert.equal(separate.entries.get(id).snapshot.draft, "민원 하나");
assert.equal(separate.entries.get(second).snapshot.draft, "민원 둘");
// SQL contract checks supplement API tests; actual PostgreSQL migration is checked separately on deployment.
const sql = readFileSync(
  new URL(
    "../supabase/migrations/202610120001_complaint_workspaces.sql",
    import.meta.url,
  ),
  "utf8",
);
assert.match(sql, /pg_advisory_xact_lock/);
assert.match(sql, /user_id=p_user_id/);
assert.match(sql, /\)>=10/);
assert.match(sql, /existing.revision <> p_revision/);
assert.match(
  sql,
  /revoke all on function[\s\S]*from public,anon,authenticated/,
);
console.log(
  "Workspace regression passed: privacy whitelist, independent tabs, coalesced saves, retries, conflicts, limits, revision-safe deletion.",
);

register("./helpers/workspace-route-loader.mjs", import.meta.url);
const handlers = await import("../app/api/workspaces/route.ts");
const profile = {
  id: "00000000-0000-4000-8000-000000000010",
  approval_status: "approved",
};
let dbCalls = 0,
  serviceError = false,
  rpcStatus = "saved";
globalThis.workspaceRouteTest = {
  profile,
  service: async (path, init) => {
    dbCalls++;
    if (serviceError) throw Error("DATABASE_FAILURE_WITH_SECRET");
    if (path.includes("/rpc/")) {
      const body = JSON.parse(init.body);
      assert.equal(body.p_user_id, profile.id);
      return { status: rpcStatus, workspace: row(2) };
    }
    assert.ok(path.includes("user_id=eq." + profile.id));
    return [row()];
  },
};
const post = (body) =>
  handlers.POST(
    new Request("http://localhost/api/workspaces", {
      method: "POST",
      headers: { "Content-Type": "application/json", origin: "http://localhost" },
      body: JSON.stringify(body),
    }),
  );
const mutation = {
  action: "save",
  id,
  revision: 1,
  snapshot: snapshot("이어서 작성할 초안"),
};
let response = await handlers.GET(new Request("http://localhost/api/workspaces"));
assert.equal(response.status, 200);
assert.equal(response.headers.get("Cache-Control"), "private, no-store");
assert.equal((await response.json()).workspaces[0].revision, 1);
response = await post({ ...mutation, user_id: "OTHER_USER" });
assert.equal(response.status, 200);
let previousCalls = dbCalls;
response = await post({
  ...mutation,
  snapshot: { ...mutation.snapshot, draft: "연락처: 010-0000-1234" },
});
assert.equal(response.status, 422);
assert.equal(dbCalls, previousCalls);
response = await handlers.POST(
  new Request("http://localhost/api/workspaces", {
    method: "POST",
    headers: { "Content-Type": "application/json", origin: "http://localhost" },
    body: "{broken",
  }),
);
assert.equal(response.status, 422);
for (const current of [
  null,
  { ...profile, approval_status: "pending" },
  { ...profile, id: "public-test" },
]) {
  globalThis.workspaceRouteTest.profile = current;
  previousCalls = dbCalls;
  assert.equal(
    (await handlers.GET(new Request("http://localhost/api/workspaces"))).status,
    current?.approval_status === "pending" ? 403 : 401,
  );
  assert.equal(
    (await post(mutation)).status,
    current?.approval_status === "pending" ? 403 : 401,
  );
  assert.equal(dbCalls, previousCalls);
}
globalThis.workspaceRouteTest.profile = profile;
for (const status of ["conflict", "limit"]) {
  rpcStatus = status;
  response = await post(mutation);
  assert.equal(response.status, 409);
  assert.equal((await response.json()).status, status);
}
serviceError = true;
response = await handlers.GET(new Request("http://localhost/api/workspaces"));
assert.equal(response.status, 503);
assert.ok(!(await response.text()).includes("DATABASE_FAILURE_WITH_SECRET"));
console.log(
  "Workspace API regression passed: approved login, owner scope, forged owner ignored, privacy rejection, conflicts/limit, no-store, generic errors.",
);

const { registerWorkspaceGuard, prepareWorkspaceLogout } =
  await import("../lib/workspace-session.ts");
const removeGuard = registerWorkspaceGuard(async () => {
  await queue.flushAll();
  return !queue.hasUnsaved();
});
assert.equal(await prepareWorkspaceLogout(), true);
const failedGuard = registerWorkspaceGuard(async () => false);
assert.equal(await prepareWorkspaceLogout(), false);
failedGuard();
assert.equal(await prepareWorkspaceLogout(), true);
removeGuard();
console.log(
  "Workspace logout regression passed: saves complete before authentication is revoked; unsaved work blocks logout.",
);

const { prepareWorkspaceSnapshot } =
  await import("../lib/browser-workspace.ts");
const preparedSnapshot = prepareWorkspaceSnapshot({
  ...emptySnapshot(),
  title: "담당자: 김가상",
  editorText: "연락처: +82 10 0000 1234",
  answerDirection: "신청번호: 1AA-2609-0000001",
  draft: "회신: test@example.com",
  rawText: "ORIGINAL_DO_NOT_SEND",
  signature: "SECRET_APPROVAL",
});
validateWorkspaceSnapshot(preparedSnapshot);
for (const raw of [
  "김가상",
  "+82 10 0000 1234",
  "1AA-2609-0000001",
  "test@example.com",
  "ORIGINAL_DO_NOT_SEND",
  "SECRET_APPROVAL",
])
  assert.ok(!JSON.stringify(preparedSnapshot).includes(raw));
assert.equal(preparedSnapshot.version, 1);
console.log(
  "Browser workspace preparation passed: real masking and strict outbound allowlist.",
);
