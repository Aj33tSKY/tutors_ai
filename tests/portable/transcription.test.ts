import { test } from "node:test";
import assert from "node:assert/strict";
import { formatTranscript } from "../../packages/jobs/src/transcription.js";

test("resumed stereo segments preserve speaker roles and the lesson's clock", () => {
  assert.equal(formatTranscript([
    { role: "student", start: 5, text: "Understood." },
    { role: "tutor", start: 2, text: "A second sentence." },
    { role: "tutor", start: 0, text: "Explanation." },
  ], 3600), "[Tutor 1:00:00] Explanation. A second sentence.\n[Student 1:00:05] Understood.");
});
