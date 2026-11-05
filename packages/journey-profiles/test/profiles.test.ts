import assert from "node:assert/strict";
import test from "node:test";

import { inputModalityProfile, touchpointProfile } from "../src/index.js";

const transition = Object.freeze({
  transition: Object.freeze({ id: "transition" }),
  touchpointId: "touchpoint",
  activation: Object.freeze({
    requiredInputModalityProfiles: Object.freeze([
      Object.freeze({ id: "keyboard", modalities: Object.freeze([Object.freeze({ id: "keyboard" })]) })
    ])
  })
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
