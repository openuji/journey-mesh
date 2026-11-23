import assert from "node:assert/strict";
import test from "node:test";

import { defaultProfile, keyboardOnlyProfile, inputModalityProfile, touchpointProfile } from "../src/index.js";
import { journeyMeshPlugin } from "../src/plugin.js";

const textEntry = "urn:openuji:input-modality:keyboard-text-entry";

const materialization = (id: string, modality: string) => Object.freeze({
  id, transitionId: "transition", modality: Object.freeze({ id: modality }),
  steps: Object.freeze([Object.freeze({ id: `${id}:step`, kind: "activation" })])
});

const transition = Object.freeze({
  transition: Object.freeze({ id: "transition" }),
  touchpointId: "touchpoint",
  activation: Object.freeze({
    requiredInputModalityProfiles: Object.freeze([
      Object.freeze({ id: "keyboard", modalities: Object.freeze([Object.freeze({ id: "keyboard" })]) })
    ])
  }),
  materializations: Object.freeze([materialization("urn:material:keyboard", "keyboard")])
});

const withModalities = (ids: string[], materializations = ids.filter((id) => id !== textEntry).map((id) => materialization(`urn:material:${id}`, id))) => ({
  ...transition,
  activation: { requiredInputModalityProfiles: ids.map((id) => ({ id: `profile:${id}`, modalities: [{ id }] })) },
  materializations
});

test("shipped profiles select RC4 modalities and the materialization declared through them", async () => {
  for (const profile of [defaultProfile(), keyboardOnlyProfile()]) {
    const select = async (ids: string[]) => profile.selectInputModality!(withModalities(ids) as never, { profile } as never);
    const text = await select([textEntry]);
    assert.equal(text.modality.id, textEntry);
    assert.equal(text.materialization, undefined);
    const keyboard = await select(["observability:keyboard"]);
    assert.equal(keyboard.modality.id, "observability:keyboard");
    assert.equal(keyboard.materialization?.id, "urn:material:observability:keyboard");
    const either = await select(["observability:pointer", "observability:keyboard"]);
    const expected = profile.id === "default" ? "observability:pointer" : "observability:keyboard";
    assert.equal(either.modality.id, expected);
    assert.equal(either.materialization?.id, `urn:material:${expected}`);
  }
});

test("a transition without a materialization through the selected modality is rejected by default", async () => {
  const profile = keyboardOnlyProfile();
  await assert.rejects(
    async () => profile.selectInputModality!(withModalities(["observability:keyboard"], []) as never, { profile } as never),
    /Transition transition has no TransitionMaterialization through observability:keyboard \(profile keyboard-only\)/
  );
  const pointerOnly = withModalities(["observability:keyboard"], [materialization("urn:material:pointer", "observability:pointer")]);
  await assert.rejects(async () => profile.selectInputModality!(pointerOnly as never, { profile } as never), /no TransitionMaterialization through observability:keyboard/);
});

test("text entry keeps its optional focus-move materialization", async () => {
  const profile = keyboardOnlyProfile();
  const reach = materialization("urn:material:reach", textEntry);
  const decision = await profile.selectInputModality!(withModalities([textEntry], [reach]) as never, { profile } as never);
  assert.equal(decision.materialization?.id, "urn:material:reach");
});

test("several materializations through one modality need an explicit preference", async () => {
  const both = withModalities(["observability:keyboard"], [
    materialization("urn:material:tabs", "observability:keyboard"),
    materialization("urn:material:shortcut", "observability:keyboard")
  ]);
  const ambiguous = keyboardOnlyProfile();
  await assert.rejects(
    async () => ambiguous.selectInputModality!(both as never, { profile: ambiguous } as never),
    /declares 2 TransitionMaterializations through observability:keyboard \(urn:material:tabs, urn:material:shortcut\); list the one to run in profile keyboard-only option materializationPreference/
  );
  const preferring = keyboardOnlyProfile({ materializationPreference: ["urn:material:unrelated", "urn:material:shortcut"] });
  assert.equal((await preferring.selectInputModality!(both as never, { profile: preferring } as never)).materialization?.id, "urn:material:shortcut");
});

test("requireMaterialization false allows adapters with direct commands", async () => {
  const touch = inputModalityProfile({ id: "touch", modalityPreference: ["urn:openuji:input:touch-tap"], requireMaterialization: false });
  const decision = await touch.selectInputModality!(withModalities(["urn:openuji:input:touch-tap"], []) as never, { profile: touch } as never);
  assert.equal(decision.modality.id, "urn:openuji:input:touch-tap");
  assert.equal("materialization" in decision, false);
});

test("the profile plugin parses materialization options for presets and custom profiles", async () => {
  const parse = (options: Record<string, unknown>) => journeyMeshPlugin.parse(options, {} as never);
  assert.deepEqual(parse({ preset: "keyboard-only" }), {
    kind: "preset", preset: "keyboard-only", selection: { materializationPreference: [], requireMaterialization: true }
  });
  const custom = parse({ id: "touch", modalityPreference: ["urn:openuji:input:touch-tap"], requireMaterialization: false, materializationPreference: ["urn:m"] });
  assert.deepEqual(custom, {
    kind: "custom", id: "touch", modalityPreference: ["urn:openuji:input:touch-tap"],
    selection: { materializationPreference: ["urn:m"], requireMaterialization: false }
  });
  assert.throws(() => parse({ preset: "default", materializationPreference: "urn:m" }), /materializationPreference must be an array/);
  const touch = await journeyMeshPlugin.create(custom as never, {} as never);
  const decision = await touch.selectInputModality!(withModalities(["urn:openuji:input:touch-tap"], []) as never, { profile: touch } as never);
  assert.equal(decision.materialization, undefined);
});

test("profiles snapshot preferences and publish frozen decisions", async () => {
  const preference = ["keyboard"];
  const child = inputModalityProfile({ id: "child", modalityPreference: preference });
  preference[0] = "changed";
  const composite = touchpointProfile({ id: "composite", profiles: { touchpoint: child } });
  const decision = await composite.selectInputModality!(transition as never, { profile: composite } as never);

  assert.equal(decision.modality.id, "keyboard");
  assert.equal(decision.materialization?.id, "urn:material:keyboard");
  assert.equal(decision.profileId, "composite");
  assert.ok(Object.isFrozen(child));
  assert.ok(Object.isFrozen(composite));
  assert.ok(Object.isFrozen(decision));
});
