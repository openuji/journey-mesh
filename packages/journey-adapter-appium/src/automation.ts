import { contract } from "@openuji/journey-plugin";
import type { AppiumExecutionObserver } from "./contracts.js";

/** Observers declaring this automation are attached to Appium executions. */
export const appiumAutomation = contract<AppiumExecutionObserver>("appium");
