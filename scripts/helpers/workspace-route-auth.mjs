export async function requireProfile(options) {
  if (!options.approved) throw Error("TEST_EXPECTED_APPROVED");
  const state = globalThis.workspaceRouteTest;
  if (!state.profile) throw Error("AUTH_REQUIRED");
  if (state.profile.approval_status !== "approved")
    throw Error("ACCOUNT_NOT_APPROVED");
  return state.profile;
}
export async function serviceRequest(path, init) {
  return globalThis.workspaceRouteTest.service(path, init);
}
