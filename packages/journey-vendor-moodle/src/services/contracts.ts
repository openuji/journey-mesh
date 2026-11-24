import { contract, type SourceIdentity } from "@openuji/journey-plugin";

/**
 * A Moodle image built from source. `files` maps source-relative paths to the sha256 of the file the
 * image contains, so a stack can verify that it serves exactly those bytes (for example compiled JS).
 */
export type MoodleImage = Readonly<{ image: string; identity: SourceIdentity; files: Readonly<Record<string, string>> }>;
export const moodleImageContract = contract<MoodleImage>("@openuji/moodle-image/v1");
