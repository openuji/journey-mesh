import { fileURLToPath } from "node:url";
import { createNextcloudEnvironment } from "../examples/nextcloud-filesharing/environment.js";

// Explicit fixture data; importing the example never loads deployment credentials.
export const nextcloudEnvironment = createNextcloudEnvironment({
  aliceTouchpoint: { baseURL: "http://alice.test" }, bobTouchpoint: { baseURL: "http://bob.test" },
  aliceUser: { username: "alice", password: "test-alice" }, bobUser: { username: "bob", password: "test-bob" },
  fixturePath: fileURLToPath(new URL("../examples/nextcloud-filesharing/deployment/fixtures/report.pdf", import.meta.url))
});
