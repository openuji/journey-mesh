import { sourceCheckoutContract, sourceIdentityContract } from "@openuji/journey-plugin";
import { appendFile, readFile } from "node:fs/promises";
export const journeyMeshPlugin = {
  kind: "service", outputs: { source: sourceCheckoutContract, identity: sourceIdentityContract },
  parse: (options) => options,
  create(options, context) {
    return { name: "source", async up() {
      await appendFile(context.resolvePath("events"), "source-up\n");
      const identity = { repository: "https://example.test/app.git", pullRequest: 42, sourceSha: await readFile(context.resolvePath(options.headFile), "utf8") };
      return { source: { directory: "/runtime-only", identity }, identity };
    }, async down() { await appendFile(context.resolvePath("events"), "source-down\n"); } };
  }
};
