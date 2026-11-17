/** Directory of one test's evidence below its suite root. */
export const testDirectory = (id: string) => encodeURIComponent(id).replace(/\./g, "%2E");
/** Directory of one comparison subject's copied suite evidence below the comparison root. */
export const subjectDirectory = (side: "baseline" | "candidate") => `subjects/${side}`;
export const artifactHref = (path: string) => path.split("/").map(encodeURIComponent).join("/");
