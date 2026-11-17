import { contract } from "@openuji/journey-plugin";
import type { PlaywrightExecutionObserver } from "./observers/contracts.js";

/** Observers declaring this automation are attached to Playwright executions. */
export const playwrightAutomation = contract<PlaywrightExecutionObserver>("playwright");
