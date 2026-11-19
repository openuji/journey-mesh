import { validateHref } from "@openuji/journey-run-record";
import { reportModelFormat, testModelFormat, type ReportModel, type TestModel } from "./types.js";

/** Reads bytes of a file; `href` is relative to the directory being read (a run or a comparison). */
export type ByteReader = (href: string) => Promise<Uint8Array>;
/** Reads and parses a JSON file; `href` is relative to the directory being read. */
export type JsonReader = (href: string) => Promise<unknown>;

/** A JSON reader over plain bytes. Consumers that store the model differently pass their own `JsonReader`. */
export const jsonReader = (read: ByteReader): JsonReader => async (href) => {
  validateHref(href);
  return JSON.parse(new TextDecoder().decode(await read(href)));
};

export type LoadedReport = Readonly<{
  model: ReportModel;
  /** Prefix of this report's run directory within what `read` reads (`""`, or `subjects/<side>/`). */
  base: string;
  loadTest(id: string): Promise<TestModel>;
  /** The run report of a comparison subject, or null. */
  loadSubject(side: "baseline" | "candidate"): Promise<LoadedReport | null>;
  readJson<T = unknown>(href: string): Promise<T>;
}>;

/** Open `report/report.json` of a run or comparison directory. Tests and subjects load on demand. */
export async function loadReportModel(read: JsonReader, base = ""): Promise<LoadedReport> {
  const json = async <T>(href: string) => { validateHref(href); return await read(base + href) as T; };
  const model = await json<ReportModel>("report/report.json");
  if (model?.format !== reportModelFormat || model.version !== 1) throw new Error("Expected a Journey Mesh report model (report/report.json, version 1). Build it with `journey-mesh report <run>`.");
  return {
    model, base, readJson: json,
    async loadTest(id) {
      const entry = model.tests.find((item) => item.id === id);
      if (!entry) throw new Error(`Unknown report test ${id}`);
      const test = await json<TestModel>(entry.href);
      if (test?.format !== testModelFormat || test.version !== 1 || test.id !== id) throw new Error(`Invalid test model for ${id}`);
      return test;
    },
    async loadSubject(side) {
      const directory = model.comparison?.subjects[side].directory;
      return directory ? loadReportModel(read, `${base}${directory}/`) : null;
    }
  };
}
