import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  runConfiguredTests,
  validateConfiguredTests,
} from "@openuji/journey-runtime";
import { publishReportBundle } from "../../nextcloud-comparison-report/scripts/build-data.mjs";
import { comparisonEnvironment, comparisonProcessEnvironment, composeArguments } from "./deployment.mjs";

const example = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repo = resolve(example, "../..");
const manifest = JSON.parse(
  await readFile(new URL("manifest.json", import.meta.url), "utf8"),
);
const args = process.argv.slice(2);
const action = args[0] ?? "run";
const variantFlag = args.indexOf("--variant");
const variantId = variantFlag >= 0 ? args[variantFlag + 1] : undefined;
const variants = manifest.variants.filter(
  (v) => !variantId || v.id === variantId,
);
if (!variants.length || !["run", "prepare", "report", "down"].includes(action))
  throw new Error(
    "Usage: comparison/run.mjs [run|prepare|report|down] [--variant nc34|pr66147]",
  );
const outputBase = resolve(
  example,
  process.env.NEXTCLOUD_COMPARISON_OUTPUT_DIR ?? "test-results/comparison",
);
await mkdir(outputBase, { recursive: true });
const runDirectory =
  action === "report"
    ? (await readFile(resolve(outputBase, "latest"), "utf8")).trim()
    : (process.env.NEXTCLOUD_COMPARISON_RUN_ID ??
      new Date().toISOString().replaceAll(":", "-"));
if (!/^[a-zA-Z0-9_.-]+$/.test(runDirectory))
  throw new Error("Invalid comparison run ID");
const root = resolve(outputBase, runDirectory);
if (action === "run") {
  await mkdir(root);
  await writeFile(resolve(outputBase, "latest"), runDirectory);
}
const reportDirectory = resolve(
  repo,
  "examples/nextcloud-comparison-report/public",
);

function execute(
  command,
  argv,
  env = process.env,
  cwd = repo,
  capture = false,
) {
  return new Promise((accept, reject) => {
    const child = spawn(command, argv, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
      if (!capture) process.stdout.write(chunk);
    });
    child.stderr.on("data", (chunk) => {
      if (!capture) process.stderr.write(chunk);
    });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0
        ? accept(output.trim())
        : reject(new Error(`${command} ${argv[0]} exited with ${code}`)),
    );
  });
}

async function environment(variant) {
  const runtimeRoot = resolve(example, ".runtime/comparison", variant.id);
  const defaults = await readFile(
    resolve(example, "deployment/.env.example"),
    "utf8",
  );
  const text = comparisonEnvironment(defaults, variant);
  await mkdir(runtimeRoot, { recursive: true });
  const source = resolve(runtimeRoot, "source.env");
  await writeFile(source, text, { mode: 0o600 });
  return comparisonProcessEnvironment(process.env, text, {
    NEXTCLOUD_STACK_ENV_FILE: source,
    NEXTCLOUD_STACK_PROJECT: `journey-comparison-${variant.id}`,
    NEXTCLOUD_STACK_COMPOSE_OVERRIDE: resolve(
      example,
      "deployment/compose.comparison.yaml",
    ),
    NEXTCLOUD_COMPARISON_MODEL: variant.model,
    NEXTCLOUD_COMPARISON_OUTPUT_DIR: resolve(root, variant.id),
  });
}

const composeArgs = (env) => [
  ...composeArguments(
    env.NEXTCLOUD_STACK_PROJECT,
    env.NEXTCLOUD_STACK_ENV_FILE,
    resolve(example, "deployment/compose.yaml"),
  ),
  "-f",
  env.NEXTCLOUD_STACK_COMPOSE_OVERRIDE,
];

async function build(variant, env) {
  if (!variant.sourceSha) return;
  const directory = resolve(repo, ".tmp", `nextcloud-${variant.id}`);
  const existing = await execute(
    "git",
    ["rev-parse", "HEAD"],
    env,
    directory,
    true,
  ).catch(() => null);
  if (existing !== variant.sourceSha) {
    if (!existing)
      await execute(
        "git",
        [
          "clone",
          "--no-checkout",
          "--filter=blob:none",
          variant.sourceRepository,
          directory,
        ],
        env,
      );
    await execute(
      "git",
      ["fetch", "origin", variant.sourceSha],
      env,
      directory,
    );
    await execute(
      "git",
      ["checkout", "--detach", variant.sourceSha],
      env,
      directory,
    );
  }
  const actual = await execute(
    "git",
    ["rev-parse", "HEAD"],
    env,
    directory,
    true,
  );
  if (actual !== variant.sourceSha)
    throw new Error("Source checkout does not match manifest");
  const dirty = await execute(
    "git",
    ["status", "--porcelain", "--untracked-files=no"],
    env,
    directory,
    true,
  );
  if (dirty) throw new Error("Refusing to build modified Nextcloud source");
  await execute(
    "git",
    ["submodule", "update", "--init", "--depth", "1"],
    env,
    directory,
  );
  for (const app of variant.apps ?? []) {
    if (!/^[a-z_]+$/.test(app.id) || !/^[a-f0-9]{40}$/.test(app.sourceSha))
      throw new Error("Invalid pinned app source");
    const appDirectory = resolve(directory, "apps", app.id);
    const existingApp = await execute(
      "git",
      ["rev-parse", "HEAD"],
      env,
      appDirectory,
      true,
    ).catch(() => null);
    if (!existingApp)
      await execute(
        "git",
        ["clone", "--no-checkout", app.sourceRepository, appDirectory],
        env,
      );
    await execute("git", ["fetch", "origin", app.sourceSha], env, appDirectory);
    await execute(
      "git",
      ["checkout", "--detach", app.sourceSha],
      env,
      appDirectory,
    );
    if (
      (await execute("git", ["rev-parse", "HEAD"], env, appDirectory, true)) !==
        app.sourceSha ||
      (await execute(
        "git",
        ["status", "--porcelain", "--untracked-files=no"],
        env,
        appDirectory,
        true,
      ))
    )
      throw new Error(`App source mismatch: ${app.id}`);
  }
  await writeFile(resolve(directory, ".source-sha"), `${actual}\n`);
  await writeFile(
    resolve(directory, ".dockerignore"),
    ".git\n**/.git\nnode_modules\n**/node_modules\n",
  );
  await execute(
    "docker",
    [
      "build",
      "-f",
      resolve(example, "deployment/Dockerfile.pr"),
      "--build-arg",
      `SOURCE_SHA=${actual}`,
      "-t",
      variant.image,
      directory,
    ],
    env,
  );
}

async function verify(variant, env) {
  const services = await Promise.all(
    ["alice", "bob"].map(async (service) => {
      const status = JSON.parse(
        await execute(
          "docker",
          [
            ...composeArgs(env),
            "exec",
            "-T",
            "-u",
            "www-data",
            service,
            "php",
            "occ",
            "status",
            "--output=json",
          ],
          env,
          repo,
          true,
        ),
      );
      if (
        status.versionstring !== variant.version &&
        !status.versionstring?.startsWith(`${variant.version} `)
      )
        throw new Error(
          `${service}: expected ${variant.version}, received ${status.versionstring}`,
        );
      const containerId = await execute(
        "docker",
        [...composeArgs(env), "ps", "-q", service],
        env,
        repo,
        true,
      );
      const imageId = await execute(
        "docker",
        ["inspect", "--format", "{{.Image}}", containerId],
        env,
        repo,
        true,
      );
      if (variant.sourceSha) {
        const sourceSha = await execute(
          "docker",
          [
            ...composeArgs(env),
            "exec",
            "-T",
            service,
            "cat",
            "/var/www/html/.journey-source-sha",
          ],
          env,
          repo,
          true,
        );
        if (sourceSha !== variant.sourceSha)
          throw new Error(`${service}: source SHA mismatch`);
      }
      const apps = JSON.parse(
        await execute(
          "docker",
          [
            ...composeArgs(env),
            "exec",
            "-T",
            "-u",
            "www-data",
            service,
            "php",
            "occ",
            "app:list",
            "--output=json",
          ],
          env,
          repo,
          true,
        ),
      );
      if (!apps.enabled.notifications)
        throw new Error(
          `${service}: Notifications must be enabled for comparable pending-share behavior`,
        );
      for (const app of variant.apps ?? [])
        if (apps.enabled[app.id] !== app.version)
          throw new Error(`${service}: app version mismatch for ${app.id}`);
      return {
        service,
        version: status.versionstring,
        imageId,
        sourceSha: variant.sourceSha ?? null,
        apps: { notifications: apps.enabled.notifications },
      };
    }),
  );
  return { verifiedAt: new Date().toISOString(), services };
}

if (action === "report") {
  await publishReportBundle({
    manifest,
    resultRoot: root,
    destination: reportDirectory,
    example,
    generatedAt: new Date().toISOString(),
    workflowUrl: process.env.GITHUB_ACTIONS
      ? `https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
      : null,
  });
  await execute("pnpm", [
    "--filter",
    "@openuji/nextcloud-comparison-report",
    "build",
  ]);
} else {
  let failed = false;
  for (const variant of variants) {
    const env = await environment(variant);
    if (action === "down") {
      await execute("docker", [...composeArgs(env), "down", "--volumes"], env);
      continue;
    }
    const directory = resolve(root, variant.id);
    await mkdir(directory, { recursive: true });
    const startedAt = new Date().toISOString();
    try {
      await copyFile(
        resolve(example, variant.model),
        resolve(directory, "model.ujg.jsonld"),
      );
      await copyFile(
        resolve(example, variant.visualization),
        resolve(directory, "model.ujg.yaml"),
      );
      env.NEXTCLOUD_COMPARISON_MODEL = resolve(directory, "model.ujg.jsonld");
      await validateConfiguredTests(resolve(example, "comparison.mesh.yaml"), {
        env,
      });
      await build(variant, env);
      await execute("docker", [...composeArgs(env), "up", "-d"], env);
      await execute(
        "sh",
        [resolve(example, "deployment/scripts/provision.sh")],
        env,
        repo,
        true,
      );
      for (const service of ["alice", "bob"]) {
        for (const app of variant.apps ?? []) {
          await execute(
            "docker",
            [
              ...composeArgs(env),
              "exec",
              "-T",
              service,
              "cp",
              "-a",
              `/usr/src/nextcloud/custom_apps/${app.id}`,
              "/var/www/html/custom_apps/",
            ],
            env,
            repo,
            true,
          );
          await execute(
            "docker",
            [
              ...composeArgs(env),
              "exec",
              "-T",
              service,
              "chown",
              "-R",
              "www-data:www-data",
              `/var/www/html/custom_apps/${app.id}`,
            ],
            env,
            repo,
            true,
          );
        }
        await execute(
          "docker",
          [
            ...composeArgs(env),
            "exec",
            "-T",
            "-u",
            "www-data",
            service,
            "php",
            "occ",
            "app:enable",
            "notifications",
          ],
          env,
          repo,
          true,
        );
      }
      await execute(
        "sh",
        [resolve(example, "deployment/scripts/seed.sh")],
        env,
        repo,
        true,
      );
      const deployment = await verify(variant, env);
      await writeFile(
        resolve(directory, "deployment.json"),
        JSON.stringify(deployment, null, 2),
      );
      if (action === "run") {
        const outcome = await runConfiguredTests(
          resolve(example, "comparison.mesh.yaml"),
          {
            env,
            progress: [
              {
                publish(event) {
                  if (event.type === "operation-completed")
                    console.log(
                      `${variant.id} ${event.profileId}: ${event.operation.id.split(":").at(-1)} passed`,
                    );
                  if (event.type === "operation-failed")
                    console.error(
                      `${variant.id} ${event.profileId}: ${event.operation.id.split(":").at(-1)} failed: ${event.error.message}`,
                    );
                },
              },
            ],
          },
        );
        if (!outcome.ok) failed = true;
      }
      await writeFile(
        resolve(directory, "run.json"),
        JSON.stringify(
          { startedAt, completedAt: new Date().toISOString(), error: null },
          null,
          2,
        ),
      );
    } catch (error) {
      failed = true;
      console.error(`${variant.id}: ${error.message}`);
      await writeFile(
        resolve(directory, "run.json"),
        JSON.stringify(
          {
            startedAt,
            completedAt: new Date().toISOString(),
            error: error.message,
          },
          null,
          2,
        ),
      );
    }
  }
  if (action === "run") {
    await publishReportBundle({
      manifest,
      resultRoot: root,
      destination: reportDirectory,
      example,
      generatedAt: new Date().toISOString(),
      workflowUrl: process.env.GITHUB_ACTIONS
        ? `https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
        : null,
    });
    await execute("pnpm", [
      "--filter",
      "@openuji/nextcloud-comparison-report",
      "build",
    ]);
  }
  if (failed) process.exitCode = 1;
}
