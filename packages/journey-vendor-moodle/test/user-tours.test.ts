import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ComposeStack } from "@openuji/journey-service-docker/compose";
import { userToursService, type UserToursOptions } from "../src/services/user-tours/user-tours.js";

const stack: ComposeStack = { project: "moodle-tour", composeFiles: ["/deployment/compose.yaml"], envFile: "/runtime/stack.env", services: ["db", "moodle"] };
type Tour = { id: number; name: string; enabled: boolean; imported: boolean };

async function fixture(t: TestContext, report: (imported: string[]) => Tour[]) {
  const root = await mkdtemp(join(tmpdir(), "moodle-tours-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const tour = join(root, "tour.json");
  await writeFile(tour, JSON.stringify({ name: "Scrolled tour", pathmatch: "/my/%", enabled: "1", steps: [] }));
  const options: UserToursOptions = { directory: join(root, "work"), service: "moodle", tours: [tour], disableOthers: true };
  const calls: string[][] = [];
  const run = async (command: string, args: readonly string[]) => {
    calls.push([command, ...args]);
    if (args.includes("php")) return JSON.stringify({ tours: report(args.filter((arg) => arg.endsWith(".json"))) });
    return "";
  };
  return { options, calls, run, root };
}
const compose = ["compose", "--project-name", "moodle-tour", "--env-file", "/runtime/stack.env", "-f", "/deployment/compose.yaml"];

test("tours are copied into the Moodle container and imported there, and every other tour is disabled", async (t) => {
  const { options, calls, run } = await fixture(t, () => [
    { id: 1, name: "tour_navigation_dashboard_tour_name,tool_usertours", enabled: false, imported: false },
    { id: 7, name: "Scrolled tour", enabled: true, imported: true }
  ]);
  const lease = await userToursService(options, run, { stack }).start({});
  assert.ok(calls.every(([command, ...args]) => command === "docker" && compose.every((part, index) => args[index] === part)), "every command addresses the stack's own project");
  const php = calls.find((call) => call.includes("php"))!;
  assert.deepEqual(php.slice(compose.length + 1, php.indexOf("php")), ["exec", "-T", "-u", "www-data", "-w", "/var/www/html", "moodle"]);
  assert.ok(php.includes("--disable-others"));
  assert.equal(calls.filter((call) => call.includes("cp")).length, 2, "the import script and the tour");
  assert.ok(calls.at(-1)!.includes("rm"), "the staged files are removed from the container");
  assert.deepEqual(await readdir(options.directory), [], "and from the host");
  const provenance = lease.provenance as { imported: { name: string; id: number; sha256: string }[]; disabled: string[] };
  assert.deepEqual(provenance.imported.map(({ name, id }) => [name, id]), [["Scrolled tour", 7]]);
  assert.match(provenance.imported[0]!.sha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(provenance.disabled, ["tour_navigation_dashboard_tour_name,tool_usertours"]);
});

test("the import is verified: a tour that is not enabled, or another tour left enabled, fails the service", async (t) => {
  const notEnabled = await fixture(t, () => [{ id: 7, name: "Scrolled tour", enabled: false, imported: true }]);
  await assert.rejects(userToursService(notEnabled.options, notEnabled.run, { stack }).start({}), /Tour Scrolled tour was not imported and enabled/);
  const shipped = await fixture(t, () => [{ id: 1, name: "Shipped", enabled: true, imported: false }, { id: 7, name: "Scrolled tour", enabled: true, imported: true }]);
  await assert.rejects(userToursService(shipped.options, shipped.run, { stack }).start({}), /Tours still enabled: Shipped/);
  assert.ok(shipped.calls.at(-1)!.includes("rm"), "staged files are removed after a failure too");
});

test("a stack without the Moodle service, or a file that is not a tour export, is refused before anything is copied", async (t) => {
  const { options, calls, run, root } = await fixture(t, () => []);
  await assert.rejects(userToursService(options, run, { stack: { ...stack, services: ["alice", "bob"] } }).start({}), /Stack moodle-tour has no service moodle/);
  const notATour = join(root, "notes.json");
  await writeFile(notATour, JSON.stringify({ title: "not a tour" }));
  await assert.rejects(userToursService({ ...options, tours: [notATour] }, run, { stack }).start({}), /is not a user tour export/);
  assert.deepEqual(calls, []);
  assert.throws(() => userToursService({ ...options, tours: [] }, run, { stack }), /at least one tour export/);
});
