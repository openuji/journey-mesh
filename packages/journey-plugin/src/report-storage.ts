/** One policy for report data, provider evidence, pages, and application assets. */
export const defaultMaxFileBytes = 5 * 1024 * 1024;
export type ReportStorageOptions = Readonly<{ maxFileBytes: number }>;

export function reportFileLimit(maxFileSizeMiB: unknown = 5): number {
  const bytes = typeof maxFileSizeMiB === "number" ? Math.floor(maxFileSizeMiB * 1024 * 1024) : NaN;
  if (!Number.isFinite(maxFileSizeMiB) || !Number.isSafeInteger(bytes) || bytes <= 0) throw new Error("report.maxFileSizeMiB must resolve to a positive safe byte count");
  return bytes;
}

export class ReportFileSizeError extends Error {
  constructor(readonly file: string, readonly bytes: number, readonly maxFileBytes: number) {
    super(`Report file ${file} is ${bytes} bytes; the limit is ${maxFileBytes} bytes. Split the document or increase report.maxFileSizeMiB.`);
    this.name = "ReportFileSizeError";
  }
}

export const byteLength = (data: string | Uint8Array): number => typeof data === "string" ? new TextEncoder().encode(data).byteLength : data.byteLength;
export function checkReportFile(name: string, data: string | Uint8Array, maxFileBytes: number): void {
  const bytes = byteLength(data);
  if (bytes > maxFileBytes) throw new ReportFileSizeError(name, bytes, maxFileBytes);
}

export function validateReportHref(href: string): void {
  if (typeof href !== "string" || !href || /[\\:?#\u0000]/.test(href) || href.split("/").some((part) => !part || part === "." || part === "..")) throw new Error("Report reference must be a relative evidence path");
}
