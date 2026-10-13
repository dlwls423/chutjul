type Session = { access_token: string; refresh_token: string; expires_in: number; user: { id: string; email?: string } };
export async function revokeCurrentSession(
  access: string | undefined,
  refresh: string | undefined,
  send: (path: string, init: RequestInit) => Promise<Response>,
  retainRefreshed: (session: Session) => Promise<void>,
) {
  const revoke = (token: string) => send('/auth/v1/logout?scope=local', {
    method: 'POST', headers: { Authorization: `Bearer ${token}` },
  });
  if (access) {
    const result = await revoke(access);
    if (result.ok) return;
    if (![401, 403, 404].includes(result.status)) throw new Error('LOGOUT_FAILED');
  }
  if (!refresh) return;
  const response = await send('/auth/v1/token?grant_type=refresh_token', {
    method: 'POST', body: JSON.stringify({ refresh_token: refresh }),
  });
  if ([400, 401, 403].includes(response.status)) return; // Already expired/revoked.
  if (!response.ok) throw new Error('LOGOUT_FAILED');
  const session = await response.json() as Session;
  if (!session.access_token || !session.refresh_token) throw new Error('LOGOUT_FAILED');
  // Retain rotation if revocation fails so logout can be retried, without losing
  // the only token that can revoke the remaining session.
  await retainRefreshed(session);
  if (!(await revoke(session.access_token)).ok) throw new Error('LOGOUT_FAILED');
}
