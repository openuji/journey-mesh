import type { JourneyExecutionContext } from "../adapters/contracts.js";
import { errorToJourneyRunError } from "../errors.js";
import { profileDescriptor } from "../observers/contracts.js";
import type { JourneyProfileAssessment } from "../results/contracts.js";

export type AssessedProfile = Readonly<{
  context: JourneyExecutionContext;
  assessment: JourneyProfileAssessment;
}>;

/** Evaluate all applicability callbacks before any execution or shared fixture starts. */
export async function assessProfiles(
  contexts: readonly JourneyExecutionContext[]
): Promise<readonly AssessedProfile[]> {
  return contexts.reduce<Promise<readonly AssessedProfile[]>>(async (pending, context) => {
    const previous = await pending;
    const assessment = await assessProfile(context);
    return Object.freeze([...previous, Object.freeze({ context, assessment })]);
  }, Promise.resolve(Object.freeze([])));
}

async function assessProfile(context: JourneyExecutionContext): Promise<JourneyProfileAssessment> {
  const profile = Object.freeze(profileDescriptor(context.profile));
  try {
    return await context.plan.operations.reduce<Promise<JourneyProfileAssessment>>(async (pending, operation) => {
      const previous = await pending;
      if (previous.kind !== "applicable") return previous;
      if (!context.profile.appliesTo || await context.profile.appliesTo(operation, context)) return previous;
      return Object.freeze({
        kind: "not-applicable",
        profile,
        reason: `Profile ${profile.id} does not apply to touchpoint ${operation.touchpointId} (operation ${operation.id})`
      });
    }, Promise.resolve(Object.freeze({ kind: "applicable", profile })));
  } catch (error) {
    return Object.freeze({ kind: "failed", profile, error: Object.freeze(errorToJourneyRunError(error)) });
  }
}
