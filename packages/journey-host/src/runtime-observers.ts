import type { JourneyArtifactStore, RuntimeObserver } from "@openuji/journey-plugin";
import { fileEvidenceStore } from "@openuji/journey-run-record/node";
import type { LoadedSuiteConfig } from "./config/load.js";
import type { LoadedPlugin } from "./plugins/loader.js";
import { pluginContext } from "./plugins/context.js";
import { createRuntimeObservable, type RuntimeObservationFailure } from "./runtime-observable.js";

/** The host wires observers; neither topic payloads nor collector implementations are inspected here. */
export function runtimeObservers(loaded: LoadedSuiteConfig, recipes: readonly LoadedPlugin<"runtime-observer">[], outputDir: string) {
  const observable = createRuntimeObservable(loaded.config.runtimeObserverTimeoutMs);
  const active: { componentId: string; observer: RuntimeObserver }[] = [];
  const stores: JourneyArtifactStore[] = [];
  const failures: RuntimeObservationFailure[] = [];
  const failure = (observer: string, error: unknown) => failures.push({ topic: "runtime-observer-lifecycle", source: "suite", observer,
    message: error instanceof Error ? error.message : String(error) });
  return {
    observable,
    get files() { return stores.flatMap((store) => store.files); },
    async start() {
      for (const [index, recipe] of recipes.entries()) {
        const componentId = `runtimeObservers[${index}]`;
        const artifacts = fileEvidenceStore(outputDir, `diagnostics/observer-${String(index + 1).padStart(2, "0")}`);
        stores.push(artifacts);
        let observer: RuntimeObserver | undefined;
        try {
          observer = await recipe.create(undefined, pluginContext({ configPath: loaded.path, env: loaded.env, testId: "suite", componentId, artifacts }));
          await observer.start(observable.source);
          active.push({ componentId, observer });
        } catch (error) {
          failure(componentId, error);
          try { await observer?.close(); } catch (cleanup) { failure(componentId, cleanup); }
        }
      }
    },
    async close() {
      try {
        for (const { componentId, observer } of [...active].reverse()) {
          try { await observer.close(); } catch (error) { failure(componentId, error); }
        }
        const all = [...failures, ...observable.failures];
        if (all.length) {
          const artifacts = fileEvidenceStore(outputDir, "diagnostics");
          stores.push(artifacts);
          await artifacts.write({ name: "errors.json", data: JSON.stringify(all, null, 2), contentType: "application/json" });
        }
      } finally { observable.close(); }
    }
  };
}
