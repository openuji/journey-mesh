import { contract } from "@openuji/journey-plugin";
import type { AppiumExecutionObserver } from "./contracts.js";

/**
 * The observation contract the Appium executor publishes. It names Android because its observations
 * expose Android device metrics and deep links; a future Appium iOS executor publishes its own contract.
 */
export const appiumAndroidObservationContract = contract<AppiumExecutionObserver>("@openuji/appium-android-observation/v1");
