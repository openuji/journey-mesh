import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { execute, type Command } from "@openuji/journey-service-git";
import { sourceIdentity, type JourneyService, type SourceCheckout, type SourceIdentity } from "@openuji/journey-plugin";

export type BuildOptions = Readonly<{ directory: string; image: string; nodeImage: string; composerImage: string; runtimeImage?: string }>;
export function validateBuild(options: BuildOptions, server: boolean): void {
  if (!/^[a-z0-9][a-z0-9._/-]*$/.test(options.image)) throw new Error("image must be an untagged image repository");
  for (const value of [options.nodeImage, options.composerImage, ...(server ? [options.runtimeImage] : [])]) {
    if (typeof value !== "string" || !/^[a-z0-9][a-z0-9._/:-]*@sha256:[a-f0-9]{64}$/.test(value)) throw new Error("Build tool and runtime images must be pinned by digest");
  }
}
export function buildService(options: BuildOptions, server: boolean, run: Command = execute): JourneyService {
  options = structuredClone(options);
  validateBuild(options, server);
  let identity: SourceIdentity | undefined;
  return {
    name: server ? "nextcloud-server-build" : "nextcloud-app-build",
    provenance: () => identity,
    async up(input) {
      const source = input?.inputs?.source as SourceCheckout | undefined;
      if (!source?.directory) throw new Error("Missing source checkout");
      identity = sourceIdentity(source.identity);
      let id: string | undefined;
      let version: string;
      if (server) {
        await run("git", ["submodule", "update", "--init", "--depth", "1"], source.directory, input?.signal);
        const text = await readFile(join(source.directory, "version.php"), "utf8");
        version = /\$OC_VersionString\s*=\s*'([^']+)'/.exec(text)?.[1] ?? "";
      } else {
        const text = await readFile(join(source.directory, "appinfo/info.xml"), "utf8");
        id = /<id>([a-z_]+)<\/id>/.exec(text)?.[1];
        version = /<version>([^<]+)<\/version>/.exec(text)?.[1] ?? "";
        if (!id) throw new Error("Cannot read app ID");
      }
      if (!version) throw new Error("Cannot read source version");
      identity = sourceIdentity({ ...identity, version });
      await mkdir(options.directory, { recursive: true });
      const temporary = await mkdtemp(join(options.directory, "build-"));
      try {
        const context = join(temporary, "source");
        await cp(source.directory, context, { recursive: true, verbatimSymlinks: true,
          filter: (path) => ![".git", "node_modules"].includes(basename(path)) });
        await writeFile(join(context, ".journey-source-sha"), identity.sourceSha + "\n");
        await writeFile(join(context, ".dockerignore"), ".git\n**/.git\nnode_modules\n**/node_modules\n");
        const appRecipe = `FROM ${options.nodeImage} AS frontend
WORKDIR /source
ENV CYPRESS_INSTALL_BINARY=0
COPY . .
RUN npm ci && npm run build && rm -rf node_modules
FROM ${options.composerImage} AS dependencies
WORKDIR /source
COPY --from=frontend /source /source
RUN composer install --no-dev --no-interaction --prefer-dist --no-scripts
FROM scratch
COPY --from=dependencies /source /opt/journey-app
`;
        const serverRecipe = `FROM ${options.nodeImage} AS frontend
WORKDIR /source
COPY . .
RUN npm ci && npm run build && rm -rf node_modules build/frontend/node_modules build/frontend-legacy/node_modules
FROM ${options.runtimeImage}
COPY --from=${options.composerImage} /usr/bin/composer /usr/local/bin/composer
RUN cp -a /usr/src/nextcloud/config /tmp/docker-config && rm -rf /usr/src/nextcloud
COPY --from=frontend /source /usr/src/nextcloud
RUN cd /usr/src/nextcloud && composer install --no-dev --no-interaction --prefer-dist --no-scripts && cp /tmp/docker-config/*.php config/ && mkdir -p data custom_apps
`;
        const recipe = server ? serverRecipe : appRecipe;
        await writeFile(join(context, "Dockerfile.journey"), recipe);
        const key = createHash("sha256").update(identity.sourceSha + recipe).digest("hex").slice(0, 16);
        const image = `${options.image}:journey-${key}`;
        await run("docker", ["build", "-f", join(context, "Dockerfile.journey"), "-t", image, context], resolve(options.directory), input?.signal);
        return server ? { image: { image, identity } } : { app: { image, identity, id } };
      } finally { await rm(temporary, { recursive: true, force: true }); }
    }
  };
}
