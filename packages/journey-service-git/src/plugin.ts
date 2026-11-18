import { defineServicePlugin, knownOptions, requiredString, sourceCheckoutContract, sourceIdentityContract } from "@openuji/journey-plugin";
import { gitSource, validateGitSource } from "./index.js";

export const journeyMeshPlugin = defineServicePlugin({
  kind: "service", outputs: { source: sourceCheckoutContract, identity: sourceIdentityContract },
  parse(options, context) {
    knownOptions(options, ["repository", "directory", "sha", "pullRequest"]);
    if (options.pullRequest !== undefined && typeof options.pullRequest !== "number"
      && !(typeof options.pullRequest === "string" && /^[1-9][0-9]*$/.test(options.pullRequest))) throw new Error("pullRequest must be a positive integer");
    const settings = {
      repository: requiredString(options.repository, "repository"),
      directory: context.resolvePath(requiredString(options.directory, "directory")),
      ...(options.sha === undefined ? {} : { sha: requiredString(options.sha, "sha") }),
      ...(options.pullRequest === undefined ? {} : { pullRequest: Number(options.pullRequest) })
    };
    validateGitSource(settings); return settings;
  },
  create: (settings) => gitSource(settings)
});
