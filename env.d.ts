export {};
declare global {
  namespace Cloudflare {
    interface Env {
      FILES: import('@cloudflare/workers-types').R2Bucket;
    }
  }
}
