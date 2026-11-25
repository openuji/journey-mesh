/**
 * The observation contract of the Playwright executor: what its executor observers receive, the
 * contract they declare, and pure helpers they need. Observers import the executor only through this
 * entry. It loads no browser runtime; `playwright` appears in types only.
 */
export type * from "./observers/contracts.js";
export { playwrightObservationContract } from "./observation-contract.js";
export { playwrightExecutorName } from "./name.js";
export { toPlaywrightLocator, toPlaywrightObservationLocator } from "./locators.js";
/** Where the user is, read exactly as the executor's step checks read it. */
export { PlaywrightFocus } from "./focus.js";
