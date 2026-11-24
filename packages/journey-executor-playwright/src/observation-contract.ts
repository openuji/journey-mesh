import { contract } from "@openuji/journey-plugin";
import type { PlaywrightExecutionObserver } from "./observers/contracts.js";

/**
 * The observation contract the Playwright executor publishes. Executor observers that declare it
 * are attached to Playwright executions; the host compares the ids before allocating resources.
 */
export const playwrightObservationContract = contract<PlaywrightExecutionObserver>("@openuji/playwright-observation/v1");
