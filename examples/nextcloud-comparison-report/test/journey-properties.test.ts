import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { mapYaml } from "../../../vendor/journey-path/src/data/parser.js";

test("versioned indexed journeys resolve their own touchpoint metadata", async () => {
  for (const version of ["nc34", "pr66147"]) {
    const source = await readFile(new URL(`../../nextcloud-filesharing/ujg/comparison/${version}.ujg.yaml`, import.meta.url), "utf8");
    const { registry } = mapYaml(source);
    assert.deepEqual(registry.getJourneyProperties("urn:composite:alice-federated-sharing").touchpoints, [
      { id: "urn:touchpoint:nextcloud-a", label: "Nextcloud A" },
    ]);
    assert.deepEqual(registry.getJourneyProperties("urn:composite:bob-remote-share").touchpoints, [
      { id: "urn:touchpoint:nextcloud-b", label: "Nextcloud B" },
    ]);
    assert.deepEqual(registry.getJourneyProperties("urn:state:alice-files-ready").touchpoints, [
      { id: "urn:touchpoint:nextcloud-a", label: "Nextcloud A" },
    ]);
  }
});
