export async function resolve(specifier, context, nextResolve) {
  if ((context.parentURL?.endsWith('/lib/document-access.ts') && specifier === './auth') ||
      (['/app/api/answers/route.ts','/app/api/uploads/route.ts'].some(path => context.parentURL?.endsWith(path)) && specifier === '../../../lib/auth'))
    return nextResolve(new URL('./workspace-route-auth.mjs', import.meta.url).href, context);
  if (specifier === 'next/server') return nextResolve('next/server.js', context);
  return nextResolve(specifier, context);
}
