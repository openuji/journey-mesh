/**
 * The Android observation contract of the Appium executor: what its executor observers receive and
 * the contract they declare. Observers import the executor only through this entry. It loads no
 * device runtime; `webdriverio` and `appium` stay behind the executor's root entry.
 */
export type * from "./contracts.js";
export { appiumAndroidObservationContract } from "./observation-contract.js";
export { appiumExecutorName } from "./name.js";
