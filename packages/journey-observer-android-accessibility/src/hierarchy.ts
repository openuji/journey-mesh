import { XMLParser, XMLValidator } from "fast-xml-parser";
import type { AndroidDeviceMetrics } from "@openuji/journey-adapter-appium";
import { immutableSnapshot } from "./immutable.js";

export type AndroidHierarchyNode = Readonly<{
  id: string;
  className?: string;
  resourceId?: string;
  text?: string;
  contentDescription?: string;
  password?: boolean;
  visible?: boolean;
  enabled?: boolean;
  clickable?: boolean;
  longClickable?: boolean;
  bounds?: Readonly<{ left: number; top: number; right: number; bottom: number }>;
  children: readonly AndroidHierarchyNode[];
}>;
export type AndroidHierarchy = readonly AndroidHierarchyNode[];
export type AndroidHierarchyCheck = Readonly<{
  rule: "actionable-label" | "touch-target-size";
  nodeId: string;
  status: "passed" | "finding" | "unassessed";
  message: string;
}>;

/** Preserve the captured XML while removing password-node text and descriptions. */
export function redactAndroidHierarchy(xml: string): string {
  return xml.replace(/<[^!?/][^>]*>/g, (tag) => /\bpassword=["']true["']/.test(tag)
    ? tag.replace(/\b(text|content-desc)=("[^"]*"|'[^']*')/g, '$1="[redacted]"') : tag);
}

/** Parses UiAutomator2 and adb uiautomator hierarchies without runtime access. */
export function parseAndroidHierarchy(xml: string): AndroidHierarchy {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error("Android hierarchy must not contain document types or entities");
  const valid = XMLValidator.validate(xml);
  if (valid !== true) throw new Error(`Invalid Android hierarchy XML: ${valid.err.msg}`);
  const parsed: unknown = new XMLParser({
    preserveOrder: true, ignoreAttributes: false, attributeNamePrefix: "",
    parseTagValue: false, parseAttributeValue: false, trimValues: false
  }).parse(redactAndroidHierarchy(xml));
  const roots = readChildren(parsed, "");
  if (!Array.isArray(parsed) || !parsed.some((item) => typeof item === "object" && item !== null && "hierarchy" in item)) {
    throw new Error("Android source must contain a hierarchy root");
  }
  return immutableSnapshot(roots);
}

function readChildren(value: unknown, parent: string): AndroidHierarchyNode[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry, index) => {
    if (typeof entry !== "object" || entry === null) return [];
    const tag = Object.keys(entry).find((key) => key !== ":@" && !key.startsWith("#") && !key.startsWith("?"));
    if (!tag) return [];
    if (tag === "hierarchy") return readChildren(entry[tag], parent);
    const raw: Record<string, string> = entry[":@"] ?? {};
    const id = `${parent}/${index}`;
    const coordinates = /^\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]$/.exec(raw.bounds ?? "");
    const rect = coordinates ? { left: Number(coordinates[1]), top: Number(coordinates[2]), right: Number(coordinates[3]), bottom: Number(coordinates[4]) } : undefined;
    const bounds = rect && rect.right >= rect.left && rect.bottom >= rect.top ? rect : undefined;
    return [{
      id, className: raw.class ?? tag, resourceId: raw["resource-id"],
      text: raw.text, contentDescription: raw["content-desc"],
      password: boolean(raw.password), visible: boolean(raw.displayed ?? raw["visible-to-user"]),
      enabled: boolean(raw.enabled), clickable: boolean(raw.clickable), longClickable: boolean(raw["long-clickable"]),
      ...(bounds ? { bounds } : {}), children: readChildren(entry[tag], id)
    }];
  });
}
function boolean(value: string | undefined): boolean | undefined {
  return value === "true" ? true : value === "false" ? false : undefined;
}

function label(node: AndroidHierarchyNode): string | undefined {
  const own = node.password ? undefined : node.contentDescription?.trim() || node.text?.trim();
  return own || node.children.filter((child) => child.visible !== false && !child.clickable && !child.longClickable).map(label).find(Boolean);
}

/** Heuristics over captured attributes, not a reconstruction of TalkBack semantics. */
export function checkAndroidHierarchy(hierarchy: AndroidHierarchy, metrics: AndroidDeviceMetrics): readonly AndroidHierarchyCheck[] {
  const visit = (nodes: AndroidHierarchy): AndroidHierarchyCheck[] => nodes.flatMap((node) => {
    const children = visit(node.children);
    if ((!node.clickable && !node.longClickable) || node.visible === false || node.enabled === false) return children;
    const base = { nodeId: node.id };
    if (node.visible === undefined || node.enabled === undefined) return [
      ...(["actionable-label", "touch-target-size"] as const).map((rule) => ({ ...base, rule, status: "unassessed" as const, message: "Visibility or enabled state was not captured." })),
      ...children
    ];
    const named = label(node);
    const nameCheck: AndroidHierarchyCheck = { ...base, rule: "actionable-label",
      status: node.password ? "unassessed" : named ? "passed" : "finding",
      message: node.password ? "Password-node labels require manual review." : named ? "Actionable node has captured label text." : "Potential missing label: actionable node has no text or content description in its non-actionable group." };
    const density = metrics.densityDpi;
    const measurable = node.bounds && density !== undefined && Number.isFinite(density) && density > 0;
    const width = measurable ? (node.bounds!.right - node.bounds!.left) * 160 / density! : undefined;
    const height = measurable ? (node.bounds!.bottom - node.bounds!.top) * 160 / density! : undefined;
    const sizeCheck: AndroidHierarchyCheck = { ...base, rule: "touch-target-size",
      status: !measurable ? "unassessed" : width! < 48 || height! < 48 ? "finding" : "passed",
      message: !measurable ? "Bounds or display density was not captured." : `Captured bounds are ${width!.toFixed(1)} × ${height!.toFixed(1)} dp; review targets below 48 × 48 dp, viewport/ancestor clipping, and any expanded hit area.` };
    return [nameCheck, sizeCheck, ...children];
  });
  return immutableSnapshot(visit(hierarchy));
}

