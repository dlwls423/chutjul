import assert from "node:assert/strict";
import { reviewDraftGrounding } from "../lib/draft-grounding.ts";

const conditionalEvidence =
  "개인정보가 불필요하게 되었을 때에는 지체 없이 파기하여야 한다. 다만 다른 법령에 따라 보존하여야 하는 경우에는 그러하지 아니하다.";

const overconfident = reviewDraftGrounding(
  "회원 탈퇴 후 두 달이 지났으므로 해당 개인정보는 불필요하게 되었으며 즉시 파기 대상입니다.",
  conditionalEvidence,
);
assert.equal(overconfident.passed, false);
assert.ok(overconfident.warnings.length >= 1);

const cautious = reviewDraftGrounding(
  "처리 목적이 달성되고 다른 법령상 보존 의무가 없는지 추가 확인이 필요하며, 그 전제가 충족되면 지체 없이 파기해야 합니다.",
  conditionalEvidence,
);
assert.equal(cautious.passed, true);

const supported = reviewDraftGrounding(
  "법령에 따라 반드시 통지해야 합니다.",
  "개인정보처리자는 정보주체에게 반드시 통지해야 합니다.",
);
assert.equal(supported.passed, true);

const explicitReview = reviewDraftGrounding(
  "동의 여부와 고지 내용의 적절성은 실제 제공 과정에서 확인해야 합니다.",
  "개인신용정보를 제공하려는 경우 법률이 정한 방식으로 동의를 받아야 합니다.",
);
assert.equal(explicitReview.passed, true);

console.log("draft grounding regression: ok");
