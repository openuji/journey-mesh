/** Directory name of one test below `tests/`. Dots are encoded so no name is `.` or `..`. */
export const testDirectory = (id: string) => encodeURIComponent(id).replace(/\./g, "%2E");
/** The test record of one test, relative to the run directory. */
export const testRecordHref = (id: string) => `tests/${testDirectory(id)}/run.json`;
/** Where a test's evidence files are written, relative to the run directory. */
export const testFilesPrefix = (id: string) => `tests/${testDirectory(id)}/files`;
/** Where a service's evidence files are written, relative to the run directory. */
export const serviceFilesPrefix = (key: string) => `services/${key}`;
/** Where suite-level evidence files are written, relative to the run directory. */
export const suiteFilesPrefix = "files";
/** Top-level names owned by the run record or by consumers deriving from it. */
export const reservedNames = Object.freeze(["run.json", "files", "tests", "services", "report"]);

/** Hrefs are relative paths below the run directory: no empty, `.` or `..` segments, no URL syntax. */
export function validateHref(href: string): void {
  if (typeof href !== "string" || !href || /[\\:?#\u0000]/.test(href) || href.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error(`Invalid run record reference: ${String(href)}`);
  }
}
