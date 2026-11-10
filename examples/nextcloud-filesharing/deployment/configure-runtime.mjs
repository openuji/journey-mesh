#!/usr/bin/env node
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { isIPv4 } from "node:net";
import { networkInterfaces, platform } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execFile);
const deployment = dirname(fileURLToPath(import.meta.url));
const example = resolve(deployment, "..");

export async function discoverStackHost({
  environment = process.env,
  hostPlatform = platform(),
  interfaces = networkInterfaces(),
  capture = (command, args) => exec(command, args, { timeout: 15_000 })
} = {}) {
  if (environment.NEXTCLOUD_STACK_HOST) {
    if (!isIPv4(environment.NEXTCLOUD_STACK_HOST)) throw new Error("NEXTCLOUD_STACK_HOST must be an IPv4 address");
    return environment.NEXTCLOUD_STACK_HOST;
  }
  if (hostPlatform === "linux") {
    const result = await capture("docker", ["network", "inspect", "bridge", "--format", "{{(index .IPAM.Config 0).Gateway}}"]);
    const host = result.stdout.trim();
    if (isIPv4(host)) return host;
  }
  if (hostPlatform === "darwin") {
    let preferred;
    try {
      const route = await capture("/sbin/route", ["-n", "get", "default"]);
      preferred = /interface:\s*(\S+)/.exec(route.stdout)?.[1];
    } catch {}
    for (const name of [preferred, "en0", "en1", ...Object.keys(interfaces)].filter(Boolean)) {
      const address = interfaces[name]?.find((item) => item.family === "IPv4" && !item.internal && !item.address.startsWith("169.254."));
      if (address) return address.address;
    }
  }
  throw new Error("Could not discover a host IPv4 address reachable by Docker and Android; set NEXTCLOUD_STACK_HOST");
}

export async function configureStackRuntime({
  root = example,
  environment = process.env,
  refresh = false,
  ...discovery
} = {}) {
  const target = resolve(root, ".runtime/stack.env");
  if (!refresh) {
    try { await readFile(target); return target; }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  const deploymentDirectory = resolve(root, "deployment");
  const sourcePath = environment.NEXTCLOUD_STACK_ENV_FILE
    ? resolve(environment.NEXTCLOUD_STACK_ENV_FILE)
    : resolve(deploymentDirectory, ".env");
  let source;
  try { source = await readFile(sourcePath, "utf8"); }
  catch (error) {
    if (environment.NEXTCLOUD_STACK_ENV_FILE || error.code !== "ENOENT") throw error;
    source = await readFile(resolve(deploymentDirectory, ".env.example"), "utf8");
  }
  if (source.includes("host.docker.internal")) {
    const host = await discoverStackHost({ environment, ...discovery });
    source = source.replaceAll("host.docker.internal", host);
  }
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, source.endsWith("\n") ? source : `${source}\n`, { mode: 0o600 });
  return target;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const unknown = process.argv.slice(2).filter((value) => value !== "--refresh");
  if (unknown.length) throw new Error(`Unknown option ${unknown[0]}`);
  console.log(await configureStackRuntime({ root: example, refresh: process.argv.includes("--refresh") }));
}
