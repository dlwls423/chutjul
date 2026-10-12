// Flush before revoking authentication so the last edit survives signing out.
const guards = new Set<() => Promise<boolean>>();
export function registerWorkspaceGuard(guard: () => Promise<boolean>) {
  guards.add(guard);
  return () => {
    guards.delete(guard);
  };
}
export async function prepareWorkspaceLogout() {
  const results = await Promise.all(
    [...guards].map(async (guard) => {
      try {
        return await guard();
      } catch {
        return false;
      }
    }),
  );
  return results.every(Boolean);
}
