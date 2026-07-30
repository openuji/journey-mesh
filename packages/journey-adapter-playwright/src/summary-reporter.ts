import { readFile } from "node:fs/promises";

import {
  renderJourneyRunSummary,
  type JourneyRunSummaryInput
} from "@openuji/journey-runner";

type PlaywrightAttachment = {
  name: string;
  path?: string;
};

type PlaywrightTestResult = {
  attachments: readonly PlaywrightAttachment[];
};

type PlaywrightTestCase = {
  results: readonly PlaywrightTestResult[];
};

type PlaywrightSuite = {
  suites: readonly PlaywrightSuite[];
  tests: readonly PlaywrightTestCase[];
};

const summaryAttachmentName = "ujg-summary.json";

export default class UjgSummaryReporter {
  private suite: PlaywrightSuite | undefined;

  onBegin(_config: unknown, suite: PlaywrightSuite): void {
    this.suite = suite;
  }

  async onEnd(): Promise<void> {
    const summaries = await this.readSummaries();
    if (summaries.length === 0) return;

    process.stdout.write("\n");
    for (const [index, summary] of summaries.entries()) {
      if (index > 0) process.stdout.write("\n");
      process.stdout.write(`${renderJourneyRunSummary(summary)}\n`);
    }
  }

  private async readSummaries(): Promise<JourneyRunSummaryInput[]> {
    const paths = [...this.testResults()]
      .flatMap((result) => result.attachments)
      .filter((attachment) => attachment.name === summaryAttachmentName && attachment.path)
      .map((attachment) => attachment.path as string);

    const summaries: JourneyRunSummaryInput[] = [];
    for (const path of paths) {
      summaries.push(JSON.parse(await readFile(path, "utf8")) as JourneyRunSummaryInput);
    }
    return summaries;
  }

  private *testResults(): Iterable<PlaywrightTestResult> {
    if (!this.suite) return;
    for (const test of allTests(this.suite)) {
      yield* test.results;
    }
  }
}

function* allTests(suite: PlaywrightSuite): Iterable<PlaywrightTestCase> {
  for (const test of suite.tests) {
    yield test;
  }
  for (const child of suite.suites) {
    yield* allTests(child);
  }
}
