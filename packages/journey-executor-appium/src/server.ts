import { contract } from "@openuji/journey-plugin";

/** A ready Appium server. */
export type AppiumServer = Readonly<{ url: string }>;
export const appiumServerContract = contract<AppiumServer>("@openuji/appium-server/v1");
