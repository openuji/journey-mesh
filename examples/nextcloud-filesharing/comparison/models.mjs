import { readFile, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { parse, stringify } from "yaml";

// Authoring-only projection. The execution compiler remains the model plugin.
export function expandAuthoring(source, contexts, documentId) {
  const nodes = [];
  const add = (type, id, properties) =>
    nodes.push({ "@type": type, "@id": id, ...properties });
  const maps = [
    ["touchpoints", "Touchpoint"],
    ["personas", "Persona"],
    ["artifacts", "Artifact"],
    ["effects", "Effect"],
    ["entryBindings", "EntryBinding"],
    ["locales", "Locale"],
    ["messageMeta", "MessageMeta"],
    ["messages", "Message"],
    ["resolvers", "SurfaceInstanceResolver"],
    ["inputModalities", "InputModality"],
    ["inputModalityProfiles", "InputModalityProfile"],
    ["observationEvents", "ObservationEvent"],
    ["observationBindings", "ObservationBinding"],
    ["phases", "Phase"],
    ["steps", "Step"],
  ];
  for (const [key, type] of maps)
    for (const [id, value] of Object.entries(source[key] ?? {}))
      add(type, id, value);
  for (const [key, type] of [
    ["features", "AccessibleFeature"],
    ["locators", "AccessibleLocator"],
  ]) {
    for (const [id, value] of Object.entries(source.accessible?.[key] ?? {})) {
      const { type: customType, ...properties } = value;
      add(customType ?? type, id, properties);
    }
  }
  const { id: indexId, ...index } = source.journeyEntryIndex;
  add("JourneyEntryIndex", indexId, index);
  function state(id, value) {
    const { type = "State", subjourney, surface, ...rest } = value;
    add(type, id, {
      ...rest,
      ...(subjourney ? { subjourneyRefs: [subjourney.id] } : {}),
    });
    if (surface) {
      const { id: surfaceId, ...props } = surface;
      add("Surface", surfaceId, { ...props, graphNodeRef: id });
    }
    if (!subjourney) return;
    const {
      id: journeyId,
      entries,
      states,
      transitions = [],
      exits = {},
      ...props
    } = subjourney;
    add("Journey", journeyId, {
      ...props,
      entryRefs: Object.keys(entries),
      stateRefs: Object.keys(states),
      transitionRefs: transitions.map((t) => t.id),
      ...(Object.keys(exits).length ? { exitRefs: Object.keys(exits) } : {}),
    });
    for (const [entryId, entry] of Object.entries(entries))
      add("JourneyEntry", entryId, entry);
    for (const [stateId, child] of Object.entries(states))
      state(stateId, child);
    for (const [exitId, exit] of Object.entries(exits))
      add("JourneyExit", exitId, exit);
    for (const {
      id: transitionId,
      surface: target,
      ...transition
    } of transitions) {
      add("Transition", transitionId, transition);
      if (target) {
        const { id: surfaceId, ...rest } = target;
        add("Surface", surfaceId, { ...rest, graphNodeRef: transitionId });
      }
    }
  }
  for (const [id, value] of Object.entries(source.states)) state(id, value);
  return {
    "@context": contexts,
    "@type": "UJGDocument",
    "@id": documentId,
    nodes,
  };
}

export function acceptanceModel(original, variant) {
  const source = structuredClone(original);
  const candidate = variant === "pr66147";
  const state = (name, label) => [
    "urn:state:" + name,
    { label, surface: { id: "urn:surface:" + name, label } },
  ];
  const transition = (name, label, from, to, extra = {}) => ({
    id: "urn:transition:" + name,
    label,
    from: "urn:state:" + from,
    to,
    surface: { id: "urn:surface:" + name, label },
    ...extra,
  });
  const offer =
    source.states["urn:composite:bob-remote-share"].subjourney.states[
      "urn:composite:bob-remote-share-offer"
    ].subjourney;
  offer.entries["urn:entry:bob-remote-share-offer"].stateRef =
    candidate ? "urn:state:bob-all-files-ready" : "urn:state:bob-files-list-ready";
  offer.states = Object.fromEntries([
    ...(!candidate ? [state("bob-files-list-ready", "The All files table has loaded")] : []),
    state(
      "bob-all-files-ready",
      candidate
        ? "Bob accepts the file invitation in All files"
        : "Bob arrives at All files",
    ),
    ...(!candidate
      ? [
          state("bob-shares-ready", "Shares navigation is expanded"),
          state(
            "bob-incoming-share-visible",
            "Bob finds the file in Pending shares",
          ),
        ]
      : []),
  ]);
  offer.transitions = [
    ...(!candidate
      ? [
          transition("bob-files-loaded", "All files is ready for interaction", "bob-files-list-ready", "urn:state:bob-all-files-ready"),
          transition(
            "bob-opens-shares",
            "Bob expands Shares navigation",
            "bob-all-files-ready",
            "urn:state:bob-shares-ready",
          ),
          transition(
            "bob-opens-pending-shares",
            "Bob opens Pending shares",
            "bob-shares-ready",
            "urn:state:bob-incoming-share-visible",
          ),
        ]
      : []),
    transition(
      "bob-accepts-share",
      candidate
        ? "Bob accepts the file inline"
        : "Bob accepts the pending share",
      candidate ? "bob-all-files-ready" : "bob-incoming-share-visible",
      "urn:exit:bob-share-offer-accepted",
      { effectRef: "urn:effect:bob-accept-share" },
    ),
  ];
  const completion =
    source.states["urn:composite:bob-remote-share"].subjourney.states[
      "urn:composite:bob-pending-share-offer-cleared"
    ].subjourney;
  if (candidate) {
    completion.entries[completion.defaultEntryRef].stateRef = "urn:state:bob-shared-report-visible";
    completion.states = Object.fromEntries([
      state(
        "bob-shared-report-visible",
        "Bob verifies the accepted file in the files list",
      ),
    ]);
    completion.transitions = [];
    source.steps["urn:step:bob-remote-share-offer"].label = "Bob accepts the file";
    source.steps["urn:step:bob-pending-share-offer-cleared"].label = "Bob verifies the files list";
  }
  for (const binding of Object.values(source.entryBindings))
    if (binding.entryRef.startsWith("urn:entry:bob"))
      binding.value = "nextcloud.files";
  function message(name, value) {
    const id = "urn:message:" + name;
    source.messageMeta[id] = { defaultLocaleRef: "urn:locale:en" };
    source.messages["urn:message-value:" + name + ":en"] = {
      messageMetaRef: id,
      localeRef: "urn:locale:en",
      value,
    };
    return id;
  }
  source.accessible.locators["urn:locator:incoming-share-row"] = candidate
    ? { role: "listitem", contextLocatorRefs: ["urn:locator:pending-list"] }
    : original.accessible.locators["urn:locator:incoming-share-row"];
  source.accessible.locators["urn:locator:pending-list"] = {
    role: "list",
    accessibleNameRef: message("pending-list", "Pending shares"),
  };
  source.accessible.locators["urn:locator:all-files-link"] = {
    role: "link",
    accessibleNameRef: message("all-files", "All files"),
  };
  source.accessible.locators["urn:locator:files-table"] = {
    role: "table",
    accessibleNameRef: message("files-table", "List of your files and folders."),
  };
  source.accessible.locators["urn:locator:pending-shares-link"] = {
    role: "link",
    accessibleNameRef: message("pending-shares-link", "Pending shares"),
  };
  source.accessible.features["urn:feature:comparison-exact-name"] = {
    accessibleFeatureName: "accessible-name-exact",
    accessibleFeatureValue: "true",
  };
  for (const id of [
    "urn:locator:shares-overview-link",
    "urn:locator:pending-shares-link",
  ])
    source.accessible.locators[id].accessibleFeatureRefs = [
      "urn:feature:comparison-exact-name",
    ];
  // Nextcloud labels both its Shares and Folder tree disclosures "Open menu".
  // Keep this unavoidable DOM escape hatch explicit and application-owned.
  source.accessible.locators["urn:locator:shares-expander"] = {
    type: "CustomLocator",
    label: "Shares navigation disclosure",
    extensions: {
      "urn:openuji:playwright:css":
        '[data-cy-files-navigation-item="shareoverview"] > .app-navigation-entry > button[aria-label="Open menu"]',
    },
  };
  source.accessible.locators[
    "urn:locator:bob-accept-share-button"
  ].accessibleNameRef = message(
    "accept-action",
    candidate ? "Accept file" : "Accept share",
  );
  source.observationBindings = Object.fromEntries(
    Object.entries(source.observationBindings).filter(
      ([, b]) => !b.observeSurfaceRef.startsWith("urn:surface:bob"),
    ),
  );
  function binding(name, event, locators, count) {
    source.observationBindings["urn:obs:" + name] = {
      observeSurfaceRef: "urn:surface:" + name,
      observationEventRef: "urn:observation-event:" + event,
      locatorRefs: locators.map((id) => "urn:locator:" + id),
      ...(count === undefined ? {} : { expectedMatchCount: count }),
    };
  }
  binding(
    "bob-all-files-ready",
    "presence",
    [candidate ? "incoming-share-row" : "files-table"],
    1,
  );
  source.observationEvents["urn:observation-event:automatic"] = {
    label: "Automatic continuation without user input",
  };
  if (!candidate) {
    binding("bob-files-list-ready", "presence", ["files-table"], 1);
    binding("bob-files-loaded", "automatic", ["files-table"]);
    binding("bob-shares-ready", "presence", ["pending-shares-link"], 1);
    binding(
      "bob-incoming-share-visible",
      "presence",
      ["incoming-share-row"],
      1,
    );
    binding("bob-opens-shares", "button-activation", ["shares-expander"]);
    binding("bob-opens-pending-shares", "link-activation", [
      "pending-shares-link",
    ]);
  }
  binding("bob-accepts-share", "button-activation", [
    "bob-accept-share-button",
  ]);
  if (!candidate)
    binding("bob-pending-share-offer-cleared", "absence", ["incoming-share-row"], 0);
  binding(
    "bob-shared-report-visible",
    "presence",
    ["bob-shared-report-file-row"],
    1,
  );
  if (!candidate)
    binding("bob-opens-shares-overview", "link-activation", [
      "shares-overview-link",
    ]);
  return source;
}

export async function syncModels(check = false) {
  const base = new URL("../ujg/", import.meta.url);
  const original = parse(
    await readFile(new URL("filesharing.ujg.yaml", base), "utf8"),
  );
  const contexts = JSON.parse(
    await readFile(new URL("filesharing.ujg.jsonld", base), "utf8"),
  )["@context"];
  await mkdir(new URL("comparison/", base), { recursive: true });
  for (const variant of ["nc34", "pr66147"]) {
    const model = acceptanceModel(original, variant);
    for (const [extension, value] of [
      ["yaml", stringify(model)],
      [
        "jsonld",
        JSON.stringify(
          expandAuthoring(
            model,
            contexts,
            `urn:ujg:document:nextcloud-acceptance:${variant}`,
          ),
          null,
          2,
        ) + "\n",
      ],
    ]) {
      const destination = new URL(
        `comparison/${variant}.ujg.${extension}`,
        base,
      );
      if (check) {
        if ((await readFile(destination, "utf8")) !== value)
          throw new Error(`Stale model: ${fileURLToPath(destination)}`);
      } else await writeFile(destination, value);
    }
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  await syncModels(process.argv.includes("--check"));
