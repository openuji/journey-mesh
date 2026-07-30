import type { JourneyPlanOperation } from "@openuji/journey-execution-model";

import type { JourneyProgressSink } from "./contracts.js";

export function consoleJourneyProgress(
  options: { readonly stream?: Pick<NodeJS.WriteStream, "write"> } = {}
): JourneyProgressSink {
  const stream = options.stream ?? process.stdout;

  return {
    publish(event) {
      if (event.type === "execution-started") {
        stream.write(`Profile: ${event.profileId}\n\n`);
        return;
      }

      if (event.type === "operation-started") {
        stream.write(
          `  ${event.position}/${event.total} ${operationVerb(event.operation)} "${operationLabel(event.operation)}"...\n`
        );
        return;
      }

      if (event.type === "operation-completed") {
        stream.write(`       ✓ completed in ${formatDuration(event.durationMs)}\n\n`);
        return;
      }

      if (event.type === "operation-failed") {
        stream.write(`       ✗ failed after ${formatDuration(event.durationMs)}\n`);
        stream.write(`         ${event.error.message}\n\n`);
      }
    }
  };
}

function operationVerb(operation: JourneyPlanOperation): string {
  return operation.kind === "state" ? "Checking" : "Performing";
}

function operationLabel(operation: JourneyPlanOperation): string {
  if (operation.kind === "state") return operation.state.label ?? operation.id;
  return operation.transition.label ?? operation.id;
}

function formatDuration(durationMs: number): string {
  if (durationMs < 1000) return `${Math.round(durationMs)}ms`;
  return `${(durationMs / 1000).toFixed(1)}s`;
}
