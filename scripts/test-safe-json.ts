import { strict as assert } from "node:assert";
import { normalizeJsonRequestBody } from "../lib/safe-json.ts";

const result = JSON.parse(
  normalizeJsonRequestBody(
    JSON.stringify({
      actualNull: "가\u0000이드",
      escapedNull: String.raw`가\u0000이드`,
      brokenHighSurrogate: `앞${String.fromCharCode(0xd800)}뒤`,
      brokenLowSurrogate: `앞${String.fromCharCode(0xdc00)}뒤`,
      validEmoji: "안내서 📘",
      nested: [{ text: "정상" }],
    }),
  ),
);
assert.equal(result.actualNull, "가이드");
assert.equal(result.escapedNull, "가이드");
assert.equal(result.brokenHighSurrogate, "앞뒤");
assert.equal(result.brokenLowSurrogate, "앞뒤");
assert.equal(result.validEmoji, "안내서 📘");
assert.equal(result.nested[0].text, "정상");
assert.throws(() => normalizeJsonRequestBody(""), /SUPABASE_REQUEST_JSON_INVALID/);
console.log("safe JSON regression: ok");
