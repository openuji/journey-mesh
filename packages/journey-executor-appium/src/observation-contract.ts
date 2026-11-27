import { contract } from "@openuji/journey-plugin";
import type { AppiumExecutionObserver } from "./contracts.js";
import type { IosAppiumExecutionObserver } from "./ios-contracts.js";

/**
 * Separate observation contracts for Android (UiAutomator2) and iOS (XCUITest), so an
 * Android accessibility observer cannot be attached to an iOS executor or vice versa.
 */
export const appiumAndroidObservationContract = contract<AppiumExecutionObserver>("@openuji/appium-android-observation/v1");
export const appiumIosObservationContract = contract<IosAppiumExecutionObserver>("@openuji/appium-ios-observation/v1");
