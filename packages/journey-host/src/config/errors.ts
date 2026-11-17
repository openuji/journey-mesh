/** Invalid configuration: nothing was started. `testIds` lists the tests that could be selected instead. */
export class JourneyConfigError extends Error {
  override name = "JourneyConfigError";
  readonly testId?: string;
  readonly testIds: readonly string[];

  constructor(message: string, context: { testId?: string; testIds?: readonly string[] } = {}) {
    super(message);
    this.testId = context.testId;
    this.testIds = Object.freeze([...(context.testIds ?? [])]);
  }
}
