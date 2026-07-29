import type {
  AxeAuditMetadata,
  AxeNode,
  AxePathAuditItem
} from "../types.js";

export function stringTargets(node: AxeNode): string[] {
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

export function stringMetadataValue(metadata: AxeAuditMetadata, key: string): string | undefined {
  const value = metadata[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function artifactHref(href: string, artifactBaseHref: string | undefined): string {
  if (!artifactBaseHref) return href;
  const base = artifactBaseHref.endsWith("/") ? artifactBaseHref : `${artifactBaseHref}/`;
  return `${base}${href.replace(/^\/+/, "")}`;
}

export function safeFileSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "-");
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/'/g, "&#39;");
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
