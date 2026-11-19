import type {
  AxeAuditMetadata,
  AxeNode
} from "../types.js";
import type { Immutable } from "@openuji/journey-core";

export function stringTargets(node: Immutable<AxeNode>): string[] {
  return node.target.map((target) => Array.isArray(target) ? target.join(" ") : String(target));
}

export function urlPath(value: string): string {
  try {
    const url = new URL(value);
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return value;
  }
}

export function stringMetadataValue(metadata: Immutable<AxeAuditMetadata>, key: string): string | undefined {
  const value = metadata[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function safeFileSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "-");
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
