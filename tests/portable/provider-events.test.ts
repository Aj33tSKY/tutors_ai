import assert from "node:assert/strict";
import test from "node:test";
import { eventIntake } from "../../packages/jobs/src/provider-events.js";

const payload = { kind: "x" } as never;
function fakePool() {
  const stats = { created: 0, ended: 0, queries: 0, failNext: false };
  const createPool = async () => { stats.created++; return { query: async () => { stats.queries++; if (stats.failNext) { stats.failNext = false; throw new Error("boom"); } return { rows: [{ accepted: true }] }; }, end: async () => { stats.ended++; } }; };
  return { stats, createPool };
}

test("on Node one pool is reused for every event", async () => {
  const { stats, createPool } = fakePool();
  const intake = eventIntake("postgresql://u:p@h:6543/db", { connectionPerRequest: false, createPool })!;
  for (let i = 0; i < 4; i++) assert.equal(await intake.accept("stripe", `evt_${i}`, "t", payload), true);
  assert.deepEqual({ created: stats.created, ended: stats.ended, queries: stats.queries }, { created: 1, ended: 0, queries: 4 });
});

test("per-request mode opens and closes a connection for every event, even when the query fails", async () => {
  const { stats, createPool } = fakePool();
  const intake = eventIntake("postgresql://u:p@h:6543/db", { connectionPerRequest: true, createPool })!;
  assert.equal(await intake.accept("stripe", "evt_1", "t", payload), true);
  stats.failNext = true;
  await assert.rejects(intake.accept("stripe", "evt_2", "t", payload), /boom/);
  assert.equal(await intake.accept("livekit", "EV_3", "t", payload), true);
  assert.deepEqual({ created: stats.created, ended: stats.ended }, { created: 3, ended: 3 });
});

test("without a connection string there is no intake", () => assert.equal(eventIntake(undefined, {}), null));
