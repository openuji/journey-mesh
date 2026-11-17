import type {
  AxeAuditMetadata,
  AxeNode,
  AxePathAuditItem
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

export function profileIdForItem(item: AxePathAuditItem): string {
  return stringMetadataValue(item.metadata, "profileId") ?? item.groupId?.split(":")[0] ?? "unprofiled";
}

export function stringMetadataValue(metadata: Immutable<AxeAuditMetadata>, key: string): string | undefined {
  const value = metadata[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function safeFileSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "-");
}

export { escapeHtml, escapeHtml as escapeAttribute } from "@openuji/journey-plugin";

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
