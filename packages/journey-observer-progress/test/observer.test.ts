import assert from "node:assert/strict";
import test from "node:test";
import { serviceLifecycle, type RuntimeObservation, type RuntimeObservationSource, type ServiceLifecycleObservation } from "@openuji/journey-plugin";
import { createProgressRuntimeObserver } from "../src/index.js";
import { journeyMeshPlugin } from "../src/plugin.js";

type Listener = (event: RuntimeObservation<ServiceLifecycleObservation>, signal: AbortSignal) => Promise<void> | void;

function fixture() {
  let listener: Listener | undefined;
  const source: RuntimeObservationSource = {
    subscribe(topic, observe) {
      assert.equal(topic.id, serviceLifecycle.id);
      listener = observe as unknown as Listener;
      return () => { listener = undefined; };
    }
  };
  const lines: string[] = [];
  const observer = createProgressRuntimeObserver({ heartbeatMs: 60_000 }, (line) => lines.push(line));
  const publish = async (service: string, phase: ServiceLifecycleObservation["phase"]) => {
    await listener?.(Object.freeze({ topic: serviceLifecycle.id, source: service, timestamp: new Date().toISOString(), value: { phase } }), new AbortController().signal);
  };
  return { source, observer, publish, lines };
}

test("each service reports its start, a heartbeat while it lasts, and how long it took", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval", "Date"] });
  const { source, observer, publish, lines } = fixture();
  await observer.start(source);
  await publish("services.stack", "starting");
  t.mock.timers.tick(125_000);
  await publish("services.stack", "ready");
  t.mock.timers.tick(120_000);
  await publish("services.stack", "releasing");
  t.mock.timers.tick(5_000);
  await publish("services.stack", "released");
  assert.deepEqual(lines.filter((line) => !line.includes("still")),
    ["[services.stack] starting", "[services.stack] ready after 2m05s", "[services.stack] releasing", "[services.stack] released after 5s"]);
  assert.equal(lines.filter((line) => line.startsWith("[services.stack] still starting after ")).length, 2);
});

test("a failure ends the heartbeat, and closing stops those still under way", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval", "Date"] });
  const { source, observer, publish, lines } = fixture();
  await observer.start(source);
  await publish("services.broken", "starting");
  t.mock.timers.tick(7_000);
  await publish("services.broken", "failed");
  await publish("services.slow", "starting");
  await observer.close();
  t.mock.timers.tick(600_000);
  await publish("services.slow", "ready");
  assert.deepEqual(lines, ["[services.broken] starting", "[services.broken] failed after 7s", "[services.slow] starting"]);
});

test("the heartbeat interval is validated before construction", () => {
  assert.deepEqual(journeyMeshPlugin.parse({}, {} as never), { heartbeatMs: 60_000 });
  assert.throws(() => journeyMeshPlugin.parse({ heartbeatMs: 0 }, {} as never), /positive/);
  assert.throws(() => journeyMeshPlugin.parse({ every: 5 }, {} as never), /Unknown option every/);
});
