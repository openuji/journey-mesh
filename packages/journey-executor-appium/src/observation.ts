/**
 * The observation contracts of the Appium executors: what their executor observers receive and
 * the contracts they declare. Observers import the executor only through this entry. It loads no
 * device runtime; `webdriverio` and `appium` stay behind the executor's runtime entries.
 */
export type * from "./contracts.js";
export type * from "./ios-contracts.js";
export { appiumAndroidObservationContract, appiumIosObservationContract } from "./observation-contract.js";
export { appiumExecutorName, appiumIosExecutorName } from "./name.js";
