import assert from "node:assert/strict";
import test from "node:test";
import { contract } from "@openuji/journey-plugin";
import { createRuntimeObservable } from "../src/runtime-observable.js";

const topic = contract<{ values: string[] }>("test/runtime");

test("delivery is awaited, scoped, immutable, and independent of caller-owned values", async () => {
  const observable = createRuntimeObservable(1000);
  const events: string[] = [];
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  observable.source.subscribe(topic, async (event) => {
    assert.equal(event.source, "services.example");
    assert.ok(Object.isFrozen(event) && Object.isFrozen(event.value.values));
    assert.match(event.timestamp, /^\d{4}-/);
    events.push(event.value.values[0]); await pending; events.push("captured");
  }, { name: "capture" });
  const value = { values: ["original"] };
  const delivery = observable.publisher("services.example").publish(topic, value);
  value.values[0] = "changed";
  await Promise.resolve();
  assert.deepEqual(events, ["original"]);
  release(); await delivery; events.push("resource-released");
  assert.deepEqual(events, ["original", "captured", "resource-released"]);
  assert.equal(Object.isFrozen(value), false);
  observable.close();
});

test("a failed or timed-out subscriber cannot prevent other captures or producer cleanup", async () => {
  const observable = createRuntimeObservable(1000);
  let captured = false;
  observable.source.subscribe(topic, () => { throw new Error("collector failed"); }, { name: "broken" });
  observable.source.subscribe(topic, () => new Promise<void>(() => {}), { name: "stuck", timeoutMs: 10 });
  observable.source.subscribe(topic, () => { captured = true; }, { name: "healthy" });
  await observable.publisher("service").publish(topic, { values: [] });
  assert.equal(captured, true);
  assert.deepEqual(observable.failures.map((failure) => failure.observer).sort(), ["broken", "stuck"]);
  assert.match(observable.failures.find((failure) => failure.observer === "stuck")!.message, /exceeded 10ms$/);
  observable.close();
});

test("the owner's deadline caps a subscriber that asks for longer, and is the default when it asks for nothing", async () => {
  const observable = createRuntimeObservable(20);
  const started = Date.now();
  observable.source.subscribe(topic, () => new Promise<void>(() => {}), { name: "greedy", timeoutMs: 3_600_000 });
  observable.source.subscribe(topic, () => new Promise<void>(() => {}), { name: "silent" });
  await observable.publisher("service").publish(topic, { values: [] });
  assert.ok(Date.now() - started < 1000, "disposal is never held past the owner's deadline");
  const messages = Object.fromEntries(observable.failures.map((failure) => [failure.observer, failure.message]));
  assert.match(messages.greedy, /runtimeObserverTimeoutMs of 20ms/);
  assert.match(messages.silent, /exceeded 20ms$/);
  observable.close();
  for (const invalid of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) assert.throws(() => createRuntimeObservable(invalid), /positive/);
});

test("observers receive a frozen subscribe-only source, never the publisher factory or close", () => {
  const observable = createRuntimeObservable(1000);
  assert.deepEqual(Object.keys(observable.source), ["subscribe"]);
  assert.ok(Object.isFrozen(observable.source));
  assert.equal("publisher" in observable.source, false);
  assert.equal("close" in observable.source, false);
  observable.close();
});

test("subscriptions detach and never leak across observable instances or a closed run", async () => {
  const first = createRuntimeObservable(1000);
  const second = createRuntimeObservable(1000);
  let calls = 0;
  const remove = first.source.subscribe(topic, () => { calls++; }, { name: "first" });
  await second.publisher("second").publish(topic, { values: [] });
  await first.publisher("first").publish(topic, { values: [] });
  remove(); await first.publisher("first").publish(topic, { values: [] });
  first.close(); await first.publisher("first").publish(topic, { values: [] });
  assert.equal(calls, 1);
  assert.throws(() => first.source.subscribe(topic, () => {}, { name: "late" }), /closed/);
  second.close();
});
