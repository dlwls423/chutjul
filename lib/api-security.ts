import { allowBurst } from './request-limits';
// Shared by route handlers so protection also applies outside framework middleware.
export function securityHeaders(url: string) {
  const headers = new Headers({
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  });
  if (new URL(url).protocol === 'https:') headers.set('Strict-Transport-Security', 'max-age=31536000');
  return headers;
}

export function validRequestOrigin(request: Request) {
  const site = request.headers.get('sec-fetch-site');
  if (site === 'cross-site' || site === 'same-site') return false;
  const origin = request.headers.get('origin');
  if (origin) return origin === new URL(request.url).origin;
  const referer = request.headers.get('referer');
  if (referer) {
    try { return new URL(referer).origin === new URL(request.url).origin; } catch { return false; }
  }
  return site === 'same-origin';
}

export async function boundedBody(request: Request, limit: number) {
  if (Number(request.headers.get('content-length') || 0) > limit) throw new Error('REQUEST_TOO_LARGE');
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw new Error('REQUEST_TOO_LARGE'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

export function withApiSecurity<T extends unknown[]>(handler: (request: Request, ...args: T) => Promise<Response>) {
  return async (request: Request, ...args: T): Promise<Response> => {
    let response: Response;
    try {
      const path = new URL(request.url).pathname;
      let automation = false;
      if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
        // These two endpoints validate the bearer token themselves. A cookie must
        // never let an invalid automation token fall back to a browser session.
        automation = ['/api/legal/sync', '/api/privacy/audit'].includes(path)
          && /^Bearer \S+$/i.test(request.headers.get('authorization') || '')
          && !request.headers.has('cookie');
        if (process.env.PUBLIC_TEST_MODE === 'true' && !automation && !['/api/draft', '/api/department-routing', '/api/search'].includes(path))
          return rejected(request, 403, '공개 테스트에서는 자료를 변경하거나 계정에 저장할 수 없습니다.');
        if (!automation && !validRequestOrigin(request)) return rejected(request, 403, '같은 사이트에서 다시 요청해 주세요.');
        if (['/api/auth', '/api/draft', '/api/department-routing'].includes(path)) {
          // Hash even transport identifiers; never retain IPs, emails or tokens.
          const identifier = request.headers.get('cf-connecting-ip') || 'unknown';
          const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(identifier)));
          const key = path + ':' + Array.from(digest, b => b.toString(16).padStart(2, '0')).join('');
          if (!allowBurst(key, path === '/api/auth' ? 20 : 30)) return rejected(request, 429, '요청이 많습니다. 1분 뒤 다시 시도해 주세요.');
        }
        const upload = path === '/api/uploads';
        const bytes = await boundedBody(request, upload ? 32 * 1024 * 1024 : 512 * 1024);
        const mediaType = request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
        if (bytes.length && mediaType !== (upload ? 'multipart/form-data' : 'application/json'))
          return rejected(request, 415, '지원하지 않는 요청 형식입니다.');
        // The original request body has been consumed by boundedBody().
        // Reusing that Request as the constructor input throws for empty POSTs
        // (including scheduled legal sync calls), so rebuild it from the URL.
        request = new Request(request.url, {
          method: request.method,
          headers: request.headers,
          body: bytes.length ? bytes : null,
          redirect: request.redirect,
        });
      }
      response = await handler(request, ...args);
      // 보호된 자동화 엔드포인트는 안전하게 정규화된 오류 코드만 반환하므로
      // GitHub Actions가 실패 원인을 기록할 수 있도록 응답을 유지합니다.
      if (response.status >= 500 && !automation) return rejected(request, response.status, '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.');
      if (response.status === 403) return rejected(request, 403, '이 요청을 수행할 권한이 없습니다.');
    } catch (error) {
      const tooLarge = error instanceof Error && error.message === 'REQUEST_TOO_LARGE';
      return rejected(request, tooLarge ? 413 : error instanceof SyntaxError ? 400 : 500,
        tooLarge ? '전송 가능한 크기를 초과했습니다.' : '요청을 처리하지 못했습니다.');
    }
    const headers = new Headers(response.headers);
    securityHeaders(request.url).forEach((value, key) => headers.set(key, value));
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  };
}

function rejected(request: Request, status: number, error: string) {
  const headers = securityHeaders(request.url);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify({ error }), { status, headers });
}
