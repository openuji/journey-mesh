import { relative } from "node:path";

import type { ExecutionResult, RunResult } from "../results/contracts.js";
import { executionPassed } from "../results/outcomes.js";

export type JourneyRunSummaryColorMode = "auto" | "always" | "never";

export type JourneyRunSummaryArtifact = {
  label: string;
  path: string;
};

export type JourneyRunSummaryCommand = {
  label: string;
  command: string;
};

export type JourneyRunSummaryInput = {
  result: RunResult;
  artifacts?: readonly JourneyRunSummaryArtifact[];
  commands?: readonly JourneyRunSummaryCommand[];
};

export type JourneyRunSummaryOptions = {
  color?: JourneyRunSummaryColorMode;
  cwd?: string;
  stream?: Pick<NodeJS.WriteStream, "isTTY">;
};

type ColorFns = {
  bold(value: string): string;
  dim(value: string): string;
  green(value: string): string;
  red(value: string): string;
  yellow(value: string): string;
  cyan(value: string): string;
};

export function renderJourneyRunSummary(
  input: JourneyRunSummaryInput,
  options: JourneyRunSummaryOptions = {}
): string {
  const colors = colorFns(options);
  const result = input.result;
  const counts = executionCounts(result);
  const status = result.ok
    ? colors.green("PASS")
    : counts.passed > 0
      ? colors.yellow("PARTIAL")
      : colors.red("FAIL");
  const lines: string[] = [];

  if (input.commands && input.commands.length > 0) {
    lines.push(colors.bold("Commands"));
    for (const command of input.commands) {
      lines.push(`  ${colors.dim(command.label.padEnd(14))} ${command.command}`);
    }
    lines.push("");
  }

  lines.push(
    `${colors.bold("UJG Journey")} ${status}`,
    `  ${colors.dim("run")}      ${result.runId}`,
    `  ${colors.dim("plan")}     ${result.plan.id}`,
    `  ${colors.dim("profiles")} ${counts.passed}/${counts.total} passed${counts.skipped ? `; ${counts.skipped} not applicable` : ""}`
  );

  if (result.executions.length > 0 || result.assessments.some((assessment) => assessment.kind !== "applicable")) {
    lines.push("", colors.bold("Profiles"));
    for (const execution of result.executions) {
      lines.push(formatExecution(execution, colors));
    }
    for (const assessment of result.assessments) {
      if (assessment.kind === "not-applicable") {
        lines.push(`  ${assessment.profile.id.padEnd(14)} ${colors.yellow("not applicable")} ${assessment.reason}`);
      }
      if (assessment.kind === "failed") {
        lines.push(`  ${assessment.profile.id.padEnd(14)} ${colors.red("assessment failed")} ${assessment.error.message}`);
      }
    }
  }

  if (result.errors.length > 0) {
    lines.push("", colors.bold("Failures"));
    for (const error of result.errors) {
      lines.push(`  ${colors.red(error.name)} ${error.message}`);
    }
  }

  if (input.artifacts && input.artifacts.length > 0) {
    lines.push("", colors.bold("Artifacts"));
    for (const artifact of input.artifacts) {
      lines.push(
        `  ${colors.dim(artifact.label.padEnd(14))} ${colors.cyan(shortPath(artifact.path, options.cwd))}`
      );
    }
  }

  return lines.join("\n");
}

function formatExecution(execution: ExecutionResult, colors: ColorFns): string {
  const status = executionPassed(execution) ? colors.green("ok") : colors.red("failed");
  const message = execution.outcome.kind === "failed" ? ` ${colors.dim(execution.outcome.error.message)}` : "";
  return `  ${execution.profileId.padEnd(14)} ${status}${message}`;
}

function executionCounts(result: RunResult): {
  total: number;
  passed: number;
  skipped: number;
} {
  return {
    total: result.executions.length,
    passed: result.executions.filter(executionPassed).length,
    skipped: result.assessments.filter((assessment) => assessment.kind === "not-applicable").length
  };
}

function colorFns(options: JourneyRunSummaryOptions): ColorFns {
  const enabled = shouldUseColor(options);
  return {
    bold: (value) => color(value, enabled, 1, 22),
    dim: (value) => color(value, enabled, 2, 22),
    green: (value) => color(value, enabled, 32, 39),
    red: (value) => color(value, enabled, 31, 39),
    yellow: (value) => color(value, enabled, 33, 39),
    cyan: (value) => color(value, enabled, 36, 39)
  };
}

function shouldUseColor(options: JourneyRunSummaryOptions): boolean {
  if (options.color === "always") return true;
  if (options.color === "never") return false;
  if (process.env.NO_COLOR !== undefined) return false;
  if (process.env.FORCE_COLOR && process.env.FORCE_COLOR !== "0") return true;
  return Boolean((options.stream ?? process.stdout).isTTY);
}

function color(value: string, enabled: boolean, open: number, close: number): string {
  return enabled ? `\u001b[${open}m${value}\u001b[${close}m` : value;
}

function shortPath(path: string, cwd = process.cwd()): string {
  const relativePath = relative(cwd, path);
  if (!relativePath || relativePath.startsWith("..")) return path;
  return relativePath;
}
