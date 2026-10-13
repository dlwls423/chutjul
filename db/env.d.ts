export {};
declare global {
  namespace Cloudflare {
    interface Env {
      DB: import('@cloudflare/workers-types').D1Database;
    }
  }
}
