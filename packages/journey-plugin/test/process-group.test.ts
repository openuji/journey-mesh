import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { stopProcessGroup } from "../src/node.js";

const failure = (code: string) => Object.assign(new Error(code), { code });

test("a group the operating system refuses to signal is reported, not mistaken for a stopped one", async (t) => {
  const kill = mock.method(process, "kill", () => { throw failure("EPERM"); });
  t.after(() => kill.mock.restore());
  await assert.rejects(stopProcessGroup(4242, { graceMs: 100, killWaitMs: 100 }), /Process group 4242 did not stop after SIGKILL.*EPERM/);
});

test("a group that refuses the group signal is stopped through its leader", async (t) => {
  let alive = true;
  const kill = mock.method(process, "kill", (pid: number, signal: string | number) => {
    if (pid < 0 && signal !== 0) throw failure("EPERM");
    if (pid < 0) { if (!alive) throw failure("ESRCH"); return true; }
    if (signal === "SIGTERM") alive = false;
    return true;
  });
  t.after(() => kill.mock.restore());
  await stopProcessGroup(4242, { graceMs: 100, killWaitMs: 100 });
  assert.equal(alive, false);
});

test("an already gone group is not an error", async (t) => {
  const kill = mock.method(process, "kill", () => { throw failure("ESRCH"); });
  t.after(() => kill.mock.restore());
  await stopProcessGroup(4242);
});
