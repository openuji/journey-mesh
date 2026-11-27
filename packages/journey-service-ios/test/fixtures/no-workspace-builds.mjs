import { registerHooks } from "node:module";

// A fresh checkout has no compiled workspace files, even when this test runs after a build.
const root = new URL("../../../../", import.meta.url).href;
registerHooks({
  resolve(specifier, context, nextResolve) {
    const resolved = nextResolve(specifier, context);
    const path = resolved.url.slice(root.length);
    if (resolved.url.startsWith(root) && /^(?:packages|vendor)\/[^/]+\/dist\//.test(path)) {
      throw Object.assign(new Error(`Workspace build file is unavailable before build: ${resolved.url}`), { code: "ERR_MODULE_NOT_FOUND" });
    }
    return resolved;
  }
});
