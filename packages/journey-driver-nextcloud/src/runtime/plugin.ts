import { defineServicePlugin, knownOptions, optionsObject, requiredString } from "@openuji/journey-plugin";
import { nextcloudStackRuntime, validateStackOptions, type StackBuild, type StackOptions, type PinnedSource } from "./stack.js";

function settings(options: Record<string, unknown>, resolvePath: (path: string) => string): StackOptions {
  knownOptions(options, ["project", "composeFiles", "image", "expectedVersion", "environment", "directory", "services", "enabledApps", "build"]);
  const strings = (value: unknown, name: string): string[] => {
    if (!Array.isArray(value)) throw new Error(`${name} must be an array`);
    return value.map((entry) => requiredString(entry, name));
  };
  const pin = (value: Record<string, unknown>): PinnedSource => ({ repository: requiredString(value.repository, "repository"), sha: requiredString(value.sha, "sha") });
  // Environment interpolation yields strings, so `${NEXTCLOUD_PR}` arrives as "66147".
  const pullRequestNumber = (value: unknown): number => {
    const number = typeof value === "string" && /^[1-9][0-9]*$/.test(value) ? Number(value) : value;
    if (typeof number !== "number" || !Number.isSafeInteger(number) || number < 1) throw new Error("build.pullRequest must be a pull request number");
    return number;
  };
  const source = (value: Record<string, unknown>): PinnedSource | { repository: string; pullRequest: number } => {
    if (value.sha !== undefined && value.pullRequest !== undefined) throw new Error("build takes either sha or pullRequest, not both");
    return value.pullRequest === undefined ? pin(value) : { repository: requiredString(value.repository, "repository"), pullRequest: pullRequestNumber(value.pullRequest) };
  };
  const build = options.build === undefined ? undefined : optionsObject(options.build, "build");
  if (build) knownOptions(build, ["repository", "sha", "pullRequest", "directory", "dockerfile", "apps"]);
  if (build?.apps !== undefined && !Array.isArray(build.apps)) throw new Error("build.apps must be an array");
  const config: StackOptions = {
    project: requiredString(options.project, "project"), composeFiles: strings(options.composeFiles, "composeFiles").map(resolvePath),
    image: requiredString(options.image, "image"), ...(options.expectedVersion === undefined ? {} : { expectedVersion: requiredString(options.expectedVersion, "expectedVersion") }), directory: resolvePath(requiredString(options.directory, "directory")),
    environment: Object.fromEntries(Object.entries(optionsObject(options.environment, "environment")).map(([key, value]) => [key, requiredString(value, `environment.${key}`)])),
    services: Object.fromEntries(Object.entries(optionsObject(options.services, "services")).map(([name, raw]) => {
      const service = optionsObject(raw, name); knownOptions(service, ["baseURL", "username", "password"]);
      return [name, { baseURL: requiredString(service.baseURL, `${name}.baseURL`), username: requiredString(service.username, `${name}.username`), password: requiredString(service.password, `${name}.password`) }];
    })),
    enabledApps: strings(options.enabledApps ?? [], "enabledApps"),
    ...(build ? { build: { ...source(build), directory: resolvePath(requiredString(build.directory, "build.directory")), dockerfile: resolvePath(requiredString(build.dockerfile, "build.dockerfile")), apps: ((build.apps ?? []) as unknown[]).map((raw) => { const app = optionsObject(raw, "app"); knownOptions(app, ["id", "version", "repository", "sha"]); return { ...pin(app), id: requiredString(app.id, "app.id"), version: requiredString(app.version, "app.version") }; }) } satisfies StackBuild } : {})
  };
  validateStackOptions(config); return config;
}
/**
 * Provisions a two-instance Nextcloud stack with Docker Compose and records its identity. The source is either an exact
 * `sha` or a `pullRequest` number, which is resolved to the pull request's current head when the stack starts.
 */
export const journeyMeshPlugin = defineServicePlugin({
  kind: "service",
  parse(options, context) { return settings(options, context.resolvePath); },
  create(settings, context) { return nextcloudStackRuntime(settings, context.artifacts); }
});
