import { writeFile } from "node:fs/promises";

import type {
  JourneyReporter,
  JourneyRunSummaryArtifact,
  JourneyRunSummaryCommand,
  JourneyRunSummaryInput
} from "@openuji/journey-runner";

export type PlaywrightTestAttachment = {
  path?: string;
  body?: string | Buffer;
  contentType?: string;
};

export type PlaywrightTestInfoLike = {
  outputPath(...pathSegments: string[]): string;
  attach(
    name: string,
    attachment: PlaywrightTestAttachment
  ): Promise<void> | void;
};

export type PlaywrightJsonEvidenceReporterOptions = {
  testInfo: PlaywrightTestInfoLike;
  fileName?: string;
};

export type PlaywrightJsonEvidenceReporter = JourneyReporter & {
  readonly latestPath?: string;
};

export type PlaywrightSummaryArtifact =
  | JourneyRunSummaryArtifact
  | undefined
  | null
  | false;

export type PlaywrightSummaryArtifactSource =
  | readonly PlaywrightSummaryArtifact[]
  | (() => readonly PlaywrightSummaryArtifact[]);

export type PlaywrightJourneyRunSummaryReporterOptions = {
  testInfo: PlaywrightTestInfoLike;
  fileName?: string;
  artifacts?: PlaywrightSummaryArtifactSource;
  commands?: readonly JourneyRunSummaryCommand[];
};

export type PlaywrightJourneyRunSummaryReporter = JourneyReporter & {
  readonly latestPath?: string;
  readonly latestSummary?: JourneyRunSummaryInput;
};

const defaultEvidenceFileName = "ujg-evidence.json";
const defaultSummaryFileName = "ujg-summary.json";

export function playwrightJsonEvidenceReporter(
  options: PlaywrightJsonEvidenceReporterOptions
): PlaywrightJsonEvidenceReporter {
  let latestPath: string | undefined;

  return {
    name: "@openuji/journey-adapter-playwright/json-evidence-reporter",
    version: "0.1.0",

    get latestPath() {
      return latestPath;
    },

    async report({ json }) {
      const fileName = options.fileName ?? defaultEvidenceFileName;
      latestPath = options.testInfo.outputPath(fileName);
      await writeFile(latestPath, json);
      await options.testInfo.attach(fileName, {
        path: latestPath,
        contentType: "application/json"
      });
    }
  };
}

export function playwrightJourneyRunSummaryReporter(
  options: PlaywrightJourneyRunSummaryReporterOptions
): PlaywrightJourneyRunSummaryReporter {
  let latestPath: string | undefined;
  let latestSummary: JourneyRunSummaryInput | undefined;

  return {
    name: "@openuji/journey-adapter-playwright/run-summary-reporter",
    version: "0.1.0",

    get latestPath() {
      return latestPath;
    },

    get latestSummary() {
      return latestSummary;
    },

    async report({ result }) {
      latestSummary = {
        result,
        artifacts: resolveArtifacts(options.artifacts),
        commands: options.commands ?? []
      };
      const fileName = options.fileName ?? defaultSummaryFileName;
      latestPath = options.testInfo.outputPath(fileName);
      await writeFile(latestPath, JSON.stringify(latestSummary, null, 2));
      await options.testInfo.attach(fileName, {
        path: latestPath,
        contentType: "application/json"
      });
    }
  };
}

function resolveArtifacts(
  source: PlaywrightSummaryArtifactSource | undefined
): JourneyRunSummaryArtifact[] {
  const artifacts = typeof source === "function" ? source() : source ?? [];
  return artifacts.filter(isSummaryArtifact);
}

function isSummaryArtifact(
  artifact: PlaywrightSummaryArtifact
): artifact is JourneyRunSummaryArtifact {
  return Boolean(artifact);
}
