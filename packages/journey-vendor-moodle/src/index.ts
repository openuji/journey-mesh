/**
 * Moodle integration: a Web client, a source build, a Compose stack and a user tour fixture service.
 * Entry points: `./web/plugin`, `./build/service`, `./stack/service`, `./user-tours/service`.
 */
export { moodleImageContract, type MoodleImage } from "./services/contracts.js";
export type { MoodleWebClientOptions } from "./web/client.js";
