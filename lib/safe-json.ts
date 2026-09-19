function sanitizeJsonValue(value: unknown): unknown {
  if (typeof value === "string")
    return value.replace(/\u0000/g, "").replace(/\\u0000/gi, "");
  if (Array.isArray(value)) return value.map(sanitizeJsonValue);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        sanitizeJsonValue(item),
      ]),
    );
  return value;
}

export function normalizeJsonRequestBody(body: string) {
  try {
    return JSON.stringify(sanitizeJsonValue(JSON.parse(body)));
  } catch {
    throw new Error("SUPABASE_REQUEST_JSON_INVALID");
  }
}
