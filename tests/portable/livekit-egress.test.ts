import assert from "node:assert/strict";
import test from "node:test";
import { isEgressNotFound } from "../../packages/jobs/src/livekit-egress.js";

test("LiveKit's not_found is recognised; other failures are not", () => {
  assert.equal(isEgressNotFound({ code: "not_found", message: "egress does not exist" }), true);
  assert.equal(isEgressNotFound({ code: "unavailable" }), false);
  assert.equal(isEgressNotFound(new Error("fetch failed")), false);
  assert.equal(isEgressNotFound(undefined), false);
});
