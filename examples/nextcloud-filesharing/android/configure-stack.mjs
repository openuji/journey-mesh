import { mkdir, readFile, writeFile } from "node:fs/promises";
import { isIP } from "node:net";
import { fileURLToPath } from "node:url";

const host = process.argv[2];
if (isIP(host ?? "") !== 4) throw new Error("Pass an IPv4 host address reachable from the host, containers, and Android");
const source = await readFile(new URL("../deployment/.env.example", import.meta.url), "utf8");
const directory = new URL("../.android/", import.meta.url);
const path = new URL("stack.env", directory);
await mkdir(directory, { recursive: true });
await writeFile(path, source.replaceAll("host.docker.internal", host));
console.log(fileURLToPath(path));
