function removeUnpairedSurrogates(value: string) {
  let result = "";
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        result += value[index] + value[index + 1];
        index++;
      }
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) continue;
    result += value[index];
  }
  return result;
}

function sanitizeJsonValue(value: unknown): unknown {
  if (typeof value === "string")
    return removeUnpairedSurrogates(
      value.replace(/\u0000/g, "").replace(/\\u0000/gi, ""),
    );
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
