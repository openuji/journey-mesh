import { XMLParser, XMLValidator } from "fast-xml-parser";
import type { IosDeviceMetrics } from "@openuji/journey-executor-appium/observation";
import { immutableSnapshot } from "@openuji/journey-core";

export type IosHierarchyNode = Readonly<{
  id: string;
  type?: string;
  name?: string;
  label?: string;
  value?: string;
  secure?: boolean;
  visible?: boolean;
  enabled?: boolean;
  accessible?: boolean;
  bounds?: Readonly<{ x: number; y: number; width: number; height: number }>;
  children: readonly IosHierarchyNode[];
}>;
export type IosHierarchy = readonly IosHierarchyNode[];
export type IosHierarchyCheck = Readonly<{
  rule: "actionable-label" | "touch-target-size";
  nodeId: string;
  status: "passed" | "finding" | "unassessed";
  message: string;
}>;

const ACTIONABLE_TYPES = new Set([
  "XCUIElementTypeButton",
  "XCUIElementTypeCell",
  "XCUIElementTypeSwitch",
  "XCUIElementTypeLink",
  "XCUIElementTypeTab",
  "XCUIElementTypeSlider",
  "XCUIElementTypeStepper",
  "XCUIElementTypeSegmentedControl",
  "XCUIElementTypeTextField",
  "XCUIElementTypeSecureTextField",
  "XCUIElementTypeSearchField"
]);

/** Preserve captured XCUITest XML while removing secure-text-field values and labels. */
export function redactIosHierarchy(xml: string): string {
  return xml.replace(/<[^!?/][^>]*>/g, (tag) =>
    /^<XCUIElementTypeSecureTextField\b|\btype=["']XCUIElementTypeSecureTextField["']/.test(tag)
      ? tag.replace(/\b(value|label)=("[^"]*"|'[^']*')/g, '$1="[redacted]"')
      : tag
  );
}

/** Parses Appium XCUITest hierarchies without runtime access. */
export function parseIosHierarchy(xml: string): IosHierarchy {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error("iOS hierarchy must not contain document types or entities");
  const valid = XMLValidator.validate(xml);
  if (valid !== true) throw new Error(`Invalid iOS hierarchy XML: ${valid.err.msg}`);
  const parsed: unknown = new XMLParser({
    preserveOrder: true,
    ignoreAttributes: false,
    attributeNamePrefix: "",
    parseTagValue: false,
    parseAttributeValue: false,
    trimValues: false
  }).parse(redactIosHierarchy(xml));
  const roots = readChildren(parsed, "");
  if (
    !Array.isArray(parsed) ||
    !parsed.some(
      (item) =>
        typeof item === "object" &&
        item !== null &&
        ("AppiumAUT" in item || "XCUIElementTypeApplication" in item)
    )
  ) {
    throw new Error("iOS source must contain an AppiumAUT or XCUIElementTypeApplication root");
  }
  return immutableSnapshot(roots);
}

function readChildren(value: unknown, parent: string): IosHierarchyNode[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry, index) => {
    if (typeof entry !== "object" || entry === null) return [];
    const tag = Object.keys(entry).find((key) => key !== ":@" && !key.startsWith("#") && !key.startsWith("?"));
    if (!tag) return [];
    if (tag === "AppiumAUT") return readChildren((entry as Record<string, unknown>)[tag], parent);
    const raw: Record<string, string> = (entry as Record<string, Record<string, string>>)[":@"] ?? {};
    const id = `${parent}/${index}`;
    const type = raw.type ?? tag;
    const x = numberAttr(raw.x);
    const y = numberAttr(raw.y);
    const width = numberAttr(raw.width);
    const height = numberAttr(raw.height);
    const bounds =
      x !== undefined && y !== undefined && width !== undefined && height !== undefined && width >= 0 && height >= 0
        ? { x, y, width, height }
        : undefined;
    return [
      {
        id,
        type,
        name: raw.name,
        label: raw.label,
        value: raw.value,
        secure: type === "XCUIElementTypeSecureTextField" ? true : undefined,
        visible: booleanAttr(raw.visible),
        enabled: booleanAttr(raw.enabled),
        accessible: booleanAttr(raw.accessible),
        ...(bounds ? { bounds } : {}),
        children: readChildren((entry as Record<string, unknown>)[tag], id)
      }
    ];
  });
}

function booleanAttr(value: string | undefined): boolean | undefined {
  return value === "true" ? true : value === "false" ? false : undefined;
}

function numberAttr(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function label(node: IosHierarchyNode): string | undefined {
  const own = node.secure ? undefined : node.label?.trim() || node.name?.trim() || node.value?.trim();
  return (
    own ||
    node.children
      .filter((child) => child.visible !== false && !ACTIONABLE_TYPES.has(child.type ?? ""))
      .map(label)
      .find(Boolean)
  );
}

/** Heuristics over captured XCUITest attributes in UIKit points (`44 × 44 pt`), not VoiceOver conformance. */
export function checkIosHierarchy(hierarchy: IosHierarchy, _metrics: IosDeviceMetrics): readonly IosHierarchyCheck[] {
  const visit = (nodes: IosHierarchy): IosHierarchyCheck[] =>
    nodes.flatMap((node) => {
      const children = visit(node.children);
      if (!ACTIONABLE_TYPES.has(node.type ?? "") || node.visible === false || node.enabled === false) return children;
      const base = { nodeId: node.id };
      if (node.visible === undefined || node.enabled === undefined) {
        return [
          ...(["actionable-label", "touch-target-size"] as const).map((rule) => ({
            ...base,
            rule,
            status: "unassessed" as const,
            message: "Visibility or enabled state was not captured."
          })),
          ...children
        ];
      }
      const named = label(node);
      const nameCheck: IosHierarchyCheck = {
        ...base,
        rule: "actionable-label",
        status: node.secure ? "unassessed" : named ? "passed" : "finding",
        message: node.secure
          ? "Secure-text-field labels require manual review."
          : named
            ? "Actionable node has captured label or accessibility identifier text."
            : "Potential missing label: actionable node has no label, name, or text in its non-actionable group."
      };
      const measurable = node.bounds !== undefined;
      const width = node.bounds?.width;
      const height = node.bounds?.height;
      const sizeCheck: IosHierarchyCheck = {
        ...base,
        rule: "touch-target-size",
        status: !measurable ? "unassessed" : width! < 44 || height! < 44 ? "finding" : "passed",
        message: !measurable
          ? "Bounds were not captured."
          : `Captured bounds are ${width!.toFixed(1)} × ${height!.toFixed(1)} pt; review targets below 44 × 44 pt, viewport/ancestor clipping, and any expanded hit area.`
      };
      return [nameCheck, sizeCheck, ...children];
    });
  return immutableSnapshot(visit(hierarchy));
}
