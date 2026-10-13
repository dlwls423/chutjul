// A bounded per-worker burst guard. Hosting must also enforce durable WAF limits;
// isolates/restarts do not share this memory and it is not an account lockout.
const windows = new Map<string, { count: number; expires: number }>();
export function allowBurst(key: string, limit: number, now = Date.now()) {
  for (const [k, value] of windows) if (value.expires <= now) windows.delete(k);
  let entry = windows.get(key);
  if (!entry) {
    if (windows.size >= 2000) return false;
    entry = { count: 0, expires: now + 60000 };
    windows.set(key, entry);
  }
  entry.count++;
  return entry.count <= limit;
}
