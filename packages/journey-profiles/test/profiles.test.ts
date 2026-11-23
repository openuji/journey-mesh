import assert from "node:assert/strict";
import test from "node:test";

import { defaultProfile, keyboardOnlyProfile, inputModalityProfile, touchpointProfile } from "../src/index.js";

const transition = Object.freeze({
  transition: Object.freeze({ id: "transition" }),
  touchpointId: "touchpoint",
  activation: Object.freeze({
    requiredInputModalityProfiles: Object.freeze([
      Object.freeze({ id: "keyboard", modalities: Object.freeze([Object.freeze({ id: "keyboard" })]) })
    ])
  })
});

test("shipped profiles select migrated RC4 text entry and standard keyboard activation", async () => {
  const withModalities = (ids: string[]) => ({
    ...transition,
    activation: { requiredInputModalityProfiles: ids.map((id) => ({ id: `profile:${id}`, modalities: [{ id }] })) }
  });
  for (const profile of [defaultProfile(), keyboardOnlyProfile()]) {
    const select = async (ids: string[]) => profile.selectInputModality!(withModalities(ids) as never, { profile } as never);
    assert.equal((await select(["urn:openuji:input-modality:keyboard-text-entry"])).modality.id, "urn:openuji:input-modality:keyboard-text-entry");
    assert.equal((await select(["observability:keyboard"])).modality.id, "observability:keyboard");
    assert.equal((await select(["observability:pointer", "observability:keyboard"])).modality.id, profile.id === "default" ? "observability:pointer" : "observability:keyboard");
  }
});

test("profiles snapshot preferences and publish frozen decisions", async () => {
  const preference = ["keyboard"];
  const child = inputModalityProfile({ id: "child", modalityPreference: preference });
  preference[0] = "changed";
  const composite = touchpointProfile({ id: "composite", profiles: { touchpoint: child } });
  const decision = await composite.selectInputModality!(transition as never, { profile: composite } as never);

  assert.equal(decision.modality.id, "keyboard");
  assert.equal(decision.profileId, "composite");
  assert.ok(Object.isFrozen(child));
  assert.ok(Object.isFrozen(composite));
  assert.ok(Object.isFrozen(decision));
});
