// Replace only the auth boundary of the workspace route; use production handlers.
export async function resolve(specifier, context, nextResolve) {
  if (
    context.parentURL?.endsWith("/app/api/workspaces/route.ts") &&
    specifier === "../../../lib/auth"
  )
    return nextResolve(
      new URL("./workspace-route-auth.mjs", import.meta.url).href,
      context,
    );
  if (specifier === "next/server")
    return nextResolve("next/server.js", context);
  return nextResolve(specifier, context);
}
